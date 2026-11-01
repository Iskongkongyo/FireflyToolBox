// Production UI with isolated browser state; system shortcut requests are mocked.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { mockAndroidShell } from './android-shell-fixture.mjs'

const dist = path.resolve('dist')
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname
  const file = pathname === '/' ? path.join(dist, 'index.html') : path.resolve(dist, '.' + pathname)
  if (!file.startsWith(dist + path.sep)) { response.writeHead(404); response.end(); return }
  try {
    response.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' })[path.extname(file)] ?? 'application/octet-stream')
    response.end(await readFile(file))
  } catch { response.writeHead(404); response.end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const browser = await chromium.launch({ executablePath: process.env.FIREFLY_TEST_BROWSER || (existsSync(chrome) ? chrome : 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'), headless: true })

async function pageFor({ android = false, launch = '', width = 1280 } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, ...(android ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36' } : {}) })
  context.setDefaultTimeout(8000)
  const page = await context.newPage()
  if (android) await page.addInitScript(mockAndroidShell)
  await page.addInitScript(({ android, launch }) => {
    window.isTauri = true; window.calls = []; window.launchHint = launch
    window.FireflyShortcutLaunch = { hasPendingLaunch: () => !!window.launchHint }
    localStorage.setItem('firefly.app-font-size.v1', '125')
    if (!launch) localStorage.setItem('firefly.startup-splash-enabled.v1', 'false')
    window.iconSource = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="10" y="10" width="44" height="44" fill="#f00" /></svg>')
    const tools = [['json.format', 'JSON 格式化'], ['data.convert', 'CSV / JSON 互转'], ['url.convert', 'URL 编解码']].map(([id, name]) => ({ id, name, description: name, category: '开发与文本', aliases: [], tags: [], builtin: true, custom: false, ui_kind: 'text', actions: [{ id: 'format', label: '处理', input_types: ['text'] }] }))
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: () => 1, unregisterCallback() {},
      async invoke(command, args) {
        window.calls.push({ command, args })
        if (command === 'list_tools') return tools
        if (['list_favorites', 'list_recent_tools', 'list_custom_tools', 'list_websites', 'list_modules'].includes(command)) return []
        if (command === 'desktop_close_behavior') return 'tray'
        if (command === 'desktop_autostart_enabled') return false
        if (command === 'take_shortcut_launch') {
          const hint = window.launchHint; window.launchHint = ''
          if (window.holdNextTake) { window.holdNextTake = false; return new Promise(resolve => { window.takeDone = () => resolve(hint) }) }
          return hint
        }
        if (command === 'create_tool_shortcut') {
          window.created = args
          if (window.createError) throw new Error(window.createError)
          if (window.holdCreate) return new Promise(resolve => { window.createDone = resolve })
          return android ? 'requested' : 'created'
        }
        if (command === 'plugin:dialog|open') return 'content://fixture/icon.svg'
        if (command === 'read_shortcut_icon_file') { if (window.iconError) throw new Error(window.iconError); return window.iconSource.buffer }
        if (command === 'clear_runtime_cache') return new Promise(resolve => { window.cacheDone = resolve })
        return null
      },
    }
  }, { android, launch })
  await page.goto(origin)
  await page.waitForFunction(() => { const app = document.querySelector('.app-shell'); return app && getComputedStyle(app).display !== 'none' })
  return { context, page }
}

async function shortcuts(page) {
  await page.locator('.nav-button').filter({ hasText: '快捷方式' }).evaluate(button => button.click())
  await page.getByRole('region', { name: '快捷方式', exact: true }).waitFor()
}
async function choose(page, label) {
  await page.getByRole('button', { name: '对应工具', exact: true }).click()
  await page.getByRole('option', { name: label, exact: true }).click()
}
async function launched(page, name) { await page.locator('.editor-open .tool-title').filter({ hasText: name }).waitFor() }

try {
  await test('a stuck Android shortcut request releases the form, ignores late replies and recovers on retry', async () => {
    const { context, page } = await pageFor({ android: true })
    try {
      await shortcuts(page); await choose(page, 'JSON 格式化'); await page.clock.install()
      await page.evaluate(() => { window.holdCreate = true })
      await page.getByRole('button', { name: '创建快捷方式', exact: true }).click()
      await page.waitForFunction(() => !!window.createDone)
      await page.evaluate(() => document.querySelector('.shortcut-form').requestSubmit())
      assert.equal(await page.evaluate(() => window.calls.filter(c => c.command === 'create_tool_shortcut').length), 1)
      await page.clock.fastForward(15001)
      await page.locator('.shortcut-page [role=alert]').filter({ hasText: '响应超时' }).waitFor()
      assert.equal(await page.locator('#shortcut-name').isEnabled(), true)
      assert.equal(await page.getByRole('button', { name: '创建快捷方式', exact: true }).isEnabled(), true)
      await page.evaluate(() => { window.lateCreateDone = window.createDone; window.holdCreate = false; window.createError = '桌面上已有此工具的同名快捷方式，请换个名字。' })
      await page.getByRole('button', { name: '创建快捷方式', exact: true }).click()
      await page.locator('.shortcut-page [role=alert]').filter({ hasText: '同名快捷方式' }).waitFor()
      await page.evaluate(() => window.lateCreateDone('requested'))
      assert.equal(await page.locator('.shortcut-page .module-studio-notice').count(), 0)
      await page.evaluate(() => { window.createError = '' })
      await page.locator('#shortcut-name').fill('重试入口')
      await page.getByRole('button', { name: '创建快捷方式', exact: true }).click()
      await page.locator('.shortcut-page .module-studio-notice').filter({ hasText: '已向桌面发起请求' }).waitFor()
    } finally { await context.close() }
  })
  await test('Windows suggestions are valid, custom names survive tool changes and creation freezes its form', async () => {
    const { context, page } = await pageFor()
    try {
      await shortcuts(page); await choose(page, 'CSV / JSON 互转')
      assert.equal(await page.locator('#shortcut-name').inputValue(), 'CSV - JSON 互转')
      await page.locator('#shortcut-name').fill('我的快捷入口'); await choose(page, 'JSON 格式化')
      assert.equal(await page.locator('#shortcut-name').inputValue(), '我的快捷入口')
      await page.evaluate(() => { window.holdCreate = true })
      await page.getByRole('button', { name: '创建快捷方式', exact: true }).click()
      await page.waitForFunction(() => !!window.createDone)
      assert.equal(await page.locator('#shortcut-name').isDisabled(), true)
      assert.equal(await page.getByRole('button', { name: '对应工具', exact: true }).isDisabled(), true)
      assert.deepEqual(await page.evaluate(() => window.created), { toolId: 'json.format', name: '我的快捷入口', iconData: null })
      await page.evaluate(() => window.createDone('created'))
      await page.getByText('快捷方式已创建在桌面。', { exact: true }).waitFor()
      await page.locator('#shortcut-name').fill('CON')
      assert.equal(await page.locator('.shortcut-page .module-studio-notice').count(), 0)
      const before = await page.evaluate(() => window.calls.filter(c => c.command === 'create_tool_shortcut').length)
      await page.getByRole('button', { name: '创建快捷方式', exact: true }).click()
      await page.getByText(/Windows 保留名称/).waitFor()
      assert.equal(await page.evaluate(() => window.calls.filter(c => c.command === 'create_tool_shortcut').length), before)
    } finally { await context.close() }
  })

  await test('Android labels keep normal punctuation and explain checking the desktop and app permissions', async () => {
    const { context, page } = await pageFor({ android: true })
    try {
      await shortcuts(page); await choose(page, 'CSV / JSON 互转')
      assert.equal(await page.locator('#shortcut-name').inputValue(), 'CSV / JSON 互转')
      await page.getByRole('button', { name: '创建快捷方式', exact: true }).click()
      await page.getByText('已向桌面发起请求，请返回桌面查看目标应用是否已创建。若目标应用不存在，请打开应用授权页面并查看下是否给本应用授予相关权限！', { exact: true }).waitFor()
      assert.equal(await page.locator('.shortcut-permission-card').textContent().then(text => text.includes('部分手机')), false)
      assert.equal(await page.getByText('快捷方式已创建在桌面。', { exact: true }).count(), 0)
    } finally { await context.close() }
  })

  await test('icons use bounded native content-URI reads, retain higher resolution and survive a failed replacement', async () => {
    const { context, page } = await pageFor({ android: true })
    try {
      await shortcuts(page); await choose(page, 'JSON 格式化')
      await page.getByRole('button', { name: '选择图片', exact: true }).click()
      await page.locator('.shortcut-image-row img[src^="data:image/png"]').waitFor()
      const previous = await page.locator('.shortcut-image-row img').getAttribute('src')
      const png = Buffer.from(previous.split(',')[1], 'base64')
      assert.equal(png.readUInt32BE(16), 256); assert(png.length <= 24 * 1024)
      assert.equal(await page.evaluate(() => window.calls.some(c => c.command === 'plugin:fs|read_file')), false)
      await page.evaluate(() => { window.iconError = '图片文件不能超过 1 MiB。' })
      await page.getByRole('button', { name: '选择图片', exact: true }).click()
      await page.getByText('图片文件不能超过 1 MiB。', { exact: true }).waitFor()
      assert.equal(await page.locator('.shortcut-image-row img').getAttribute('src'), previous)
      await page.getByRole('button', { name: '恢复应用图标', exact: true }).click()
      assert.equal(await page.locator('.shortcut-image-row img[src^="data:image/png"]').count(), 0)
    } finally { await context.close() }
  })

  await test('a shortcut clicked during cache cleanup waits and opens after cleanup instead of being lost', async () => {
    const { context, page } = await pageFor()
    try {
      await page.locator('.nav-button').filter({ hasText: '更多设置' }).evaluate(button => button.click())
      await page.getByRole('button', { name: /^清理缓存/ }).click()
      await page.waitForFunction(() => !!window.cacheDone)
      const before = await page.evaluate(() => window.calls.filter(c => c.command === 'take_shortcut_launch').length)
      await page.evaluate(() => { window.launchHint = 'json.format'; window.dispatchEvent(new Event('firefly:shortcut-open')) })
      assert.equal(await page.evaluate(() => window.calls.filter(c => c.command === 'take_shortcut_launch').length), before)
      await page.evaluate(() => window.cacheDone({ disk_cache_cleared: true, temporary_files: 0, temporary_bytes: 0, skipped_files: 0, memory_bytes: 0, warnings: [] }))
      await launched(page, 'JSON 格式化')
    } finally { await context.close() }
  })

  await test('consecutive clicks drain the second native hint and end at the latest tool', async () => {
    const { context, page } = await pageFor()
    try {
      await page.evaluate(() => { window.holdNextTake = true; window.launchHint = 'json.format'; window.dispatchEvent(new Event('firefly:shortcut-open')) })
      await page.waitForFunction(() => !!window.takeDone)
      await page.evaluate(() => { window.launchHint = 'url.convert'; window.dispatchEvent(new Event('firefly:shortcut-open')); window.takeDone() })
      await launched(page, 'URL 编解码')
    } finally { await context.close() }
  })

  await test('warm launches close configuration modals and report unavailable tools without losing the current page', async () => {
    const { context, page } = await pageFor()
    try {
      await page.locator('.nav-button').filter({ hasText: '更多设置' }).evaluate(button => button.click())
      await page.getByRole('button', { name: /^配置管理/ }).click()
      await page.locator('.backup-dialog[open]').waitFor()
      await page.evaluate(() => { window.launchHint = 'json.format'; window.dispatchEvent(new Event('firefly:shortcut-open')) })
      await launched(page, 'JSON 格式化'); assert.equal(await page.locator('.backup-dialog[open]').count(), 0)
      await page.evaluate(() => { window.launchHint = 'missing.tool'; window.dispatchEvent(new Event('firefly:shortcut-open')) })
      await page.getByText('快捷方式对应的工具已删除或暂不可用。', { exact: true }).waitFor()
      await launched(page, 'JSON 格式化')
    } finally { await context.close() }
  })

  await test('Android cold shortcut launches skip the splash and open the selected tool', async () => {
    const { context, page } = await pageFor({ android: true, launch: 'json.format' })
    try { await launched(page, 'JSON 格式化'); assert.equal(await page.locator('.startup-splash').count(), 0) }
    finally { await context.close() }
  })

  await test('shortcut controls fit narrow screens with larger text and a long custom label', async () => {
    const { context, page } = await pageFor({ android: true, width: 390 })
    try {
      await shortcuts(page); await choose(page, 'CSV / JSON 互转'); await page.locator('#shortcut-name').fill('猫'.repeat(40))
      for (const width of [320, 360, 390, 430, 1280]) {
        await page.setViewportSize({ width, height: 900 })
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width}px`)
      }
    } finally { await context.close() }
  })
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
