import assert from 'node:assert/strict'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const bundle = await build({entryPoints:['src/services/androidShell.ts'],bundle:true,write:false,format:'iife',globalName:'Shell',platform:'browser'})
function fixture({ missing = false, child = false, state = { top: 24, bottom: 16, shortcutPending: true } } = {}) {
  const sent = [], timers = new Map(), events = new Map()
  let sequence = 0
  const window = { addEventListener: (name, listener) => events.set(name, listener) }
  window.top = child ? {} : window
  const bridge = { onmessage: null, postMessage(text) {
    const request = JSON.parse(text)
    sent.push(request)
    if (request.operation === 'state') queueMicrotask(() => reply(request.id, state))
  } }
  if (!missing) window.FireflyAndroid = bridge
  const context = { window, console, setTimeout: fn => { const id = ++sequence; timers.set(id, fn); return id }, clearTimeout: id => timers.delete(id) }
  runInNewContext(bundle.outputFiles[0].text, context)
  function reply(id, result, error) { bridge.onmessage?.({data:JSON.stringify({id,result,error})}) }
  return {window, bridge, sent, timers, events, reply, initialize:context.Shell.initializeAndroidShell}
}

test('startup state is ready before synchronous inset and shortcut adapters are published', async () => {
  const f = fixture()
  const ready = f.initialize()
  assert.equal(f.window.FireflyInsets, undefined)
  await ready
  assert.equal(f.window.FireflyInsets.top(), 24)
  assert.equal(f.window.FireflyInsets.bottom(), 16)
  assert.equal(f.window.FireflyShortcutLaunch.hasPendingLaunch(), true)
  f.events.get('firefly:insets')({detail:{top:31,bottom:0}})
  assert.equal(f.window.FireflyInsets.top(), 31)
  assert.equal(f.window.FireflyInsets.bottom(), 0)
  assert.equal(f.timers.size, 0)
})

test('native requests correlate replies and propagate website failures to the UI', async () => {
  const f = fixture(); await f.initialize()
  let finished = false
  const first = f.window.FireflyWebsites.open('https://example.com/one').then(() => { finished = true })
  const second = f.window.FireflyWebsites.open('https://example.com/two')
  const [,one,two] = f.sent
  f.reply(two.id, true)
  await second
  assert.equal(finished, false)
  f.reply(one.id, undefined, 'website rejected')
  await assert.rejects(first, /website rejected/)
  assert.equal(f.timers.size, 0)
})

test('tool fullscreen uses the authenticated shell operation and waits for its native result', async () => {
  const f = fixture(); await f.initialize()
  const entering = f.window.FireflyToolWindow.setFullscreen(true)
  const request = f.sent.at(-1)
  assert.equal(request.operation, 'setToolFullscreen'); assert.equal(request.value, true)
  f.reply(request.id, true); await entering
  const leaving = f.window.FireflyToolWindow.setFullscreen(false)
  f.reply(f.sent.at(-1).id, undefined, 'native restore failed')
  await assert.rejects(leaving, /native restore failed/)
})

test('unsupported WebViews, subframes and invalid state never publish privileged adapters', async () => {
  for (const options of [{missing:true},{child:true},{state:{top:-1,bottom:0,shortcutPending:false}},{state:{top:1,bottom:0,shortcutPending:'true'}}]) {
    const f = fixture(options)
    await assert.rejects(f.initialize())
    assert.equal(f.window.FireflyWebsites, undefined)
    assert.equal(f.window.FireflyToolWindow, undefined)
  }
})

test('native timeouts reject once, release the request and ignore a late reply', async () => {
  const f = fixture(); await f.initialize()
  const request = f.window.FireflyWebsites.open('https://example.com/')
  const id = f.sent.at(-1).id
  for (const [timer, fire] of f.timers) { f.timers.delete(timer); fire() }
  await assert.rejects(request, /超时/)
  f.reply(id, true)
  assert.equal(f.timers.size, 0)
})
