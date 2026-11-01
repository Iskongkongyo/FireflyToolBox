import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { connectWindows } from './windows-test-client.mjs'
import { connectAndroid } from './android-device-client.mjs'
import { fullscreenFixture } from './web-tool-fullscreen-fixture.mjs'

const windows = process.argv.includes('--windows'), keepAlive = setInterval(() => {}, 1000)
// Build a debug client with FIREFLY_MESSAGES_URL=http://127.0.0.1:18791/messages.json
// to exercise real native HTTP and dialog/shortcut ordering deterministically.
const messagesMode = process.argv.includes('--messages')
let feed = { schema_version: 1 }, holdFeed = false, releaseFeed
const server = messagesMode ? createServer(async (request, response) => {
  if (request.url !== '/messages.json') { response.writeHead(404).end(); return }
  const value = structuredClone(feed)
  if (holdFeed) await new Promise(resolve => { releaseFeed = resolve })
  if (!response.destroyed) { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)) }
}) : null
if (server) await new Promise(resolve => server.listen(18791, '127.0.0.1', resolve))
const originalFetch = fetch
globalThis.fetch = (url, init = {}) => originalFetch(url, { ...init, signal: init.signal || AbortSignal.timeout(3000) })
const fullscreenKey = 'firefly.web-tool-default-fullscreen.v1', hintKey = 'firefly.web-tool-fullscreen-initial-hint.v1'
const groupKeys = ['firefly.groups.favorites.v1', 'firefly.groups.websites.v1']
const keys = ['firefly.smart-clipboard.v1', 'firefly.startup-splash-enabled.v1', 'firefly.remote-messages.read.v1', 'firefly.usage-stats.v1', fullscreenKey, hintKey, ...groupKeys]
const token = crypto.randomUUID().replaceAll('-', '').slice(0, 10)
const fixtures = [fullscreenFixture(`test.fsa_${token}`), fullscreenFixture(`test.fsn_${token}`, false)]
if (messagesMode) fixtures[1].scripts['main.js'] = fixtures[1].scripts['main.js'].replace('export function mount(){', 'export async function mount(){await new Promise(resolve => setTimeout(resolve, 600));')
for (const [index, fixture] of fixtures.entries()) {
  const name = `${index ? '普通' : '全屏'}测试 ${token}`
  fixture.manifest.name['zh-CN'] = name
  fixture.manifest.tools[0].name['zh-CN'] = name
}
const installed = [], report = { checks: [], restored: false, cleaned: false }
let client, directory, original, originalWindow, websiteId, reversed = false
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn, ...args) { for (let i = 0; i < 250; i++) { if (await client.evaluate(fn, ...args)) return; await pause(100) }; throw new Error('Timed out: ' + fn) }
async function shellReady() { await until(() => { document.querySelector('.startup-splash-skip')?.click(); const app = document.querySelector('.app-shell'); return app && getComputedStyle(app).display !== 'none' }) }
async function ready() {
  await shellReady(); await nav('关于应用')
  await until(() => { const button = document.querySelector('.about-link'); return button && !button.disabled })
  for (let i = 0; i < 3; i++) {
    const dismissed = await client.evaluate(() => { const dialog = document.querySelector('.remote-message-dialog[open]'); if (!dialog) return false; if (dialog.classList.contains('remote-message-required')) throw new Error('Live feed requires a mandatory update'); (dialog.querySelector('.secondary-button') || dialog.querySelector('.primary-button')).click(); return true })
    if (!dismissed) break
    await pause(150)
  }
}
async function runInFrame(fn, ...args) {
  const tree = await client.call('Page.getFrameTree')
  const find = node => node.frame.url === 'about:srcdoc' ? node.frame : node.childFrames?.map(find).find(Boolean)
  const frame = find(tree.frameTree); assert(frame, 'No active web tool frame')
  const world = await client.call('Page.createIsolatedWorld', { frameId: frame.id, worldName: 'fullscreen-device-review' })
  const result = await client.call('Runtime.evaluate', { expression: `(${fn})(${args.map(value => JSON.stringify(value)).join(',')})`, contextId: world.executionContextId, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result.value
}
async function tap(selector, child = false) {
  let rect
  if (!child) {
    // Android can commit a route's initial scroll restoration after the first
    // scrollIntoView. Check the actual hit target and retry the scroll.
    for (let attempt = 0; attempt < 5; attempt++) {
      await client.evaluate(async selector => { const node = document.querySelector(selector); if (!node) throw new Error(selector); node.scrollIntoView({ block: 'center', behavior: 'instant' }); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))) }, selector)
      await pause(450)
      rect = await client.evaluate(selector => { const node = document.querySelector(selector), r = node.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2; return node.contains(document.elementFromPoint(x, y)) ? { x, y } : null }, selector)
      if (rect) break
    }
    assert(rect, 'Obscured: ' + selector)
  } else {
    await pause(350)
    rect = await runInFrame(selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } }, selector)
  }
  if (child) { const offset = await client.evaluate(() => { const r = document.querySelector('.web-tool-frame').getBoundingClientRect(); return { x: r.x, y: r.y } }); rect.x += offset.x; rect.y += offset.y }
  if (windows) { await client.call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...rect }); await client.call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...rect }) }
  else { await client.call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...rect, id: 1 }] }); await client.call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }) }
}
async function full() {
  await until(() => document.documentElement.dataset.toolFullscreen === 'true')
  if (windows) {
    let entered = false
    for (let i = 0; i < 100; i++) { if (await client.invoke('plugin:window|is_fullscreen', { label: 'main' })) { entered = true; break }; await pause(100) }
    assert(entered, 'Windows never entered native fullscreen')
  } else {
    await until(() => window.FireflyInsets.top() === 0 && window.FireflyInsets.bottom() === 0)
  }
  await until(() => !document.querySelector('.web-tool-opening-cover'))
}
async function ordinary() {
  await until(() => !document.documentElement.dataset.toolFullscreen)
  if (windows) { for (let i = 0; i < 100; i++) { if (await client.invoke('plugin:window|is_fullscreen', { label: 'main' }) === originalWindow.fullscreen) return; await pause(100) }; throw new Error('Windows fullscreen did not restore') }
  else await until(() => window.FireflyInsets.top() > 0 || window.FireflyInsets.bottom() > 0)
}
async function nav(name) {
  await client.evaluate(name => [...document.querySelectorAll('.nav-button')].find(node => node.textContent.trim() === name).click(), name)
  await client.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await pause(200)
}
async function open(normal = false) {
  await nav('工具管理')
  await client.evaluate(name => [...document.querySelectorAll('.all-tool-item')].find(node => node.textContent.trim().includes(name)).click(), fixtures[normal ? 1 : 0].manifest.tools[0].name['zh-CN'])
  await until(() => document.querySelector('.web-tool-container')?.getAttribute('aria-busy') === 'false' && !!document.querySelector('.web-tool-frame'))
}
async function enter() { await tap('[aria-label="更多工具操作"]'); await client.evaluate(() => [...document.querySelectorAll('[role=menuitem]')].find(node => node.textContent.trim() === '全屏显示').click()); await full() }
async function hold(point) {
  await client.call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] })
  try { await pause(750) }
  finally { await client.call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }) }
}
async function revealControls() {
  const point = await client.evaluate(windows => ({ x: innerWidth - 8, y: windows ? 4 : 80 }), windows)
  if (windows) { await client.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 200, y: 300 }); await client.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point }); await pause(500) }
  else await hold(point)
  await until(() => !document.querySelector('.fullscreen-controls-hidden'))
  assert.equal(await client.evaluate(() => document.querySelectorAll('.fullscreen-exit-hint').length), 0)
  assert.equal(await runInFrame(() => document.documentElement.dataset.blankClicks), '0', 'Long-press release must not activate the tool')
}
async function screenshot(name) {
  const shot = await client.call('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(directory, name + '.png'), Buffer.from(shot.data, 'base64'))
  if (!windows) {
    const adb = process.env.FIREFLY_ADB || path.join(process.env.LOCALAPPDATA, 'Android/Sdk/platform-tools/adb.exe')
    await writeFile(path.join(directory, name + '-physical.png'), execFileSync(adb, ['-s', client.device('get-serialno'), 'exec-out', 'screencap', '-p'], { windowsHide: true, timeout: 15000, maxBuffer: 16 * 1024 * 1024 }))
  }
}
async function check(name, work) { await work(); report.checks.push(name); console.log('PASS:', name) }
try {
  client = await (windows ? connectWindows() : connectAndroid())
  if (messagesMode && !windows) { client.device('reverse', 'tcp:18791', 'tcp:18791'); reversed = true }
  directory = path.resolve('target-check/web-tool-fullscreen', windows ? 'windows' : client.device('get-serialno')); await mkdir(directory, { recursive: true })
  await shellReady()
  original = await client.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), keys)
  await writeFile(path.join(directory, 'original-preferences.json'), JSON.stringify(original, null, 2))
  if (windows) originalWindow = { fullscreen: await client.invoke('plugin:window|is_fullscreen', { label: 'main' }), size: await client.invoke('plugin:window|inner_size', { label: 'main' }) }
  await client.evaluate(({ keys, hintKey, groupKeys }) => { for (const key of keys) if (!key.includes('.read.') && !groupKeys.includes(key)) localStorage.setItem(key, key === hintKey ? 'true' : 'false') }, { keys, hintKey, groupKeys })
  for (const details of fixtures) { await client.invoke('install_module_draft', { manifest: details.manifest, scripts: details.scripts }); installed.push(details.manifest.tools[0].id) }
  await client.call('Page.reload'); await ready(); await nav('关于应用')
  await until(() => { const button = document.querySelector('.about-link'); return button && !button.disabled })
  for (let i = 0; i < 3; i++) {
    const modal = await client.evaluate(() => { const dialog = document.querySelector('.remote-message-dialog[open]'); if (!dialog) return false; if (dialog.classList.contains('remote-message-required')) throw new Error('Live feed requires a mandatory update'); return true })
    if (!modal) break
    await client.evaluate(() => { const dialog = document.querySelector('.remote-message-dialog[open]'); (dialog.querySelector('.secondary-button') || dialog.querySelector('.primary-button')).click() }); await pause(150)
  }
  await check('native fullscreen covers the entire viewport and focused-iframe Escape preserves all tool state', async () => {
    const details = await client.invoke('get_module_details', { moduleId: fixtures[0].manifest.module_id }); assert.equal(details.manifest.tools[0].ui.fullscreen, true)
    await open(); await full()
    await runInFrame(() => { document.getElementById('state').value = '保留输入 👩🏽‍💻' }); await tap('#advance', true)
    const viewport = await client.evaluate(() => { const r = document.querySelector('.web-tool-frame').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, vw: innerWidth, vh: visualViewport?.height ?? innerHeight } })
    assert(Math.abs(viewport.x) < 1 && Math.abs(viewport.y) < 1 && Math.abs(viewport.width - viewport.vw) < 1 && Math.abs(viewport.height - viewport.vh) < 2)
    report.fullscreenViewport = viewport; await screenshot('fullscreen')
    report.exitHint = await client.evaluate(() => document.querySelector('.fullscreen-exit-hint').innerText)
    assert.equal(report.exitHint, windows
      ? '退出全屏：按ESC退出；\n鼠标靠近右上方顶边并停留，呼出退出按钮'
      : '退出全屏：屏幕右边缘左滑或者点击系统返回键；\n长按右上角空白处呼出退出按钮')
    await runInFrame(() => document.getElementById('advance').focus())
    await client.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await client.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await ordinary()
    assert.deepEqual(await runInFrame(() => ({ input: document.getElementById('state').value, count: document.getElementById('count').textContent, mounts: document.documentElement.dataset.mountCount })), { input: '保留输入 👩🏽‍💻', count: '1', mounts: '1' })
    await screenshot('restored')
    if (windows) { const size = await client.invoke('plugin:window|inner_size', { label: 'main' }); assert(Math.abs(size.width - originalWindow.size.width) < 2 && Math.abs(size.height - originalWindow.size.height) < 2) }
  })
  await check('initial hint whitespace passes real clicks through to the underlying tool', async () => {
    await open(); await full(); await tap('#under-hint', true)
    assert.equal(await runInFrame(() => document.getElementById('under-count').textContent), '1')
    assert.equal(await client.evaluate(() => document.querySelectorAll('.fullscreen-exit-hint').length), 1)
    await tap('.fullscreen-exit-button'); await ordinary()
  })
  await check('ordinary corner tool clicks do not reveal controls; deliberate dwell or hold reveals only the exit button', async () => {
    await open(true); await ordinary(); await enter(); await pause(6400)
    await until(() => !!document.querySelector('.fullscreen-controls-hidden'))
    await tap('#corner', true); await pause(750)
    assert.equal(await runInFrame(() => document.getElementById('corner-count').textContent), '1')
    assert.equal(await client.evaluate(() => !!document.querySelector('.fullscreen-controls-hidden')), true)
    if (windows) {
      const point = await runInFrame(() => { const r = document.getElementById('edge-control').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
      await client.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point }); await pause(650)
    } else {
      for (const selector of ['#corner', '#corner-canvas']) {
        const point = await runInFrame(selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } }, selector)
        await hold(point)
      }
    }
    assert.equal(await client.evaluate(() => !!document.querySelector('.fullscreen-controls-hidden')), true)
    await revealControls(); await tap('.fullscreen-exit-button'); await ordinary()
  })
  await check(windows ? 'native Back exits fullscreen before leaving the tool' : 'physical Android right-edge swipe and system Back exit fullscreen before leaving the tool', async () => {
    await enter()
    if (!windows) {
      const size = client.device('shell', 'wm', 'size').match(/(\d+)x(\d+)/), width = Number(size[1]), height = Number(size[2]), y = Math.round(height * .67)
      client.device('shell', 'input', 'swipe', String(width - 12), String(y), String(width - 340), String(y), '250')
      await ordinary(); await enter(); client.device('shell', 'input', 'keyevent', '4')
    } else await client.evaluate(() => window.dispatchEvent(new Event('firefly:native-back')))
    await ordinary(); assert.equal(await client.evaluate(() => !!document.querySelector('.web-tool-frame')), true)
  })
  await check('runtime errors recover native bars and the application controls, and navigation releases fullscreen', async () => {
    await enter(); await tap('#fail', true); await ordinary()
    await until(() => document.querySelector('.web-tool-page .editor-status.error')?.textContent.includes('fixture-fullscreen-error'))
    await open(); await full(); await nav('首页'); await ordinary(); assert.equal(await client.evaluate(() => !!document.querySelector('.web-tool-frame')), false)
  })
  await check('native display switches persist after reload, with a divider and no horizontal overflow', async () => {
    await nav('更多设置')
    assert.deepEqual(await client.evaluate(() => [...document.querySelectorAll('.web-tool-presentation-settings [role=switch]')].map(node => node.getAttribute('aria-checked'))), ['false', 'true'])
    await tap('.web-tool-presentation-settings [role=switch]:first-child'); await tap('.web-tool-presentation-settings [role=switch]:last-child')
    await client.call('Page.reload'); await ready(); await nav('更多设置')
    assert.deepEqual(await client.evaluate(() => [...document.querySelectorAll('.web-tool-presentation-settings [role=switch]')].map(node => node.getAttribute('aria-checked'))), ['true', 'false'])
    assert.equal(await client.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.web-tool-presentation-settings')).borderTopWidth) > 0 && document.documentElement.scrollWidth <= innerWidth), true)
    await screenshot('display-settings')
  })
  await check('global fullscreen overrides an ordinary tool; disabled initial controls can still be revealed and exited', async () => {
    if (windows) await client.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 200, y: 300 })
    await client.evaluate(() => {
      window.presentationSamples = []; window.samplingPresentation = true
      function sample() {
        const frame = document.querySelector('.web-tool-frame')
        if (frame && getComputedStyle(frame).visibility === 'visible') { const r = frame.getBoundingClientRect(); window.presentationSamples.push({ full: document.documentElement.dataset.toolFullscreen, x: r.x, y: r.y, w: r.width, h: r.height, vw: innerWidth, vh: visualViewport?.height ?? innerHeight }) }
        if (window.samplingPresentation) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
    await open(true); await full(); await until(() => !!document.querySelector('.fullscreen-controls-hidden'))
    await pause(100)
    const samples = await client.evaluate(() => { window.samplingPresentation = false; return window.presentationSamples })
    assert(samples.length > 0)
    for (const r of samples) assert(r.full === 'true' && Math.abs(r.x) < 1 && Math.abs(r.y) < 1 && Math.abs(r.w - r.vw) < 1 && Math.abs(r.h - r.vh) < 2, JSON.stringify(r))
    report.visibleFullscreenSamples = samples.length
    await runInFrame(() => { document.getElementById('state').value = 'global fullscreen preserves input' })
    await screenshot('initial-controls-hidden')
    await revealControls(); await full(); await tap('.fullscreen-exit-button'); await ordinary()
    assert.equal(await runInFrame(() => document.getElementById('state').value), 'global fullscreen preserves input')
  })
  if (!windows) await check('Android warm desktop shortcut uses the same global fullscreen and hidden-hint settings', async () => {
    await nav('首页')
    client.device('shell', 'am', 'start', '-n', 'firefly.toolbox/.MainActivity', '-a', 'android.intent.action.VIEW', '--es', 'firefly_tool_id', fixtures[1].manifest.tools[0].id)
    await full(); await until(() => !!document.querySelector('.fullscreen-controls-hidden'))
    await tap('#advance', true); assert.equal(await runInFrame(() => document.getElementById('count').textContent), '1')
    client.device('shell', 'input', 'keyevent', '4'); await ordinary()
  })
  await check('cold native desktop shortcut also applies both global display settings', async () => {
    await nav('首页'); await ordinary()
    const device = client.device; client.close(); await pause(400)
    if (!windows) device('shell', 'am', 'force-stop', 'firefly.toolbox')
    const id = fixtures[1].manifest.tools[0].id
    client = await (windows ? connectWindows({ args: [`--firefly-open-tool=${id}`] }) : connectAndroid({ toolId: id }))
    await shellReady(); await full(); await until(() => !!document.querySelector('.fullscreen-controls-hidden'))
    assert.equal(await runInFrame(() => !!document.getElementById('advance')), true)
    await screenshot('cold-shortcut')
    if (windows) await client.evaluate(() => window.dispatchEvent(new Event('firefly:native-back')))
    else client.device('shell', 'input', 'keyevent', '4')
    await ordinary()
    await ready()
  })
  await check('favorite Ungrouped hides after the last real tool moves and reappears when removed from its group', async () => {
    const toolId = fixtures[1].manifest.tools[0].id
    await client.invoke('set_favorite', { toolId, favorite: true })
    const favorites = await client.invoke('list_favorites')
    await client.evaluate(({ key, favorites, toolId }) => localStorage.setItem(key, JSON.stringify({ enabled: true, groups: [{ id: 'favorite:review', name: '测试收藏' }, { id: 'favorite:empty', name: '测试空分组' }], assignments: Object.fromEntries(favorites.filter(id => id !== toolId).map(id => [id, 'favorite:review'])) })), { key: groupKeys[0], favorites, toolId })
    await client.call('Page.reload'); await ready(); await nav('收藏')
    await until(() => !!document.querySelector('.favorite-categories > [data-group-id="favorite:ungrouped"]'))
    assert.equal(await client.evaluate(() => document.querySelector('.favorite-categories [data-group-id="favorite:ungrouped"] .category-count')?.textContent), '1 个工具')
    await nav('分组管理')
    await client.evaluate(() => { document.querySelector('#group-tab-favorites').click(); const toggle = document.querySelector('[data-group-id="favorite:review"] .group-manager-card-toggle'); if (toggle.getAttribute('aria-expanded') !== 'true') toggle.click() })
    await client.evaluate(() => document.querySelector('[aria-label="选择工具加入测试收藏"]').click())
    await client.evaluate(name => [...document.querySelectorAll('[role=option]')].find(node => node.textContent.includes(name)).click(), fixtures[1].manifest.tools[0].name['zh-CN'])
    assert.equal(await client.evaluate(() => !!document.querySelector('.group-manager-card[data-group-id="favorite:ungrouped"]')), true)
    await nav('收藏')
    assert.equal(await client.evaluate(() => !!document.querySelector('.favorite-categories > [data-group-id="favorite:ungrouped"]')), false)
    assert.equal(await client.evaluate(() => !!document.querySelector('.favorite-categories > [data-group-id="favorite:empty"]')), true)
    assert.equal(await client.evaluate(() => document.querySelector('.favorite-categories [data-group-id="favorite:empty"] .category-count')?.textContent), '0 个工具')
    await screenshot('favorites-grouped'); await nav('分组管理')
    await client.evaluate(name => document.querySelector(`#group-panel-favorites [aria-label="将${name}移到未分组"]`).click(), fixtures[1].manifest.tools[0].name['zh-CN'])
    await nav('收藏'); await until(() => !!document.querySelector('.favorite-categories > [data-group-id="favorite:ungrouped"]'))
  })
  await check('website Ungrouped hides after its last real bookmark moves; management retains the target', async () => {
    const name = `测试网站 ${token}`
    const saved = await client.invoke('save_website', { website: { id: 0, name, url: 'https://example.com', description: '', tags: '', favorite: false } }); websiteId = saved.id
    await client.evaluate(({ key, sites, websiteId }) => localStorage.setItem(key, JSON.stringify({ enabled: true, groups: [{ id: 'website:review', name: '测试网站' }, { id: 'website:empty', name: '测试空分组' }], assignments: Object.fromEntries(sites.filter(site => site.id !== websiteId).map(site => [String(site.id), 'website:review'])) })), { key: groupKeys[1], sites: saved.websites, websiteId })
    await client.call('Page.reload'); await ready(); await nav('网站')
    await until(() => !!document.querySelector('.website-group[data-group-id="website:ungrouped"]'))
    assert.equal(await client.evaluate(() => document.querySelector('.website-group[data-group-id="website:ungrouped"] .category-count')?.textContent), '1 个网站')
    await nav('分组管理')
    await client.evaluate(() => document.querySelector('#group-tab-websites').click())
    await client.evaluate(() => { const toggle = document.querySelector('[data-group-id="website:review"] .group-manager-card-toggle'); if (toggle.getAttribute('aria-expanded') !== 'true') toggle.click() })
    await client.evaluate(() => document.querySelector('[aria-label="选择网站加入测试网站"]').click())
    await client.evaluate(name => [...document.querySelectorAll('[role=option]')].find(node => node.textContent.includes(name)).click(), name)
    assert.equal(await client.evaluate(() => !!document.querySelector('.group-manager-card[data-group-id="website:ungrouped"]')), true)
    await nav('网站')
    assert.equal(await client.evaluate(() => !!document.querySelector('.website-group[data-group-id="website:ungrouped"]')), false)
    assert.equal(await client.evaluate(() => !!document.querySelector('.website-group[data-group-id="website:empty"]')), true)
    await screenshot('websites-grouped'); await nav('分组管理')
    await client.evaluate(() => document.querySelector('#group-tab-websites').click())
    await client.evaluate(name => document.querySelector(`[aria-label="将${name}移到未分组"]`).click(), name)
    await nav('网站'); await until(() => !!document.querySelector('.website-group[data-group-id="website:ungrouped"]'))
  })
  await check('native market search has no inner square focus shadow and shows the requested introduction', async () => {
    await nav('工具市场')
    await client.evaluate(() => document.querySelector('.repository-search input').focus())
    assert.equal(await client.evaluate(() => getComputedStyle(document.querySelector('.repository-search input')).boxShadow), 'none')
    assert.notEqual(await client.evaluate(() => getComputedStyle(document.querySelector('.repository-search')).boxShadow), 'none')
    assert.equal(await client.evaluate(() => document.querySelector('.repository-heading p').textContent), '从官方公开仓库获取的最新工具，下载后请仔细核对内容再安装使用。')
    await client.evaluate(() => document.querySelector('.repository-search input').blur()); await screenshot('market-focus')
  })
  await check('home group headers show count badges beside names with no overflow', async () => {
    await nav('首页')
    assert.equal(await client.evaluate(() => {
      const headers = [...document.querySelectorAll('.home-categories .category-header')]
      return headers.length > 0 && headers.every(header => {
        const title = header.querySelector('strong').getBoundingClientRect(), badge = header.querySelector('.category-count')
        if (!badge || !/^\d+ 个工具$/.test(badge.textContent)) return false
        const r = badge.getBoundingClientRect(); return r.left >= title.right - 1 && Math.abs((r.top + r.bottom - title.top - title.bottom) / 2) < 2
      }) && document.documentElement.scrollWidth <= innerWidth
    }), true)
    await screenshot('home-counts')
  })
  if (messagesMode) {
    const update = { id: `fullscreen-update-${token}`, enabled: true, show_once: false, title: '全屏时序更新', content: '<p>原生全屏更新回归</p>', version: '99.0.0', force: false, downloads: { windows: 'https://example.com/update', android: 'https://example.com/update' } }
    const notification = { id: `fullscreen-notice-${token}`, enabled: true, show_once: false, title: '全屏时序公告', content: '<p>原生全屏公告回归</p>' }
    const modal = () => until(() => !!document.querySelector('.remote-message-dialog[open]'))
    const noModal = () => until(() => !document.querySelector('.remote-message-dialog[open]'))
    const restart = async delayed => {
      holdFeed = delayed; releaseFeed = undefined
      await nav('首页'); const device = client.device; client.close(); await pause(400)
      if (!windows) device('shell', 'am', 'force-stop', 'firefly.toolbox')
      const toolId = fixtures[1].manifest.tools[0].id
      client = await (windows ? connectWindows({ args: [`--firefly-open-tool=${toolId}`] }) : connectAndroid({ toolId }))
      await shellReady()
    }
    const releaseMessages = () => { assert(releaseFeed, 'No pending native message request'); holdFeed = false; releaseFeed() }
    const dismissBoth = async keepFullscreen => {
      await modal()
      assert.equal(await client.evaluate(() => document.querySelector('.remote-message-dialog[open] h2').textContent), update.title)
      if (keepFullscreen) assert.equal(await client.evaluate(() => document.documentElement.dataset.toolFullscreen), 'true')
      await tap('.remote-message-actions .secondary-button')
      await until(title => document.querySelector('.remote-message-dialog[open] h2')?.textContent === title, notification.title)
      if (keepFullscreen) assert.equal(await client.evaluate(() => document.documentElement.dataset.toolFullscreen), 'true')
      await tap('.remote-message-actions .primary-button'); await noModal()
    }
    await check('cold shortcut waits for queued native update and announcement before presenting fullscreen', async () => {
      feed = { schema_version: 1, update, notification }; await restart(false); await modal()
      await until(() => document.querySelector('.web-tool-container')?.getAttribute('aria-busy') === 'false')
      assert.equal(await client.evaluate(() => document.documentElement.dataset.toolFullscreen || ''), '')
      await tap('.remote-message-actions .secondary-button')
      await until(title => document.querySelector('.remote-message-dialog[open] h2')?.textContent === title, notification.title)
      assert.equal(await client.evaluate(() => document.documentElement.dataset.toolFullscreen || ''), '')
      await tap('.remote-message-actions .primary-button'); await noModal(); await full()
    })
    await check('late native update and announcement retain the shortcut fullscreen and its input and execution state', async () => {
      await restart(true); await full()
      await runInFrame(() => document.getElementById('state').value = 'native messages preserve state'); await tap('#advance', true)
      // A cold Android WebView can use its first physical touch to regain
      // focus. Establish the changed tool state before releasing the feed.
      await pause(300)
      if (await runInFrame(() => document.getElementById('count').textContent) === '0') { await tap('#advance', true); await pause(300) }
      assert.equal(await runInFrame(() => document.getElementById('count').textContent), '1', 'The pre-message tool interaction must have completed')
      releaseMessages(); await dismissBoth(true); await full(); await pause(200)
      assert.deepEqual(await runInFrame(() => ({ input: document.getElementById('state').value, count: document.getElementById('count').textContent, mounts: document.documentElement.dataset.mountCount })), { input: 'native messages preserve state', count: '1', mounts: '1' })
      await screenshot('shortcut-after-messages')
    })
    await check('explicit native fullscreen exit remains ordinary after delayed messages close', async () => {
      await restart(true); await full()
      if (windows) await client.evaluate(() => window.dispatchEvent(new Event('firefly:native-back')))
      else client.device('shell', 'input', 'keyevent', '4')
      await ordinary(); releaseMessages(); await dismissBoth(false); await ordinary()
    })
    await check('mandatory native update blocks a shortcut tool and rejects Back without losing its pending fullscreen request', async () => {
      feed = { schema_version: 1, update: { ...update, force: true }, notification }; await restart(false); await modal()
      if (windows) await client.evaluate(() => window.dispatchEvent(new Event('firefly:native-back')))
      else client.device('shell', 'input', 'keyevent', '4')
      await pause(200); assert.equal(await client.evaluate(() => !!document.querySelector('.remote-message-required[open]')), true)
      assert.equal(await client.evaluate(() => document.documentElement.dataset.toolFullscreen || ''), '')
      feed = { schema_version: 1 }; await client.call('Page.reload'); await ready()
    })
  }
} catch (error) { if (directory) { await writeFile(path.join(directory, 'error.txt'), String(error.stack || error)); try { await screenshot('error') } catch {} }; throw error }
finally {
  try {
    holdFeed = false; releaseFeed?.(); feed = { schema_version: 1 }
    if (client) {
      if (!windows) client.device('shell', 'am', 'start', '-n', 'firefly.toolbox/.MainActivity', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER')
      try { await nav('首页') } catch {}
      if (websiteId) await client.invoke('delete_website', { id: websiteId })
      if (installed.length) { await client.invoke('delete_tools', { toolIds: installed }); report.cleaned = true }
      if (original) {
        await client.evaluate(saved => { for (const [key, value] of Object.entries(saved)) value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value) }, original)
        await client.call('Page.reload'); await ready()
        // Startup messages may be configured to reappear. Restore the read
        // markers again after dismissing them so a test never consumes them.
        await client.evaluate(saved => { for (const [key, value] of Object.entries(saved)) value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value) }, original)
        await nav('首页')
        assert.deepEqual(await client.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), keys), original); report.restored = true
      }
      if (directory) await writeFile(path.join(directory, 'results.json'), JSON.stringify(report, null, 2))
    }
  } finally { if (reversed) client?.device('reverse', '--remove', 'tcp:18791'); client?.close(); server?.closeAllConnections(); server?.close(); clearInterval(keepAlive); globalThis.fetch = originalFetch }
}
