import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { chromium } from 'playwright-core'

const dist = path.resolve('dist')
const artifacts = path.resolve('target-check/mobile-ripples')
await mkdir(artifacts, { recursive: true })
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname
  const file = path.resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname))
  if (!file.startsWith(dist + path.sep)) { response.writeHead(404); response.end(); return }
  try {
    response.setHeader('Content-Type', { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream')
    response.end(await readFile(file))
  } catch { response.writeHead(404); response.end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const browser = await chromium.launch({ headless: true, executablePath: process.env.FIREFLY_TEST_BROWSER || (existsSync(chrome) ? chrome : 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe') })
async function pageFor({ width = 390, theme = 'light', accent = '', reducedMotion = 'no-preference', empty = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: true, colorScheme: theme, reducedMotion })
  const page = await context.newPage()
  page.setDefaultTimeout(6000)
  await page.addInitScript(({ theme, accent, empty }) => {
    localStorage.setItem('firefly.theme.v1', theme)
    localStorage.setItem('firefly.accent.v1', accent)
    localStorage.setItem('firefly.auto-hide-bars.v1', 'false')
    localStorage.setItem('firefly.component-transparency.v1', '60')
    const tools = empty ? [] : ['JSON 格式化', '文本编码', '时间转换'].map((name, index) => ({
      id: `fixture.${index}`, name, description: '', category: index === 2 ? '生活与查询' : '开发与文本',
      builtin: true, custom: false, ui_kind: 'text', aliases: [], tags: [], actions: [{ id: 'run', label: '处理', consumes_input: true }],
    }))
    window.__TAURI_INTERNALS__ = { invoke: async command => {
      if (command === 'list_tools') return tools
      if (command === 'list_favorites') return tools.map(tool => tool.id)
      if (command === 'list_websites') return [{ id: 1, name: '示例网站', url: 'https://example.com', description: '', tags: '', favorite: false }]
      if (['list_modules', 'list_custom_tools', 'list_recent_tools'].includes(command)) return []
      return null
    } }
  }, { theme, accent, empty })
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.locator('.app-shell').waitFor({ state: 'visible' })
  await page.locator('.bottom-nav button').first().waitFor({ state: 'attached' })
  return { context, page }
}
async function point(locator, edge = false) {
  const box = await locator.boundingBox()
  assert.ok(box)
  return { x: box.x + (edge ? 8 : box.width / 2), y: box.y + box.height / 2 }
}
async function hold(page, locator, edge = false) {
  const p = await point(locator, edge)
  await page.mouse.move(p.x, p.y)
  await page.mouse.down()
  return p
}
const clean = page => page.waitForFunction(() => !document.querySelector('.mobile-ripple-layer, [data-mobile-ripple]'))

try {
  await test('all three tabs show a clipped ripple from the touch point and navigate once', async () => {
    const { context, page } = await pageFor()
    try {
      for (const label of ['收藏', '网站', '首页']) {
        const button = page.locator('.bottom-nav button').filter({ hasText: label })
        const before = await button.boundingBox(), p = await hold(page, button, true)
        const info = await button.evaluate(button => {
          const layer = button.querySelector('.mobile-ripple-layer'), wave = layer.querySelector('i')
          return { left: wave.style.left, width: parseFloat(wave.style.width), clipped: getComputedStyle(layer).overflow, pointer: getComputedStyle(layer).pointerEvents, hidden: layer.getAttribute('aria-hidden') }
        })
        assert.equal(info.left, '8px')
        assert.ok(info.width > before.width)
        assert.deepEqual([info.clipped, info.pointer, info.hidden], ['hidden', 'none', 'true'])
        assert.deepEqual(await button.boundingBox(), before, 'feedback must not move the button')
        assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y).closest('button').textContent.trim(), p), label)
        await page.mouse.up()
        await page.waitForFunction(label => document.querySelector('.bottom-nav button.active').textContent.trim() === label, label)
        assert.equal(await button.locator('.mobile-ripple-layer.is-released').count(), 1, 'the tab update must retain its feedback')
        await clean(page)
      }
      await page.touchscreen.tap(...Object.values(await point(page.locator('.bottom-nav button').nth(1))))
      assert.equal(await page.locator('.bottom-nav button.active').innerText(), '收藏')
      await clean(page)
    } finally { await context.close() }
  })
  await test('light, dark and custom accents tint the wave and keep transparent surfaces intact', async () => {
    for (const theme of ['light', 'dark']) for (const accent of ['', '#7056b6']) {
      const { context, page } = await pageFor({ theme, accent })
      try {
        const button = page.locator('.bottom-nav button').first()
        await hold(page, button)
        await page.waitForTimeout(150)
        const colors = await button.evaluate(button => {
          const layer = button.querySelector('.mobile-ripple-layer'), wave = layer.querySelector('i')
          const probe = document.createElement('i'); probe.style.color = 'var(--accent)'; button.append(probe)
          const accent = getComputedStyle(probe).color; probe.remove()
          return { color: getComputedStyle(layer).color, accent, opacity: Number(getComputedStyle(wave).opacity), surface: getComputedStyle(button.parentElement).backgroundColor }
        })
        assert.equal(colors.color, colors.accent)
        assert.equal(colors.opacity, theme === 'dark' ? .18 : .14)
        assert.ok(colors.surface.endsWith(', 0.4)'))
        await page.screenshot({ path: path.join(artifacts, `${theme}${accent ? '-custom' : ''}.png`), animations: 'allow' })
        await page.mouse.up()
        await clean(page)
      } finally { await context.close() }
    }
  })
  await test('home controls, favorites and website actions retain their original behavior', async () => {
    const { context, page } = await pageFor()
    try {
      const header = page.locator('.tab-panel-active .category-header').first()
      await hold(page, header)
      assert.equal(await header.locator('.mobile-ripple-layer').count(), 1)
      await page.mouse.up()
      assert.equal(await header.getAttribute('aria-expanded'), 'true')
      await clean(page)
      const tool = page.locator('.tab-panel-active .tool-pill').first()
      await hold(page, tool)
      assert.equal(await tool.locator('.mobile-ripple-layer').count(), 1)
      await page.mouse.up()
      await page.locator('.editor-open').waitFor()
      await clean(page)
      await page.locator('.top-title .top-icon-button').click()
      await page.locator('.bottom-nav button').nth(1).tap()
      const favorite = page.locator('.tab-panel-active .favorite-card').first()
      await hold(page, favorite)
      assert.equal(await favorite.locator('.mobile-ripple-layer').count(), 1)
      await page.mouse.up()
      await page.locator('.editor-open').waitFor()
      await page.locator('.top-title .top-icon-button').click()
      await page.locator('.bottom-nav button').nth(2).tap()
      const more = page.locator('.tab-panel-active .website-menu-button')
      await hold(page, more)
      assert.equal(await more.locator('.mobile-ripple-layer').count(), 1)
      await page.mouse.up()
      await page.locator('.website-actions-dialog[open]').waitFor()
      await page.getByRole('button', { name: '关闭网站操作', exact: true }).click()
      const search = page.locator('.search-trigger')
      await hold(page, search)
      assert.equal(await search.locator('.mobile-ripple-layer').count(), 1)
      await page.mouse.up()
      await page.locator('.search-page').waitFor()
      await clean(page)
    } finally { await context.close() }
  })
  await test('dragging, touch cancellation and long-press sorting clear feedback without intercepting gestures', async () => {
    const { context, page } = await pageFor()
    try {
      const header = page.locator('.tab-panel-active .category-header').first()
      const p = await hold(page, header)
      await page.mouse.move(p.x + 22, p.y)
      await clean(page)
      await page.mouse.up()
      // Reset the header without relying on whether a moved mouse click toggled it.
      await page.reload()
      await header.waitFor()
      await hold(page, header)
      await page.waitForTimeout(480)
      assert.equal(await page.locator('.swap-origin').count(), 1)
      await clean(page)
      await page.mouse.up()
      assert.equal(await page.locator('.swap-origin').count(), 0)
      assert.equal(await header.getAttribute('aria-expanded'), 'false', 'long press must not trigger a click')
      // A completed sort deliberately suppresses page swipes for 500 ms. Start
      // the independent swipe check with fresh app state.
      await page.reload()
      await header.waitFor()
      const cdp = await context.newCDPSession(page)
      const touch = await point(header)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch] })
      assert.equal(await page.locator('.mobile-ripple-layer').count(), 1)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
      await clean(page)
      // A real horizontal touch gesture starting on a button still switches tabs.
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touch.x - 125, y: touch.y }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await page.waitForFunction(() => document.querySelector('.bottom-nav button.active').textContent.trim() === '收藏')
      await clean(page)
      await cdp.detach()
    } finally { await context.close() }
  })
  await test('keyboard activation is centered and rapid taps leave no layers behind', async () => {
    const { context, page } = await pageFor()
    try {
      const button = page.locator('.bottom-nav button').nth(1)
      await button.focus()
      await page.keyboard.press('Enter')
      assert.equal(await page.locator('.bottom-nav button.active').innerText(), '收藏')
      assert.equal(await button.locator('.mobile-ripple-wave').evaluate(wave => parseFloat(wave.style.left)), (await button.boundingBox()).width / 2)
      await page.evaluate(() => {
        const button = document.querySelector('.bottom-nav button.active'), r = button.getBoundingClientRect()
        for (let i = 0; i < 40; i++) {
          const args = { bubbles: true, isPrimary: true, pointerId: 1, button: 0, clientX: r.x + 10, clientY: r.y + 10 }
          button.dispatchEvent(new PointerEvent('pointerdown', args))
          button.dispatchEvent(new PointerEvent('pointerup', args))
        }
      })
      assert.ok(await page.locator('.mobile-ripple-layer').count() <= 6)
      await clean(page)
    } finally { await context.close() }
  })
  await test('reduced motion shows a still highlight, including contrasting primary button feedback', async () => {
    const { context, page } = await pageFor({ reducedMotion: 'reduce', empty: true })
    try {
      await page.locator('.bottom-nav button').nth(1).tap()
      const primary = page.locator('.tab-panel-active .primary-button')
      await hold(page, primary, true)
      const style = await primary.evaluate(button => {
        const layer = button.querySelector('.mobile-ripple-layer'), wave = layer.querySelector('i'), css = getComputedStyle(wave)
        return { color: getComputedStyle(layer).color, text: getComputedStyle(button).color, transform: css.transform, animation: css.animationName, left: css.left, top: css.top, width: parseFloat(css.width), innerWidth: button.clientWidth }
      })
      assert.equal(style.color, style.text)
      assert.deepEqual([style.transform, style.animation, style.left, style.top], ['none', 'none', '0px', '0px'])
      assert.equal(style.width, style.innerWidth)
      await page.mouse.up()
      await clean(page)
    } finally { await context.close() }
  })
  await test('desktop widths, disabled controls and secondary pages do not gain mobile feedback', async () => {
    const { context, page } = await pageFor({ width: 1280 })
    try {
      await hold(page, page.locator('.tab-panel-active .category-header').first())
      assert.equal(await page.locator('.mobile-ripple-layer').count(), 0)
      await page.mouse.up()
      await page.setViewportSize({ width: 390, height: 844 })
      const menu = page.locator('.mobile-menu-button')
      await menu.evaluate(button => { button.disabled = true })
      await menu.dispatchEvent('pointerdown', { pointerId: 2, isPrimary: true, button: 0 })
      assert.equal(await page.locator('.mobile-ripple-layer').count(), 0)
      await menu.evaluate(button => { button.disabled = false })
      await hold(page, menu)
      assert.equal(await menu.locator('.mobile-ripple-layer').count(), 1)
      await page.mouse.up()
      const theme = page.locator('.nav-button').filter({ hasText: '应用主题' })
      await hold(page, theme)
      assert.equal(await theme.locator('.mobile-ripple-layer').count(), 1)
      await page.mouse.up()
      await page.locator('.preference-page').waitFor()
      await clean(page)
      await hold(page, page.locator('.top-title .top-icon-button'))
      assert.equal(await page.locator('.mobile-ripple-layer').count(), 0)
      await page.mouse.up()
    } finally { await context.close() }
  })
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
