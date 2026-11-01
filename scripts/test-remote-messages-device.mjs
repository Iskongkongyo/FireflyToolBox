// Compile debug clients with FIREFLY_MESSAGES_URL=http://127.0.0.1:18791/messages.json.
// Real native IPC + HTTP; no mocks of Tauri internals and no downloads/installs.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { connectAndroid } from './android-device-client.mjs'
import { connectWindows } from './windows-test-client.mjs'

const keepAlive = setInterval(() => {}, 1000), windows = process.argv.includes('--windows')
const fetchOriginal = globalThis.fetch
globalThis.fetch = (url, options = {}) => fetchOriginal(url, { ...options, signal: options.signal || AbortSignal.timeout(3000) })
const historyKey = 'firefly.remote-messages.read.v1', keys = [historyKey, 'firefly.smart-clipboard.v1', 'firefly.startup-splash-enabled.v1']
const id = `native-test-${Date.now()}`
const currentVersion = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version
const notice = { id: `${id}-notice`, enabled: true, show_once: true, title: '💌 给你的一封流萤来信 ❤️', content: '<h2>你好喵 🐱</h2><p>原生通知与正文<br>都已准备好。👨‍👩‍👧‍👦 👍🏽</p><ul><li>支持 HTML 排版 💚</li><li>确认之后不会重复打扰</li></ul>' }
const update = { id: `${id}-update`, enabled: true, show_once: true, title: '✨ 流萤百宝箱有新版本啦 👩🏽‍💻', version: '999.0.0', force: false, content: '<h2>🎉 让每一次使用更顺手</h2><p>这是双端原生验证使用的本地消息，不会安装更新。👩🏽‍💻 👍🏽</p><ul><li>启动时静默检查 💚</li><li>更清楚的更新说明</li><li>适配桌面、手机和平板</li></ul><img src="data:image/svg+xml,invalid" onerror="window.remoteXss=true"><script>window.remoteXss=true</script>', downloads: { windows: 'https://example.com/windows.exe', android: 'https://example.com/android.apk' } }
let data = { schema_version: 1 }, requests = 0, failures = 0, failAlways = false
const server = createServer((request, response) => {
  if (request.url !== '/messages.json') { response.writeHead(404).end(); return }
  requests++
  if (failAlways || failures-- > 0) { response.writeHead(503).end('offline'); return }
  response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(data))
})
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(18791, '127.0.0.1', resolve) })
let client, directory, original, reversed = false
const report = { platform: windows ? 'windows' : 'android', checks: [], restored: false }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn, ...args) { for (let i = 0; i < 160; i++) { if (await client.evaluate(fn, ...args)) return; await pause(100) }; throw new Error(`Timed out: ${fn}`) }
async function ready() { await until(() => { document.querySelector('.startup-splash-skip')?.click(); const app = document.querySelector('.app-shell'); return app && !app.inert && getComputedStyle(app).display !== 'none' }) }
async function reload(next, fail = 0) {
  data = structuredClone(next); requests = 0; failures = fail; failAlways = fail < 0
  await client.call('Page.reload'); await ready()
}
async function modal() { await until(() => !!document.querySelector('.remote-message-dialog[open]')) }
async function noModal() { await until(() => !document.querySelector('.remote-message-dialog[open]')) }
async function tap(selector) {
  await client.evaluate(async selector => { const node = document.querySelector(selector); if (!node) throw new Error('Missing: ' + selector); node.scrollIntoView({ block: 'center', behavior: 'instant' }); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))) }, selector)
  await pause(500)
  const point = await client.evaluate(selector => {
    const node = document.querySelector(selector), rect = node.getBoundingClientRect(), x = rect.x + rect.width / 2, y = rect.y + rect.height / 2
    if (!node.contains(document.elementFromPoint(x, y))) throw new Error('Tap is obscured: ' + selector)
    return { x, y }
  }, selector)
  if (windows) {
    await client.call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point })
    await client.call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point })
  } else {
    await client.call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] })
    await client.call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
}
async function back() { if (windows) await client.evaluate(() => window.dispatchEvent(new Event('firefly:native-back'))); else client.device('shell', 'input', 'keyevent', '4'); await pause(300) }
async function screenshot(name) { const shot = await client.call('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(directory, name), Buffer.from(shot.data, 'base64')) }
async function check(name, fn) { await fn(); report.checks.push(name); console.log('PASS:', name) }
async function settleStartup() {
  await client.evaluate(() => [...document.querySelectorAll('.nav-button')].find(node => node.textContent.trim() === '关于应用').click())
  await until(() => { const button = document.querySelector('.about-links .about-link'); return button && !button.disabled })
}
try {
  console.log('Connecting native client…')
  client = await (windows ? connectWindows() : connectAndroid())
  directory = path.resolve('target-check/remote-messages', windows ? 'windows' : client.device('get-serialno')); await mkdir(directory, { recursive: true })
  if (!windows) { client.device('reverse', 'tcp:18791', 'tcp:18791'); reversed = true }
  await ready()
  // A CDP reload does not cancel already executing Rust commands. Drain the
  // initial startup request before attributing HTTP counts to the next startup.
  await settleStartup()
  original = await client.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), keys)
  await writeFile(path.join(directory, 'original-preferences.json'), JSON.stringify(original, null, 2))
  await client.evaluate(({ keys, historyKey }) => { keys.forEach(key => localStorage.setItem(key, key === historyKey ? '[]' : 'false')) }, { keys, historyKey })
  await check('startup uses native HTTP, retries exactly once, filters HTML and selects the current platform', async () => {
    await reload({ schema_version: 1, update, notification: notice }, 1); await modal()
    assert.equal(requests, 2)
    assert.equal(await client.evaluate(() => document.getElementById('remote-message-title').textContent), update.title)
    assert.equal(await client.evaluate(() => document.querySelector('.remote-message-body p').textContent.endsWith('👩🏽‍💻 👍🏽')), true)
    assert.equal(await client.evaluate(() => !!document.querySelector('.remote-message-body script,.remote-message-body [onerror],.remote-message-body img') || !!window.remoteXss), false)
    assert.equal(await client.evaluate(() => !!document.querySelector('.remote-message-download')), false)
    const checkedFeed = await client.invoke('fetch_remote_messages')
    assert.equal(checkedFeed.update.download_url, update.downloads[windows ? 'windows' : 'android'])
    assert.equal(await client.evaluate(() => { const rect = document.querySelector('.remote-message-dialog').getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight }), true)
    await screenshot('update.png')
    await tap('.remote-message-actions .secondary-button')
    await until(title => document.getElementById('remote-message-title')?.textContent === title, notice.title)
    assert.equal(await client.evaluate(() => document.querySelector('.remote-message-body p').textContent.endsWith('👨‍👩‍👧‍👦 👍🏽')), true)
    await screenshot('notification.png')
    await tap('.remote-message-actions .primary-button'); await noModal()
    assert.deepEqual(await client.evaluate(key => JSON.parse(localStorage.getItem(key)), historyKey), [`update:${update.id}`, `notification:${notice.id}`])
  })
  await check('acknowledged IDs stay hidden on a new startup and new notice IDs appear', async () => {
    await reload({ schema_version: 1, update, notification: notice }); await pause(1000)
    assert.equal(requests, 1); await noModal()
    await reload({ schema_version: 1, notification: { ...notice, id: `${id}-second` } }); await modal(); await back(); await noModal()
    assert.equal(await client.evaluate(() => document.querySelector('.top-title')?.textContent.includes('流萤百宝箱')), true)
  })
  await check('disabled messages and an invalid forced-download URL never lock the app', async () => {
    await reload({ schema_version: 1, update: { ...update, enabled: false }, notification: { ...notice, enabled: false } }); await pause(700); await noModal()
    await reload({ schema_version: 1, update: { ...update, force: true, downloads: { windows: 'javascript:alert(1)', android: 'javascript:alert(1)' } }, notification: { ...notice, id: `${id}-valid` } }); await modal()
    assert.equal(await client.evaluate(() => document.getElementById('remote-message-title').textContent), notice.title)
    await tap('.remote-message-actions .primary-button'); await noModal()
    await assert.rejects(client.invoke('open_remote_message_link', { url: 'javascript:alert(1)' }), /HTTPS/)
  })
  await check('show_once false repeats update and notice after restart, ignores read IDs and never loops in the same session', async () => {
    const savedHistory = await client.evaluate(key => localStorage.getItem(key), historyKey)
    for (let launch = 0; launch < 2; launch++) {
      await reload({ schema_version: 1, update: { ...update, show_once: false }, notification: { ...notice, id: `${id}-repeat`, show_once: false } }); await modal()
      assert.equal(await client.evaluate(() => document.getElementById('remote-message-title').textContent), update.title)
      await tap('.remote-message-actions .secondary-button')
      await until(title => document.getElementById('remote-message-title')?.textContent === title, notice.title)
      await tap('.remote-message-actions .primary-button'); await noModal()
      assert.equal(await client.evaluate(key => localStorage.getItem(key), historyKey), savedHistory)
      await client.evaluate(() => window.dispatchEvent(new Event('firefly:foreground'))); await pause(300)
      assert.equal(requests, 1); await noModal()
    }
  })
  await check('equal or older app versions, disabled flags and missing platform downloads never show an update', async () => {
    const platform = windows ? 'windows' : 'android'
    for (const override of [
      { version: currentVersion }, { version: '0.0.0' }, { enabled: false },
      { downloads: {} }, { downloads: { [platform]: '' } },
      { downloads: { [windows ? 'android' : 'windows']: 'https://example.com/other-platform' } },
    ]) {
      await reload({ schema_version: 1, update: { ...update, show_once: false, force: true, ...override } })
      await settleStartup(); await noModal()
      assert.equal(requests, 1)
    }
  })
  await check('mandatory updates ignore read history and reject system Back and Escape', async () => {
    await reload({ schema_version: 1, update: { ...update, force: true }, notification: notice }); await modal()
    assert.equal(await client.evaluate(() => !!document.querySelector('.remote-message-close,.remote-message-actions .secondary-button')), false)
    await back(); await modal()
    await client.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await client.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await modal(); await screenshot('required-update.png')
  })
  await check('two HTTP failures remain silent, leave the app usable and never start a third request', async () => {
    await reload({ schema_version: 1 }, -1)
    await pause(1800)
    assert.equal(requests, 2); await noModal()
    assert.equal(await client.evaluate(() => !!document.querySelector('.toast')), false)
    await pause(800); assert.equal(requests, 2)
    failAlways = false
    await client.evaluate(() => [...document.querySelectorAll('.nav-button')].find(node => node.textContent.trim() === '关于应用').click())
    await until(() => !!document.querySelector('.about-links'))
    requests = 0; failAlways = true
    await tap('.about-links .about-link')
    await until(() => document.querySelector('.toast')?.textContent.includes('暂时无法检查更新'))
    assert.equal(requests, 2)
  })
} catch (error) {
  if (directory) { await writeFile(path.join(directory, 'error.txt'), String(error.stack || error)); try { await screenshot('error.png') } catch {} }
  throw error
} finally {
  try {
    failAlways = false; failures = 0; data = { schema_version: 1 }
    if (client && original) {
      await client.evaluate(saved => { for (const [key, value] of Object.entries(saved)) { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value) } }, original)
      await client.call('Page.reload'); await ready(); await settleStartup(); report.restored = true
      assert.deepEqual(await client.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), keys), original)
    }
    if (directory) await writeFile(path.join(directory, 'results.json'), JSON.stringify(report, null, 2))
  } finally {
    if (reversed) client.device('reverse', '--remove', 'tcp:18791')
    client?.close(); server.closeAllConnections(); server.close(); clearInterval(keepAlive); globalThis.fetch = fetchOriginal
  }
}
