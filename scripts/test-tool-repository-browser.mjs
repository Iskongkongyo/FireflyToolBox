import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createServer } from 'node:http'
import { chromium } from 'playwright-core'
import { repositoryFixture, fixtureCatalog } from './tool-repository-fixture.mjs'
import { mockAndroidShell } from './android-shell-fixture.mjs'

const root = path.resolve('dist'), shots = path.resolve('target-check/tool-download/browser')
await mkdir(shots, { recursive: true })
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname, file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname))
  try { if (!file.startsWith(root + path.sep)) throw new Error(); response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' })[path.extname(file)] || 'application/octet-stream'); response.end(await readFile(file)) } catch { response.writeHead(404).end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ executablePath: existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe') ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
const items = repositoryFixture('browser')
async function app(width, work) {
  const android = width < 1000
  const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: android, userAgent: android ? 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36' : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36' })
  context.setDefaultTimeout(10000)
  try {
    const page = await context.newPage()
    if (android) await page.addInitScript(mockAndroidShell)
    await page.addInitScript(({ items, catalog }) => {
      window.isTauri = true; window.repositoryCalls = []; window.installedModules = []; window.tools = []; window.catalog = catalog
      localStorage.setItem('firefly.startup-splash-enabled.v1', 'false')
      window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, transformCallback: () => 1, unregisterCallback() {}, async invoke(command, args) {
        window.repositoryCalls.push({ command, args })
        if (command === 'repository_catalog') { if (window.failCatalog) throw new Error('连接失败，请切换线路'); return structuredClone(window.catalog) }
        if (command === 'repository_describe') {
          const item = items.find(item => item.entry.id === args.id); return { ...structuredClone(item.entry), title: item.title, description: '来自公开仓库的实用工具 💚', updated_at: '2026-10-28T00:00:00Z', metadata_loaded: true }
        }
        if (command === 'repository_prepare') {
          if (window.failPrepare) throw new Error('下载失败，请重试')
          const item = items.find(item => item.entry.id === args.id)
          if (window.holdPrepare) return new Promise((resolve, reject) => { window.prepareResult = { resolve: () => resolve(structuredClone(item.prepared)), reject } })
          const result = structuredClone(item.prepared); result.installed_version = window.installedModules.find(value => value.module_id === result.summary?.module_id)?.version || null; return result
        }
        if (command === 'repository_cancel') { window.prepareResult?.reject(new Error('已取消下载')); return }
        if (command === 'repository_install') {
          if (window.failInstall) throw new Error('安装失败，请重试')
          const item = items.find(item => item.prepared.token === args.token)
          if (window.holdInstall) await new Promise(resolve => { window.finishInstall = resolve })
          window.installedModules = [structuredClone(item.summary)]
          const tool = item.detail.manifest.tools[0]
          window.tools = [{ id: tool.id, module_id: item.detail.manifest.module_id, name: item.title, description: 'Fixture tool', category: '效率工具', tags: [], aliases: [], builtin: false, custom: false, runtime: 'browser', ui_kind: 'web', actions: [{ id: 'open', label: '打开' }] }]
          return structuredClone(item.summary)
        }
        if (command === 'repository_save') { if (window.failSave) throw new Error('保存失败，请重试'); return }
        if (command === 'plugin:dialog|save') return window.cancelSave ? null : window.savePath || 'fixture.fftool'
        if (command === 'list_modules') return structuredClone(window.installedModules)
        if (command === 'list_tools') return structuredClone(window.tools)
        if (command === 'get_module_details') return structuredClone(items.find(item => item.detail.manifest.module_id === args.moduleId).detail)
        if (command === 'load_tool_storage') return '{}'
        if (command === 'web_file_transport') return 'http://127.0.0.1:12345/0123456789abcdef0123456789abcdef'
        if (command === 'fetch_remote_messages') return { configured: true, update: null, notification: null }
        if (command === 'desktop_close_behavior') return 'tray'; if (command === 'desktop_autostart_enabled') return false
        return ['list_favorites', 'list_recent_tools', 'list_websites', 'list_custom_tools'].includes(command) ? [] : null
      } }
    }, { items: items.map(({ bytes, ...item }) => item), catalog: fixtureCatalog(items) })
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    const nav = async name => page.locator('.nav-button').filter({ hasText: name }).evaluate(button => button.click())
    await nav('工具市场'); await page.getByRole('region', { name: '工具市场', exact: true }).waitFor()
    await page.getByRole('heading', { name: items[0].title, exact: true }).waitFor()
    await work({ page, nav, card: index => page.locator('.repository-card').filter({ has: page.getByRole('heading', { name: items[index].title, exact: true }) }) })
  } finally { await context.close() }
}
try {
  await test('the system-approved save path is preserved for explicit extensions and Android document URIs', async () => {
    for (const [width, savePath] of [[1280, 'chosen.txt'], [1280, 'chosen.FFTOOL'], [390, 'content://documents/tree/output/document/selected']]) {
      await app(width, async ({ page, card }) => {
        await page.evaluate(value => { window.savePath = value }, savePath)
        await card(0).getByRole('button', { name: '下载文件', exact: true }).click()
        await page.locator('.toast').filter({ hasText: '已保存' }).waitFor()
        assert.equal(await page.evaluate(() => window.repositoryCalls.find(call => call.command === 'repository_save').args.path), savePath)
      })
    }
  })
  for (const width of [320, 1280]) await test(`invalid packages remain visible as warnings while valid tools stay downloadable at ${width}px`, async () => app(width, async ({ page, card }) => {
    await page.evaluate(() => {
      window.catalog.skipped_entries = [{ path: '异常目录/' + 'long-filename-'.repeat(18) + '.fftool', reason: '文件为空。' }]
      document.documentElement.style.setProperty('--app-font-scale', '1.25')
    })
    await page.getByRole('button', { name: '刷新列表', exact: true }).click()
    const warning = page.locator('.repository-skipped')
    await warning.getByText('已跳过 1 个异常工具包').click()
    await warning.getByText('文件为空。').waitFor()
    assert.equal(await page.locator('.repository-card').count(), 4)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.screenshot({ path: path.join(shots, `skipped-${width}.png`), fullPage: true })
    await card(0).getByRole('button', { name: '下载并安装', exact: true }).click()
    await page.locator('.repository-dialog[open]').waitFor()
  }))
  for (const width of [320, 390, 640, 1280]) {
    await test(`catalog search, folder filters and readable cards at ${width}px`, async () => app(width, async ({ page }) => {
      const names = await page.locator('.side-nav .nav-button').allTextContents()
      assert.equal(names.findIndex(name => name.trim() === '工具市场'), names.findIndex(name => name.trim() === '分组管理') + 1)
      const search = page.getByRole('searchbox', { name: '搜索工具' })
      await search.focus()
      assert.notEqual(await page.locator('.repository-search').evaluate(node => getComputedStyle(node).boxShadow), 'none')
      assert.equal(await search.evaluate(node => getComputedStyle(node).boxShadow), 'none')
      assert.equal(await page.locator('.repository-heading p').textContent(), '从官方公开仓库获取的最新工具，下载后请仔细核对内容再安装使用。')
      assert.equal(await page.locator('.repository-source-button').textContent(), '从外部浏览器访问↗')
      assert.equal(await page.locator('.repository-footnote').count(), 0)
      await page.locator('.repository-route-help summary').click()
      await page.locator('.repository-route-help p').waitFor({ state: 'visible' })
      await page.getByRole('searchbox', { name: '搜索工具' }).fill('联网 生活'); assert.equal(await page.locator('.repository-card').count(), 1)
      await page.getByRole('searchbox', { name: '搜索工具' }).fill(''); await page.getByRole('navigation', { name: '工具分类' }).getByRole('button', { name: /效率工具/ }).click(); assert.equal(await page.locator('.repository-card').count(), 2)
      await page.evaluate(() => document.documentElement.style.setProperty('--app-font-scale', '1.25'))
      if (width === 390) await page.evaluate(() => document.documentElement.dataset.theme = 'dark')
      await page.waitForTimeout(250)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      await page.screenshot({ path: path.join(shots, `catalog-${width}.png`), fullPage: true })
    }))
    await test(`installation previews actual package details and stays on the catalog at ${width}px`, async () => app(width, async ({ page, card }) => {
      await card(1).getByRole('button', { name: '下载并安装', exact: true }).click()
      const dialog = page.locator('.repository-dialog[open]'); await dialog.waitFor()
      assert.equal(await dialog.locator('.repository-review-caption').count(), 0)
      assert.equal(await dialog.locator('.repository-script-warning').count(), 1)
      assert.equal(await page.evaluate(() => window.repositoryCalls.filter(call => call.command === 'repository_install').length), 0)
      assert.equal(await dialog.locator('.repository-network').evaluate(node => node.open), false)
      assert.equal(await dialog.getByRole('button', { name: '安装工具', exact: true }).isDisabled(), true)
      await dialog.getByRole('checkbox').check(); await page.screenshot({ path: path.join(shots, `preview-${width}.png`) })
      await dialog.getByRole('button', { name: '安装工具', exact: true }).click()
      await dialog.waitFor({ state: 'hidden' }); await page.locator('.toast').filter({ hasText: '已安装' }).waitFor()
      assert.equal(await page.getByRole('region', { name: '工具市场', exact: true }).count(), 1)
      const install = await page.evaluate(() => window.repositoryCalls.find(call => call.command === 'repository_install'))
      assert.equal(install.args.allowNetwork, true)
      await card(1).getByRole('button', { name: '打开工具', exact: true }).click()
      await page.frameLocator('.web-tool-frame').locator('#advance').waitFor()
    }))
  }
  await test('native Back closes preview before leaving the standalone page; cancelled save does not write', async () => app(390, async ({ page, card }) => {
    await card(0).getByRole('button', { name: '下载并安装' }).click(); await page.locator('.repository-dialog[open]').waitFor()
    await page.evaluate(() => window.dispatchEvent(new Event('firefly:native-back')))
    await page.locator('.repository-dialog[open]').waitFor({ state: 'hidden' }); assert.equal(await page.locator('.tool-download-page').count(), 1)
    await page.evaluate(() => window.cancelSave = true); await card(0).getByRole('button', { name: '下载文件' }).click()
    await page.locator('.toast').filter({ hasText: '已取消保存' }).waitFor()
    assert.equal(await page.evaluate(() => window.repositoryCalls.filter(call => call.command === 'repository_save').length), 0)
  }))
  await test('download cancellation stays on the page and late replies cannot reopen a dialog', async () => app(1280, async ({ page, card, nav }) => {
    await page.evaluate(() => window.holdPrepare = true)
    await card(0).getByRole('button', { name: '下载并安装' }).click(); await page.getByRole('button', { name: '取消下载' }).click()
    await page.locator('.toast').filter({ hasText: '已取消下载' }).waitFor()
    assert.equal(await page.locator('.repository-dialog[open]').count(), 0)
    await card(0).getByRole('button', { name: '下载并安装' }).click(); await nav('首页')
    await page.evaluate(() => window.prepareResult.resolve()); await page.waitForTimeout(100)
    assert.equal(await page.locator('.repository-dialog[open]').count(), 0)
  }))
  await test('unsupported packages remain saveable; failed refresh preserves cards; installation blocks navigation', async () => app(1280, async ({ page, card, nav }) => {
    await card(2).getByRole('button', { name: '下载并安装' }).click(); const dialog = page.locator('.repository-dialog[open]'); await dialog.waitFor()
    assert.equal(await dialog.getByRole('button', { name: '安装工具', exact: true }).isDisabled(), true)
    await dialog.getByRole('button', { name: '保存文件', exact: true }).click(); await page.locator('.toast:popover-open').filter({ hasText: '文件已保存' }).waitFor(); await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await page.evaluate(() => window.failCatalog = true); await page.getByRole('button', { name: '刷新列表' }).click(); await page.locator('.toast').filter({ hasText: '连接失败' }).waitFor(); assert.equal(await page.locator('.repository-card').count(), 4)
    await page.evaluate(() => { window.failCatalog = false; window.holdInstall = true }); await card(0).getByRole('button', { name: '下载并安装' }).click(); await dialog.waitFor(); await dialog.getByRole('button', { name: '安装工具', exact: true }).click()
    await page.waitForFunction(() => !!window.finishInstall); await nav('首页'); assert.equal(await page.locator('.tool-download-page').count(), 1)
    await page.evaluate(() => window.finishInstall()); await dialog.waitFor({ state: 'hidden' })
  }))
  for (const width of [390, 1280]) await test(`operation feedback pops above the install dialog and repeated failures show again at ${width}px`, async () => app(width, async ({ page, card }) => {
    await page.evaluate(() => window.failPrepare = true)
    await card(0).getByRole('button', { name: '下载文件' }).click()
    await page.locator('.toast:popover-open').filter({ hasText: '下载失败' }).waitFor()
    await page.evaluate(() => window.failPrepare = false)
    await card(0).getByRole('button', { name: '下载并安装' }).click()
    const dialog = page.locator('.repository-dialog[open]'); await dialog.waitFor()
    await page.evaluate(() => window.failInstall = true)
    await dialog.getByRole('button', { name: '安装工具', exact: true }).click()
    const toast = page.locator('.toast:popover-open'); await toast.filter({ hasText: '安装失败' }).waitFor()
    await page.evaluate(() => window.failSave = true)
    await dialog.getByRole('button', { name: '保存文件', exact: true }).click()
    await toast.filter({ hasText: '保存失败' }).waitFor()
    assert.equal(await dialog.locator('.error-text').count(), 0)
    assert.equal(await dialog.isVisible(), true)
    await page.screenshot({ path: path.join(shots, `feedback-${width}.png`) })
    await toast.waitFor({ state: 'hidden', timeout: 5000 })
    await dialog.getByRole('button', { name: '保存文件', exact: true }).click()
    await toast.filter({ hasText: '保存失败' }).waitFor()
    await page.evaluate(() => window.failSave = false)
    await dialog.getByRole('button', { name: '保存文件', exact: true }).click()
    await toast.filter({ hasText: '已保存' }).waitFor()
    assert.equal(await page.locator('.tool-download-page > .error-text, .repository-notice, .repository-error').count(), 0)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  }))
} finally { await browser.close(); server.close() }
