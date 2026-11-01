import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { readFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createServer } from 'node:http'
import { chromium } from 'playwright-core'

let server, browser, origin
const directory = path.resolve('target-check/module-import')
before(async () => {
  await mkdir(directory, { recursive: true })
  const root = path.resolve('dist')
  server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname))
    if (!file.startsWith(root + path.sep)) { response.writeHead(404); response.end(); return }
    try { response.setHeader('Content-Type', { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream'); response.end(await readFile(file)) }
    catch { response.writeHead(404); response.end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`
  const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  browser = await chromium.launch({ headless: true, executablePath: process.env.FIREFLY_TEST_BROWSER || (existsSync(chrome) ? chrome : 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe') })
})
after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)) })

async function fixture(t, width = 1280) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36' })
  t.after(() => context.close())
  const page = await context.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.message)); t.after(() => assert.deepEqual(errors, []))
  await page.addInitScript(() => {
    window.isTauri = true
    window.dialogResults = []; window.calls = []; window.installCalls = []; window.fail = new Set(); window.holdInstall = false; window.releaseInstall = null
    const callbacks = new Map(), listeners = new Map(), modules = new Map(); let sequence = 0
    const describe = path => { const base = path.split('/').pop().replace(/\.fftool$/i, ''), id = base === 'alias' ? 'a' : base; return { module_id: 'dev.test.' + id, name: '测试工具 ' + id, version: '1.0.0', author: '测试作者', tools: ['工具 ' + id], tool_ids: ['dev.test.' + id + '.main'], categories: ['效率工具'], network_hosts: id === 'c' ? ['https://example.com'] : [], builtin: false, modified: false } }
    window.emitDrop = paths => {
      const listener = listeners.get('tauri://drag-drop'); if (!listener) throw new Error('The native drop listener is missing')
      callbacks.get(listener)({ event: 'tauri://drag-drop', id: 1, payload: { paths, position: { x: 10, y: 10 } } })
    }
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} }
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback(callback) { const id = ++sequence; callbacks.set(id, callback); return id }, unregisterCallback(id) { callbacks.delete(id) },
      async invoke(command, args) {
        window.calls.push({ command, args })
        if (command === 'plugin:event|listen') { listeners.set(args.event, args.handler); return ++sequence }
        if (command === 'plugin:dialog|open') { if (!args.options.multiple) throw new Error('Multiple selection is not enabled'); return window.dialogResults.shift() ?? null }
        if (command === 'plugin:fs|stat') return { size: 100, isFile: true, isDirectory: false }
        if (command === 'inspect_module_file') { if (args.path.includes('broken')) throw new Error('损坏的工具包'); return describe(args.path) }
        if (command === 'install_module_file') {
          window.installCalls.push(args.path)
          if (window.holdInstall) await new Promise(resolve => window.releaseInstall = resolve)
          if (window.fail.has(args.path)) throw new Error('测试安装失败')
          const summary = describe(args.path); modules.set(summary.module_id, summary); return summary
        }
        if (command === 'list_modules') return [...modules.values()]
        if (command === 'list_tools') return [...modules.values()].map(summary => ({ id: summary.tool_ids[0], name: summary.tools[0], description: '', category: '效率工具', builtin: false, custom: false, module_id: summary.module_id, ui_kind: 'text', tags: [], aliases: [], actions: [{ id: 'run', label: '处理' }] }))
        if (['list_favorites', 'list_recent_tools', 'list_websites', 'list_custom_tools'].includes(command)) return []
        if (command === 'desktop_close_behavior') return 'tray'
        if (command === 'desktop_autostart_enabled') return false
        return null
      },
    }
  })
  await page.goto(origin)
  await page.locator('.nav-button').filter({ hasText: '工具管理' }).evaluate(button => button.click())
  await page.getByRole('button', { name: '打开工具工作台', exact: true }).click()
  const panel = page.locator('#studio-panel-import'), rows = panel.locator('.module-import-item')
  async function choose(paths) { await page.evaluate(paths => window.dialogResults.push(paths), paths); await panel.locator('.module-import-button').click(); await page.waitForFunction(() => !document.querySelector('.module-import-item.import-checking, .module-import-item.import-waiting')) }
  return { page, panel, rows, choose }
}

for (const width of [1280, 390]) test(`multi-file import continues after an error, retries failed installs, and stays on import at ${width}px`, async t => {
  const f = await fixture(t, width)
  await f.choose(['C:/a.fftool', 'C:/b.fftool', 'C:/broken.fftool', 'C:/c.fftool', 'C:/a.fftool'])
  assert.equal(await f.rows.count(), 4)
  const networkInfo = f.rows.filter({ hasText: '测试工具 c' }).locator('.module-import-details')
  await networkInfo.locator('summary').click()
  assert.equal(await networkInfo.getAttribute('open'), '')
  assert((await networkInfo.locator('dd').allTextContents()).includes('https://example.com'))
  assert((await networkInfo.locator('dd').allTextContents()).includes('效率工具'))
  await f.page.evaluate(() => { window.fail.add('C:/b.fftool'); window.holdInstall = true })
  await f.panel.getByRole('button', { name: '安装全部（3）', exact: true }).click()
  await f.page.waitForFunction(() => !!window.releaseInstall)
  assert.equal(await f.panel.getByRole('button', { name: '清空列表', exact: true }).isDisabled(), true)
  await f.page.evaluate(() => { window.holdInstall = false; window.releaseInstall() })
  await f.panel.locator('.module-import-notice').filter({ hasText: '已安装 2 个工具包' }).waitFor()
  assert.equal(await f.panel.locator('.import-installed').count(), 2)
  assert.equal(await f.panel.locator('.import-failed').count(), 1)
  assert.equal(await f.page.locator('#studio-tab-import').getAttribute('aria-selected'), 'true')
  assert.deepEqual(await f.page.evaluate(() => window.installCalls), ['C:/a.fftool', 'C:/b.fftool', 'C:/c.fftool'])
  assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await f.page.screenshot({ path: path.join(directory, `batch-${width}.png`), fullPage: true })
  await f.page.evaluate(() => window.fail.clear())
  await f.panel.getByRole('button', { name: '重试安装', exact: true }).click()
  await f.panel.locator('.import-installed').filter({ hasText: '测试工具 b' }).waitFor()
  assert.deepEqual(await f.page.evaluate(() => window.installCalls), ['C:/a.fftool', 'C:/b.fftool', 'C:/c.fftool', 'C:/b.fftool'])
  await f.panel.getByRole('button', { name: '清空列表', exact: true }).click()
  assert.equal(await f.rows.count(), 0)
})

test('picker cancellation preserves queued files and the native drop listener accepts several paths', async t => {
  const f = await fixture(t, 320)
  await f.choose(['C:/a.fftool']); await f.choose(null)
  assert.equal(await f.rows.count(), 1)
  await f.page.evaluate(() => window.emitDrop(['C:/b.fftool', 'C:/c.fftool']))
  await f.rows.filter({ hasText: '测试工具 c' }).waitFor()
  assert.equal(await f.rows.count(), 3)
  await f.choose(['C:/alias.fftool'])
  await f.panel.locator('.import-invalid').filter({ hasText: '同一工具包 ID' }).waitFor()
  await f.panel.getByRole('button', { name: '从列表移除 测试工具 a', exact: true }).click()
  await f.panel.getByRole('button', { name: '重新检查', exact: true }).click()
  await f.panel.locator('.import-ready').filter({ hasText: 'alias.fftool' }).waitFor({ state: 'attached' })
  assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
})
