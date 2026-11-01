import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'

// Requires the disposable configuration produced by the Windows test wrapper.
export async function connectWindows({ splash = false, args = [] } = {}) {
  const port = Number(process.env.FIREFLY_TEST_DEBUG_PORT || 19351)
  const child = spawn(path.resolve(process.env.FIREFLY_WINDOWS_TEST_EXE || 'target-check/debug/firefly-toolbox.exe'), args, { windowsHide: true, stdio: 'ignore' })
  let socket
  try {
    let target
    for (let attempt = 0; attempt < 120; attempt++) {
      assert.equal(child.exitCode, null, 'The Windows test application exited during startup.')
      try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(page => /^https?:\/\/tauri\.localhost\//.test(page.url) && page.url.includes('splash.html') === splash) } catch {}
      if (target) break
      await new Promise(resolve => setTimeout(resolve, 200))
    }
    assert(target, 'Build the Windows test configuration with its CDP port first.')
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Windows debug connection timed out.')), 5000)
      socket.onopen = () => { clearTimeout(timer); resolve() }
      socket.onerror = error => { clearTimeout(timer); reject(error) }
    })
    let sequence = 0
    const pending = new Map(), events = []
    socket.onmessage = ({ data }) => {
      const result = JSON.parse(data), item = pending.get(result.id)
      if (!item) { if (['Runtime.exceptionThrown', 'Log.entryAdded', 'Network.loadingFailed'].includes(result.method)) events.push(result); return }
      pending.delete(result.id); clearTimeout(item.timer)
      result.error ? item.reject(new Error(JSON.stringify(result.error))) : item.resolve(result.result)
    }
    const call = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Windows CDP timeout: ${method}`)) }, 45000)
      pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }))
    })
    const evaluate = async (fn, ...args) => {
      const result = await call('Runtime.evaluate', { expression: `(${fn})(${args.map(arg => JSON.stringify(arg)).join(',')})`, awaitPromise: true, returnByValue: true })
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
      return result.result.value
    }
    // Development builds reuse the app version while their public runtime files
    // change. Clear only this disposable profile before testing a fresh build.
    await call('Network.enable')
    await call('Network.clearBrowserCache')
    return { call, evaluate, events, pid: child.pid, invoke: (command, args = {}) => evaluate((command, args) => window.__TAURI_INTERNALS__.invoke(command, args), command, args),
      close() { socket.close(); child.kill() } }
  } catch (error) { socket?.close(); child.kill(); throw error }
}
