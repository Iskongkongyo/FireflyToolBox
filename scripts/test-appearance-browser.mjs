// Real Chromium and IndexedDB; native shell calls use an isolated fixture.
import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { mockAndroidShell } from './android-shell-fixture.mjs'

const storageBundle = await build({ entryPoints: ['src/services/wallpaper.ts'], bundle: true, write: false, format: 'esm', platform: 'browser' })
const dist = path.resolve('dist')
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname
  if (pathname === '/src/services/wallpaper.ts') { response.setHeader('Content-Type', 'text/javascript'); response.end(storageBundle.outputFiles[0].text); return }
  const file = pathname === '/' ? path.join(dist, 'index.html') : path.resolve(dist, '.' + pathname)
  if (!file.startsWith(dist + path.sep)) { response.writeHead(404); response.end(); return }
  try {
    const bytes = await readFile(file)
    response.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' })[path.extname(file)] ?? 'application/octet-stream')
    response.end(bytes)
  } catch { response.writeHead(404); response.end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const browser = await chromium.launch({ headless: true, executablePath: process.env.FIREFLY_TEST_BROWSER || (existsSync(chrome) ? chrome : 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe') })

async function pageFor({ width = 1280, preferences = {}, android = false, blockedStorage = false, catalog = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: 'light', ...(android ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36' } : {}) })
  context.setDefaultTimeout(8000)
  const page = await context.newPage()
  if (android) await page.addInitScript(mockAndroidShell)
  await page.addInitScript(({ preferences, android, blockedStorage, catalog }) => {
    window.isTauri = android
    for (const [key, value] of Object.entries(preferences)) localStorage.setItem(key, value)
    const tools = catalog ? [{ id: 'json.format', name: 'JSON 格式化', description: '格式化 JSON', category: '开发与文本', aliases: [], tags: [], builtin: true, custom: false, ui_kind: 'text', actions: [{ id: 'format', label: '格式化', input_types: ['text'] }] }] : []
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: () => 1, unregisterCallback() {},
      invoke: async (command, args) => {
        if (command === 'list_tools') return tools
        if (command === 'search_tools') return tools.filter(tool => tool.name.includes(args.query) || tool.id.includes(args.query))
        if (command === 'list_favorites') return tools.map(tool => tool.id)
        if (command === 'list_websites') return catalog ? [1, 2].map(id => ({ id, name: `网站 ${id}`, url: 'https://example.com/', description: '', tags: '', favorite: false })) : []
        return ['list_recent_tools', 'list_custom_tools', 'list_modules'].includes(command) ? [] : null
      },
    }
    if (blockedStorage) Object.defineProperty(window, 'indexedDB', { value: { open() { const request = {}; queueMicrotask(() => request.onblocked?.()); return request } } })
  }, { preferences, android, blockedStorage, catalog })
  await page.goto(origin, { timeout: 30000 })
  return { context, page }
}

async function theme(page) {
  await page.locator('.nav-button').filter({ hasText: '应用主题' }).evaluate(button => button.click())
  await page.locator('.sidebar-image-preference .text-button').first().waitFor()
  await page.waitForFunction(() => !document.querySelector('.sidebar-image-preference .text-button').disabled && !document.querySelector('.wallpaper-preference [role="switch"]').disabled)
}

async function selectImage(page, target = '侧边栏', mime = 'image/png') {
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64
    const context = canvas.getContext('2d'); context.fillStyle = 'rgba(255,0,0,.5)'; context.fillRect(16, 16, 32, 32)
    return Array.from(new Uint8Array(await (await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))).arrayBuffer()))
  })
  await page.getByLabel(`选择${target}图片`, { exact: true }).setInputFiles({ name: 'transparent.png', mimeType: mime, buffer: Buffer.from(bytes) })
}

async function savedImage(page, target) {
  return page.evaluate(async target => {
    const storage = await import('/src/services/wallpaper.ts')
    const blob = await storage[target]()
    if (!blob) return null
    const image = await createImageBitmap(blob), canvas = document.createElement('canvas')
    canvas.width = image.width; canvas.height = image.height
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0)
    const result = { type: blob.type, width: image.width, height: image.height, alpha: context.getImageData(0, 0, 1, 1).data[3], bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) }
    image.close()
    return result
  }, target)
}

