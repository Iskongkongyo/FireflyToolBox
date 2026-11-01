import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'node:http'
import { chromium } from 'playwright-core'

const root = path.resolve('dist')
const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname))
  if (!file.startsWith(root + path.sep)) { response.writeHead(404); response.end(); return }
  try {
    response.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' })[path.extname(file)] || 'application/octet-stream')
    response.end(fs.readFileSync(file))
  } catch { response.writeHead(404); response.end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const browser = await chromium.launch({ headless: true, executablePath: process.env.FIREFLY_TEST_BROWSER || (fs.existsSync(chrome) ? chrome : 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe') })
async function fixture(width) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, ...(width < 600 ? { isMobile: true, hasTouch: true } : {}) })
  context.setDefaultTimeout(8000)
  const page = await context.newPage()
  await page.route('https://piaofang.maoyan.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Official dashboard fixture</title><p>Loaded</p>' }))
  await page.addInitScript(() => {
    window.isTauri = true
    window.loadModes = {}
    window.pendingLoads = {}
    window.loadingObservations = []
    const tools = [['local.fast.main', 'Fast web'], ['local.slow.main', 'Slow web'], ['local.error.main', 'Broken web'], ['boxoffice.live', 'Box office']].map(([id, name]) => ({ id, name, description: 'Tool description', category: '开发与文本', aliases: [], tags: [], builtin: id === 'boxoffice.live', custom: false, module_id: id === 'boxoffice.live' ? 'builtin.boxoffice.live' : id.slice(0, -5), runtime: 'browser', ui_kind: 'web', actions: [{ id: 'open', label: '打开' }] }))
    const details = id => {
      const tool = tools.find(tool => tool.module_id === id)
      return { modified: false, builtin: tool.builtin, manifest: { schema_version: 7, module_id: id, network: { hosts: [] }, resources: [], limits: { timeout_ms: 15000, input_bytes: 8388608, output_bytes: 4194304 }, tools: [{ id: tool.id, entry: 'index.html', ui: { kind: 'web', style: 'style.css', script: 'main.js' } }] }, scripts: { 'index.html': '<main><button id="ready">Ready</button></main>', 'style.css': 'main { padding: 12px }', 'main.js': 'export function mount() {}' } }
    }
    window.releaseLoad = id => { const resolve = window.pendingLoads[id]; delete window.pendingLoads[id]; resolve?.(details(id)) }
    window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, transformCallback: () => 1, unregisterCallback() {}, invoke: async (command, args) => {
      if (command === 'list_tools') return tools
      if (command === 'load_tool_storage') return '{}'
      if (command === 'get_module_details') {
        if (window.loadModes[args.moduleId] === 'hold') return await new Promise(resolve => { window.pendingLoads[args.moduleId] = resolve })
        if (window.loadModes[args.moduleId] === 'error') throw new Error('Fixture load failed')
        return details(args.moduleId)
      }
      if (command.includes('close_behavior')) return 'tray'
      if (command.includes('autostart')) return false
      return ['list_favorites', 'list_recent_tools', 'list_modules', 'list_websites', 'list_custom_tools'].includes(command) ? [] : null
    } }
  })
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.waitForFunction(() => document.querySelector('.app-shell'))
  const navigate = name => page.locator('.nav-button').filter({ hasText: name }).evaluate(button => button.click())
  const open = async name => { await navigate('工具管理'); await page.locator('.all-tool-item').filter({ hasText: name }).click() }
  const ready = () => page.waitForFunction(() => document.querySelector('.web-tool-container')?.getAttribute('aria-busy') === 'false')
  const loading = page.locator('.web-tool-page > p[role="status"]')
  const observe = () => page.evaluate(() => {
    window.loadingObserver?.disconnect()
    window.loadingObservations = []
    window.loadingObserver = new MutationObserver(() => {
      const hint = document.querySelector('.web-tool-page > p[role="status"]')
      if (hint) window.loadingObservations.push(hint.textContent)
    })
    window.loadingObserver.observe(document.body, { childList: true, subtree: true })
  })
  return { context, page, navigate, open, ready, loading, observe }
}

