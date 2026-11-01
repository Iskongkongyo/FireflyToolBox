import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { build } from 'esbuild'
import { capacityFixture, MiB } from './module-capacity-fixtures.mjs'

const draftBundle = await build({ entryPoints: ['src/services/toolDraft.ts'], bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{
  name: 'raw-template', setup(plugin) {
    plugin.onResolve({ filter: /\?raw$/ }, args => ({ path: path.resolve(args.resolveDir, args.path.replace(/\?raw$/, '')), namespace: 'raw' }))
    plugin.onLoad({ filter: /.*/, namespace: 'raw' }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'text' }))
  },
}] })
const { emptyModuleDraft, templateContent, readToolWorkspace } = await import('data:text/javascript;base64,' + Buffer.from(draftBundle.outputFiles[0].text).toString('base64'))
const guide = (await readFile('skills/firefly-module-author/SKILL.md', 'utf8')).replace(/\r\n?/g, '\n')
const python = guide.match(/```python\n([\s\S]*?)\n```/)[1]
async function workspace(t) {
  const prefix = path.join(tmpdir(), 'firefly-capacity-'), directory = await mkdtemp(prefix)
  t.after(async () => { assert(path.resolve(directory).startsWith(path.resolve(prefix))); await rm(directory, { recursive: true, force: true }) })
  await writeFile(path.join(directory, 'pack.py'), python)
  return directory
}
function command(executable, args) { return spawnSync(executable, args, { encoding: 'utf8', windowsHide: true, timeout: 120000 }) }
function packers(directory, source, suffix) {
  const result = [
    { output: path.join(directory, `node-${suffix}.fftool`), executable: process.execPath, args: ['scripts/bundle-module.mjs'] },
    { output: path.join(directory, `python-${suffix}.fftool`), executable: 'python', args: ['-X', 'utf8', path.join(directory, 'pack.py')] },
  ]
  if (process.env.FIREFLY_TEST_EXE) result.push({ output: path.join(directory, `native-${suffix}.fftool`), executable: process.env.FIREFLY_TEST_EXE, args: ['--pack-fftool'] })
  return result.map(item => ({ ...item, result: command(item.executable, [...item.args, source, item.output]) }))
}
function assertPacked(results) {
  for (const item of results) {
    assert.equal(item.result.status, 0, `${item.executable}: ${item.result.stderr}\n${item.result.stdout}`)
    if (process.env.FIREFLY_TEST_EXE) {
      const checked = command(process.env.FIREFLY_TEST_EXE, ['--check-fftool', item.output])
      assert.equal(checked.status, 0, checked.stdout + checked.stderr)
      assert.equal(JSON.parse(checked.stdout).ok, true)
    }
  }
}
test('workspace recovery uses UTF-8 byte limits, 32 MiB aggregate, 128 sources and 96 MiB resources', () => {
  const draft = { ...emptyModuleDraft(), ...templateContent('web-blank') }
  const recover = () => readToolWorkspace(JSON.stringify({ schema_version: 1, draft, contents: {} }))
  draft.scripts = [{ path: 'index.html', source: '界'.repeat(Math.floor(8 * MiB / 3)) + 'xx' }]
  assert(recover())
  draft.scripts[0].source += 'x'
  assert.equal(recover(), null)
  draft.scripts = Array.from({ length: 4 }, (_, index) => ({ path: `${index}.html`, source: 'a'.repeat(8 * MiB) }))
  assert(recover())
  draft.scripts.push({ path: 'extra.js', source: 'x' })
  assert.equal(recover(), null)
  draft.scripts = Array.from({ length: 128 }, (_, index) => ({ path: `${index}.html`, source: 'x' }))
  draft.resources = [{ path: 'assets/model.bin', size: 96 * MiB, sha256: '0'.repeat(64) }]
  assert(recover())
  draft.scripts.push({ path: 'overflow.js', source: 'x' })
  assert.equal(recover(), null)
  draft.scripts.pop(); draft.resources[0].size++
  assert.equal(recover(), null)
  Object.assign(draft, templateContent('text-blank')); delete draft.resources
  draft.scripts[0].source = 'a'.repeat(MiB)
  assert(recover())
  draft.scripts[0].source += 'a'
  assert(recover(), 'unfinished text drafts retain the previous recovery behavior')
  draft.scripts[0].source = 'a'.repeat(4 * MiB + 1)
  assert.equal(recover(), null)
})
test('standalone packers accept exactly 8 MiB source and reject one extra byte', async t => {
  const directory = await workspace(t), source = path.join(directory, 'source')
  await capacityFixture(source, { htmlBytes: 8 * MiB })
  assertPacked(packers(directory, source, '8mib'))
  await writeFile(path.join(source, 'page-0.html'), ' '.repeat(8 * MiB + 1))
  for (const item of packers(directory, source, 'overflow')) assert.notEqual(item.result.status, 0)
  await capacityFixture(source)
  const prefix = 'export function mount(){}'
  await writeFile(path.join(source, 'main-0.js'), prefix + '\v'.repeat(8 * MiB - prefix.length))
  assertPacked(packers(directory, source, 'escaped-js'))
})
test('48 referenced source files pack successfully; total source over 32 MiB is rejected', async t => {
  const directory = await workspace(t), source = path.join(directory, 'source')
  await capacityFixture(source, { entries: 16 })
  assertPacked(packers(directory, source, '48-files'))
  await capacityFixture(source, { entries: 16, htmlBytes: 3 * MiB })
  for (const item of packers(directory, source, 'total-overflow')) assert.notEqual(item.result.status, 0)
})
test('96 MiB resources produce usable packages above 64 MiB; larger resources and aggregate overflow fail', async t => {
  const directory = await workspace(t), source = path.join(directory, 'source')
  await capacityFixture(source, { resources: [96 * MiB] })
  const accepted = packers(directory, source, '96mib')
  assertPacked(accepted)
  for (const item of accepted) {
    const file = await readFile(item.output)
    assert(file.length > 64 * MiB && file.length < 128 * MiB)
  }
  await capacityFixture(source, { resources: [96 * MiB + 1] })
  for (const item of packers(directory, source, 'resource-overflow')) assert.notEqual(item.result.status, 0)
  await capacityFixture(source, { resources: [96 * MiB, 32 * MiB] })
  for (const item of packers(directory, source, 'package-overflow')) assert.notEqual(item.result.status, 0)
})
