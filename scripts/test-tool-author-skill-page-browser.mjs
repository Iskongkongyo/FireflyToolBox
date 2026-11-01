import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { readFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { chromium } from 'playwright-core'

const guide = await readFile('skills/firefly-module-author/SKILL.md', 'utf8')
const directory = path.resolve('target-check/skill-page')
let server, browser, origin
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
async function fixture(t, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36' })
  t.after(() => context.close())
  const page = await context.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.message)); t.after(() => assert.deepEqual(errors, []))
  await page.addInitScript(() => {
    window.isTauri = true; window.copiedSkill = ''; window.copyShouldFail = false
    Object.defineProperty(navigator, 'clipboard', { value: { async writeText(text) { if (window.copyShouldFail) throw new Error('denied'); window.copiedSkill = text } } })
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} }
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, transformCallback: () => 1, unregisterCallback() {},
      async invoke(command, args) {
        if (['list_tools', 'list_favorites', 'list_recent_tools', 'list_custom_tools', 'list_websites', 'list_modules'].includes(command)) return []
        if (command === 'plugin:clipboard-manager|write_text') { if (window.copyShouldFail) throw new Error('denied'); window.copiedSkill = args.text; return }
        if (command === 'desktop_close_behavior') return 'tray'
        if (command === 'desktop_autostart_enabled') return false
        return null
      },
    }
  })
  await page.goto(origin)
  await page.locator('.nav-button').filter({ hasText: '工具管理' }).evaluate(button => button.click())
  await page.getByRole('button', { name: '打开工具工作台', exact: true }).click()
  await page.locator('#studio-tab-create').click()
  await page.locator('#studio-panel-create input').first().fill('保留创建草稿')
  await page.waitForFunction(() => !document.querySelector('.module-studio-panel-stage.panel-stage-settling'))
  return { page, panel: page.locator('#studio-panel-create') }
}

for (const width of [320, 390, 1280]) test(`guide opens as a page, returns to its draft, and copies complete source at ${width}px`, async t => {
  const f = await fixture(t, width)
  if (width === 320) await f.page.evaluate(() => document.documentElement.style.setProperty('--app-font-scale', '1.25'))
  const row = f.panel.locator('.module-create-title-row'), title = f.panel.locator('#studio-create-title'), view = f.page.getByRole('button', { name: '查看SKILL', exact: true }), fresh = row.getByRole('button', { name: '新建工具', exact: true })
  const [heading, viewBox, freshBox, rowBox] = await Promise.all([title.boundingBox(), view.boundingBox(), fresh.boundingBox(), row.boundingBox()])
  const center = box => box.y + box.height / 2
  assert(Math.abs(center(heading) - center(viewBox)) < 3)
  assert(Math.abs(center(heading) - center(freshBox)) < 3)
  assert(viewBox.x >= heading.x + heading.width)
  assert(Math.abs(freshBox.x + freshBox.width - (rowBox.x + rowBox.width)) < 2, JSON.stringify({ heading, viewBox, freshBox, rowBox }))
  assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await f.page.screenshot({ path: path.join(directory, `creator-${width}.png`) })
  await view.click()
  await f.page.getByRole('document', { name: '工具编写指南正文', exact: true }).waitFor()
  assert.equal(await f.panel.count(), 0)
  assert.equal(await f.page.locator('dialog[open]').count(), 0)
  assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  const copy = f.page.locator('.topbar').getByRole('button', { name: '复制全文', exact: true })
  await copy.click()
  await f.page.locator('.toast').filter({ hasText: '已复制 SKILL 全文' }).waitFor()
  assert.equal(await f.page.evaluate(() => window.copiedSkill), guide)
  await f.page.evaluate(() => window.copyShouldFail = true)
  await copy.click()
  await f.page.locator('.toast').filter({ hasText: '复制失败' }).waitFor()
  assert.equal(await f.page.locator('.tool-author-skill-page .module-studio-notice').count(), 0)
  await f.page.evaluate(() => window.scrollTo(0, 1600))
  assert((await f.page.evaluate(() => window.scrollY)) > 100)
  assert.equal(await f.page.locator('.tool-author-skill-content').evaluate(node => node.scrollTop), 0)
  assert((await f.page.locator('.tool-author-skill-intro').boundingBox()).y < 0)
  const topbar = await f.page.locator('.topbar').boundingBox(), copyBox = await copy.boundingBox()
  assert(copyBox.y >= topbar.y && copyBox.y + copyBox.height <= topbar.y + topbar.height)
  assert(copyBox.x + copyBox.width > topbar.x + topbar.width - 65)
  await f.page.screenshot({ path: path.join(directory, `guide-${width}.png`) })
  await f.page.evaluate(() => window.dispatchEvent(new Event('firefly:native-back')))
  await f.panel.waitFor()
  assert.equal(await f.panel.locator('input').first().inputValue(), '保留创建草稿')
  assert.equal(await f.page.locator('#studio-tab-create').getAttribute('aria-selected'), 'true')
  await view.click(); await f.page.getByRole('document', { name: '工具编写指南正文', exact: true }).waitFor()
  await f.page.locator('.top-title .top-icon-button').click()
  await f.panel.waitFor()
  assert.equal(await f.panel.locator('input').first().inputValue(), '保留创建草稿')
})

test('leaving during guide loading cannot reopen it when Markdown finishes loading', async t => {
  const f = await fixture(t, 390)
  let release
  const gate = new Promise(resolve => { release = resolve })
  t.after(() => release())
  await f.page.route('**/markdown-it-*.js', async route => { await gate; await route.continue() })
  await f.page.getByRole('button', { name: '查看SKILL', exact: true }).click()
  await f.page.getByRole('status').filter({ hasText: '正在加载工具编写指南' }).waitFor()
  await f.page.evaluate(() => window.dispatchEvent(new Event('firefly:native-back')))
  await f.panel.waitFor(); release()
  await f.page.waitForLoadState('networkidle')
  assert.equal(await f.page.locator('.tool-author-skill-page').count(), 0)
  assert.equal(await f.panel.locator('input').first().inputValue(), '保留创建草稿')
})