try {
  await test('component transparency changes the three main pages but leaves other pages and search unchanged', async () => {
    for (const width of [1280, 390]) for (const mode of ['light', 'dark']) for (const accent of ['', '#123456']) {
      const snapshots = []
      for (const transparency of [0, 80]) {
        const { context, page } = await pageFor({ width, android: width === 390, catalog: true, preferences: {
          'firefly.theme.v1': mode, 'firefly.accent.v1': accent, 'firefly.component-transparency.v1': String(transparency), 'firefly.startup-splash-enabled.v1': 'false',
        } })
        try {
          const navigate = async name => {
            await page.locator('.nav-button').filter({ hasText: name }).evaluate(button => button.click())
          }
          const backgrounds = async selectors => {
            const colors = []
            for (const selector of selectors) {
              const node = page.locator(selector).first()
              await node.waitFor({ state: 'attached' })
              colors.push(await node.evaluate(element => getComputedStyle(element).backgroundColor))
            }
            return colors
          }
          const snapshot = { main: {}, other: {} }
          for (const [name, selector] of [['首页', '.tool-pill'], ['收藏', '.favorite-card'], ['网站', '.website-row']]) {
            await navigate(name)
            snapshot.main[name] = await backgrounds(['.topbar', `.tab-panel-active ${selector}`, '.bottom-nav'])
          }
          for (const [name, selector] of [['更多设置', '.settings-group'], ['关于应用', '.about-card'], ['工具管理', '.all-tool-item'], ['分组管理', '.category'], ['应用主题', '.preference-card']]) {
            await navigate(name)
            snapshot.other[name] = await backgrounds(['.topbar', selector])
            if (name === '更多设置') snapshot.preview = await backgrounds(['.home-appearance-preview-card', '.home-appearance-preview-card span'])
          }
          await page.getByLabel('打开色盘选择主题色').click()
          snapshot.other.color = await backgrounds(['.topbar', '.color-editor-card'])
          await navigate('工具管理')
          await page.locator('.all-tool-item').first().click()
          snapshot.other.editor = await backgrounds(['.topbar', '.editor-pane', '.editor-actions .secondary-button'])
          await navigate('首页')
          await page.getByRole('button', { name: '搜索', exact: true }).click()
          snapshot.other.search = await backgrounds(['.search-page-header', '.search-page-field'])
          await page.getByRole('searchbox', { name: '搜索工具和网站', exact: true }).fill('不存在的工具123')
          snapshot.other.searchEmpty = await backgrounds(['.search-page .empty-state'])
          snapshots.push(snapshot)
        } finally { await context.close() }
      }
      assert.deepEqual(snapshots[1].other, snapshots[0].other, `${width}px ${mode}: transparency escaped the main pages`)
      assert.notDeepEqual(snapshots[1].preview, snapshots[0].preview)
      for (const name of ['首页', '收藏', '网站']) {
        for (let index = 0; index < 3; index++) assert.notEqual(snapshots[1].main[name][index], snapshots[0].main[name][index], `${width}px ${mode}: ${name} surface ${index}`)
      }
    }
  })

  await test('live transparency changes preserve text and use matching RGB channels in every theme', async () => {
    const channels = color => {
      const match = /^rgba?\(([^)]+)\)$/.exec(color)
      assert.ok(match, `Expected an RGB color: ${color}`)
      const parts = match[1].split(',').map(Number)
      return { rgb: parts.slice(0, 3), alpha: parts.length === 4 ? parts[3] : 1 }
    }
    for (const mode of ['light', 'dark']) for (const accent of ['', '#123456']) {
      const { context, page } = await pageFor({ width: 390, catalog: true, preferences: { 'firefly.theme.v1': mode, 'firefly.accent.v1': accent } })
      try {
        await page.locator('.nav-button').filter({ hasText: '更多设置' }).evaluate(button => button.click())
        let textColor
        for (const value of [0, 40, 80]) {
          await page.locator('#component-transparency').fill(String(value))
          const styles = await page.locator('.home-appearance-preview-card').first().evaluate(async node => {
            await new Promise(resolve => requestAnimationFrame(resolve))
            const card = getComputedStyle(node), label = getComputedStyle(node.querySelector('span'))
            return { card: card.backgroundColor, label: label.backgroundColor, text: card.color, opacity: card.opacity }
          })
          assert.deepEqual(channels(styles.card).rgb, mode === 'dark' ? [28, 40, 38] : [255, 255, 255])
          assert.equal(channels(styles.card).alpha, (100 - value) / 100)
          assert.equal(channels(styles.label).alpha, (92 - value) / 100)
          textColor ??= styles.text
          assert.equal(styles.text, textColor)
          assert.equal(styles.opacity, '1')
        }
        await page.locator('.nav-button').filter({ hasText: '网站' }).evaluate(button => button.click())
        const tint = await page.locator('.website-avatar').first().evaluate(node => ({
          color: getComputedStyle(node).backgroundColor,
          soft: getComputedStyle(document.documentElement).getPropertyValue('--accent-soft').trim(),
        }))
        assert.deepEqual(channels(tint.color).rgb, [1, 3, 5].map(index => parseInt(tint.soft.slice(index, index + 2), 16)))
        assert.equal(channels(tint.color).alpha, .12)
        if (accent) {
          await theme(page)
          await page.locator('.color-preference').getByRole('button', { name: '恢复默认', exact: true }).click()
          assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent-soft-rgb').trim()), mode === 'dark' ? '42, 66, 55' : '231, 240, 233')
        }
      } finally { await context.close() }
    }
  })

  await test('card spacing changes main-page cards and the preview while group management keeps its own spacing', async () => {
    const snapshots = []
    for (const gap of [6, 22]) {
      const { context, page } = await pageFor({ catalog: true, preferences: { 'firefly.card-gap.v1': String(gap) } })
      try {
        const styles = async selector => {
          const node = page.locator(selector).first()
          await node.waitFor({ state: 'attached' })
          return node.evaluate(element => { const style = getComputedStyle(element); return { margin: style.marginBottom, gap: style.gap } })
        }
        const home = await styles('.tab-panel-active .category')
        await page.locator('.nav-button').filter({ hasText: '收藏' }).evaluate(button => button.click())
        const favorites = await styles('.tab-panel-active .tool-grid')
        await page.locator('.nav-button').filter({ hasText: '网站' }).evaluate(button => button.click())
        const websites = await styles('.tab-panel-active .website-grid')
        await page.locator('.nav-button').filter({ hasText: '分组管理' }).evaluate(button => button.click())
        const manager = await styles('.group-manager-card')
        await page.locator('.nav-button').filter({ hasText: '更多设置' }).evaluate(button => button.click())
        const preview = await styles('.home-appearance-preview')
        snapshots.push({ home, favorites, websites, manager, preview })
      } finally { await context.close() }
    }
    assert.deepEqual(snapshots[1].manager, snapshots[0].manager)
    for (const [index, gap] of [6, 22].entries()) {
      assert.equal(snapshots[index].home.margin, `${gap}px`)
      assert.equal(snapshots[index].favorites.gap, `${gap}px`)
      assert.equal(snapshots[index].websites.gap, `${gap}px`)
      assert.equal(snapshots[index].preview.gap, `${gap}px`)
    }
  })

  await test('font size remains global on main pages, settings, tools and search', async () => {
    const snapshots = []
    for (const size of [100, 125]) {
      const { context, page } = await pageFor({ catalog: true, preferences: { 'firefly.app-font-size.v1': String(size) } })
      try {
        const font = async selector => {
          const node = page.locator(selector).first()
          await node.waitFor({ state: 'attached' })
          return node.evaluate(element => parseFloat(getComputedStyle(element).fontSize))
        }
        const sample = { home: await font('.top-brand') }
        await page.locator('.nav-button').filter({ hasText: '更多设置' }).evaluate(button => button.click())
        sample.settings = await font('#settings-appearance-title')
        await page.locator('.nav-button').filter({ hasText: '工具管理' }).evaluate(button => button.click())
        await page.locator('.all-tool-item').first().click()
        sample.tool = await font('.tool-title')
        await page.locator('.nav-button').filter({ hasText: '首页' }).evaluate(button => button.click())
        await page.getByRole('button', { name: '搜索', exact: true }).click()
        sample.search = await font('.search-page-field input')
        snapshots.push(sample)
      } finally { await context.close() }
    }
    for (const area of Object.keys(snapshots[0])) assert.equal(snapshots[1][area], snapshots[0][area] * 1.25, area)
  })

  await test('color editor opens at full brightness on both platforms while apply, cancel and reset retain their meanings', async () => {
    for (const android of [false, true]) for (const saved of [null, '#123456']) {
      const { context, page } = await pageFor({ android, preferences: saved ? { 'firefly.accent.v1': saved } : {} })
      try {
        await theme(page)
        await page.getByLabel('打开色盘选择主题色').click()
        assert.equal(await page.locator('#color-brightness').inputValue(), '1')
        await page.locator('#color-brightness').fill('0.4')
        await page.getByRole('button', { name: '取消', exact: true }).click()
        assert.equal(await page.evaluate(() => localStorage.getItem('firefly.accent.v1')), saved)
        await page.getByLabel('打开色盘选择主题色').click()
        assert.equal(await page.locator('#color-brightness').inputValue(), '1')
        await page.locator('#color-brightness').fill('0.8')
        const chosen = (await page.locator('.color-preview strong').textContent()).toLowerCase()
        await page.getByRole('button', { name: '应用主题色', exact: true }).click()
        assert.equal(await page.evaluate(() => localStorage.getItem('firefly.accent.v1')), chosen)
        await page.getByLabel('打开色盘选择主题色').click()
        assert.equal(await page.locator('#color-brightness').inputValue(), '1')
        await page.getByRole('button', { name: '取消', exact: true }).click()
        assert.equal(await page.evaluate(() => localStorage.getItem('firefly.accent.v1')), chosen)
        await page.locator('.color-preference').getByRole('button', { name: '恢复默认', exact: true }).click()
        assert.equal(await page.evaluate(() => localStorage.getItem('firefly.accent.v1')), null)
      } finally { await context.close() }
    }
  })

  await test('explicit display modes ignore system changes and following the system resumes immediately', async () => {
    const { context, page } = await pageFor()
    try {
      await theme(page)
      await page.getByRole('button', { name: /^显示模式/ }).click()
      await page.getByRole('button', { name: /^深色/ }).click()
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark')
      await page.emulateMedia({ colorScheme: 'light' })
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark')
      await page.getByRole('button', { name: /^显示模式/ }).click()
      await page.getByRole('button', { name: /^跟随系统/ }).click()
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
      await page.emulateMedia({ colorScheme: 'dark' })
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
    } finally { await context.close() }
  })

  await test('wallpaper and startup preserve alpha and wallpaper survives disabling, reload and re-enabling', async () => {
    const { context, page } = await pageFor()
    try {
      await theme(page)
      for (const target of ['壁纸', '启动图']) {
        await selectImage(page, target)
        await page.getByRole('region', { name: `编辑${target}`, exact: true }).waitFor()
        await page.getByRole('button', { name: '保存并启用', exact: true }).click()
        await page.getByRole('region', { name: '应用主题', exact: true }).waitFor()
        const saved = await savedImage(page, target === '壁纸' ? 'readWallpaper' : 'readStartupImage')
        assert.equal(saved.type, 'image/png'); assert.equal(saved.alpha, 0)
      }
      await page.evaluate(async () => { const s = await import('/src/services/wallpaper.ts'); await s.saveSidebarImage(await s.readStartupImage()) })
      const original = await savedImage(page, 'readWallpaper')
      const wallpaper = page.locator('.wallpaper-preference')
      assert.equal(await wallpaper.getByRole('button', { name: '恢复默认', exact: true }).count(), 0)
      await wallpaper.getByRole('switch').click()
      assert.equal(await wallpaper.getByRole('switch').getAttribute('aria-checked'), 'false')
      assert.deepEqual(await savedImage(page, 'readWallpaper'), original)
      await page.reload(); await theme(page)
      assert.equal(await wallpaper.getByRole('switch').getAttribute('aria-checked'), 'false')
      await wallpaper.getByRole('switch').click()
      assert.equal(await wallpaper.getByRole('switch').getAttribute('aria-checked'), 'true')
      assert.deepEqual(await savedImage(page, 'readWallpaper'), original)
      assert.equal((await savedImage(page, 'readStartupImage')).type, 'image/png')
      assert.equal((await savedImage(page, 'readSidebarImage')).type, 'image/png')
    } finally { await context.close() }
  })

  await test('leaving the theme page cancels a pending decode instead of reopening the editor later', async () => {
    const { context, page } = await pageFor()
    try {
      await theme(page)
      await page.evaluate(() => {
        const OriginalImage = window.Image
        window.Image = function () {
          const image = new OriginalImage()
          Object.defineProperty(image, 'onload', { set(handler) { if (handler) image.addEventListener('load', () => { window.finishDecode = handler }, { once: true }) } })
          return image
        }
      })
      await selectImage(page)
      await page.waitForFunction(() => !!window.finishDecode)
      await page.locator('.nav-button').filter({ hasText: '更多设置' }).evaluate(button => button.click())
      await page.evaluate(() => window.finishDecode())
      await page.getByRole('region', { name: '更多设置', exact: true }).waitFor()
      assert.equal(await page.locator('.wallpaper-editor').count(), 0)
    } finally { await context.close() }
  })

  await test('saving locks the selected image target and prevents navigation until the write completes', async () => {
    const { context, page } = await pageFor()
    try {
      await theme(page); await selectImage(page, '壁纸')
      await page.locator('.wallpaper-editor').waitFor()
      await page.evaluate(() => {
        const original = HTMLCanvasElement.prototype.toBlob
        HTMLCanvasElement.prototype.toBlob = function (...args) { window.finishCrop = () => original.apply(this, args) }
      })
      await page.getByRole('button', { name: '保存并启用', exact: true }).click()
      await page.waitForFunction(() => !!window.finishCrop)
      assert.equal(await page.getByRole('button', { name: '取消', exact: true }).isDisabled(), true)
      await page.locator('.nav-button').filter({ hasText: '应用主题' }).evaluate(button => button.click())
      assert.equal(await page.locator('.wallpaper-editor').count(), 1)
      await page.evaluate(() => window.finishCrop())
      await page.getByRole('region', { name: '应用主题', exact: true }).waitFor()
      assert.equal((await savedImage(page, 'readWallpaper')).type, 'image/png')
      assert.equal(await savedImage(page, 'readStartupImage'), null)
      assert.equal(await savedImage(page, 'readSidebarImage'), null)
    } finally { await context.close() }
  })

  await test('resizing the window does not change the crop aspect ratio during corner dragging', async () => {
    const { context, page } = await pageFor()
    try {
      await theme(page); await selectImage(page, '壁纸'); await page.locator('.wallpaper-crop').waitFor()
      const ratio = await page.locator('.wallpaper-crop').evaluate(node => node.clientWidth / node.clientHeight)
      await page.setViewportSize({ width: 800, height: 900 })
      const handle = page.locator('.wallpaper-crop-handle-bottom-right')
      await handle.scrollIntoViewIfNeeded()
      const box = await handle.boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down()
      await page.mouse.move(box.x - 30, box.y - 10); await page.mouse.up()
      const after = await page.locator('.wallpaper-crop').evaluate(node => node.clientWidth / node.clientHeight)
      assert(Math.abs(ratio - after) < .04, `${ratio} → ${after}`)
    } finally { await context.close() }
  })

  await test('a failed IndexedDB image write keeps the existing image and leaves the editor available for retry', async () => {
    const { context, page } = await pageFor()
    try {
      await theme(page); await selectImage(page, '壁纸'); await page.locator('.wallpaper-editor').waitFor()
      await page.getByRole('button', { name: '保存并启用', exact: true }).click()
      await page.getByRole('region', { name: '应用主题', exact: true }).waitFor()
      const previous = await savedImage(page, 'readWallpaper')
      await selectImage(page, '壁纸'); await page.locator('.wallpaper-editor').waitFor()
      await page.evaluate(() => { IDBObjectStore.prototype.put = () => { throw new DOMException('quota', 'QuotaExceededError') } })
      await page.getByRole('button', { name: '保存并启用', exact: true }).click()
      await page.getByText('保存壁纸失败，请重试', { exact: true }).waitFor()
      assert.deepEqual(await savedImage(page, 'readWallpaper'), previous)
      assert.equal(await page.getByRole('button', { name: '保存并启用', exact: true }).isDisabled(), false)
    } finally { await context.close() }
  })

  await test('blocked startup image storage falls back to a skippable Android splash instead of freezing the app', async () => {
    const { context, page } = await pageFor({ android: true, blockedStorage: true })
    try {
      await page.locator('.startup-splash-skip').click()
      assert.equal(await page.locator('.app-shell').evaluate(node => node.inert), false)
      await theme(page)
    } finally { await context.close() }
  })

  await test('theme persistence failures are visible and narrow layouts fit with all image controls and larger text', async () => {
    const { context, page } = await pageFor({ width: 390, preferences: { 'firefly.app-font-size.v1': '125' } })
    try {
      await theme(page); await selectImage(page, '壁纸'); await page.locator('.wallpaper-editor').waitFor()
      await page.getByRole('button', { name: '保存并启用', exact: true }).click()
      await page.getByRole('region', { name: '应用主题', exact: true }).waitFor()
      for (const width of [320, 360, 390, 430, 1280]) {
        await page.setViewportSize({ width, height: 900 })
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width}px`)
      }
      await page.evaluate(() => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function (key, value) { if (key === 'firefly.theme.v1') throw new DOMException('quota', 'QuotaExceededError'); return original.call(this, key, value) } })
      await page.getByRole('button', { name: /^显示模式/ }).click()
      await page.getByRole('button', { name: /^深色/ }).click()
      await page.getByText(/设置未能保存到本机/).waitFor()
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark')
    } finally { await context.close() }
  })
} finally {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
}
