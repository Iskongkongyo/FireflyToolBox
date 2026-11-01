import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const bundle = await build({ entryPoints: ['src/services/webToolStorage.ts'], bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'ToolStorage', plugins: [{
  name: 'storage-backend', setup(plugin) {
    plugin.onResolve({ filter: /^@tauri-apps\/api\/core$/ }, () => ({ path: 'core', namespace: 'fixture' }))
    plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const isTauri=()=>true;export const invoke=(...args)=>bridge.invoke(...args)' }))
  },
}] })
class Local {
  values = new Map()
  get length() { return this.values.size }
  key(index) { return [...this.values.keys()][index] ?? null }
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) { this.values.set(key, String(value)) }
  removeItem(key) { this.values.delete(key) }
}
function host() {
  const local = new Local(), stored = new Map(), calls = []
  const control = { failLoad: false, failSave: false, gate: null }
  const bridge = { async invoke(command, args) {
    calls.push({ command, args })
    if (command === 'load_tool_storage') {
      if (control.failLoad) throw new Error('migration failed')
      if (args.readOnly) return stored.get(args.moduleId) ?? null
      if (!stored.has(args.moduleId)) stored.set(args.moduleId, args.legacyJson)
      return stored.get(args.moduleId)
    }
    if (command === 'save_tool_storage') {
      if (control.gate) await control.gate
      if (control.failSave) throw new Error('disk full')
      stored.set(args.moduleId, args.valuesJson); return
    }
    if (command === 'clear_preview_tool_storage') {
      let count = 0
      for (const id of stored.keys()) if (id.startsWith('preview.')) { stored.delete(id); count++ }
      return count
    }
    throw new Error('Unexpected command: ' + command)
  } }
  const context = { bridge, localStorage: local, TextEncoder, DOMException }
  runInNewContext(bundle.outputFiles[0].text, context)
  return { api: context.ToolStorage, local, stored, calls, control }
}
function tool(storage) {
  const handlers = new Set(), messages = [], controller = new AbortController(), parent = {}
  const context = { parent, TextEncoder, DOMException, Promise,
    addEventListener(type, fn) { if (type === 'message') handlers.add(fn) },
    removeEventListener(type, fn) { if (type === 'message') handlers.delete(fn) },
  }
  context.window = context
  runInNewContext(readFileSync('public/tool-storage.js', 'utf8'), context)
  const send = message => {
    messages.push(message)
    if (message.type !== 'storage') return
    Promise.resolve().then(() => storage.update(message)).then(() => {
      for (const handler of handlers) handler({ source: parent, data: { id: 'run', type: 'storageResult', requestId: message.requestId } })
    }).catch(error => {
      for (const handler of handlers) handler({ source: parent, data: { id: 'run', type: 'storageResult', requestId: message.requestId, error: { message: error.message } } })
    })
  }
  const api = context.FireflyToolStorage(storage.read(), 'run', send, controller.signal)
  return { api, local: context.localStorage, session: context.sessionStorage, controller, messages }
}
test('legacy strings migrate before removal and namespaces remain isolated', async () => {
  const f = host()
  f.local.setItem('firefly.browser-module.dev.a.notes', '中文 🐱')
  f.local.setItem('firefly.browser-module.dev.b.notes', 'other')
  const storage = await f.api.openToolStorage('dev.a')
  assert.equal(storage.read().notes, '中文 🐱')
  assert.equal(f.local.getItem('firefly.browser-module.dev.a.notes'), null)
  assert.equal(f.local.getItem('firefly.browser-module.dev.b.notes'), 'other')
  assert.equal(JSON.parse(f.stored.get('dev.a')).notes, '中文 🐱')
})

test('a stale oversized legacy copy cannot block an existing committed database snapshot', async () => {
  const f = host()
  f.stored.set('dev.a', '{"notes":"committed"}')
  f.local.setItem('firefly.browser-module.dev.a.notes', 'x'.repeat(1048576))
  const storage = await f.api.openToolStorage('dev.a')
  assert.equal(storage.read().notes, 'committed')
  assert.equal(f.local.getItem('firefly.browser-module.dev.a.notes').length, 1048576)
})

