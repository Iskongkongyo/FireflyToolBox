import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

test('every HTTP/storage host command is registered and permitted only in the local main capability', () => {
  const commands = new Set()
  for (const file of ['src/services/webToolHttp.ts', 'src/services/webToolStorage.ts', 'src/services/toolbox.ts']) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'invoke' && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        const command = node.arguments[0].text
        if (/^(web_tool_|(?:load|save|clear_preview)_tool_storage$)/.test(command)) commands.add(command)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  assert.equal(commands.size, 11)
  const permissions = readFileSync('src-tauri/permissions/main.toml', 'utf8')
  const registered = readFileSync('src-tauri/src/lib.rs', 'utf8').split('.invoke_handler(tauri::generate_handler![')[1]?.split('])')[0]
  assert(registered, 'The native invoke handler must be present')
  for (const command of commands) {
    assert(permissions.includes(`"${command}"`), `${command} is missing its Tauri permission`)
    assert(new RegExp(`\\b${command}\\b`).test(registered), `${command} is missing its native registration`)
  }
  const main = JSON.parse(readFileSync('src-tauri/capabilities/main.json', 'utf8'))
  assert.deepEqual(main.windows, ['main']); assert.equal(main.remote, undefined)
  assert(main.permissions.includes('main-commands'))
  const splash = JSON.parse(readFileSync('src-tauri/capabilities/splash.json', 'utf8'))
  assert(!splash.permissions.includes('main-commands'))
})

