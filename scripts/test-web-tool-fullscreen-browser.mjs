import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'node:http'
import { chromium } from 'playwright-core'
import { mockAndroidShell } from './android-shell-fixture.mjs'
import { fullscreenFixture, fullscreenDescriptor } from './web-tool-fullscreen-fixture.mjs'

const root = path.resolve('dist'), shots = path.resolve('target-check/web-tool-fullscreen/browser')
fs.mkdirSync(shots, { recursive: true })
const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname, file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname))
  try { if (!file.startsWith(root + path.sep)) throw new Error(); response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' })[path.extname(file)] || 'application/octet-stream'); response.end(fs.readFileSync(file)) }
  catch { response.writeHead(404).end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ executablePath: fs.existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe') ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
const fixtures = [fullscreenFixture(), fullscreenFixture('test.fullscreen_normal', false)]
async function revealControls(page, width) {
  if (width >= 1000) { await page.mouse.move(200, 300); await page.mouse.move(width - 8, 4); await page.waitForTimeout(480) }
  else {
    const session = await page.context().newCDPSession(page)
    try { await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: width - 8, y: 80, id: 1 }] }); await page.waitForTimeout(700); await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }) }
    finally { await session.detach() }
  }
}
async function app(width, work, { preferences = {}, launch = '', feed = { configured: true, update: null, notification: null }, deferFeed = false, official = false } = {}) {
  const mobile = width < 1000
  const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: mobile,
    userAgent: mobile ? 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36' : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36' })
  context.setDefaultTimeout(10000)
  try {
    const page = await context.newPage()
    if (mobile) await page.addInitScript(mockAndroidShell)
    const appFixtures = structuredClone(fixtures)
    if (official) appFixtures[1].manifest.tools[0].id = 'boxoffice.live'
    await page.addInitScript(({ fixtures, tools, preferences, launch, feed, deferFeed }) => {
      window.isTauri = true; window.nativeFullscreen = false; window.nativeFullscreenCalls = []
      if (!sessionStorage.getItem('presentation-seeded')) {
        for (const [key, value] of Object.entries(preferences)) localStorage.setItem(key, value)
        sessionStorage.setItem('presentation-seeded', 'yes')
      }
      window.shortcutHint = launch && !sessionStorage.getItem('launch-offered') ? launch : ''
      if (launch) sessionStorage.setItem('launch-offered', 'yes')
      window.FireflyShortcutLaunch = { hasPendingLaunch: () => !!window.shortcutHint }
      const setItem = Storage.prototype.setItem
      Storage.prototype.setItem = function(key, value) { if (window.failNextPreference === key) { window.failNextPreference = ''; throw new Error('quota') }; return setItem.call(this, key, value) }
      localStorage.setItem('firefly.startup-splash-enabled.v1', 'false')
      window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, transformCallback: () => 1, unregisterCallback() {}, async invoke(command, args) {
        if (command === 'list_tools') return structuredClone(tools)
        if (command === 'take_shortcut_launch') { const hint = window.shortcutHint; window.shortcutHint = ''; return hint }
        if (command === 'get_module_details') return structuredClone(fixtures.find(item => item.manifest.module_id === args.moduleId))
        if (command === 'install_module_draft') { window.installedManifest = structuredClone(args.manifest); return { module_id: args.manifest.module_id } }
        if (command === 'load_tool_storage') return '{}'
        if (command === 'web_file_transport') return 'http://127.0.0.1:12345/0123456789abcdef0123456789abcdef'
        if (command === 'fetch_remote_messages') return deferFeed ? new Promise(resolve => { window.resolveFeed = resolve }) : structuredClone(feed)
        if (command === 'set_web_tool_fullscreen') {
          window.nativeFullscreenCalls.push(args.enabled)
          if (window.failFullscreen && args.enabled) throw new Error('Native enter failed')
          if (window.holdFullscreen && args.enabled) await new Promise(resolve => { window.releaseFullscreen = resolve })
          window.nativeFullscreen = args.enabled; return
        }
        if (command === 'desktop_close_behavior') return 'tray'; if (command === 'desktop_autostart_enabled') return false
        return ['list_favorites', 'list_recent_tools', 'list_modules', 'list_websites', 'list_custom_tools'].includes(command) ? [] : null
      } }
    }, { fixtures: appFixtures, tools: appFixtures.map(fullscreenDescriptor), preferences, launch, feed, deferFeed })
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    const nav = async name => { await page.locator('.nav-button').filter({ hasText: name }).evaluate(button => button.click()) }
    const open = async (normal = false) => {
      await nav('工具管理'); await page.locator('.all-tool-item').filter({ hasText: normal ? '普通测试工具' : '全屏测试工具' }).click()
      await page.frameLocator('.web-tool-frame').locator('#advance').waitFor({ state: 'attached' })
      await page.waitForFunction(() => document.querySelector('.web-tool-container')?.getAttribute('aria-busy') === 'false')
    }
    const full = () => page.waitForFunction(() => document.documentElement.dataset.toolFullscreen === 'true')
    const ordinary = () => page.waitForFunction(() => !document.documentElement.dataset.toolFullscreen)
    const frame = () => page.frameLocator('.web-tool-frame')
    await work({ page, open, full, ordinary, frame, nav, mobile })
  } finally { await context.close() }
}

