import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { chromium } from 'playwright-core'

const dist = path.resolve('dist'), screenshots = path.resolve('target-check/remote-messages/browser')
await mkdir(screenshots, { recursive: true })
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname
  const file = pathname === '/' ? path.join(dist, 'index.html') : path.resolve(dist, '.' + pathname)
  if (!file.startsWith(dist + path.sep)) { response.writeHead(404).end(); return }
  try {
    response.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' })[path.extname(file)] ?? 'application/octet-stream')
    response.end(await readFile(file))
  } catch { response.writeHead(404).end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const browser = await chromium.launch({ executablePath: process.env.FIREFLY_TEST_BROWSER || (existsSync(chrome) ? chrome : 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'), headless: true })
const message = { id: 'news-1', enabled: true, show_once: true, title: '💌 来自流萤的消息', content: '<h2>你好喵 🐱</h2><p>欢迎使用<br>流萤百宝箱。💚</p>' }
const update = { ...message, id: 'update-1', title: '流萤又进步了一点', version: '0.2.0', force: false, download_url: 'https://example.com/firefly.exe' }
const feed = (changes = {}) => ({ configured: true, update: { ...update }, notification: { ...message }, ...changes })

async function app(work, options = {}) {
  const { width = 1280, height = 900, data = feed(), defer = false, fail = false, history = [] } = options
  const context = await browser.newContext({ viewport: { width, height } })
  context.setDefaultTimeout(8000)
  try {
    const page = await context.newPage()
    await page.route('https://**', route => route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1kAAAAASUVORK5CYII=', 'base64') }))
    await page.addInitScript(({ data, defer, fail, history }) => {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem('firefly.remote-messages.read.v1', JSON.stringify(history))
        sessionStorage.setItem('seeded', 'yes')
      }
      window.isTauri = true; window.calls = []; window.feed = data; window.deferFeed = defer; window.failFeed = fail
      window.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
        transformCallback: () => 1, unregisterCallback() {},
        async invoke(command, args) {
          window.calls.push({ command, args })
          if (command === 'fetch_remote_messages') {
            if (window.failFeed) throw new Error('Offline')
            if (window.deferFeed) return new Promise(resolve => { window.resolveFeed = resolve })
            return structuredClone(window.feed)
          }
          if (command === 'open_remote_message_link') { if (window.failLink) throw new Error('No browser'); return }
          if (['list_tools', 'list_favorites', 'list_recent_tools', 'list_custom_tools', 'list_websites', 'list_modules'].includes(command)) return []
          if (command === 'desktop_close_behavior') return 'tray'
          if (command === 'desktop_autostart_enabled') return false
          return null
        },
      }
    }, { data, defer, fail, history })
    await page.goto(origin); await page.bringToFront()
    await page.waitForFunction(() => { const app = document.querySelector('.app-shell'); return app && getComputedStyle(app).display !== 'none' })
    await work(page)
  } finally { await context.close() }
}
const popup = page => page.locator('.remote-message-dialog[open]')
async function about(page) { await page.locator('.nav-button').filter({ hasText: '关于应用' }).evaluate(button => button.click()) }
const history = page => page.evaluate(() => JSON.parse(localStorage.getItem('firefly.remote-messages.read.v1') || '[]'))

try {
  await test('startup presents update before notice, sanitizes HTML and remembers both IDs across restarts', async () => {
    const content = '<h1>大标题</h1><h6>小标题</h6><p>正文<br><strong>重点</strong></p><img src="https://example.com/p.png" onerror="window.xss=1"><img src="data:image/svg+xml,xxx"><a href="javascript:alert(1)">坏链接</a><a href="https://example.com/help#topic">帮助</a><script>window.xss=1</script><iframe src="https://example.com"></iframe><style>body{display:none}</style><form><input name="invoke"></form><svg onload="window.xss=1"></svg><div id="main-content" class="app-shell" style="position:fixed" onclick="window.xss=1">安全内容</div>'
    await app(async page => {
      await popup(page).waitFor()
      assert.equal(await popup(page).locator('h2#remote-message-title').textContent(), update.title)
      assert.equal(await page.evaluate(() => document.activeElement.id), 'remote-message-title')
      const body = popup(page).locator('.remote-message-body')
      assert.equal(await body.locator('h1').count(), 1); assert.equal(await body.locator('h6').count(), 1)
      assert.equal(await body.locator('script,iframe,style,form,input,svg,[onclick],[onerror],[id],[class],[style]').count(), 0)
      assert.equal(await body.locator('img').count(), 1)
      assert.equal(await body.locator('a[href]').count(), 1)
      await body.getByText('帮助', { exact: true }).click()
      assert.equal(await page.evaluate(() => window.calls.find(call => call.command === 'open_remote_message_link').args.url), 'https://example.com/help#topic')
      assert.equal(await page.evaluate(() => window.xss), undefined)
      await popup(page).getByRole('button', { name: '稍后再说', exact: true }).click()
      await popup(page).getByRole('heading', { name: message.title }).waitFor()
      assert.deepEqual(await history(page), ['update:update-1'])
      await popup(page).getByRole('button', { name: '我知道了', exact: true }).click()
      await popup(page).waitFor({ state: 'hidden' })
      assert.deepEqual(await history(page), ['update:update-1', 'notification:news-1'])
      await page.reload(); await page.waitForTimeout(250)
      assert.equal(await popup(page).count(), 0)
      await about(page); await page.getByRole('button', { name: /检查更新/ }).click()
      await popup(page).getByRole('heading', { name: update.title }).waitFor()
    }, { data: feed({ update: { ...update, content } }) })
  })
  await test('mandatory update ignores acknowledged IDs and blocks Escape, native Back and background shortcuts', async () => {
    await app(async page => {
      await popup(page).waitFor()
      assert.equal(await popup(page).getByRole('button', { name: /稍后|关闭/ }).count(), 0)
      await page.keyboard.press('Escape')
      await page.evaluate(() => window.dispatchEvent(new Event('firefly:native-back')))
      await page.keyboard.press('Control+k')
      assert.equal(await popup(page).count(), 1); assert.equal(await page.locator('.search-page').count(), 0)
      await page.evaluate(() => { window.failLink = true })
      await popup(page).getByRole('button', { name: '前往下载' }).click()
      await popup(page).getByRole('alert').waitFor()
      await page.evaluate(() => { window.failLink = false })
      await popup(page).getByRole('button', { name: '前往下载' }).click()
      assert.equal(await popup(page).count(), 1)
      assert.equal(await page.evaluate(() => window.calls.filter(call => call.command === 'open_remote_message_link').length), 2)
      assert.deepEqual(await history(page), ['update:update-1'])
      assert.equal(await page.getByRole('heading', { name: message.title }).count(), 0)
    }, { data: feed({ update: { ...update, force: true } }), history: ['update:update-1'] })
  })
  await test('show_once false repeats both messages on the next startup, ignores history, and does not loop after dismissal', async () => {
    await app(async page => {
      for (let launch = 0; launch < 2; launch++) {
        await popup(page).getByRole('heading', { name: update.title }).waitFor()
        await popup(page).getByRole('button', { name: '稍后再说', exact: true }).click()
        await popup(page).getByRole('heading', { name: message.title }).waitFor()
        await popup(page).getByRole('button', { name: '我知道了', exact: true }).click()
        await popup(page).waitFor({ state: 'hidden' })
        assert.deepEqual(await history(page), ['update:update-1'])
        await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('firefly:foreground')) })
        await page.waitForTimeout(150)
        assert.equal(await popup(page).count(), 0)
        assert.equal(await page.evaluate(() => window.calls.filter(call => call.command === 'fetch_remote_messages').length), 1)
        if (!launch) await page.reload()
      }
    }, { data: feed({ update: { ...update, show_once: false }, notification: { ...message, show_once: false } }), history: ['update:update-1'] })
  })
  await test('omitting show_once preserves the previous once-per-ID behavior', async () => {
    const oldUpdate = { ...update }, oldNotice = { ...message }
    delete oldUpdate.show_once; delete oldNotice.show_once
    await app(async page => { await page.waitForTimeout(150); assert.equal(await popup(page).count(), 0) }, { data: feed({ update: oldUpdate, notification: oldNotice }), history: ['update:update-1', 'notification:news-1'] })
  })
  await test('emoji sequences remain intact in plain-text titles and sanitized HTML on mobile and desktop', async () => {
    const title = '🎉 流萤更新 👩🏽‍💻 ❤️', content = '<h2>你好呀 🐱</h2><p>快乐开发 👨‍👩‍👧‍👦 👍🏽</p><p>&#x1F49A;</p>'
    for (const width of [320, 1280]) {
      await app(async page => {
        await popup(page).waitFor()
        assert.equal(await page.locator('#remote-message-title').textContent(), title)
        assert.equal(await page.locator('.remote-message-body h2').textContent(), '你好呀 🐱')
        assert.equal(await page.locator('.remote-message-body p').first().textContent(), '快乐开发 👨‍👩‍👧‍👦 👍🏽')
        assert.equal(await page.locator('.remote-message-body p').last().textContent(), '💚')
        await page.screenshot({ path: path.join(screenshots, `emoji-update-${width}.png`) })
        await popup(page).getByRole('button', { name: '稍后再说', exact: true }).click()
        await popup(page).locator('.remote-message-eyebrow').filter({ hasText: '流萤百宝箱来信' }).waitFor()
        assert.equal(await page.locator('.remote-message-body p').first().textContent(), '快乐开发 👨‍👩‍👧‍👦 👍🏽')
        await page.screenshot({ path: path.join(screenshots, `emoji-notification-${width}.png`) })
      }, { width, data: feed({ update: { ...update, title, content }, notification: { ...message, title, content } }) })
    }
  })
  await test('failed startup remains silent; manual check gives a recoverable error and no repeated background checks', async () => {
    await app(async page => {
      await page.waitForTimeout(150)
      assert.equal(await popup(page).count(), 0); assert.equal(await page.locator('.toast').count(), 0)
      assert.equal(await page.evaluate(() => window.calls.filter(call => call.command === 'fetch_remote_messages').length), 1)
      await about(page); await page.getByRole('button', { name: /检查更新/ }).click()
      await page.locator('.toast').filter({ hasText: '暂时无法检查更新' }).waitFor()
      await page.evaluate(data => { window.failFeed = false; window.feed = data }, feed({ notification: null }))
      await page.getByRole('button', { name: /检查更新/ }).click(); await popup(page).waitFor()
    }, { fail: true })
  })
  await test('disabled entries stay hidden and notice ID changes produce a new popup', async () => {
    await app(async page => { await page.waitForTimeout(100); assert.equal(await popup(page).count(), 0) }, { data: feed({ update: { ...update, enabled: false }, notification: { ...message, enabled: false } }) })
    await app(async page => {
      await popup(page).waitFor(); assert.equal(await popup(page).getByRole('heading', { name: message.title }).count(), 1)
      await page.keyboard.press('Escape'); await popup(page).waitFor({ state: 'hidden' })
      assert.deepEqual(await history(page), ['notification:older-news', 'notification:news-1'])
    }, { data: feed({ update: null }), history: ['notification:older-news'] })
  })
  await test('a pending feed waits for an existing modal, and manual checks share the startup request', async () => {
    await app(async page => {
      await about(page)
      const check = page.getByRole('button', { name: /检查中/ }); assert(await check.isDisabled())
      await page.evaluate(data => {
        const dialog = document.createElement('dialog'); dialog.id = 'existing-modal'; dialog.textContent = '其他操作'; document.body.append(dialog); dialog.showModal()
        window.resolveFeed(data)
      }, feed())
      await page.waitForTimeout(100); assert.equal(await popup(page).count(), 0)
      await page.evaluate(() => document.getElementById('existing-modal').close())
      await popup(page).waitFor()
      assert.equal(await page.evaluate(() => window.calls.filter(call => call.command === 'fetch_remote_messages').length), 1)
    }, { defer: true })
  })
  await test('unconfigured source is quiet at startup and explained when checking manually', async () => {
    await app(async page => {
      assert.equal(await popup(page).count(), 0); assert.equal(await page.locator('.toast').count(), 0)
      await about(page); await page.getByRole('button', { name: /检查更新/ }).click()
      await page.locator('.toast').filter({ hasText: '尚未配置' }).waitFor()
    }, { data: feed({ configured: false, update: null, notification: null }) })
  })
  for (const width of [320, 390, 640, 1280]) {
    await test(`long HTML scrolls inside the card and buttons remain visible at ${width}px with enlarged fonts`, async () => {
      const content = '<h2>这次更新带来了什么</h2><p>更方便的工具，也有更舒适的使用体验。</p><img src="https://example.com/banner.png" alt="更新图片">' + '<h3>细节改善</h3><p>保留内容的层次与可读性，正文较长时可以继续滚动阅读。</p>'.repeat(20) + '<pre>' + 'very-long-content'.repeat(20) + '</pre><table><tr><td>表格内容</td><td>第二列</td></tr></table>'
      await app(async page => {
        await popup(page).waitFor()
        await page.evaluate(width => { document.documentElement.style.setProperty('--app-font-scale', '1.25'); if (width === 390) document.documentElement.dataset.theme = 'dark' }, width)
        await page.waitForTimeout(250) // Allow the existing button color transitions to settle.
        const metrics = await popup(page).evaluate(node => {
          const rect = node.getBoundingClientRect(), body = node.querySelector('.remote-message-body'), button = node.querySelector('.primary-button').getBoundingClientRect()
          return { width: rect.width, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, innerWidth, innerHeight, overflow: body.scrollHeight > body.clientHeight, buttonBottom: button.bottom, actionsFit: [...node.querySelectorAll('.remote-message-actions button')].every(button => button.scrollWidth <= button.clientWidth) }
        })
        assert(metrics.left >= 0 && metrics.right <= width)
        assert(metrics.top >= 0 && metrics.bottom <= metrics.innerHeight)
        assert(metrics.overflow); assert(metrics.buttonBottom <= metrics.innerHeight); assert(metrics.actionsFit)
        await page.screenshot({ path: path.join(screenshots, `update-${width}.png`) })
        await popup(page).getByRole('button', { name: '稍后再说', exact: true }).click()
        await popup(page).getByRole('heading', { name: message.title }).waitFor()
        await page.screenshot({ path: path.join(screenshots, `notification-${width}.png`) })
      }, { width, height: width <= 390 ? 568 : 900, data: feed({ update: { ...update, content } }) })
    })
  }
} finally { await browser.close(); server.close() }