const hostBundle = await build({ entryPoints: ['src/services/webToolHttp.ts'], bundle: true, write: false, format: 'iife', platform: 'browser', globalName: 'HttpHost', plugins: [{
  name: 'http-native', setup(plugin) {
    plugin.onResolve({ filter: /^@tauri-apps\// }, args => ({ path: args.path, namespace: 'native' }))
    plugin.onLoad({ filter: /.*/, namespace: 'native' }, args => ({ contents: args.path.endsWith('/core') ? 'export const invoke=(...args)=>bridge.invoke(...args);export const convertFileSrc=()=>""' : 'export const open=async()=>null;export const save=async()=>null' }))
  },
}] })
async function ticks() { for (let index = 0; index < 30; index++) await Promise.resolve() }
function fixture() {
  const sessions = new Map(), calls = [], handlers = new Set(), parent = {}, controller = new AbortController()
  const control = { reserve: null, holdHeaders: false, holdRead: false }
  let sequence = 0
  const bridge = { async invoke(command, args) {
    calls.push({ command, args })
    if (command === 'web_tool_http_create') {
      const token = String(++sequence).padStart(32, '0')
      sessions.set(token, { options: args.options, url: args.url, offset: 0, readCount: 0 })
      if (control.reserve) await control.reserve
      return token
    }
    const session = sessions.get(args.id)
    if (command === 'web_tool_http_cancel') { sessions.delete(args.id); session?.reject?.({ code: 'HTTP_CANCELED', message: 'canceled' }); return true }
    if (!session) throw { code: 'HTTP_SESSION_CLOSED', message: 'closed' }
    if (command === 'web_tool_http_start') {
      if (control.holdHeaders) await new Promise((_, reject) => session.reject = reject)
      const url = new URL(session.url), size = Number(url.pathname.split('/').at(-1))
      let status = 200
      if (url.pathname.startsWith('/bytes/')) session.bytes = new Uint8Array(size).fill(42)
      else if (url.pathname.startsWith('/status/')) { status = size; session.bytes = new TextEncoder().encode('status body') }
      else session.bytes = new TextEncoder().encode(JSON.stringify({ method: session.options.method, headers: session.options.headers, body: session.options.body_base64 ? Buffer.from(session.options.body_base64, 'base64').toString('utf8') : '' }))
      if (session.bytes.length > session.options.max_response_bytes) { sessions.delete(args.id); throw { code: 'HTTP_RESPONSE_LIMIT', message: 'too large' } }
      return { status, url: session.url, headers: [['content-type', 'application/octet-stream'], ['x-test', 'kept']] }
    }
    if (command === 'web_tool_http_read') {
      session.readCount++
      if (control.holdRead) await new Promise((_, reject) => session.reject = reject)
      const bytes = session.bytes.slice(session.offset, session.offset + 256 * 1024)
      session.offset += bytes.length
      if (!bytes.length) sessions.delete(args.id)
      return bytes.buffer
    }
    throw new Error('Unknown command')
  } }
  const hostContext = { bridge, Uint8Array, ArrayBuffer, AbortController, TextEncoder, btoa, setTimeout, clearTimeout }
  runInNewContext(hostBundle.outputFiles[0].text, hostContext)
  let host
  const child = { parent, AbortController, AbortSignal, Uint8Array, ArrayBuffer, Blob, Headers, Response, Request, ReadableStream, URLSearchParams, TextEncoder, DOMException,
    addEventListener(type, fn) { if (type === 'message') handlers.add(fn) }, removeEventListener(type, fn) { if (type === 'message') handlers.delete(fn) },
  }
  child.window = child
  runInNewContext(readFileSync('public/web-tool-http.js', 'utf8'), child)
  host = hostContext.HttpHost.createWebHttpHost(['https://allowed.example'], (data, transfer = []) => {
    const received = structuredClone(data, { transfer })
    queueMicrotask(() => { for (const fn of handlers) fn({ source: parent, data: { id: 'run', ...received } }) })
  })
  const send = (data, transfer = []) => { data = structuredClone(data, { transfer }); if (data.type === 'http') host.start(data); else if (data.type === 'httpPull') host.pull(data); else if (data.type === 'cancelHttp') host.cancel(data.requestId) }
  const api = child.FireflyWebToolHttp('run', send, controller.signal)
  return { api, host, sessions, calls, control, controller, close() { controller.abort(); host.dispose() } }
}
test('POST body variants and headers reach the host without detaching caller data', async () => {
  const f = fixture(), bytes = new TextEncoder().encode('binary')
  const cases = [['中文', '中文'], [new Blob(['blob'], { type: 'text/plain' }), 'blob'], [bytes, 'binary'], [bytes.buffer, 'binary'], [new URLSearchParams({ x: 'a b' }), 'x=a+b']]
  for (const [body, expected] of cases) {
    const response = await f.api.request('https://allowed.example/echo', { method: 'POST', headers: { Authorization: 'Bearer test' }, body, timeoutMs: 60000, maxResponseBytes: 16 * 1024 * 1024 })
    const value = await response.json()
    assert.equal(value.method, 'POST'); assert.equal(value.body, expected); assert.equal(value.headers.authorization, 'Bearer test')
    assert.equal(response.url, 'https://allowed.example/echo'); assert.equal(response.headers.get('x-test'), 'kept')
  }
  assert.equal(bytes.byteLength, 6)
  assert(f.calls.filter(call => call.command === 'web_tool_http_create').every(call => call.args.allowedHosts.join() === 'https://allowed.example'))
  assert.equal(f.sessions.size, 0); f.close()
})
test('buffered compatibility applies the default quota and accepts an explicit larger response', async () => {
  const f = fixture()
  await assert.rejects(f.api.request('https://allowed.example/bytes/5242880'), error => error.code === 'HTTP_RESPONSE_LIMIT')
  const response = await f.api.request('https://allowed.example/bytes/5242880', { maxResponseBytes: 8 * 1024 * 1024 })
  assert.equal((await response.arrayBuffer()).byteLength, 5 * 1024 * 1024)
  assert.equal(f.sessions.size, 0); f.close()
})
test('a streamed 16 MiB response is pulled in bounded chunks with backpressure', async () => {
  const f = fixture()
  const response = await f.api.request('https://allowed.example/bytes/16777216', { maxResponseBytes: 16 * 1024 * 1024, stream: true })
  await ticks()
  assert(f.calls.filter(call => call.command === 'web_tool_http_read').length <= 1)
  const reader = response.body.getReader(); let total = 0
  while (true) { const { value, done } = await reader.read(); if (done) break; assert(value.length <= 256 * 1024); assert(value.every(byte => byte === 42)); total += value.length }
  assert.equal(total, 16 * 1024 * 1024); assert.equal(f.sessions.size, 0); f.close()
})
test('abort before native reservation finishes never starts a network operation', async () => {
  const f = fixture(), controller = new AbortController()
  let release; f.control.reserve = new Promise(resolve => release = resolve)
  const pending = f.api.request('https://allowed.example/echo', { signal: controller.signal })
  const rejected = assert.rejects(pending, { name: 'AbortError' })
  controller.abort(); await rejected; release(); await ticks()
  assert.equal(f.calls.filter(call => call.command === 'web_tool_http_start').length, 0)
  assert.equal(f.sessions.size, 0); f.close()
})
test('body cancellation and host timeout release the underlying native response', async () => {
  const f = fixture()
  const response = await f.api.request('https://allowed.example/bytes/1048576', { stream: true })
  await response.body.cancel(); await ticks(); assert.equal(f.sessions.size, 0)
  f.control.holdHeaders = true
  await assert.rejects(f.api.request('https://allowed.example/echo', { timeoutMs: 20 }), error => error.code === 'HTTP_TIMEOUT')
  await ticks(); assert.equal(f.sessions.size, 0); f.close()
})
test('HTTP error statuses remain responses, and 204 has a null body', async () => {
  const f = fixture()
  const failure = await f.api.request('https://allowed.example/status/404')
  assert.equal(failure.status, 404); assert.equal(failure.ok, false)
  const empty = await f.api.request('https://allowed.example/status/204')
  assert.equal(empty.body, null); assert.equal(await empty.text(), '')
  await ticks(); assert.equal(f.sessions.size, 0); f.close()
})
test('invalid options fail before native allocation and URL coercion cannot revive an aborted request', async () => {
  const f = fixture()
  for (const options of [{ method: 'DELETE' }, { method: 'GET', body: 'x' }, { timeoutMs: 60001 }, { maxResponseBytes: 16777217 }, { method: 'POST', body: {} }]) await assert.rejects(f.api.request('https://allowed.example/echo', options))
  const controller = new AbortController()
  await assert.rejects(f.api.request({ toString() { controller.abort(); return 'https://allowed.example/echo' } }, { signal: controller.signal }), { name: 'AbortError' })
  assert.equal(f.calls.length, 0); f.close()
})

test('oversized binary request bodies reject before allocating a copy', async () => {
  const f = fixture()
  try {
    for (const body of [new Uint8Array(16777217), new ArrayBuffer(16777217)]) {
      body.slice = () => { throw new Error('An oversized body was copied') }
      await assert.rejects(f.api.request('https://allowed.example/echo', { method: 'POST', body }), error => error.name === 'RangeError' && /16 MiB/.test(error.message))
    }
    assert.equal(f.calls.length, 0)
  } finally { f.close() }
})