try {
  for (const width of [1280, 390]) {
    await test(`fast web loads never insert a loading hint at ${width}px`, async () => {
      const f = await fixture(width)
      try {
        await f.open('Fast web'); await f.ready()
        await f.navigate('工具管理'); await f.observe()
        await f.page.locator('.all-tool-item').filter({ hasText: 'Fast web' }).click()
        await f.ready(); await f.page.waitForTimeout(300)
        assert.deepEqual(await f.page.evaluate(() => window.loadingObservations), [])
        assert.equal(await f.loading.count(), 0)
      } finally { await f.context.close() }
    })

    await test(`slow loads show feedback after the delay and clear it on completion at ${width}px`, async () => {
      const f = await fixture(width)
      try {
        await f.page.evaluate(() => { window.loadModes['local.slow'] = 'hold' })
        await f.open('Slow web')
        await f.page.waitForFunction(() => window.pendingLoads['local.slow'])
        await f.page.waitForTimeout(100)
        assert.equal(await f.loading.count(), 0)
        await f.loading.waitFor()
        await f.page.evaluate(() => window.releaseLoad('local.slow'))
        await f.ready()
        assert.equal(await f.loading.count(), 0)
      } finally { await f.context.close() }
    })

    await test(`switching, leaving and failing web loads cannot leave a stale hint at ${width}px`, async () => {
      const f = await fixture(width)
      try {
        await f.open('Fast web'); await f.ready()
        await f.page.evaluate(() => { window.loadModes['local.slow'] = 'hold'; window.loadModes['local.fast'] = 'hold' })
        await f.open('Slow web')
        await f.page.waitForFunction(() => window.pendingLoads['local.slow'])
        await f.page.waitForTimeout(160)
        await f.open('Fast web'); await f.observe()
        await f.page.waitForFunction(() => window.pendingLoads['local.fast'])
        await f.page.waitForTimeout(130)
        assert.equal(await f.loading.count(), 0)
        await f.page.evaluate(() => window.releaseLoad('local.fast'))
        await f.ready()
        await f.page.evaluate(() => window.releaseLoad('local.slow'))
        await f.page.waitForTimeout(100)
        assert.deepEqual(await f.page.evaluate(() => window.loadingObservations), [])
        await f.open('Slow web'); await f.loading.waitFor()
        await f.navigate('首页')
        await f.page.evaluate(() => window.releaseLoad('local.slow'))
        await f.page.waitForTimeout(300)
        assert.equal(await f.loading.count(), 0)
        await f.page.evaluate(() => { window.loadModes['local.error'] = 'error' })
        await f.open('Broken web')
        await f.page.locator('.web-tool-page > [role="alert"]').waitFor()
        await f.page.waitForTimeout(300)
        assert.equal(await f.loading.count(), 0)
      } finally { await f.context.close() }
    })

    await test(`the official dashboard retains refresh/open actions without a collapse action at ${width}px`, async () => {
      const f = await fixture(width)
      let requests = 0
      f.page.on('request', request => { if (request.url().startsWith('https://piaofang.maoyan.com/')) requests++ })
      try {
        await f.open('Box office'); await f.ready()
        const toolbar = f.page.locator('.official-boxoffice-toolbar')
        assert.equal(await toolbar.getByRole('button').count(), 2)
        await toolbar.getByRole('button', { name: '刷新看板', exact: true }).click()
        await f.page.waitForFunction(() => document.querySelector('.official-boxoffice iframe') !== null)
        assert.equal(await toolbar.getByRole('button', { name: '独立窗口打开', exact: true }).count(), 1)
        assert.equal(await toolbar.getByRole('button', { name: '收起', exact: true }).count(), 0)
        await f.page.waitForTimeout(100)
        assert(requests >= 2)
      } finally { await f.context.close() }
    })
  }

  await test('touch website-add remains transparent under sticky hover and active states', async () => {
    const f = await fixture(390)
    try {
      await f.navigate('网站')
      const button = f.page.locator('.top-actions .add-button')
      const session = await f.context.newCDPSession(f.page)
      await session.send('DOM.enable'); await session.send('CSS.enable')
      const { root } = await session.send('DOM.getDocument')
      const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.top-actions .add-button' })
      await session.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover', 'active'] })
      assert.equal(await f.page.evaluate(() => matchMedia('(hover: none)').matches), true)
      assert.equal(await button.evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)')
      await session.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] })
      await button.tap()
      await f.page.locator('dialog[open].website-dialog').waitFor()
    } finally { await f.context.close() }
  })
} finally {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
}
