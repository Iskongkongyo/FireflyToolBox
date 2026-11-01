import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { mockAndroidShell } from './android-shell-fixture.mjs'

const dist = path.resolve('dist'), shots = path.resolve('target-check/display-preferences/browser')
await mkdir(shots, { recursive: true })
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname, file = path.resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname))
  try { if (!file.startsWith(dist + path.sep)) throw new Error(); response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' })[path.extname(file)] || 'application/octet-stream'); response.end(await readFile(file)) }
  catch { response.writeHead(404).end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ executablePath: existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe') ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
async function app(width, work, { empty = false, grouped = true } = {}) {
  const mobile = width < 1000, context = await browser.newContext({ viewport: { width, height: 900 }, ...(mobile ? { userAgent: 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36' } : {}) })
  context.setDefaultTimeout(8000)
  try {
    const page = await context.newPage()
    if (mobile) await page.addInitScript(mockAndroidShell)
    await page.addInitScript(({ empty, grouped }) => {
      if (!sessionStorage.getItem('groups-seeded')) {
        localStorage.setItem('firefly.groups.favorites.v1', JSON.stringify({ enabled: grouped, groups: grouped ? [{ id: 'favorite:mine', name: '收藏分组' }, { id: 'favorite:empty', name: '保留的空收藏' }] : [], assignments: {} }))
        localStorage.setItem('firefly.groups.websites.v1', JSON.stringify({ enabled: grouped, groups: grouped ? [{ id: 'website:mine', name: '网站分组' }, { id: 'website:empty', name: '保留的空网站' }] : [], assignments: {} }))
        sessionStorage.setItem('groups-seeded', 'yes')
      }
      window.isTauri = true
      localStorage.setItem('firefly.startup-splash-enabled.v1', 'false')
      const tool = { id: 'json.format', name: 'JSON 格式化', category: '开发与文本', description: '', tags: [], aliases: [], builtin: true, custom: false, ui_kind: 'text', actions: [{ id: 'format', label: '格式化' }] }
      window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, transformCallback: () => 1, unregisterCallback() {}, invoke: async command => {
        if (command === 'list_tools') return [tool]
        if (command === 'list_favorites') return empty ? [] : [tool.id]
        if (command === 'list_websites') return empty ? [] : [{ id: 1, name: '示例网站', url: 'https://example.com', description: '', tags: '', favorite: false }]
        if (command === 'fetch_remote_messages') return { configured: false, update: null, notification: null }
        if (command === 'desktop_close_behavior') return 'tray'
        if (command === 'desktop_autostart_enabled') return false
        return ['list_recent_tools', 'list_custom_tools', 'list_modules'].includes(command) ? [] : null
      } }
    }, { empty, grouped })
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    const nav = name => page.locator('.nav-button').filter({ hasText: name }).evaluate(button => button.click())
    await work({ page, nav })
  } finally { await context.close() }
}
async function manager(page, nav, tab, id) {
  await nav('分组管理'); await page.locator('#group-tab-' + tab).click()
  const toggle = page.locator(`.group-manager-card[data-group-id="${id}"] .group-manager-card-toggle`)
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
}
try {
  for (const width of [1280, 390]) {
    await test(`home, favorites and websites show live count badges before the right chevron and follow transparency at ${width}px`, async () => app(width, async ({ page, nav }) => {
      for (const [name, selector, expected] of [['首页', '.home-categories [data-group-id="source:开发与文本"]', '1 个工具'], ['收藏', '.favorite-categories [data-group-id="favorite:ungrouped"]', '1 个工具'], ['网站', '.website-group[data-group-id="website:ungrouped"]', '1 个网站']]) {
        await nav(name)
        const header = page.locator(selector + ' > .category-header'), badge = header.locator('.category-count')
        assert.equal(await badge.textContent(), expected)
        assert.equal(await header.locator('small').count(), 0)
        const titleBox = await header.locator('strong').boundingBox(), badgeBox = await badge.boundingBox(), labelBox = await header.locator('.category-label').boundingBox(), arrowBox = await header.locator('.chevron').boundingBox()
        assert(badgeBox.x >= titleBox.x + titleBox.width && Math.abs(badgeBox.x + badgeBox.width - labelBox.x - labelBox.width) < 1 && arrowBox.x > badgeBox.x + badgeBox.width)
        const colors = []
        for (const value of [0, 80]) {
          await nav('更多设置')
          assert.equal(await page.getByText('应用外观', { exact: true }).count(), 0)
          await page.locator('#component-transparency').evaluate((node, value) => { node.value = value; node.dispatchEvent(new Event('input', { bubbles: true })) }, String(value))
          await nav(name); colors.push(await badge.evaluate(node => getComputedStyle(node).backgroundColor))
        }
        assert.notEqual(colors[0], colors[1]); assert.match(colors[0], /0\.92\)/); assert.match(colors[1], /0\.12\)/)
        if (name !== '首页') {
          const empty = page.locator(name === '收藏' ? '[data-group-id="favorite:empty"] .category-count' : '[data-group-id="website:empty"] .category-count')
          assert.equal(await empty.textContent(), name === '收藏' ? '0 个工具' : '0 个网站')
        }
        await page.screenshot({ path: path.join(shots, `count-${name}-${width}.png`) })
      }
    }))
    await test(`favorite Ungrouped hides after its last item moves, returns on removal, and survives reload at ${width}px`, async () => app(width, async ({ page, nav }) => {
      const ungrouped = page.locator('.favorite-categories > [data-group-id="favorite:ungrouped"]')
      await nav('收藏'); assert.equal(await ungrouped.count(), 1)
      await manager(page, nav, 'favorites', 'favorite:mine')
      await page.getByRole('button', { name: '选择工具加入收藏分组', exact: true }).click()
      await page.getByRole('option', { name: /^JSON 格式化/ }).click()
      assert.equal(await page.locator('.group-manager-card[data-group-id="favorite:ungrouped"]').count(), 1)
      await nav('收藏'); assert.equal(await ungrouped.count(), 0)
      assert.equal(await page.locator('.favorite-categories > [data-group-id="favorite:mine"]').count(), 1)
      assert.equal(await page.locator('.favorite-categories > [data-group-id="favorite:empty"]').count(), 1)
      await page.reload(); await nav('收藏'); assert.equal(await ungrouped.count(), 0)
      await page.screenshot({ path: path.join(shots, `favorites-${width}.png`) })
      await manager(page, nav, 'favorites', 'favorite:mine')
      await page.getByRole('button', { name: '将JSON 格式化移到未分组', exact: true }).click()
      await nav('收藏'); assert.equal(await ungrouped.count(), 1)
    }))
    await test(`website Ungrouped hides after moving its final bookmark and management keeps its target at ${width}px`, async () => app(width, async ({ page, nav }) => {
      const ungrouped = page.locator('.website-group[data-group-id="website:ungrouped"]')
      await nav('网站'); assert.equal(await ungrouped.count(), 1)
      await manager(page, nav, 'websites', 'website:mine')
      await page.getByRole('button', { name: '选择网站加入网站分组', exact: true }).click()
      await page.getByRole('option', { name: /^示例网站/ }).click()
      assert.equal(await page.locator('.group-manager-card[data-group-id="website:ungrouped"]').count(), 1)
      await nav('网站'); assert.equal(await ungrouped.count(), 0)
      assert.equal(await page.locator('.website-group[data-group-id="website:mine"]').count(), 1)
      assert.equal(await page.locator('.website-group[data-group-id="website:empty"]').count(), 1)
      await page.reload(); await nav('网站'); assert.equal(await ungrouped.count(), 0)
      await page.screenshot({ path: path.join(shots, `websites-${width}.png`) })
      await manager(page, nav, 'websites', 'website:mine')
      await page.getByRole('button', { name: '将示例网站移到未分组', exact: true }).click()
      await nav('网站'); assert.equal(await ungrouped.count(), 1)
    }))
    await test(`empty custom groups stay visible and ordinary empty states are retained at ${width}px`, async () => {
      await app(width, async ({ page, nav }) => {
        await nav('收藏'); assert.equal(await page.locator('.favorite-categories > .category').count(), 2)
        await nav('网站'); assert.equal(await page.locator('.website-group').count(), 2)
      }, { empty: true })
      await app(width, async ({ page, nav }) => {
        await nav('收藏'); await page.getByText('还没有收藏的工具', { exact: true }).waitFor()
        await nav('网站'); await page.getByText('还没有保存的网站', { exact: true }).waitFor()
      }, { empty: true, grouped: false })
    })
  }
} finally { await browser.close(); server.close() }
