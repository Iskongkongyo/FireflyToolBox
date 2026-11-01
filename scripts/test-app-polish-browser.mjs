import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createServer } from 'node:http'
import { chromium } from 'playwright-core'
import { mockAndroidShell } from './android-shell-fixture.mjs'

const disclaimer = '本项目为个人开源项目，与米哈游（HoYoverse）无关。所以涉及的游戏角色名称及图标设计版权归米哈游所有。'
const shortcutMessage = '已向桌面发起请求，请返回桌面查看目标应用是否已创建。若目标应用不存在，请打开应用授权页面并查看下是否给本应用授予相关权限！'
const manifest = JSON.parse(await readFile('examples/modules/reverse/manifest.json', 'utf8'))
const scripts = Object.fromEntries(await Promise.all(['main.js', 'helper.js'].map(async name => [name, await readFile('examples/modules/reverse/' + name, 'utf8')])))
const dist = path.resolve('dist'), shots = path.resolve('target-check/app-polish/browser')
await mkdir(shots, { recursive: true })
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname, file = path.resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname))
  try {
    if (!file.startsWith(dist + path.sep)) throw new Error()
    response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream')
    response.end(await readFile(file))
  } catch { response.writeHead(404).end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ headless: true, executablePath: existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe') ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' })
async function app(width, work) {
  const android = width < 1000, context = await browser.newContext({ viewport: { width, height: 900 }, ...(android ? { userAgent: 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36' } : {}) })
  context.setDefaultTimeout(8000)
  try {
    const page = await context.newPage(), errors = []
    page.on('pageerror', error => errors.push(error.message))
    if (android) await page.addInitScript(mockAndroidShell)
    await page.addInitScript(({ manifest, scripts, android }) => {
      window.isTauri = true; localStorage.setItem('firefly.startup-splash-enabled.v1', 'false')
      const setItem = Storage.prototype.setItem
      Storage.prototype.setItem = function(key, value) { if (window.failDraft && key === 'firefly.tool-creator.draft.v1') throw new Error('Storage full'); return setItem.call(this, key, value) }
      const details = { manifest, scripts, builtin: false, modified: false }
      window.details = { [manifest.module_id]: details }; window.calls = []
      const summary = detail => ({ module_id: detail.manifest.module_id, name: detail.manifest.name['zh-CN'], version: detail.manifest.version, author: detail.manifest.author, tools: detail.manifest.tools.map(tool => tool.name['zh-CN']), tool_ids: detail.manifest.tools.map(tool => tool.id), categories: ['效率工具'], network_hosts: [], builtin: false, modified: false })
      const tools = () => Object.values(window.details).flatMap(detail => detail.manifest.tools.map(tool => ({ ...tool, name: tool.name['zh-CN'], description: tool.description['zh-CN'], builtin: false, custom: false, module_id: detail.manifest.module_id, ui_kind: tool.ui.kind, actions: tool.actions.map(action => ({ ...action, label: action.label['zh-CN'] })) })))
      window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, transformCallback: () => 1, unregisterCallback() {}, async invoke(command, args) {
        window.calls.push({ command, args })
        if (command === 'list_tools') return tools()
        if (command === 'list_modules') return Object.values(window.details).map(summary)
        if (command === 'get_module_details') return structuredClone(window.details[args.moduleId])
        if (command === 'install_module_draft') {
          if (window.failInstall) throw new Error(window.failInstall)
          const detail = { manifest: args.manifest, scripts: args.scripts, builtin: false, modified: false }
          window.details[args.manifest.module_id] = structuredClone(detail); return summary(detail)
        }
        if (command === 'export_module_file' && window.failExport) throw new Error(window.failExport)
        if (command === 'plugin:dialog|save') return 'fixture.fftool'
        if (command === 'create_tool_shortcut') return android ? 'requested' : 'created'
        if (command === 'fetch_remote_messages') return { configured: false, update: null, notification: null }
        if (command === 'desktop_close_behavior') return 'tray'
        if (command === 'desktop_autostart_enabled') return false
        return ['list_favorites', 'list_recent_tools', 'list_websites', 'list_custom_tools'].includes(command) ? [] : null
      } }
    }, { manifest, scripts, android })
    await page.goto(origin)
    const nav = name => page.locator('.nav-button').filter({ hasText: name }).evaluate(button => button.click())
    await work({ page, nav })
    assert.deepEqual(errors, [])
  } finally { await context.close() }
}
async function studio(page, nav, tab) {
  await nav('工具管理'); await page.getByRole('button', { name: '打开工具工作台', exact: true }).click()
  await page.locator('#studio-tab-' + tab).click()
}
async function bottomToast(page, text) {
  const toast = page.locator('.toast:popover-open').filter({ hasText: text }); await toast.waitFor()
  const rect = await toast.boundingBox()
  assert(rect.y > 450 && rect.y + rect.height <= 901, JSON.stringify(rect))
  assert.equal(await page.locator('.module-studio-content > .module-page-error, .module-studio-content > .module-studio-notice').count(), 0)
}
try {
  await test('PC splash requests native dragging while images cannot start an HTML drag and skip remains clickable', async () => {
    const context = await browser.newContext({ viewport: { width: 1120, height: 760 } })
    try {
      const page = await context.newPage()
      await page.addInitScript(() => {
        window.dragCalls = 0; window.finishCalls = 0
        window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'splashscreen' }, currentWebview: { label: 'splashscreen' } }, invoke: async command => { if (command === 'plugin:window|start_dragging') window.dragCalls++; if (command === 'finish_splash') window.finishCalls++ } }
      })
      await page.goto(origin + '/splash.html'); await page.locator('.startup-splash-image').waitFor()
      assert.equal(await page.locator('.startup-splash-image').evaluate(node => node.draggable), false)
      assert.equal(await page.locator('.startup-splash-image').evaluate(node => node.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true }))), false)
      await page.locator('.startup-splash').dispatchEvent('mousedown', { button: 0, detail: 1 })
      await page.waitForFunction(() => window.dragCalls === 1)
      await page.locator('.startup-splash').dispatchEvent('mousedown', { button: 2, detail: 1 })
      await page.locator('.startup-splash').dispatchEvent('mousedown', { button: 0, detail: 2 })
      await page.locator('.startup-splash-skip').click()
      await page.waitForFunction(() => window.finishCalls === 1)
      assert.equal(await page.evaluate(() => window.dragCalls), 1)
    } finally { await context.close() }
  })
  for (const width of [320, 390, 1280]) {
    await test(`about disclaimer sits between two separators at ${width}px`, async () => app(width, async ({ page, nav }) => {
      await nav('关于应用'); const text = page.locator('.about-disclaimer p'); await text.waitFor()
      assert.equal(await text.textContent(), disclaimer)
      const links = page.locator('.about-links .about-link')
      assert.equal(await links.count(), 3)
      assert.match(await links.nth(0).textContent(), /检查更新/)
      assert.match(await links.nth(1).textContent(), /项目源码/)
      assert.match(await links.nth(2).textContent(), /官方网站/)
      await links.nth(1).click()
      assert.equal(await page.evaluate(() => window.calls.filter(call => call.command === 'plugin:opener|open_url').at(-1)?.args.url), 'https://github.com/Iskongkongyo/FireflyToolBox')
      await links.nth(2).click()
      assert.equal(await page.evaluate(() => window.calls.filter(call => call.command === 'plugin:opener|open_url').at(-1)?.args.url), 'https://firefly.202132.xyz')
      const borders = await page.evaluate(() => ({ first: getComputedStyle(document.querySelector('.about-disclaimer')).borderTopWidth, second: getComputedStyle(document.querySelector('.about-links')).borderTopWidth, text: document.querySelector('.about-disclaimer p').getBoundingClientRect().bottom, cards: document.querySelector('.about-links').getBoundingClientRect().top }))
      assert.equal(borders.first, '1px'); assert.equal(borders.second, '1px'); assert(borders.text < borders.cards)
      await page.evaluate(() => document.documentElement.style.setProperty('--app-font-scale', '1.25'))
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      await page.screenshot({ path: path.join(shots, `about-${width}.png`), fullPage: true })
    }))
  }
  for (const width of [390, 1280]) {
    await test(`create failures repeat as bottom messages and successful installation stays in the creator at ${width}px`, async () => app(width, async ({ page, nav }) => {
      await studio(page, nav, 'create'); await page.locator('#tool-creation-name').fill('创建反馈测试')
      await page.evaluate(() => window.failInstall = '安装失败回归消息')
      const submit = page.locator('#studio-panel-create button[type="submit"]')
      await submit.click(); await bottomToast(page, '安装失败回归消息')
      await page.waitForTimeout(600); await bottomToast(page, '安装失败回归消息')
      await page.locator('.toast:popover-open').filter({ hasText: '安装失败回归消息' }).waitFor({ state: 'hidden', timeout: 5000 })
      await submit.click(); await bottomToast(page, '安装失败回归消息')
      assert.equal(await page.locator('#tool-creation-name').inputValue(), '创建反馈测试')
      await page.evaluate(() => window.failInstall = ''); await submit.click(); await bottomToast(page, '已安装')
      assert.equal(await page.locator('#studio-tab-create').getAttribute('aria-selected'), 'true')
      await page.screenshot({ path: path.join(shots, `create-feedback-${width}.png`) })
    }))
    await test(`installed metadata, source and export errors use bottom messages at ${width}px`, async () => app(width, async ({ page, nav }) => {
      await studio(page, nav, 'installed'); await page.locator('#studio-library-module').click()
      await page.locator('#studio-library-module-list button').first().click()
      await page.getByRole('button', { name: '修改信息', exact: true }).click()
      await page.evaluate(() => window.failInstall = '信息保存失败回归消息')
      await page.locator('.module-studio-metadata-form button[type="submit"]').click(); await bottomToast(page, '信息保存失败回归消息')
      await page.evaluate(() => window.failInstall = '')
      await page.locator('.module-studio-metadata-form button[type="submit"]').click(); await bottomToast(page, '的信息')
      await page.getByRole('button', { name: '编辑源码', exact: true }).click()
      await page.locator('.installed-source-editor .tool-advanced-settings summary').click()
      await page.getByRole('textbox', { name: '工具包清单 JSON' }).fill('{')
      await page.locator('.installed-source-editor button[type="submit"]').click(); await bottomToast(page, '清单 JSON 格式无效')
      assert.equal(await page.locator('.installed-source-editor > .editor-status.error').count(), 0)
      await page.locator('.installed-source-editor .module-studio-detail-actions').getByRole('button', { name: '取消', exact: true }).click()
      await page.evaluate(() => window.failExport = '导出失败回归消息')
      await page.getByRole('button', { name: '导出 .fftool', exact: true }).click(); await bottomToast(page, '导出失败回归消息')
      await page.evaluate(() => window.failExport = '')
      await page.getByRole('button', { name: '导出 .fftool', exact: true }).click(); await bottomToast(page, '已导出')
    }))
  }
  await test('Android shortcut permission and requested-result cards use the supplied text', async () => app(390, async ({ page, nav }) => {
    await nav('快捷方式'); assert.equal((await page.locator('.shortcut-permission-card p').textContent()).includes('部分手机'), false)
    await page.getByRole('button', { name: '对应工具', exact: true }).click()
    await page.getByRole('option', { name: manifest.tools[0].name['zh-CN'], exact: true }).click()
    await page.getByRole('button', { name: '创建快捷方式', exact: true }).click()
    await page.getByText(shortcutMessage, { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.screenshot({ path: path.join(shots, 'shortcut-390.png'), fullPage: true })
  }))
  await test('draft persistence failures and recovery surface at the bottom without replacing the draft', async () => app(390, async ({ page, nav }) => {
    await studio(page, nav, 'create'); await page.evaluate(() => window.failDraft = true)
    await page.locator('#tool-creation-name').fill('草稿存储失败测试')
    await bottomToast(page, '草稿暂未保存到本机')
    assert.equal(await page.locator('#tool-creation-name').inputValue(), '草稿存储失败测试')
    assert.equal((await page.locator('.tool-draft-notice').textContent()).includes('失败'), false)
    await page.evaluate(() => window.failDraft = false)
    await page.locator('#tool-creation-name').fill('草稿恢复测试')
    await bottomToast(page, '草稿已保存在本机')
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('firefly.tool-creator.draft.v1')).draft.toolName), '草稿恢复测试')
    await page.reload(); await studio(page, nav, 'create')
    await bottomToast(page, '已恢复本机草稿')
    assert.equal(await page.locator('#tool-creation-name').inputValue(), '草稿恢复测试')
  }))
} finally { await browser.close(); server.close() }
