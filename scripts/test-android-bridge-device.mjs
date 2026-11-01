// Requires an installed debuggable APK and one connected Android device.
// No tool package is installed and no application storage is cleared.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'

const adb = process.env.FIREFLY_ADB || path.join(process.env.ANDROID_HOME || path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk'), 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb')
const command = (...args) => execFileSync(adb, args, { encoding: 'utf8', timeout: 30000, windowsHide: true }).trim()
const devices = command('devices').split(/\r?\n/).slice(1).filter(line => /\tdevice$/.test(line)).map(line => line.split('\t')[0])
const serial = process.env.FIREFLY_TEST_SERIAL || (devices.length === 1 ? devices[0] : '')
assert.ok(serial, 'Set FIREFLY_TEST_SERIAL when more than one device is connected.')
const device = (...args) => command('-s', serial, ...args)
const vulnerable = process.argv.includes('--expect-vulnerable')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const bundle = await build({ entryPoints: ['src/services/webToolRuntime.ts'], bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'FireflyBridgeReview' })
const wasm = [...await readFile('examples/modules/media-files/assets/add.wasm')]
const report = { vulnerableExpected: vulnerable, android: device('shell', 'getprop', 'ro.build.version.release'), checks: [] }
let socket, port

async function connect() {
  device('shell', 'am', 'start', '-n', 'firefly.toolbox/.MainActivity')
  let targets = []
  for (let attempt = 0; attempt < 60; attempt++) {
    let pid
    try { pid = device('shell', 'pidof', 'firefly.toolbox').split(' ')[0] }
    catch { await delay(200); continue }
    if (pid && !port) port = device('forward', 'tcp:0', `localabstract:webview_devtools_remote_${pid}`)
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() } catch {}
    if (targets.some(target => target.type === 'page' && /^https?:\/\/tauri\.localhost\//.test(target.url))) break
    await delay(200)
  }
  const target = targets.find(target => target.type === 'page' && /^https?:\/\/tauri\.localhost\//.test(target.url))
  assert.ok(target, 'The installed APK must enable WebView debugging.')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let sequence = 0
  const pending = new Map()
  socket.onmessage = ({ data }) => {
    const reply = JSON.parse(data), task = pending.get(reply.id)
    if (!task) return
    pending.delete(reply.id); clearTimeout(task.timer)
    reply.error ? task.reject(new Error(JSON.stringify(reply.error))) : task.resolve(reply.result)
  }
  return (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 15000)
    pending.set(id, { resolve, reject, timer })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

try {
  let call = await connect()
  const evaluate = async (fn, ...args) => {
    const reply = await call('Runtime.evaluate', { expression: `(${fn})(${args.map(value => JSON.stringify(value)).join(',')})`, awaitPromise: true, returnByValue: true })
    if (reply.exceptionDetails) throw new Error(JSON.stringify(reply.exceptionDetails))
    return reply.result.value
  }
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await evaluate(() => typeof window.FireflyWebsites !== 'undefined')) break
    await delay(200)
  }
  await call('Runtime.evaluate', { expression: bundle.outputFiles[0].text })
  const ipcRun = crypto.randomUUID(), subframeRun = crypto.randomUUID()
  const nativeRunEffect = async run => await evaluate(async run => {
    try {
      await window.__TAURI_INTERNALS__.invoke('web_file_begin_run', { run, inputLimit: 1, outputLimit: 1 })
      return { childCreatedSession: false }
    } catch (error) {
      if (!String(error).startsWith('FILE_BUSY:')) throw error
      return { childCreatedSession: true }
    } finally { await window.__TAURI_INTERNALS__.invoke('web_file_close_run', { run }) }
  }, run)
  // Check the backend effect as well as replies: Wry can execute a child IPC
  // while delivering its callback to the wrong frame, making the child time out.
  await nativeRunEffect(ipcRun)
  report.tool = await evaluate(async (wasm, vulnerable, ipcRun) => {
    const names = ['FireflyWebsites', 'FireflyNavigation', 'FireflyAppearance', 'FireflyInsets', 'FireflyShortcutLaunch', 'FireflyAndroid']
    const marker = crypto.randomUUID()
    const container = document.createElement('div')
    document.body.append(container)
    let session
    const observed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { window.removeEventListener('message', receive); reject(new Error('Tool probe timeout')) }, 8000)
      function receive(event) {
        if (event.source === session?.frame.contentWindow && event.data?.marker === marker) {
          clearTimeout(timer); window.removeEventListener('message', receive); resolve(event.data)
        }
      }
      window.addEventListener('message', receive)
    })
    const script = `export async function mount(api) {
      const result={marker:${JSON.stringify(marker)},origin:origin,userActive:navigator.userActivation.isActive,
        bridges:Object.fromEntries(${JSON.stringify(names)}.map(name=>[name,typeof window[name]])),rawIpc:typeof window.ipc};
      try { parent.document; result.parentReadable=true } catch { result.parentReadable=false }
      try { await Promise.race([
        window.__TAURI_INTERNALS__.invoke('web_file_begin_run',{run:${JSON.stringify(ipcRun)},inputLimit:1,outputLimit:1}),
        new Promise((_,reject)=>setTimeout(()=>reject(new Error('no child reply')),150))
      ]);result.ipcReply=true } catch(error) {result.ipcReply=false}
      const wasm=await WebAssembly.instantiate(new Uint8Array(${JSON.stringify(wasm)}));result.wasm=wasm.instance.exports.add(20,22);
      result.hostApi=typeof api.openWebsite;
      if(${vulnerable}&&typeof FireflyWebsites!=='undefined'){FireflyWebsites.open('http://127.0.0.1:9/firefly-bridge-probe');result.openInvoked=true}
      parent.postMessage(result,'*');
    }`
    session = FireflyBridgeReview.createWebToolSession(container, {
      moduleId: 'probe.bridge', html: '<p>Android bridge regression probe</p>', css: '', script,
      networkHosts: [], timeoutMs: 10000, inputBytes: 1048576, outputBytes: 1048576,
      openFile: async () => null, saveFile: async () => false,
      openWebsite: async () => { throw new Error('An undeclared tool must not open a site') }, onError: () => {},
    }, 'fireflyBridgeProbeBudget', { read: () => ({}), update: () => {} }, () => session?.dispose())
    try { const result = await observed; await session.ready; return result }
    finally { session.dispose(); container.remove() }
  }, wasm, vulnerable, ipcRun)
  await delay(200)
  report.ipc = await nativeRunEffect(ipcRun)
  assert.equal(report.tool.origin, 'null')
  assert.equal(report.tool.parentReadable, false)
  assert.equal(report.tool.userActive, false)
  assert.equal(report.tool.wasm, 42)
  assert.equal(report.tool.hostApi, 'function')
  if (vulnerable) {
    assert.equal(report.tool.bridges.FireflyWebsites, 'object')
    assert.equal(report.tool.openInvoked, true)
    assert.equal(report.ipc.childCreatedSession, true)
    await delay(300)
    assert.match(device('shell', 'dumpsys', 'activity', 'activities'), /topResumedActivity=[^\r\n]*WebsiteActivity/)
    device('shell', 'input', 'keyevent', '4')
    report.checks.push('Reproduced direct native website launch from a real opaque tool without network permissions or user activation.')
    report.checks.push('Reproduced a backend state change through the framework IPC even though the child never receives its reply.')
  } else {
    assert.ok(Object.values(report.tool.bridges).every(value => value === 'undefined'))
    assert.equal(report.tool.rawIpc, 'undefined')
    assert.equal(report.ipc.childCreatedSession, false)
    report.checks.push('All five legacy bridges and the new endpoint are absent in the opaque tool; its real runner and WASM still work.')
    report.checks.push('A direct Tauri IPC attempt from the opaque tool produces no backend state change.')
    await nativeRunEffect(subframeRun)
    report.sameOriginFrame = await evaluate(async run => {
      const frame = document.createElement('iframe'); frame.srcdoc = '<html><body></body></html>'
      await new Promise(resolve => { frame.onload = resolve; document.body.append(frame) })
      try {
        const bridge = frame.contentWindow.FireflyAndroid
        if (!bridge) return { exposed: false, replied: false }
        let replied = false
        bridge.onmessage = () => { replied = true }
        bridge.postMessage(JSON.stringify({ id: 'subframe-state', operation: 'state' }))
        bridge.postMessage(JSON.stringify({ id: 'subframe-open', operation: 'openWebsite', value: 'http://127.0.0.1:9/forbidden' }))
        void frame.contentWindow.__TAURI_INTERNALS__.invoke('web_file_begin_run', { run, inputLimit: 1, outputLimit: 1 }).catch(() => {})
        await new Promise(resolve => setTimeout(resolve, 600))
        return { exposed: true, replied, ipcExposed: typeof frame.contentWindow.ipc }
      } finally { frame.remove() }
    }, subframeRun)
    assert.equal(report.sameOriginFrame.replied, false)
    report.sameOriginIpc = await nativeRunEffect(subframeRun)
    assert.equal(report.sameOriginIpc.childCreatedSession, false)
    assert.doesNotMatch(device('shell', 'dumpsys', 'activity', 'activities'), /topResumedActivity=[^\r\n]*WebsiteActivity/)
    report.checks.push('The native main-frame check rejects a same-origin subframe for both shell requests and Tauri IPC, including a forged website launch.')
    report.main = await evaluate(async () => {
      const bridge = window.FireflyAndroid, previous = bridge.onmessage
      async function request(id, operation, value) {
        return await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Native response timeout')), 2000)
          bridge.onmessage = event => { previous?.(event); const reply = JSON.parse(event.data); if (reply.id === id) { clearTimeout(timer); resolve(reply) } }
          bridge.postMessage(JSON.stringify({id, operation, value}))
        })
      }
      try {
        return { state: await request('probe-state', 'state'), invalidWebsite: await request('probe-invalid-url', 'openWebsite', 'file:///sdcard/'),
          invalidBoolean: await request('probe-invalid-bool', 'setBackEnabled', 'true'), appearance: await request('probe-theme', 'setDark', document.documentElement.dataset.theme === 'dark') }
      } finally { bridge.onmessage = previous }
    })
    assert.ok(Number.isFinite(report.main.state.result.top))
    assert.equal(typeof report.main.state.result.shortcutPending, 'boolean')
    assert.ok(report.main.invalidWebsite.error)
    assert.ok(report.main.invalidBoolean.error)
    assert.equal(report.main.appearance.result, true)
    report.checks.push('The main document receives insets/shortcut state, changes native theme, and rejects invalid native parameters.')
    report.nativeFile = await evaluate(async () => {
      const invoke = window.__TAURI_INTERNALS__.invoke, run = crypto.randomUUID()
      const bytes = Uint8Array.from({length:1048576}, (_, index) => (index * 31 + 127) % 256)
      await invoke('web_file_begin_run', { run, inputLimit: bytes.length, outputLimit: bytes.length })
      try {
        const id = await invoke('web_file_create_writer', { run })
        const parts = []
        for (let offset = 0; offset < bytes.length; offset += 32768) parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)))
        const size = await invoke('web_file_write', {encoding:'base64',data:btoa(parts.join(''))}, {headers:{'x-firefly-run':run,'x-firefly-file':id}})
        const preview = await invoke('web_file_preview_writer', { run, id, name: 'probe.bin' })
        const read = new Uint8Array(await invoke('web_file_read', { run, id: preview.id, offset: 0, length: bytes.length }))
        return { size, length: read.length, mismatch: read.findIndex((value, index) => value !== bytes[index]) }
      } finally { await invoke('web_file_close_run', { run }) }
    })
    assert.equal(report.nativeFile.size, 1048576)
    assert.equal(report.nativeFile.length, 1048576)
    assert.equal(report.nativeFile.mismatch, -1)
    report.checks.push('The main document still performs byte-exact native file writes and binary reads through the protected Tauri IPC.')
    await evaluate(async () => { await window.FireflyWebsites.open('http://127.0.0.1:9/firefly-bridge-legitimate') })
    await delay(300)
    assert.match(device('shell', 'dumpsys', 'activity', 'activities'), /topResumedActivity=[^\r\n]*WebsiteActivity/)
    device('shell', 'input', 'keyevent', '4')
    report.checks.push('A legitimate website open from the main UI still launches the native website activity.')
    await delay(200)
    await evaluate(() => document.querySelector('.menu-button').click())
    await delay(200)
    assert.equal(await evaluate(() => !!document.querySelector('.sidebar-visible')), true)
    device('shell', 'input', 'keyevent', '4')
    await delay(300)
    assert.equal(await evaluate(() => !!document.querySelector('.sidebar-visible')), false)
    report.checks.push('The Android hardware back action still closes the app sidebar through the scoped navigation bridge.')

    const launchTool = await evaluate(async () => {
      const tools = await window.__TAURI_INTERNALS__.invoke('list_tools', {})
      const tool = tools.find(tool => tool.id === 'json.format') || tools.find(tool => tool.ui_kind === 'text')
      return tool && { id: tool.id, name: tool.name }
    })
    assert.ok(launchTool, 'A text tool is required for the cold shortcut regression.')
    socket.close(); socket = undefined
    device('forward', '--remove', `tcp:${port}`); port = undefined
    device('shell', 'am', 'force-stop', 'firefly.toolbox')
    device('shell', 'am', 'start', '-n', 'firefly.toolbox/.MainActivity', '--es', 'firefly_tool_id', launchTool.id)
    call = await connect()
    for (let attempt = 0; attempt < 60; attempt++) {
      if (await evaluate(() => !!document.querySelector('.editor-open') && typeof window.FireflyShortcutLaunch === 'object')) break
      await delay(200)
    }
    report.shortcut = await evaluate(() => ({
      pendingAtBoot: window.FireflyShortcutLaunch?.hasPendingLaunch(),
      editor: !!document.querySelector('.editor-open'), title: document.querySelector('.tool-title')?.textContent,
      splash: !!document.querySelector('.startup-splash'),
    }))
    assert.equal(report.shortcut.pendingAtBoot, true)
    assert.equal(report.shortcut.editor, true)
    assert.equal(report.shortcut.title, launchTool.name)
    assert.equal(report.shortcut.splash, false)
    device('shell', 'input', 'keyevent', '4')
    report.checks.push('A cold Android shortcut launch still skips the splash and opens the requested tool after the secure state handshake.')
  }
  const directory = path.resolve('target-check/android-bridge-review')
  await mkdir(directory, {recursive:true})
  await writeFile(path.join(directory, vulnerable ? 'device-baseline.json' : 'device-fixed.json'), JSON.stringify(report,null,2))
  for (const check of report.checks) console.log('PASS:', check)
} finally {
  socket?.close()
  if (port) device('forward', '--remove', `tcp:${port}`)
}
