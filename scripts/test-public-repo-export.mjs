import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { preparePublicRepository } from './prepare-public-repo.mjs'

const entry = fileURLToPath(new URL('./prepare-public-repo.mjs', import.meta.url))
const write = async (root, relative, text) => { const file = path.join(root, relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, text) }
const read = (root, relative) => fs.readFile(path.join(root, relative), 'utf8')
async function fixture(t) {
  const temp = await fs.realpath(os.tmpdir()), base = await fs.mkdtemp(path.join(temp, 'firefly-public-export-test-'))
  t.after(async () => {
    assert.equal(path.dirname(await fs.realpath(base)), temp)
    assert(path.basename(base).startsWith('firefly-public-export-test-'))
    await fs.rm(base, { recursive: true, force: true })
  })
  const source = path.join(base, 'private source'), output = path.join(base, 'public output')
  await fs.mkdir(source)
  execFileSync('git', ['init', '--quiet', source], { windowsHide: true })
  await write(source, '.gitignore', '/*\n!/.gitignore\n!/README.md\n!/LICENSE\n!/package.json\n!/src/\n!/scripts/\n!/skills/\n*.log\n')
  await write(source, 'README.md', '# Public fixture\n')
  await write(source, 'LICENSE', 'Fixture license\n')
  await write(source, 'package.json', '{"name":"fixture","private":true}\n')
  await write(source, 'src/main.js', 'export const version = 1\n')
  return { base, source, output, run: options => preparePublicRepository({ sourceRoot: source, outputDir: output, ...options }) }
}

test('preview exports current tracked and untracked contents without creating the destination', async t => {
  const f = await fixture(t)
  execFileSync('git', ['-C', f.source, 'add', '.'], { windowsHide: true })
  await write(f.source, 'src/main.js', 'export const version = 2\n')
  await write(f.source, 'skills/author/SKILL.md', '---\nname: fixture\ndescription: test\n---\n')
  const plan = await f.run({ dryRun: true })
  assert(plan.files.some(file => file.path === 'skills/author/SKILL.md'))
  assert.equal(plan.added.length, plan.files.length)
  await assert.rejects(fs.stat(f.output), { code: 'ENOENT' })
  await f.run()
  assert.equal(await read(f.output, 'src/main.js'), 'export const version = 2\n')
  await assert.rejects(fs.stat(path.join(f.output, '.git')), { code: 'ENOENT' })
})

test('current ignore rules also remove already-tracked ignored files', async t => {
  const f = await fixture(t)
  await write(f.source, 'src/local.log', 'private log')
  execFileSync('git', ['-C', f.source, 'add', '-f', 'src/local.log'], { windowsHide: true })
  const plan = await f.run()
  assert(plan.excluded.some(file => file.path === 'src/local.log' && file.reason === 'gitignore'))
  await assert.rejects(fs.stat(path.join(f.output, 'src/local.log')), { code: 'ENOENT' })
})

test('local signing, environment and machine settings are excluded even if Git permits them', async t => {
  const f = await fixture(t)
  for (const name of ['.env', '.env.production', 'local.properties', 'key.properties', 'release.jks', 'key.pem.key', '.npmrc', 'old-tool.fftool']) await write(f.source, 'src/' + name, 'local-only')
  await write(f.source, 'src/data.bin', new Uint8Array([0, 1, 2]))
  const plan = await f.run()
  assert(plan.files.some(file => file.path === 'src/data.bin'))
  assert.equal(plan.excluded.filter(file => file.reason === 'local-or-sensitive-file').length, 8)
  const ignores = await read(f.output, '.gitignore')
  assert(ignores.includes('/.firefly-public-export.json'))
  assert(ignores.includes('*.jks'))
  const state = await read(f.output, '.firefly-public-export.json')
  assert(!state.includes(f.source)); assert(!state.includes('private source'))
})

test('source changes and removed files update safely while the destination Git metadata survives', async t => {
  const f = await fixture(t)
  await write(f.source, 'src/obsolete.js', 'old')
  await f.run()
  await write(f.output, '.git/config', 'public repository metadata')
  await write(f.source, 'src/main.js', 'new source')
  await fs.unlink(path.join(f.source, 'src/obsolete.js'))
  const plan = await f.run()
  assert.deepEqual(plan.updated, ['src/main.js'])
  assert.deepEqual(plan.removed, ['src/obsolete.js'])
  assert.equal(await read(f.output, '.git/config'), 'public repository metadata')
  assert.equal(await read(f.output, 'src/main.js'), 'new source')
  await assert.rejects(fs.stat(path.join(f.output, 'src/obsolete.js')), { code: 'ENOENT' })
})

test('a repeated export leaves unchanged source files untouched', async t => {
  const f = await fixture(t)
  const first = await f.run(), before = await fs.stat(path.join(f.output, 'src/main.js'))
  const second = await f.run(), after = await fs.stat(path.join(f.output, 'src/main.js'))
  assert.equal(second.added.length + second.updated.length + second.removed.length, 0)
  assert.equal(second.unchanged.length, first.files.length)
  assert.equal(after.mtimeMs, before.mtimeMs)
})

for (const removing of [false, true]) test(`manual edits are preserved when a source file is ${removing ? 'removed' : 'updated'}`, async t => {
  const f = await fixture(t)
  await f.run()
  await write(f.output, 'src/main.js', 'manual public edit')
  const previous = await read(f.output, '.firefly-public-export.json')
  if (removing) await fs.unlink(path.join(f.source, 'src/main.js'))
  else await write(f.source, 'src/main.js', 'new private version')
  await assert.rejects(f.run(), { code: 'OUTPUT_CONFLICT' })
  assert.equal(await read(f.output, 'src/main.js'), 'manual public edit')
  assert.equal(await read(f.output, '.firefly-public-export.json'), previous)
})

