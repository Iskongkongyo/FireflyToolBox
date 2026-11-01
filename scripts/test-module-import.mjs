import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'

const bundle = await build({ entryPoints: ['src/services/moduleImportQueue.ts'], bundle: true, write: false, platform: 'node', format: 'esm' })
const { createModuleImportQueue } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'))
const summary = path => ({ module_id: path, name: path, version: '1.0.0', author: 'Test', tools: ['Tool'], tool_ids: [path + '.tool'], categories: ['Test'], network_hosts: [], builtin: false, modified: false })
function fixture(options = {}) {
  const busy = { value: false }, inspected = [], installed = []
  let refreshes = 0
  const queue = createModuleImportQueue({ busy, inspect: async path => { inspected.push(path); return options.inspect ? options.inspect(path) : summary(path) }, install: async path => { installed.push(path); return options.install ? options.install(path) : summary(path) }, refresh: async () => { refreshes++; await options.refresh?.() }, errorMessage: error => error.message })
  return { ...queue, busy, inspected, installed, refreshes: () => refreshes }
}

test('adding multiple files appends unique paths and preserves the existing queue', async () => {
  const f = fixture()
  await f.add(['C:/a.fftool', 'C:/b.fftool', 'C:/a.fftool'])
  await f.add(['C:/b.fftool', 'C:/c.fftool'])
  assert.deepEqual(f.items.value.map(item => item.fileName), ['a.fftool', 'b.fftool', 'c.fftool'])
  assert.equal(f.inspected.length, 3)
  await f.add([])
  assert.equal(f.items.value.length, 3)
})

test('inspection failures do not discard valid files and a duplicate module can be rechecked after removal', async () => {
  const f = fixture({ inspect: path => { if (path === 'bad.txt') throw new Error('Not a package'); return summary('same.id') } })
  await f.add(['a.fftool', 'bad.txt', 'alias.fftool'])
  assert.deepEqual(f.items.value.map(item => item.state), ['ready', 'invalid', 'invalid'])
  assert.equal(f.items.value[1].fileName, 'bad.txt')
  assert.match(f.items.value[2].error, /同一工具包 ID/)
  f.remove(f.items.value[0].id)
  await f.retryCheck(f.items.value[1].id)
  assert.equal(f.items.value[1].state, 'ready')
})

test('batch installation is serial, continues after failures, and retries only uninstalled files', async () => {
  let active = 0, peak = 0, fail = true
  const f = fixture({ install: async path => {
    active++; peak = Math.max(peak, active)
    await new Promise(resolve => setTimeout(resolve, 3)); active--
    if (path === 'b.fftool' && fail) throw new Error('Disk full')
    return summary(path)
  } })
  await f.add(['a.fftool', 'b.fftool', 'c.fftool'])
  await f.install()
  assert.equal(peak, 1)
  assert.deepEqual(f.items.value.map(item => item.state), ['installed', 'failed', 'installed'])
  assert.deepEqual(f.installed, ['a.fftool', 'b.fftool', 'c.fftool'])
  assert.equal(f.refreshes(), 1)
  fail = false; await f.install()
  assert.deepEqual(f.installed, ['a.fftool', 'b.fftool', 'c.fftool', 'b.fftool'])
  assert(f.items.value.every(item => item.state === 'installed'))
  assert.equal(f.pending.value.length, 0)
})

test('an active install blocks duplicate actions and individual installation keeps other files pending', async () => {
  let release
  const f = fixture({ install: path => new Promise(resolve => { release = () => resolve(summary(path)) }) })
  await f.add(['a.fftool', 'b.fftool'])
  const firstId = f.items.value[0].id, running = f.install(firstId)
  assert.equal(f.busy.value, true)
  f.clear(); f.remove(firstId); await f.add(['c.fftool']); await f.install()
  assert.equal(f.items.value.length, 2); assert.equal(f.installed.length, 1)
  release(); await running
  assert.deepEqual(f.items.value.map(item => item.state), ['installed', 'ready'])
})

test('a refresh failure does not report an installed package as failed or install it twice', async () => {
  const f = fixture({ refresh: () => { throw new Error('Refresh failed') } })
  await f.add(['a.fftool']); await f.install(); await f.install()
  assert.equal(f.items.value[0].state, 'installed')
  assert.equal(f.installed.length, 1)
  assert.match(f.notice.value, /工具已安装，列表刷新失败/)
})