test('a read-only miss cannot publish an empty snapshot when migration fails validation', async () => {
  const f = host(), key = 'firefly.browser-module.dev.a.notes'
  f.local.setItem(key, 'x'.repeat(1048576))
  await assert.rejects(f.api.openToolStorage('dev.a'), error => error.name === 'QuotaExceededError')
  assert.equal(f.stored.has('dev.a'), false)
  f.local.setItem(key, 'recovered')
  const storage = await f.api.openToolStorage('dev.a')
  assert.equal(storage.read().notes, 'recovered')
  assert.equal(f.local.getItem(key), null)
})
test('failed migration preserves the original local copy and retries safely', async () => {
  const f = host(); f.local.setItem('firefly.browser-module.dev.a.notes', 'keep')
  f.control.failLoad = true
  await assert.rejects(f.api.openToolStorage('dev.a'), /migration failed/)
  assert.equal(f.local.getItem('firefly.browser-module.dev.a.notes'), 'keep')
  f.control.failLoad = false
  assert.equal((await f.api.openToolStorage('dev.a')).read().notes, 'keep')
})
test('a committed empty snapshot never resurrects old local data', async () => {
  const f = host(); f.stored.set('dev.a', '{}'); f.local.setItem('firefly.browser-module.dev.a.notes', 'old')
  assert.equal(Object.keys((await f.api.openToolStorage('dev.a')).read()).length, 0)
  assert.equal(f.local.getItem('firefly.browser-module.dev.a.notes'), 'old', 'an unconfirmed conflicting copy is retained')
})
test('local and session storage each accept one MiB, while flush waits for persistence', async () => {
  const f = host(), s = tool(await f.api.openToolStorage('dev.a'))
  let release; f.control.gate = new Promise(resolve => release = resolve)
  const value = 'a'.repeat(1048576 - 8)
  s.local.setItem('x', value); s.session.setItem('x', value)
  assert.equal(s.local.getItem('x').length, value.length)
  assert.throws(() => s.local.setItem('extra', 'x'), { name: 'QuotaExceededError' })
  assert.throws(() => s.session.setItem('extra', 'x'), { name: 'QuotaExceededError' })
  let done = false; const flushed = s.api.flush().then(() => { done = true })
  await Promise.resolve(); assert.equal(done, false)
  release(); await flushed
  assert.equal(JSON.parse(f.stored.get('dev.a')).x.length, value.length)
  s.controller.abort()
})
test('failed writes are observable and a later flush retries the latest snapshot', async () => {
  const f = host(), s = tool(await f.api.openToolStorage('dev.a'))
  f.control.failSave = true; s.local.setItem('notes', 'not lost')
  await assert.rejects(s.api.flush(), /disk full/)
  assert(s.messages.some(message => message.type === 'error'))
  assert.equal(s.local.getItem('notes'), 'not lost')
  f.control.failSave = false; await s.api.flush()
  assert(s.messages.some(message=>message.type==='storageRecovered'))
  assert.equal(JSON.parse(f.stored.get('dev.a')).notes, 'not lost')
  s.local.clear(); await s.api.flush()
  assert.equal(Object.keys(JSON.parse(f.stored.get('dev.a'))).length, 0)
  s.controller.abort()
})

test('sync waits for pending durable writes, surfaces failures and does not include preview failures',async()=>{
  const f=host(),storage=await f.api.openToolStorage('tool.dev.notes')
  let release;f.control.gate=new Promise(resolve=>release=resolve)
  const save=storage.update({values:{notes:'latest'}})
  let ready=false;const sync=f.api.flushToolStorageWrites('tool.').then(()=>{ready=true})
  await new Promise(resolve=>setTimeout(resolve,0));assert.equal(ready,false)
  release();await save;await sync;assert.equal(ready,true);assert.equal(JSON.parse(f.stored.get('tool.dev.notes')).notes,'latest')
  f.control.gate=null;f.control.failSave=true
  await assert.rejects(storage.update({values:{notes:'retry'}}),/disk full/)
  await assert.rejects(f.api.flushToolStorageWrites('tool.'),/disk full/)
  f.control.failSave=false;await f.api.flushToolStorageWrites('tool.');assert.equal(JSON.parse(f.stored.get('tool.dev.notes')).notes,'retry')
  const preview=await f.api.openToolStorage('preview.dev.notes');f.control.failSave=true
  await assert.rejects(preview.update({values:{private:'preview'}}),/disk full/)
  await f.api.flushToolStorageWrites('tool.')
})
test('preview cleanup waits for writes and never removes installed-tool state', async () => {
  const f = host()
  f.stored.set('dev.notes', '{"x":"keep"}')
  const preview = await f.api.openToolStorage('preview.dev.a')
  await preview.update({ values: { x: 'temporary' } })
  await f.api.clearToolPreviewStorage()
  assert(!f.stored.has('preview.dev.a'))
  assert.equal(f.stored.get('dev.notes'), '{"x":"keep"}')
})
