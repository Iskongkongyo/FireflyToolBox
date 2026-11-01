import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { unzipSync, strFromU8 } from 'fflate'

const root = path.resolve('.')
function bundle(directory, destination) {
  return spawnSync(process.execPath, ['scripts/bundle-module.mjs', directory, destination], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 60000,
  })
}
async function workspace(t) {
  const prefix = path.join(tmpdir(), 'firefly-v7-')
  const directory = await mkdtemp(prefix)
  t.after(async () => {
    assert(path.resolve(directory).startsWith(path.resolve(prefix)))
    await rm(directory, { recursive: true, force: true })
  })
  return directory
}
async function example(name, destination) {
  await cp(path.join(root, 'examples/modules', name), destination, {
    recursive: true, filter: file => !file.endsWith('.fftool') && path.basename(file) !== 'node_modules',
  })
}

test('the QuickJS example and all five v7 web examples produce usable package entries', async t => {
  const directory = await workspace(t)
  for (const name of ['reverse', 'browser-demo', 'node-compat', 'image-card', 'image-adjust', 'media-files']) {
    const source = path.join(directory, name), output = path.join(directory, name + '.fftool')
    await example(name, source)
    const result = bundle(source, output)
    assert.equal(result.status, 0, name + ': ' + result.stderr)
    const files = unzipSync(await readFile(output)), manifest = JSON.parse(strFromU8(files['manifest.json']))
    if (name === 'reverse') {
      assert.equal(manifest.schema_version, 1)
      assert.equal(manifest.tools[0].runtime, undefined)
    } else {
      assert.equal(manifest.schema_version, 7)
      assert(manifest.tools.every(tool => tool.ui.kind === 'web' && tool.runtime === 'browser'))
      for (const tool of manifest.tools) {
        assert(files[tool.entry] && files[tool.ui.style] && files[tool.ui.script], name)
      }
      for (const resource of manifest.resources) assert.equal(files[resource.path].length, resource.size)
      if (name === 'image-adjust') {
        assert(manifest.resources.some(resource => resource.path === 'assets/badge.svg'))
        assert(manifest.resources.some(resource => resource.path === 'assets/dots.svg'))
      }
    }
  }
})

test('the bundler rejects every obsolete web manifest version before producing an archive', async t => {
  const directory = await workspace(t), source = path.join(directory, 'web')
  await example('image-card', source)
  const manifest = JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8'))
  for (let version = 1; version <= 6; version++) {
    manifest.schema_version = version
    await writeFile(path.join(source, 'manifest.json'), JSON.stringify(manifest))
    const result = bundle(source, path.join(directory, version + '.fftool'))
    assert.notEqual(result.status, 0, 'web v' + version)
    assert.match(result.stderr, /v7/)
  }
})

test('both standalone packers accept the guide defaults and 64 origins but reject 65', async t => {
  const directory = await workspace(t), source = path.join(directory, 'guide')
  const guide = (await readFile(path.join(root, 'skills/firefly-module-author/SKILL.md'), 'utf8')).replace(/\r\n?/g, '\n')
  const section = guide.split('## 网页工具模板')[1].split('### 页面背景与配色')[0]
  const blocks = [...section.matchAll(/```(?:json|html|css|js)\n([\s\S]*?)\n```/g)].map(match => match[1])
  assert.equal(blocks.length, 4)
  await example('image-card', source)
  for (const [index, name] of ['manifest.json', 'index.html', 'style.css', 'main.js'].entries()) {
    await writeFile(path.join(source, name), blocks[index])
  }
  const manifest = JSON.parse(blocks[0])
  assert.equal(manifest.min_app_version, JSON.parse(await readFile('package.json', 'utf8')).version)
  assert.equal(manifest.limits.input_bytes, 2147483648)
  assert.equal(manifest.limits.output_bytes, 2147483648)
  manifest.permissions = ['network']
  manifest.network.hosts = Array.from({ length: 64 }, (_, index) => `https://host${index}.example.com`)
  const packer = path.join(directory, 'pack_fftool.py')
  await writeFile(packer, guide.match(/```python\n([\s\S]*?)\n```/)[1])
  for (const count of [64, 65]) {
    if (count === 65) manifest.network.hosts.push('https://extra.example.com')
    await writeFile(path.join(source, 'manifest.json'), JSON.stringify(manifest))
    const jsOutput = path.join(directory, `js-${count}.fftool`)
    const pythonOutput = path.join(directory, `python-${count}.fftool`)
    const results = [bundle(source, jsOutput), spawnSync('python', ['-X', 'utf8', packer, source, pythonOutput], {
      cwd: root, encoding: 'utf8', windowsHide: true, timeout: 60000,
    })]
    for (const result of results) {
      if (count === 64) assert.equal(result.status, 0, result.stderr)
      else { assert.notEqual(result.status, 0); assert.match(result.stderr, /64/) }
    }
    if (count === 64) for (const output of [jsOutput, pythonOutput]) {
      const packed = JSON.parse(strFromU8(unzipSync(await readFile(output))['manifest.json']))
      assert.equal(packed.network.hosts.length, 64)
      assert.equal(packed.limits.input_bytes, 2147483648)
      assert.equal(packed.limits.output_bytes, 2147483648)
    }
  }
})

test('browser-text entries and a v7 QuickJS manifest are rejected while supported text versions remain usable', async t => {
  const directory = await workspace(t), source = path.join(directory, 'text')
  await example('reverse', source)
  const manifest = JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8'))
  for (const version of [1, 2, 3, 5, 6]) {
    manifest.schema_version = version
    await writeFile(path.join(source, 'manifest.json'), JSON.stringify(manifest))
    assert.equal(bundle(source, path.join(directory, 'text-' + version + '.fftool')).status, 0)
  }
  for (const version of [3, 5, 6, 7]) {
    manifest.schema_version = version
    manifest.tools[0].runtime = 'browser'
    await writeFile(path.join(source, 'manifest.json'), JSON.stringify(manifest))
    assert.notEqual(bundle(source, path.join(directory, 'browser-' + version + '.fftool')).status, 0)
  }
  delete manifest.tools[0].runtime
  manifest.schema_version = 7
  await writeFile(path.join(source, 'manifest.json'), JSON.stringify(manifest))
  assert.notEqual(bundle(source, path.join(directory, 'invalid-text-v7.fftool')).status, 0)
})
