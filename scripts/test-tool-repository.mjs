import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { runInNewContext } from 'node:vm'
import { repositoryFixture, fixtureCatalog } from './tool-repository-fixture.mjs'
const bundle = await build({ entryPoints: ['src/services/toolRepository.ts'], bundle: true, write: false, format: 'iife', globalName: 'Repository', platform: 'browser' })
function fixture(overrides = {}) {
  const storage = new Map(), context = { crypto, setTimeout, clearTimeout, localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) } }
  runInNewContext(bundle.outputFiles[0].text, context)
  const items = repositoryFixture(), calls = []
  const deps = {
    catalog: async () => fixtureCatalog(items), describe: async id => ({ ...structuredClone(items.find(item => item.entry.id === id).entry), title: items.find(item => item.entry.id === id).title, metadata_loaded: true }),
    prepare: async id => structuredClone(items.find(item => item.entry.id === id).prepared), release: async token => { calls.push(['release', token]) }, cancel: async id => { calls.push(['cancel', id]) },
    install: async (...args) => { calls.push(['install', ...args]); return structuredClone(items.find(item => item.prepared.token === args[0]).summary) },
    save: async (...args) => { calls.push(['save', ...args]) }, chooseSavePath: async () => 'fixture.fftool', openLink: async () => {}, listInstalled: async () => [], refreshTools: async () => { calls.push(['refresh']) }, notify: message => { calls.push(['notify', message]) }, ...overrides,
  }
  return { model: context.Repository.createToolRepository(deps), items, calls, storage }
}
const pause = () => new Promise(resolve => setTimeout(resolve, 0))
test('search uses names, files, categories and literal multiword keywords without extra requests', async () => {
  const f = fixture(); await f.model.load(); await pause()
  f.model.query.value = '联网 生活'; assert.equal(f.model.entries.value.length, 1)
  f.model.query.value = '['; assert.equal(f.model.entries.value.length, 0)
  f.model.query.value = ''; f.model.category.value = '效率工具'; assert.equal(f.model.entries.value.length, 2)
  f.model.dispose()
})
test('download preview never installs automatically; network consent is required before installation', async () => {
  const f = fixture(); await f.model.load(); await f.model.start(f.items[1].entry, 'install')
  assert.equal(f.model.reviewOpen.value, true); assert.equal(f.calls.some(call => call[0] === 'install'), false)
  await f.model.install(); assert.equal(f.calls.some(call => call[0] === 'install'), false)
  f.model.allowNetwork.value = true; await f.model.install()
  const installed = f.calls.find(call => call[0] === 'install'); assert.equal(installed[2], true); assert.equal(installed[3], null)
  assert.equal(f.model.reviewOpen.value, false); assert.equal(f.model.installed.value.length, 1); assert.equal(f.model.phase.value, 'idle')
  f.model.dispose()
})
test('cancellation discards a late successful response and releases its native lease', async () => {
  let finish; const f = fixture({ prepare: () => new Promise(resolve => { finish = resolve }) })
  await f.model.load(); const work = f.model.start(f.items[0].entry, 'install'); await f.model.cancel(); finish(structuredClone(f.items[0].prepared)); await work
  assert.equal(f.model.reviewOpen.value, false); assert.equal(f.calls.some(call => call[0] === 'install'), false)
  assert(f.calls.some(call => call[0] === 'release')); assert.match(f.model.notice.value, /已取消下载/); assert.equal(f.model.phase.value, 'idle')
  f.model.dispose()
})
test('leaving during download ignores late results and cannot open an install dialog', async () => {
  let finish; const f = fixture({ prepare: () => new Promise(resolve => { finish = resolve }) })
  await f.model.load(); const work = f.model.start(f.items[0].entry, 'install'); f.model.dispose(); finish(structuredClone(f.items[0].prepared)); await work
  assert.equal(f.model.reviewOpen.value, false); assert(f.calls.some(call => call[0] === 'release'))
})
test('cancelled save does not write a file; unsupported packages can be saved but not installed', async () => {
  const f = fixture({ chooseSavePath: async () => null }); await f.model.load(); await f.model.start(f.items[0].entry, 'save')
  assert.equal(f.calls.some(call => call[0] === 'save'), false); assert.match(f.model.notice.value, /取消保存/); f.model.dispose()
  const g = fixture(); await g.model.load(); await g.model.start(g.items[2].entry, 'install'); await g.model.install()
  assert.equal(g.calls.some(call => call[0] === 'install'), false)
  await g.model.save(); assert(g.calls.some(call => call[0] === 'save')); assert.match(g.model.notice.value, /未通过安装检查/); g.model.dispose()
})
test('a failed refresh retains cached entries and route changes persist only the route preference', async () => {
  let fail = false; const f = fixture({ catalog: async () => { if (fail) throw new Error('offline'); return fixtureCatalog(repositoryFixture()) } })
  await f.model.load(); fail = true; await f.model.load(true); assert.equal(f.model.catalog.value.entries.length, 4); assert.match(f.model.error.value, /offline/)
  f.model.setRoute('github'); await pause(); assert.equal(f.storage.get('firefly.tool-download-route.v1'), 'github'); assert.equal(f.storage.size, 1)
  f.model.dispose()
})
