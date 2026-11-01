// Build debug clients with FIREFLY_REPOSITORY_TEST_URL=http://127.0.0.1:18794/.
// The loopback fixture exercises the same URL routing, hashing and installer,
// while installing only uniquely named test tools. Final clients use the real repo.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { connectWindows } from './windows-test-client.mjs'
import { connectAndroid } from './android-device-client.mjs'
import { repositoryFixture, repositoryCommit } from './tool-repository-fixture.mjs'

const keepAlive = setInterval(() => {}, 1000), windows = process.argv.includes('--windows')
const nativeFetch = fetch
globalThis.fetch = (url, init = {}) => nativeFetch(url, { ...init, signal: init.signal || AbortSignal.timeout(3000) })
const token = crypto.randomUUID().replaceAll('-', '').slice(0, 10), items = repositoryFixture(token)
const keys = ['firefly.smart-clipboard.v1', 'firefly.startup-splash-enabled.v1', 'firefly.remote-messages.read.v1', 'firefly.usage-stats.v1', 'firefly.tool-download-route.v1']
let mode = 'normal', failedProxyRequests = 0, abortedResponses = 0, catalogHeads = 0
const server = createServer((request, response) => {
  const requested = new URL(request.url, 'http://localhost').searchParams.get('url')
  if (!requested) { response.writeHead(404).end(); return }
  let url = new URL(requested), provider = url.hostname
  if (['gh-proxy.com', 'ghfast.top'].includes(provider)) url = new URL(url.pathname.slice(1) + url.search)
  if (mode === 'proxy_fail' && provider === 'gh-proxy.com') { failedProxyRequests++; response.writeHead(503).end('unavailable'); return }
  if (mode === 'offline') { response.writeHead(503).end('offline'); return }
  let data
  if (url.hostname === 'api.github.com') {
    if (url.pathname.endsWith('/git/ref/heads/main')) { catalogHeads++; data = { object: { type: 'commit', sha: repositoryCommit } } }
    else if (url.pathname.includes('/git/trees/')) data = { sha: repositoryCommit, truncated: false, tree: items.map(item => ({ type: 'blob', mode: '100644', path: item.entry.path, sha: item.entry.sha, size: item.entry.size })) }
    else if (url.pathname.endsWith('/commits')) {
      const item = items.find(item => item.entry.path === url.searchParams.get('path'))
      data = item ? [{ sha: repositoryCommit, commit: { message: item.title + '\n\n原生目录验证工具。', committer: { date: '2026-10-28T00:00:00Z' } } }] : []
    }
    if (data) {
      if (mode === 'bad_catalog' && data.tree) data.tree.push(
        { type: 'blob', mode: '100644', path: '异常目录/empty.fftool', sha: 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391', size: 0 },
        { type: 'blob', mode: '100644', path: '异常目录/bad-digest.fftool', sha: 'invalid', size: 12 },
      )
      response.setHeader('Content-Type', 'application/json')
      if (mode === 'slow_catalog' && url.pathname.endsWith('/git/ref/heads/main')) { const timer = setTimeout(() => response.end(JSON.stringify(data)), 1000); response.on('close', () => clearTimeout(timer)) }
      else response.end(JSON.stringify(data))
      return
    }
  }
  const item = items.find(item => decodeURIComponent(url.pathname).endsWith('/' + item.entry.path))
  if (!item) { response.writeHead(404).end(); return }
  const bytes = Buffer.from(item.bytes)
  if (mode === 'bad_hash' && item.kind === 'corrupt') bytes[bytes.length - 1] ^= 1
  response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length })
  if (mode === 'slow' && item.kind === 'normal') {
    response.write(bytes.subarray(0, 1))
    const timer = setTimeout(() => response.end(bytes.subarray(1)), 12000)
    response.on('close', () => { clearTimeout(timer); if (!response.writableEnded) abortedResponses++ })
  } else response.end(bytes)
})
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(18794, '127.0.0.1', resolve) })
let client, original, directory, reversed = false, savedAndroidFile = '', activeToken = '', pickerRequested = false
const installed = [], report = { checks: [], restored: false, cleaned: false }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn, ...args) { for (let i = 0; i < 250; i++) { if (await client.evaluate(fn, ...args)) return; await pause(100) }; throw new Error('Timed out: ' + fn) }
async function ready() { await until(() => { document.querySelector('.startup-splash-skip')?.click(); const app = document.querySelector('.app-shell'); return app && !app.inert && getComputedStyle(app).display !== 'none' }) }
async function nav(name) { await client.evaluate(name => [...document.querySelectorAll('.nav-button')].find(button => button.textContent.trim() === name).click(), name) }
async function tap(selector) {
  await client.evaluate(async selector => { const node = document.querySelector(selector); if (!node) throw new Error(selector); node.scrollIntoView({ block: 'center', behavior: 'instant' }); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))) }, selector)
  await pause(450)
  const point = await client.evaluate(selector => { const node = document.querySelector(selector), r = node.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2; if (!node.contains(document.elementFromPoint(x, y))) throw new Error('Obscured: ' + selector); return { x, y } }, selector)
  if (windows) { await client.call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point }); await client.call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point }) }
  else { await client.call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] }); await client.call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }) }
}
async function start(index, save = false) {
  await client.evaluate(({ id, save }) => { const card = [...document.querySelectorAll('.repository-card')].find(node => node.dataset.entryId === id); card.querySelector(save ? '.repository-card-actions .secondary-button' : '.repository-card-actions .primary-button').click() }, { id: items[index].entry.id, save })
}
async function preview() { await until(() => !!document.querySelector('.repository-dialog[open]')) }
async function screenshot(name) { await pause(200); const shot = await client.call('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(directory, name + '.png'), Buffer.from(shot.data, 'base64')) }
async function prepare(index, route = 'auto', requestId = crypto.randomUUID()) { const value = await client.invoke('repository_prepare', { id: items[index].entry.id, route, requestId }); activeToken = value.token; return value }
async function check(name, fn) { await fn(); report.checks.push(name); console.log('PASS:', name) }
try {
  client = await (windows ? connectWindows() : connectAndroid())
  if (!windows) {
    // Start with an empty in-memory catalog so the first-load race is exercised
    // even when the same debug APK was already running from a previous check.
    client.device('shell', 'am', 'force-stop', 'firefly.toolbox'); client.close()
    client = await connectAndroid()
  }
  directory = path.resolve('target-check/tool-download', windows ? 'windows' : client.device('get-serialno')); await mkdir(directory, { recursive: true })
  if (!windows) { client.device('reverse', 'tcp:18794', 'tcp:18794'); reversed = true }
  await ready(); original = await client.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), keys)
  await writeFile(path.join(directory, 'original-preferences.json'), JSON.stringify(original, null, 2))
  await client.evaluate(keys => { for (const key of keys) if (!key.includes('.read.')) localStorage.setItem(key, key.includes('download-route') ? 'auto' : 'false') }, keys)
  await client.call('Page.reload'); await ready(); await nav('关于应用')
  await until(() => { const button = document.querySelector('.about-link'); return button && !button.disabled })
  for (let i = 0; i < 3; i++) {
    if (!await client.evaluate(() => !!document.querySelector('.remote-message-dialog[open]'))) break
    await client.evaluate(() => { const modal = document.querySelector('.remote-message-dialog[open]'); if (modal.classList.contains('remote-message-required')) throw new Error('Live feed requires an update'); (modal.querySelector('.secondary-button') || modal.querySelector('.primary-button')).click() }); await pause(150)
  }
  await check('leaving and reopening during the first catalog load waits for the original result', async () => {
    mode = 'slow_catalog'; const before = catalogHeads
    await nav('工具市场')
    for (let i = 0; i < 100 && catalogHeads === before; i++) await pause(20)
    assert(catalogHeads > before, 'The first catalog request did not reach the fixture')
    await nav('首页'); await nav('工具市场')
    await until(() => document.querySelectorAll('.repository-card').length === 4 && !document.querySelector('.repository-refresh')?.disabled)
    assert.equal(catalogHeads - before, 1, 'A reopening page should reuse the in-flight request')
    assert.equal(await client.evaluate(() => document.querySelector('.toast')?.textContent.includes('正在刷新，请稍后重试') || false), false)
    mode = 'normal'; await screenshot('reentry')
  })
  await until(title => [...document.querySelectorAll('.repository-card h2')].some(node => node.textContent === title), items[0].title)
  await check('empty packages and invalid digests are isolated while valid packages remain downloadable', async () => {
    mode = 'bad_catalog'; await tap('.repository-refresh')
    await until(() => document.querySelector('.repository-skipped summary')?.textContent.includes('2 个'))
    assert.equal(await client.evaluate(() => document.querySelectorAll('.repository-card').length), 4)
    await tap('.repository-skipped summary')
    assert.equal(await client.evaluate(() => document.querySelector('.repository-skipped').textContent.includes('文件为空。') && document.querySelector('.repository-skipped').textContent.includes('文件摘要无效。')), true)
    assert.equal(await client.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await screenshot('skipped'); await start(0); await preview(); await tap('.repository-dialog .icon-button')
    mode = 'normal'; await tap('.repository-refresh'); await until(() => !document.querySelector('.repository-skipped'))
  })
  await check('native catalog reads commit titles, searches and filters without package downloads', async () => {
    await until(() => document.querySelectorAll('.repository-card').length === 4)
    assert.equal(await client.evaluate(() => document.querySelector('.repository-source-button').textContent.trim()), '从外部浏览器访问↗')
    await client.evaluate(() => document.querySelector('.repository-search input').focus())
    assert.notEqual(await client.evaluate(() => getComputedStyle(document.querySelector('.repository-search')).boxShadow), 'none')
    assert.equal(await client.evaluate(() => getComputedStyle(document.querySelector('.repository-search input')).boxShadow), 'none')
    assert.equal(await client.evaluate(() => document.querySelector('.repository-heading p').textContent), '从官方公开仓库获取的最新工具，下载后请仔细核对内容再安装使用。')
    await client.evaluate(() => document.querySelector('.repository-search input').blur())
    await client.evaluate(() => { const node = document.querySelector('.repository-search input'); node.value = '联网 生活'; node.dispatchEvent(new Event('input', { bubbles: true })) })
    await until(() => document.querySelectorAll('.repository-card').length === 1)
    await client.evaluate(() => { const node = document.querySelector('.repository-search input'); node.value = ''; node.dispatchEvent(new Event('input', { bubbles: true })) })
    await until(() => document.querySelectorAll('.repository-card').length === 4)
    assert.equal(await client.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); await screenshot('catalog')
  })
  await check('installation requires review, updates the real store, stays on the download page and can open the tool', async () => {
    await start(0); await preview()
    assert.equal((await client.invoke('list_modules')).some(item => item.module_id === items[0].summary.module_id), false)
    await screenshot('preview'); await tap('.repository-review-actions .primary-button')
    await until(() => !document.querySelector('.repository-dialog[open]') && document.querySelector('.toast')?.textContent.includes('已安装'))
    installed.push(items[0].summary.tool_ids[0])
    await until(() => !document.querySelector('.repository-card-actions .primary-button')?.disabled)
    assert((await client.invoke('list_modules')).some(item => item.module_id === items[0].summary.module_id))
    assert.equal(await client.evaluate(() => !!document.querySelector('.tool-download-page')), true)
    await client.evaluate(id => [...document.querySelectorAll('.repository-card')].find(node => node.dataset.entryId === id).querySelector('.repository-local-version button').click(), items[0].entry.id)
    await until(() => !!document.querySelector('.web-tool-frame') && document.querySelector('.tool-title')?.textContent.includes('本地小工具'))
    await nav('工具市场'); await until(() => document.querySelectorAll('.repository-card').length === 4)
  })
  await check('network consent is enforced both in the preview and by the native installer', async () => {
    const data = await prepare(1)
    await assert.rejects(client.invoke('repository_install', { token: data.token, allowNetwork: false, expectedVersion: null }), /联网/)
    await start(1); await preview()
    assert.equal(await client.evaluate(() => document.querySelector('.repository-review-actions .primary-button').disabled), true)
    assert.equal(await client.evaluate(() => document.querySelector('.repository-network').open), false)
    await tap('.repository-consent input'); await tap('.repository-review-actions .primary-button')
    await until(() => !document.querySelector('.repository-dialog[open]') && document.querySelector('.toast')?.textContent.includes('已安装'))
    installed.push(items[1].summary.tool_ids[0])
    await until(() => !document.querySelector('.repository-card-actions .primary-button')?.disabled)
  })
  await check('wrong checksums never create a preview or install; other catalog entries remain usable', async () => {
    mode = 'bad_hash'; await start(3)
    await until(() => document.querySelector('.toast')?.textContent.includes('摘要'))
    assert.equal(await client.evaluate(() => !!document.querySelector('.repository-dialog[open]')), false)
    assert.equal((await client.invoke('list_modules')).some(item => item.module_id === items[3].summary.module_id), false); mode = 'normal'
  })
  await check('download cancellation aborts a stalled transfer and cannot open a late install dialog', async () => {
    mode = 'slow'; await start(0); await until(() => !!document.querySelector('.repository-operation button')); await pause(250)
    await tap('.repository-operation button'); await until(() => document.querySelector('.toast')?.textContent.includes('已取消下载'))
    assert.equal(await client.evaluate(() => !!document.querySelector('.repository-dialog[open]')), false); mode = 'normal'
    assert(abortedResponses > 0)
  })
  await check('cached-byte leases cannot be released by stale callers, saved bytes match and version conflicts are rejected', async () => {
    const first = await prepare(0), second = await prepare(0); assert.notEqual(first.token, second.token); assert.equal(second.cached, true)
    await client.invoke('repository_release', { token: first.token })
    const saved = windows ? path.join(directory, 'downloaded.fftool') : `/data/user/0/firefly.toolbox/cache/repository-test-${token}.fftool`
    await client.invoke('repository_save', { token: second.token, path: saved })
    if (windows) assert((await readFile(saved)).equals(items[0].bytes))
    else {
      savedAndroidFile = `cache/repository-test-${token}.fftool`
      const adb = process.env.FIREFLY_ADB || path.join(process.env.LOCALAPPDATA, 'Android/Sdk/platform-tools/adb.exe')
      assert(execFileSync(adb, ['-s', client.device('get-serialno'), 'exec-out', 'run-as', 'firefly.toolbox', 'cat', savedAndroidFile], { windowsHide: true, timeout: 15000 }).equals(items[0].bytes))
    }
    await assert.rejects(client.invoke('repository_install', { token: second.token, allowNetwork: false, expectedVersion: null }), /版本已变化/)
    const requestId = crypto.randomUUID(); await client.invoke('repository_cancel', { requestId }); await assert.rejects(prepare(0, 'auto', requestId), /取消/)
  })
  await check('automatic provider fallback and future-version packages remain safely downloadable', async () => {
    await prepare(2); mode = 'proxy_fail'
    const refreshed = await client.invoke('repository_catalog', { route: 'auto', refresh: true }); assert.equal(refreshed.source, 'GitHub 直连')
    const value = await prepare(0); assert.equal(value.source, 'GHFast'); assert(failedProxyRequests > 0); mode = 'normal'
    const future = await prepare(2); assert.equal(future.compatible, false); assert(future.inspection_error)
    await assert.rejects(client.invoke('repository_install', { token: future.token, allowNetwork: true, expectedVersion: null }), /未通过检查/)
    await client.invoke('repository_save', { token: future.token, path: windows ? path.join(directory, 'future.fftool') : `/data/user/0/firefly.toolbox/cache/repository-test-${token}.fftool` })
  })
  await check('native save-picker cancellation returns to the page and offline refresh preserves the cached catalog', async () => {
    pickerRequested = true
    // Android may suspend WebView debugging while its system picker is open.
    // Observe/cancel through the OS before waiting for the click's CDP reply.
    const opening = start(0, true).then(() => ({}), error => ({ error }))
    if (windows) {
      const spec = path.join(directory, 'save-dialog.json'); await writeFile(spec, JSON.stringify({ title: '保存 .fftool 工具包', processId: client.pid }))
      let closed = false
      for (let i = 0; i < 30; i++) {
        const result = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', 'scripts/windows-file-picker.ps1', '-Action', 'cancel', '-PathsFile', spec], { encoding: 'utf8', windowsHide: true })
        if (JSON.parse(result).found) { closed = true; break }; await pause(150)
      }
      assert(closed, 'Native Windows save dialog was not found')
    } else {
      let opened = false
      for (let i = 0; i < 50; i++) { const state = client.device('shell', 'dumpsys', 'activity', 'activities'); if (/(?:topResumedActivity=|ResumedActivity:).*documentsui/i.test(state)) { opened = true; break }; await pause(100) }
      assert(opened, 'Android document picker was not opened')
      await pause(700); client.device('shell', 'input', 'keyevent', '4'); await pause(700)
      if (/topResumedActivity=.*documentsui/i.test(client.device('shell', 'dumpsys', 'activity', 'activities'))) client.device('shell', 'input', 'keyevent', '4')
    }
    const openedResult = await opening; if (openedResult.error) throw openedResult.error
    await until(() => document.querySelector('.toast')?.textContent.includes('已取消保存'))
    pickerRequested = false
    mode = 'offline'; await tap('.repository-refresh'); await until(() => document.querySelector('.toast')?.textContent.includes('503'))
    assert.equal(await client.evaluate(() => document.querySelectorAll('.repository-card').length), 4); mode = 'normal'
  })
  await check('native installation failures pop above the preview and its warning cards remain available', async () => {
    await start(0); await preview()
    assert.equal(await client.evaluate(() => document.querySelectorAll('.repository-dialog .repository-warning').length), 2)
    assert.equal(await client.evaluate(() => !!document.querySelector('.repository-review-caption, .repository-footnote')), false)
    // Issue a fresh native lease so the preview's old token is rejected without
    // changing any installed tool. This exercises real native error feedback.
    await prepare(0); await tap('.repository-review-actions .primary-button')
    await until(() => document.querySelector('.toast:popover-open')?.textContent.includes('缓存已释放'))
    assert.equal(await client.evaluate(() => !!document.querySelector('.repository-dialog[open]')), true)
    assert.equal(await client.evaluate(() => !!document.querySelector('.repository-dialog .error-text')), false)
    await screenshot('feedback'); await tap('.repository-dialog .icon-button')
  })
  if (windows) await check('saving an explicit extension keeps the native path and preserves an existing appended-name file', async () => {
    const output = path.join(directory, `save-extension-${token}.txt`), collision = output + '.fftool', marker = `original ${token}`
    await writeFile(collision, marker)
    const spec = path.join(directory, 'save-extension-dialog.json')
    await writeFile(spec, JSON.stringify({ title: '保存 .fftool 工具包', processId: client.pid, path: output }))
    pickerRequested = true
    const opening = start(0, true).then(() => ({}), error => ({ error }))
    let saved = false
    for (let i = 0; i < 30; i++) {
      const result = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', 'scripts/windows-file-picker.ps1', '-Action', 'save', '-PathsFile', spec], { encoding: 'utf8', windowsHide: true }))
      if (result.saved) { saved = true; break }; await pause(150)
    }
    assert(saved, 'Native Windows save dialog could not be submitted')
    const outcome = await opening; if (outcome.error) throw outcome.error
    await until(() => document.querySelector('.toast')?.textContent.includes('已保存'))
    pickerRequested = false
    assert((await readFile(output)).equals(items[0].bytes))
    assert.equal(await readFile(collision, 'utf8'), marker)
    await screenshot('save-extension')
  })
  if (windows) await check('cache cleanup rejects an old in-flight catalog refresh and cannot resurrect stale metadata', async () => {
    mode = 'slow_catalog'
    const oldRefresh = client.invoke('repository_catalog', { route: 'github', refresh: true }).then(value => ({ value }), error => ({ error }))
    await pause(150)
    const queuedRefresh = client.invoke('repository_catalog', { route: 'github', refresh: true }).then(value => ({ value }), error => ({ error }))
    await pause(100); await client.invoke('clear_runtime_cache'); mode = 'normal'
    const outcome = await oldRefresh; assert(outcome.error); assert.match(String(outcome.error), /缓存已清理/)
    const queuedOutcome = await queuedRefresh; assert(queuedOutcome.error); assert.match(String(queuedOutcome.error), /缓存已清理/)
    const current = await client.invoke('repository_catalog', { route: 'auto', refresh: false })
    assert.equal(current.from_cache, false); assert.equal(current.entries.length, 4)
  })
} catch (error) { if (directory) { await writeFile(path.join(directory, 'error.txt'), String(error.stack || error)); try { await screenshot('error') } catch {} }; throw error }
finally {
  try {
    mode = 'normal'
    if (client) {
      if (!windows && pickerRequested && /(?:topResumedActivity=|ResumedActivity:).*documentsui/i.test(client.device('shell', 'dumpsys', 'activity', 'activities'))) client.device('shell', 'input', 'keyevent', '4')
      try { await nav('首页') } catch {}
      if (activeToken) await client.invoke('repository_release', { token: activeToken }).catch(() => {})
      if (installed.length) await client.invoke('delete_tools', { toolIds: installed })
      report.cleaned = true
      if (savedAndroidFile) client.device('shell', 'run-as', 'firefly.toolbox', 'rm', '-f', savedAndroidFile)
      if (original) { await client.evaluate(saved => { for (const [key, value] of Object.entries(saved)) value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value) }, original); await client.call('Page.reload'); await ready(); assert.deepEqual(await client.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), keys), original); report.restored = true }
      if (directory) await writeFile(path.join(directory, 'results.json'), JSON.stringify(report, null, 2))
    }
  } finally { if (reversed) client.device('reverse', '--remove', 'tcp:18794'); client?.close(); server.closeAllConnections(); server.close(); clearInterval(keepAlive); globalThis.fetch = nativeFetch }
}