try {
  const fullscreenKey = 'firefly.web-tool-default-fullscreen.v1', hintKey = 'firefly.web-tool-fullscreen-initial-hint.v1'
  const notice = { id: 'fullscreen-notice', enabled: true, show_once: false, title: '全屏公告', content: '<p>公告内容</p>' }
  const update = { ...notice, id: 'fullscreen-update', title: '全屏更新', version: '99.0.0', force: false, download_url: 'https://example.com/update' }
  const messageFeed = { configured: true, update, notification: notice }
  const popup = page => page.locator('.remote-message-dialog[open]')
  const presented = page => page.waitForFunction(() => !!document.querySelector('.web-tool-frame') && !document.querySelector('.web-tool-opening-cover'))
  for (const width of [1280, 390]) {
    await test(`the native box-office renderer stays available when global fullscreen is enabled at ${width}px`, async () => app(width, async ({ page, open, ordinary }) => {
      await open(true); await ordinary(); await presented(page)
      assert.equal(await page.locator('.app-shell').evaluate(node => getComputedStyle(node).visibility), 'visible')
      assert.equal(await page.getByRole('button', { name: '更多工具操作', exact: true }).isVisible(), true)
    }, { preferences: { [fullscreenKey]: 'true' }, official: true }))
    await test(`automatic fullscreen never paints an ordinary tool while mounting or waiting for native enter at ${width}px`, async () => app(width, async ({ page, open, full }) => {
      await page.evaluate(() => {
        window.holdFullscreen = true; window.presentationSamples = []; window.sampling = true
        function sample() {
          const frame = document.querySelector('.web-tool-frame')
          if (frame && getComputedStyle(frame).visibility === 'visible') {
            const r = frame.getBoundingClientRect()
            window.presentationSamples.push({ fullscreen: document.documentElement.dataset.toolFullscreen, x: r.x, y: r.y, width: r.width, height: r.height, vw: innerWidth, vh: visualViewport?.height ?? innerHeight })
          }
          if (window.sampling) requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      })
      await open(true); await full()
      if (width === 1280) {
        await page.waitForFunction(() => !!window.releaseFullscreen)
        assert.equal(await page.locator('.web-tool-frame').evaluate(frame => getComputedStyle(frame).visibility), 'hidden')
        assert.equal(await page.locator('.web-tool-opening-cover').count(), 1)
        await page.evaluate(() => { window.holdFullscreen = false; window.releaseFullscreen() })
      }
      await presented(page); await page.waitForTimeout(100)
      const samples = await page.evaluate(() => { window.sampling = false; return window.presentationSamples })
      assert(samples.length > 0)
      for (const r of samples) assert(r.fullscreen === 'true' && Math.abs(r.x) < 1 && Math.abs(r.y) < 1 && Math.abs(r.width - r.vw) < 1 && Math.abs(r.height - r.vh) < 2, JSON.stringify(r))
    }, { preferences: { [fullscreenKey]: 'true' } }))
    await test(`a shortcut opened underneath queued update and notice dialogs waits and presents directly fullscreen at ${width}px`, async () => app(width, async ({ page, full, frame }) => {
      await popup(page).getByRole('heading', { name: update.title }).waitFor()
      await page.evaluate(id => { window.shortcutHint = id; window.dispatchEvent(new Event('firefly:shortcut-open')) }, fixtures[1].manifest.tools[0].id)
      await frame().locator('#advance').waitFor({ state: 'attached' })
      await page.waitForFunction(() => document.querySelector('.web-tool-container')?.getAttribute('aria-busy') === 'false')
      assert.equal(await page.locator('html').getAttribute('data-tool-fullscreen'), null)
      await popup(page).getByRole('button', { name: '稍后再说', exact: true }).click()
      await popup(page).getByRole('heading', { name: notice.title }).waitFor()
      assert.equal(await page.locator('html').getAttribute('data-tool-fullscreen'), null)
      await popup(page).getByRole('button', { name: '我知道了', exact: true }).click()
      await full(); await presented(page); await page.waitForTimeout(150)
      assert.equal(await frame().locator('html').evaluate(() => window.mountCount), 1)
      assert.equal(await page.locator('html').getAttribute('data-tool-fullscreen'), 'true')
    }, { preferences: { [fullscreenKey]: 'true' }, feed: messageFeed }))
    await test(`late update and notice preserve the cold shortcut's fullscreen, input and running instance at ${width}px`, async () => app(width, async ({ page, full, frame }) => {
      await full(); await presented(page)
      await frame().locator('#state').fill('state survives both messages'); await frame().locator('#advance').click()
      await page.waitForFunction(() => !!window.resolveFeed)
      await page.evaluate(feed => window.resolveFeed(feed), messageFeed)
      await popup(page).getByRole('heading', { name: update.title }).waitFor()
      assert.equal(await page.locator('html').getAttribute('data-tool-fullscreen'), 'true')
      await page.evaluate(() => window.dispatchEvent(new Event('firefly:native-back')))
      await popup(page).getByRole('heading', { name: notice.title }).waitFor()
      assert.equal(await page.locator('html').getAttribute('data-tool-fullscreen'), 'true')
      await popup(page).press('Escape'); await popup(page).waitFor({ state: 'hidden' }); await page.waitForTimeout(150)
      assert.equal(await page.locator('html').getAttribute('data-tool-fullscreen'), 'true')
      assert.equal(await frame().locator('#state').inputValue(), 'state survives both messages')
      assert.equal(await frame().locator('#count').textContent(), '1')
      assert.equal(await frame().locator('html').evaluate(() => window.mountCount), 1)
      await page.screenshot({ path: path.join(shots, `shortcut-after-messages-${width}.png`) })
    }, { preferences: { [fullscreenKey]: 'true' }, launch: fixtures[1].manifest.tools[0].id, deferFeed: true }))
    await test(`late announcements never re-enter a fullscreen session the user already exited at ${width}px`, async () => app(width, async ({ page, full, ordinary, frame }) => {
      await full(); await presented(page); await frame().locator('#state').press('Escape'); await ordinary()
      await page.evaluate(feed => window.resolveFeed(feed), messageFeed)
      await popup(page).getByRole('button', { name: '稍后再说', exact: true }).click()
      await popup(page).getByRole('button', { name: '我知道了', exact: true }).click()
      await popup(page).waitFor({ state: 'hidden' }); await page.waitForTimeout(150)
      assert.equal(await page.locator('html').getAttribute('data-tool-fullscreen'), null)
    }, { preferences: { [fullscreenKey]: 'true' }, launch: fixtures[1].manifest.tools[0].id, deferFeed: true }))
    await test(`display switches persist, recover from a failed write and reset with the web settings at ${width}px`, async () => app(width, async ({ page, nav }) => {
      await nav('更多设置')
      const defaultFull = page.getByRole('switch', { name: /^网页工具默认全屏显示/ }), hint = page.getByRole('switch', { name: /^退出全屏的初次提示/ })
      assert.equal(await defaultFull.getAttribute('aria-checked'), 'false'); assert.equal(await hint.getAttribute('aria-checked'), 'true')
      assert(parseFloat(await page.locator('.web-tool-presentation-settings').evaluate(node => getComputedStyle(node).borderTopWidth)) > 0)
      await defaultFull.click(); await hint.click()
      await page.reload(); await nav('更多设置')
      assert.equal(await defaultFull.getAttribute('aria-checked'), 'true'); assert.equal(await hint.getAttribute('aria-checked'), 'false')
      await page.evaluate(key => window.failNextPreference = key, fullscreenKey)
      await defaultFull.click(); await page.locator('.toast').filter({ hasText: '显示设置未能保存' }).waitFor()
      assert.equal(await defaultFull.getAttribute('aria-checked'), 'true')
      assert.equal(await page.evaluate(key => localStorage.getItem(key), fullscreenKey), 'true')
      await page.evaluate(() => document.documentElement.style.setProperty('--app-font-scale', '1.25'))
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      await page.screenshot({ path: path.join(shots, `display-settings-${width}.png`), fullPage: true })
      await page.locator('.web-tool-budget-settings').getByRole('button', { name: '恢复默认', exact: true }).click()
      assert.equal(await defaultFull.getAttribute('aria-checked'), 'false'); assert.equal(await hint.getAttribute('aria-checked'), 'true')
      assert.deepEqual(await page.evaluate(keys => keys.map(key => localStorage.getItem(key)), [fullscreenKey, hintKey]), [null, null])
    }))
    await test(`global default applies to direct and warm shortcut opens while initial controls stay hidden at ${width}px`, async () => app(width, async ({ page, open, full, ordinary, frame, mobile }) => {
      await page.mouse.move(200, 300); await open(true); await full()
      await page.waitForFunction(() => !!document.querySelector('.fullscreen-controls-hidden'))
      await frame().locator('#state').fill('keep the tool instance')
      await revealControls(page, width)
      await page.waitForFunction(() => !document.querySelector('.fullscreen-controls-hidden'))
      await full(); await page.getByRole('button', { name: '退出工具全屏' }).click(); await ordinary()
      assert.equal(await frame().locator('#state').inputValue(), 'keep the tool instance')
      await page.mouse.move(200, 300)
      await page.evaluate(id => { window.shortcutHint = id; window.dispatchEvent(new Event('firefly:shortcut-open')) }, fixtures[1].manifest.tools[0].id)
      await full(); await page.waitForFunction(() => !!document.querySelector('.fullscreen-controls-hidden'))
      await frame().locator('#state').press('Escape'); await ordinary()
    }, { preferences: { [fullscreenKey]: 'true', [hintKey]: 'false' } }))
    await test(`cold shortcut opens share the global fullscreen and hidden-initial-controls policy at ${width}px`, async () => app(width, async ({ page, full, ordinary, frame }) => {
      await full(); await frame().locator('#advance').waitFor()
      await page.waitForFunction(() => !!document.querySelector('.fullscreen-controls-hidden'))
      await frame().locator('#advance').click()
      assert.equal(await frame().locator('#count').textContent(), '1')
      await frame().locator('#state').press('Escape'); await ordinary()
    }, { preferences: { [fullscreenKey]: 'true', [hintKey]: 'false' }, launch: fixtures[1].manifest.tools[0].id }))
  }
  await test('turning off initial controls also applies to a manually entered fullscreen session', async () => app(1280, async ({ page, open, full, ordinary, frame }) => {
    await open(true); await ordinary()
    await page.getByRole('button', { name: '更多工具操作' }).click(); await page.getByRole('menuitem', { name: '全屏显示', exact: true }).click()
    await full(); await page.waitForFunction(() => !!document.querySelector('.fullscreen-controls-hidden'))
    await frame().locator('#state').press('Escape'); await ordinary()
  }, { preferences: { [hintKey]: 'false' } }))
  for (const width of [1280, 390, 640]) {
    await test(`configured fullscreen fills the viewport and iframe Escape preserves state at ${width}px`, async () => app(width, async ({ page, open, full, ordinary, frame }) => {
      await open(); await full()
      assert.equal(await page.locator('.fullscreen-exit-hint').innerText(), width === 1280
        ? '退出全屏：按ESC退出；\n鼠标靠近右上方顶边并停留，呼出退出按钮'
        : '退出全屏：屏幕右边缘左滑或者点击系统返回键；\n长按右上角空白处呼出退出按钮')
      await frame().locator('#state').fill('keep input 👩🏽‍💻'); await frame().locator('#advance').click()
      const before = await frame().locator('html').evaluate(() => window.mountCount)
      const rect = await page.locator('.web-tool-frame').boundingBox()
      assert(Math.abs(rect.x) < 1 && Math.abs(rect.y) < 1 && Math.abs(rect.width - width) < 1 && Math.abs(rect.height - 900) < 1)
      await page.screenshot({ path: path.join(shots, `fullscreen-${width}.png`) })
      await frame().locator('#state').press('Escape'); await ordinary()
      assert.equal(await frame().locator('#state').inputValue(), 'keep input 👩🏽‍💻')
      assert.equal(await frame().locator('#count').textContent(), '1')
      assert.equal(await frame().locator('html').evaluate(() => window.mountCount), before)
      assert.equal(await page.locator('.web-tool-frame').getAttribute('sandbox'), 'allow-scripts')
      await page.screenshot({ path: path.join(shots, `ordinary-${width}.png`) })
    }))
    await test(`ordinary tools can enter manually, and the host exit button preserves the page at ${width}px`, async () => app(width, async ({ page, open, full, ordinary, frame }) => {
      await open(true); await ordinary(); await frame().locator('#state').fill('manual input')
      await page.getByRole('button', { name: '更多工具操作', exact: true }).click()
      await page.getByRole('menuitem', { name: '全屏显示', exact: true }).click(); await full()
      if (width === 1280) await page.getByRole('button', { name: '退出工具全屏' }).press('Enter')
      else await page.getByRole('button', { name: '退出工具全屏' }).tap()
      await ordinary()
      assert.equal(await frame().locator('#state').inputValue(), 'manual input')
      assert.equal(await frame().locator('html').evaluate(() => window.mountCount), 1)
    }))
  }
  await test('mobile Back exits fullscreen first; only a right-edge swipe exits, normal swipes and input edits do not', async () => app(390, async ({ page, open, full, ordinary, frame }) => {
    await open(); await full()
    const touch = async (x, dx, target = '#surface') => frame().locator(target).evaluate((node, { x, dx }) => {
      node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: x, clientY: 400 }))
      node.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: x + dx, clientY: 402 }))
      node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: x + dx, clientY: 402 }))
    }, { x, dx })
    await touch(200, -100); await page.waitForTimeout(100); assert.equal(await page.locator('html').getAttribute('data-tool-fullscreen'), 'true')
    await touch(385, -100, '#state'); await page.waitForTimeout(100); assert.equal(await page.locator('html').getAttribute('data-tool-fullscreen'), 'true')
    await touch(385, -100); await ordinary()
    await page.getByRole('button', { name: '更多工具操作' }).click(); await page.getByRole('menuitem', { name: '全屏显示', exact: true }).click(); await full()
    await page.evaluate(() => window.dispatchEvent(new Event('firefly:native-back'))); await ordinary()
    assert.equal(await page.locator('.web-tool-frame').count(), 1)
  }))
  await test('initial hints last six seconds; an ordinary tap stays with the tool and a deliberate hold reveals only the exit button', async () => app(390, async ({ page, open, full, ordinary, frame }) => {
    await open(); await full()
    assert.equal(await page.locator('.fullscreen-exit-hint').innerText(), '退出全屏：屏幕右边缘左滑或者点击系统返回键；\n长按右上角空白处呼出退出按钮')
    await page.waitForTimeout(3400)
    assert.equal(await page.locator('.fullscreen-controls-hidden').count(), 0)
    await page.waitForTimeout(3000)
    assert.equal(await page.locator('.fullscreen-controls-hidden').count(), 1)
    const rect = await page.locator('.fullscreen-exit-button').boundingBox()
    await page.touchscreen.tap(rect.x + rect.width / 2, rect.y + rect.height / 2)
    await page.waitForTimeout(700)
    assert.equal(await page.locator('html').getAttribute('data-tool-fullscreen'), 'true')
    assert.equal(await frame().locator('#corner-count').textContent(), '1')
    assert.equal(await page.locator('.fullscreen-controls-hidden').count(), 1)
    await revealControls(page, 390)
    await page.waitForFunction(() => !document.querySelector('.fullscreen-controls-hidden'))
    assert.equal(await page.locator('.fullscreen-exit-hint').count(), 0)
    assert.equal(await page.getByRole('button', { name: '退出工具全屏' }).isVisible(), true)
    // Reject a stale touch-generated click without a new press, including when
    // the control is already visible after the first tap.
    await page.locator('.fullscreen-exit-button').dispatchEvent('click', { detail: 1 })
    assert.equal(await page.locator('html').getAttribute('data-tool-fullscreen'), 'true')
    await page.getByRole('button', { name: '退出工具全屏' }).tap(); await ordinary()
  }))
  for (const width of [1280, 390]) {
    await test(`corner tool buttons and drawing surfaces do not summon exit controls at ${width}px`, async () => app(width, async ({ page, open, full, ordinary, frame, mobile }) => {
      await open(); await full(); await page.waitForFunction(() => !!document.querySelector('.fullscreen-controls-hidden'))
      const button = frame().locator('#corner')
      if (!mobile) { await button.hover(); await page.waitForTimeout(600) }
      await button.click(); assert.equal(await frame().locator('#corner-count').textContent(), '1')
      await page.waitForTimeout(750); assert.equal(await page.locator('.fullscreen-controls-hidden').count(), 1)
      if (mobile) {
        const session = await page.context().newCDPSession(page)
        try {
          for (const selector of ['#corner', '#corner-canvas']) {
            const rect = await frame().locator(selector).boundingBox()
            await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, id: 1 }] })
            await page.waitForTimeout(750); await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
            assert.equal(await page.locator('.fullscreen-controls-hidden').count(), 1)
          }
        } finally { await session.detach() }
      } else { await frame().locator('#edge-control').hover(); await page.waitForTimeout(600); assert.equal(await page.locator('.fullscreen-controls-hidden').count(), 1) }
      await revealControls(page, width); await page.waitForFunction(() => !document.querySelector('.fullscreen-controls-hidden'))
      assert.equal(await page.locator('.fullscreen-exit-hint').count(), 0)
      assert.equal(await frame().locator('html').getAttribute('data-blank-clicks'), '0', 'A recognized hold must not click the underlying tool')
      await page.getByRole('button', { name: '退出工具全屏' }).click(); await ordinary()
    }, { preferences: { [hintKey]: 'false' } }))
    await test(`initial hint and overlay whitespace pass clicks through to the tool at ${width}px`, async () => app(width, async ({ page, open, full, ordinary, frame }) => {
      await open(); await full(); await page.locator('.fullscreen-exit-hint').waitFor()
      await frame().locator('#under-hint').click(); assert.equal(await frame().locator('#under-count').textContent(), '1')
      await full(); await frame().locator('#state').press('Escape'); await ordinary()
    }))
  }
  await test('keyboard focus can reveal hidden exit controls without repeating the hint', async () => app(1280, async ({ page, open, full, ordinary }) => {
    await open(); await full(); await page.waitForFunction(() => !!document.querySelector('.fullscreen-controls-hidden'))
    const button = page.getByRole('button', { name: '退出工具全屏' }); await button.focus()
    await page.waitForFunction(() => !document.querySelector('.fullscreen-controls-hidden'))
    assert.equal(await page.locator('.fullscreen-exit-hint').count(), 0); await button.press('Enter'); await ordinary()
  }, { preferences: { [hintKey]: 'false' } }))
  await test('opening host search releases fullscreen without resetting the tool', async () => app(1280, async ({ page, open, full, ordinary, frame }) => {
    await open(); await full(); await frame().locator('#state').fill('search preserves this')
    await page.getByRole('button', { name: '退出工具全屏' }).focus()
    await page.keyboard.press('Control+k'); await ordinary(); await page.locator('.search-page').waitFor()
    await page.keyboard.press('Escape'); await page.locator('.search-page').waitFor({ state: 'hidden' })
    assert.equal(await frame().locator('#state').inputValue(), 'search preserves this')
    assert.equal(await frame().locator('html').evaluate(() => window.mountCount), 1)
  }))
  await test('tool errors, navigation and stop recover the application without a stale fullscreen state', async () => app(1280, async ({ page, open, full, ordinary, frame, nav }) => {
    await open(); await full(); await frame().locator('#fail').click(); await ordinary()
    await page.locator('.web-tool-page .editor-status.error').filter({ hasText: 'fixture-fullscreen-error' }).waitFor()
    await open(); await full(); await nav('首页'); await ordinary()
    await page.waitForFunction(() => window.nativeFullscreen === false)
    await open(); await full(); await page.getByRole('button', { name: '退出工具全屏' }).click()
    await page.getByRole('button', { name: '更多工具操作' }).click(); await page.getByRole('menuitem', { name: '停止工具', exact: true }).click(); await ordinary()
    assert.equal(await page.locator('.web-tool-frame').count(), 0)
  }))
  await test('a delayed enter cannot outlive navigation, and native enter failures keep the tool usable', async () => app(1280, async ({ page, open, full, ordinary, nav }) => {
    await page.evaluate(() => { window.holdFullscreen = true }); await open(); await full()
    await page.waitForFunction(() => !!window.releaseFullscreen); await nav('首页'); await ordinary()
    await page.evaluate(() => { window.holdFullscreen = false; window.releaseFullscreen() })
    await page.waitForFunction(() => window.nativeFullscreen === false)
    await page.evaluate(() => { window.failFullscreen = true }); await open(); await ordinary()
    await page.locator('.toast').filter({ hasText: '无法进入系统全屏' }).waitFor()
    assert.equal(await page.frameLocator('.web-tool-frame').locator('#advance').isVisible(), true)
  }))
  await test('creator persists the default display choice, keeps previews ordinary, and exports the native manifest flag', async () => app(390, async ({ page, nav }) => {
    await nav('工具管理'); await page.getByRole('button', { name: '打开工具工作台', exact: true }).click()
    await page.locator('#studio-tab-create').click()
    await page.locator('[data-tool-kind=web]').click()
    await page.locator('#tool-creation-name').fill('Default fullscreen example')
    await page.locator('.tool-advanced-settings > summary').click()
    await page.getByLabel('默认显示方式').selectOption('true')
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('firefly.tool-creator.draft.v1'))?.draft.fullscreen === true)
    await page.locator('[data-tool-kind=text]').click(); await page.locator('[data-tool-kind=web]').click()
    assert.equal(await page.getByLabel('默认显示方式').inputValue(), 'true')
    await page.getByRole('button', { name: '预览网页工具', exact: true }).click()
    await page.locator('[aria-label="工具预览页面"] .web-tool-frame').waitFor()
    assert.equal(await page.locator('html').getAttribute('data-tool-fullscreen'), null)
    await page.waitForFunction(() => document.querySelector('[aria-label="工具预览页面"]')?.getAttribute('aria-busy') === 'false')
    await page.getByRole('button', { name: '保存工具', exact: true }).click()
    await page.waitForFunction(() => window.installedManifest?.tools[0].ui.fullscreen === true)
    assert.equal(await page.evaluate(() => window.installedManifest.tools[0].ui.kind), 'web')
  }))
} finally { await browser.close(); server.close() }