test('unmanaged destination files stop the export before any planned write', async t => {
  const f = await fixture(t)
  await f.run(); await write(f.output, 'src/manual.txt', 'keep me')
  await write(f.source, 'src/main.js', 'updated')
  await assert.rejects(f.run(), { code: 'OUTPUT_CONFLICT' })
  assert.equal(await read(f.output, 'src/manual.txt'), 'keep me')
  assert.equal(await read(f.output, 'src/main.js'), 'export const version = 1\n')
})

for (const [label, secret] of [['GITHUB_TOKEN', 'gh' + 'p_' + 'A'.repeat(36)], ['PRIVATE_KEY', '-'.repeat(5) + 'BEGIN PRIVATE KEY' + '-'.repeat(5)]]) test(`${label} is blocked without printing the credential or creating an output`, async t => {
  const f = await fixture(t)
  await write(f.source, 'src/credentials.txt', secret)
  await assert.rejects(f.run(), error => {
    assert.equal(error.code, 'SECRET_DETECTED')
    assert(error.details.some(item => item.rule === label))
    assert(!JSON.stringify({ message: error.message, details: error.details }).includes(secret))
    return true
  })
  await assert.rejects(fs.stat(f.output), { code: 'ENOENT' })
})

test('overlapping destinations and drive roots are rejected', async t => {
  const f = await fixture(t)
  for (const outputDir of [f.source, path.join(f.source, 'public'), f.base, path.parse(f.base).root, path.join(f.base, 'other', '.git')]) await assert.rejects(f.run({ outputDir }), { code: 'OUTPUT_PATH' })
})

test('tampered cleanup metadata cannot point outside the output', async t => {
  const f = await fixture(t)
  await f.run(); await write(f.base, 'victim.txt', 'untouched')
  const state = JSON.parse(await read(f.output, '.firefly-public-export.json'))
  state.files['../victim.txt'] = 'a'.repeat(64)
  await write(f.output, '.firefly-public-export.json', JSON.stringify(state))
  await assert.rejects(f.run(), { code: 'INVALID_STATE' })
  assert.equal(await read(f.base, 'victim.txt'), 'untouched')
})

test('directory junctions in selected source paths are rejected', async t => {
  const f = await fixture(t)
  await write(f.base, 'outside/private.txt', 'not project data')
  await fs.mkdir(path.join(f.source, 'src'), { recursive: true })
  try { await fs.symlink(path.join(f.base, 'outside'), path.join(f.source, 'src/linked'), process.platform === 'win32' ? 'junction' : 'dir') }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('Symlinks are unavailable'); return }; throw error }
  await assert.rejects(f.run(), error => ['UNSAFE_PATH', 'UNSAFE_SOURCE_PATH'].includes(error.code))
  await assert.rejects(fs.stat(f.output), { code: 'ENOENT' })
})

test('a source file referenced by Rust cannot silently disappear through ignore rules', async t => {
  const f = await fixture(t)
  await write(f.source, 'src/main.rs', 'const DATA: &str = include_str!("../private.md");')
  await write(f.source, 'private.md', 'unexported note')
  await assert.rejects(f.run(), { code: 'MISSING_BUILD_INPUT' })
})

test('CLI preview works with spaces and Unicode paths and produces parseable JSON', async t => {
  const f = await fixture(t), output = path.join(f.base, '公开目录 with spaces')
  const result = spawnSync(process.execPath, [entry, '--source', f.source, '--output', output, '--dry-run', '--json'], { encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).dryRun, true)
  await assert.rejects(fs.stat(output), { code: 'ENOENT' })
})

test('a destination junction cannot redirect the export into another directory', async t => {
  const f = await fixture(t)
  await fs.mkdir(path.join(f.base, 'other'))
  try { await fs.symlink(path.join(f.base, 'other'), f.output, process.platform === 'win32' ? 'junction' : 'dir') }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('Symlinks are unavailable'); return }; throw error }
  await assert.rejects(f.run(), { code: 'OUTPUT_PATH' })
  assert.deepEqual(await fs.readdir(path.join(f.base, 'other')), [])
})

test('existing local build caches are preserved and never enter the export record', async t => {
  const f = await fixture(t)
  await f.run(); await write(f.output, 'node_modules/local/cache.txt', 'do not touch')
  await write(f.source, 'src/main.js', 'source update')
  await f.run()
  assert.equal(await read(f.output, 'node_modules/local/cache.txt'), 'do not touch')
  const state = JSON.parse(await read(f.output, '.firefly-public-export.json'))
  assert(!Object.keys(state.files).some(file => file.startsWith('node_modules/')))
})

test('unmanaged generated files covered by nested ignore rules survive a refresh', async t => {
  const f = await fixture(t)
  await write(f.source, 'src/.gitignore', '/generated.gradle.kts\n')
  await f.run(); await write(f.output, 'src/generated.gradle.kts', 'local generated settings')
  await write(f.source, 'src/main.js', 'new source')
  await f.run()
  assert.equal(await read(f.output, 'src/generated.gradle.kts'), 'local generated settings')
  assert(!Object.keys(JSON.parse(await read(f.output, '.firefly-public-export.json')).files).includes('src/generated.gradle.kts'))
})

test('previously exported files that are now ignored are removed only when unchanged', async t => {
  const f = await fixture(t)
  await write(f.source, 'src/obsolete.js', 'previously public')
  await f.run(); await write(f.source, 'src/.gitignore', '/obsolete.js\n')
  const result = await f.run()
  assert(result.removed.includes('src/obsolete.js'))
  await assert.rejects(fs.stat(path.join(f.output, 'src/obsolete.js')), { code: 'ENOENT' })
})
