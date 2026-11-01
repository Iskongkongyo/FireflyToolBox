import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

export function androidUiNodes(xml) {
  const decode = value => value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity) => {
    if (entity.startsWith('#')) return String.fromCodePoint(parseInt(entity.slice(entity[1].toLowerCase() === 'x' ? 2 : 1), entity[1].toLowerCase() === 'x' ? 16 : 10))
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[entity.toLowerCase()]
  })
  return [...xml.matchAll(/<node\s+([^>]+)>/g)].map(match => Object.fromEntries([...match[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map(item => [item[1], decode(item[2])])))
}

export async function connectAndroid({ toolId = '' } = {}) {
  const adb = process.env.FIREFLY_ADB || path.join(process.env.ANDROID_HOME || path.join(process.env.LOCALAPPDATA, 'Android/Sdk'), 'platform-tools/adb.exe')
  const command = (...args) => execFileSync(adb, args, { encoding: 'utf8', timeout: 30000, windowsHide: true }).trim()
  const devices = command('devices').split(/\r?\n/).slice(1).filter(line => /\tdevice$/.test(line)).map(line => line.split('\t')[0])
  const serial = process.env.FIREFLY_TEST_SERIAL || (devices.length === 1 ? devices[0] : '')
  assert.ok(serial, 'Connect one device or set FIREFLY_TEST_SERIAL.')
  const device = (...args) => command('-s', serial, ...args)
  device('shell', 'am', 'start', '-n', 'firefly.toolbox/.MainActivity', ...(toolId ? ['-a', 'android.intent.action.VIEW', '--es', 'firefly_tool_id', toolId] : []))
  let pid
  for (let attempt = 0; attempt < 60; attempt++) {
    try { pid = device('shell', 'pidof', 'firefly.toolbox').split(' ')[0] } catch {}
    if (pid) break
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  assert.ok(pid, 'The Android application did not start.')
  const port = device('forward', 'tcp:0', `localabstract:webview_devtools_remote_${pid}`)
  let socket
  try {
    let target
    for (let i = 0; i < 60; i++) {
      try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item => /^https?:\/\/tauri\.localhost\//.test(item.url)) } catch {}
      if (target) break
      await new Promise(resolve => setTimeout(resolve, 200))
    }
    assert.ok(target, 'A debuggable APK is required.')
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      const timer=setTimeout(()=>reject(new Error('The Android debug socket did not open')),5000)
      socket.onopen=()=>{clearTimeout(timer);resolve()}
      socket.onerror=error=>{clearTimeout(timer);reject(error)}
      socket.onclose=()=>{clearTimeout(timer);reject(new Error('The Android debug socket closed during startup'))}
    })
    let sequence = 0
    const pending = new Map()
    socket.onmessage = ({ data }) => {
      const result = JSON.parse(data), task = pending.get(result.id)
      if (!task) return
      pending.delete(result.id); clearTimeout(task.timer)
      result.error ? task.reject(new Error(JSON.stringify(result.error))) : task.resolve(result.result)
    }
    const call = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 45000)
      pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }))
    })
    const evaluate = async (fn, ...args) => {
      const result = await call('Runtime.evaluate', { expression: `(${fn})(${args.map(arg => JSON.stringify(arg)).join(',')})`, awaitPromise: true, returnByValue: true })
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
      return result.result.value
    }
    return { device, call, evaluate, debugPort: port, invoke: (command, args = {}) => evaluate((command, args) => window.__TAURI_INTERNALS__.invoke(command, args), command, args),
      close() { socket.close(); device('forward', '--remove', `tcp:${port}`) } }
  } catch (error) { socket?.close(); device('forward', '--remove', `tcp:${port}`); throw error }
}
