import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { readFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { chromium } from 'playwright-core'

const directory = path.resolve('target-check/tablet-layout/browser')
const androidUA = 'Mozilla/5.0 (Linux; Android 12; DBY-W09; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/114.0.5735.196 Safari/537.36'
const windowsUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36'
let browser, server, origin
before(async () => {
  await mkdir(directory, { recursive: true })
  const root = path.resolve('dist')
  server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname, file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname))
    if (!file.startsWith(root + path.sep)) { response.writeHead(404); response.end(); return }
    try { response.setHeader('Content-Type', { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream'); response.end(await readFile(file)) }
    catch { response.writeHead(404); response.end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`
  const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  browser = await chromium.launch({ headless: true, executablePath: process.env.FIREFLY_TEST_BROWSER || (existsSync(chrome) ? chrome : 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe') })
})
after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)) })
async function fixture(t, { android = true, width = 640, height = 1024 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: android, userAgent: android ? androidUA : windowsUA }); t.after(() => context.close())
  const page = await context.newPage(), errors = []; page.setDefaultTimeout(8000)
  page.on('pageerror', error => errors.push(error.message)); t.after(() => assert.deepEqual(errors, []))
  await page.addInitScript(() => {
    localStorage.setItem('firefly.startup-splash-enabled.v1', 'false')
    if (localStorage.getItem('firefly.auto-hide-bars.v1') === null) localStorage.setItem('firefly.auto-hide-bars.v1', 'true')
    window.isTauri = true
    window.FireflyAndroid = { onmessage: null, postMessage(text) {
      const request = JSON.parse(text), result = request.operation === 'state' ? { top: 24, bottom: 16, shortcutPending: false } : true
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ id: request.id, result }) }))
    } }
    const tools = Array.from({ length: 60 }, (_, i) => ({ id: `layout.${i}`, name: `布局工具 ${i}`, description: '', category: `布局分组 ${i}`, aliases: [], tags: [], builtin: true, custom: false, pipeline_compatible: true, ui_kind: 'text', actions: [{ id: 'run', label: '运行' }] }))
    window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, transformCallback: () => 1, unregisterCallback() {}, async invoke(command) {
      if (command === 'list_tools') return tools
      if (['list_custom_tools', 'list_websites', 'list_modules', 'list_favorites', 'list_recent_tools'].includes(command)) return []
      if (command === 'desktop_close_behavior') return 'tray'
      if (command === 'desktop_autostart_enabled') return false
      return null
    } }
  })
  await page.goto(origin); await page.locator('.app-shell').waitFor({ state: 'visible' })
  return page
}
const hidden = page => page.locator('.app-shell.bars-hidden').count()
async function menu(page, label) {
  await page.getByRole('button', { name: '打开侧边栏', exact: true }).click()
  await page.locator('.nav-button').filter({ hasText: label }).click()
}
async function swipe(page, selector) {
  const box = await page.locator(selector).boundingBox(), y = box.y + Math.min(180, box.height / 2)
  const session = await page.context().newCDPSession(page)
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width * .8, y }] })
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + box.width * .2, y }] })
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await session.detach()
}

for (const [width, height] of [[640, 1024], [1024, 640], [1280, 800]]) test(`Android tablets use mobile navigation, scrolling and gestures at ${width}x${height}`, async t => {
  const page = await fixture(t, { width, height })
  assert.equal(await page.locator('html').getAttribute('data-app-layout'), 'mobile')
  assert.equal(await page.locator('.bottom-nav').isVisible(), true)
  assert.equal(await page.locator('.desktop-menu-button').isVisible(), false)
  await menu(page, '更多设置')
  const toggle = page.getByRole('switch', { name: /自动隐藏导航栏/ })
  assert.equal(await toggle.isVisible(), true)
  await toggle.click(); assert.equal(await toggle.getAttribute('aria-checked'), 'false')
  await page.reload(); await menu(page, '更多设置')
  assert.equal(await toggle.getAttribute('aria-checked'), 'false')
  await toggle.click()
  await page.locator('.top-title .top-icon-button').click()
  await page.waitForTimeout(320)
  await page.locator('.tab-panel-active').evaluate(panel => panel.scrollTop = 220)
  await page.waitForFunction(() => document.querySelector('.app-shell').classList.contains('bars-hidden'))
  await page.waitForTimeout(350)
  await page.locator('.tab-panel-active').evaluate(panel => panel.scrollTop = 0)
  await page.waitForFunction(() => !document.querySelector('.app-shell').classList.contains('bars-hidden'))
  await swipe(page, '.tab-panel-active')
  await page.getByRole('button', { name: '收藏', exact: true }).filter({ has: page.locator('.bottom-nav-icon') }).waitFor()
  await page.waitForFunction(() => document.querySelector('.bottom-nav button[aria-current=page]')?.textContent === '收藏')
  await page.waitForFunction(() => !document.querySelector('.tab-track-settling'))
  await page.waitForFunction(() => Math.abs(document.querySelector('.tab-panel-active').getBoundingClientRect().left - document.querySelector('.tab-viewport').getBoundingClientRect().left) < 2)
  const viewport = await page.locator('.tab-viewport').boundingBox(), active = await page.locator('.tab-panel-active').boundingBox()
  assert(Math.abs(active.x - viewport.x) < 2)
  await menu(page, '分组管理'); await swipe(page, '.module-studio-panel-viewport')
  await page.waitForFunction(() => document.getElementById('group-tab-favorites')?.getAttribute('aria-selected') === 'true')
  await page.waitForTimeout(280)
  await page.locator('.top-title .top-icon-button').click()
  await menu(page, '工具管理'); await page.getByRole('button', { name: '打开工具工作台', exact: true }).click()
  await swipe(page, '.module-studio-panel-viewport')
  await page.waitForFunction(() => document.getElementById('studio-tab-create')?.getAttribute('aria-selected') === 'true')
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ path: path.join(directory, `tablet-${width}.png`) })
})

test('disabling auto-hide leaves both app bars visible while scrolling on a wide tablet', async t => {
  const page = await fixture(t, { width: 1024, height: 640 })
  await menu(page, '更多设置'); await page.getByRole('switch', { name: /自动隐藏导航栏/ }).click()
  await page.locator('.top-title .top-icon-button').click(); await page.waitForTimeout(320)
  await page.locator('.tab-panel-active').evaluate(panel => panel.scrollTop = 300)
  await page.waitForTimeout(350)
  assert.equal(await hidden(page), 0)
  assert.equal(await page.locator('.bottom-nav').isVisible(), true)
  assert.equal(await page.locator('.topbar').evaluate(node => node.getBoundingClientRect().top), 0)
  await page.setViewportSize({ width: 640, height: 1024 })
  assert.equal(await page.locator('html').getAttribute('data-app-layout'), 'mobile')
})

test('Windows retains desktop navigation and follows narrow-window layout changes', async t => {
  const page = await fixture(t, { android: false, width: 1280, height: 800 })
  assert.equal(await page.locator('html').getAttribute('data-app-layout'), 'desktop')
  assert.equal(await page.locator('.bottom-nav').isVisible(), false)
  assert.equal(await page.locator('.desktop-menu-button').isVisible(), true)
  await menu(page, '更多设置')
  assert.equal(await page.getByRole('switch', { name: /自动隐藏导航栏/ }).count(), 0)
  await page.locator('.top-title .top-icon-button').click()
  await page.setViewportSize({ width: 390, height: 800 })
  await page.waitForFunction(() => document.documentElement.dataset.appLayout === 'mobile')
  assert.equal(await page.locator('.bottom-nav').isVisible(), true)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.waitForFunction(() => document.documentElement.dataset.appLayout === 'desktop')
  assert.equal(await page.locator('.bottom-nav').isVisible(), false)
})
