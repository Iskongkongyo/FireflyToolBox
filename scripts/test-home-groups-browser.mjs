import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { chromium } from 'playwright-core'

const root = path.resolve('dist')
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname))
  if (!file.startsWith(root + path.sep)) { response.writeHead(404); response.end(); return }
  try {
    response.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream')
    response.end(await readFile(file))
  } catch { response.writeHead(404); response.end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const browser = await chromium.launch({ headless: true, executablePath: process.env.FIREFLY_TEST_BROWSER || (existsSync(chrome) ? chrome : 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe') })
const empty = () => ({ names: {}, custom: [], deleted: [], assignments: {}, otherCreated: false })
async function pageFor({ width = 1280, settings = empty(), existing = false, web = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 } })
  const page = await context.newPage()
  await page.addInitScript(({ settings, existing, web }) => {
    if (localStorage.getItem('firefly.groups.home.v1') === null) localStorage.setItem('firefly.groups.home.v1', JSON.stringify(settings))
    const text = { id: 'json.format', name: 'JSON 格式化', description: '', category: '开发与文本', builtin: true, custom: false, pipeline_compatible: true, aliases: [], tags: [], actions: [{ id: 'format', label: '格式化', consumes_input: true }] }
    const descriptor = tool => ({ ...text, ...tool, category: '自定义工具', builtin: false, custom: true, pipeline_compatible: false, actions: [{ id: 'run', label: '运行' }] })
    const custom = existing ? [{ id: 'custom.1', name: '已有流程', steps: [{ tool_id: text.id, action: 'format' }] }] : []
    const tools = [text, ...custom.map(descriptor)]
    if (web) tools.push({ ...text, id: 'local.web.main', name: '网页回归', category: '自定义工具', builtin: false, custom: false, ui_kind: 'web', module_id: 'local.web', pipeline_compatible: false })
    window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
      if (command === 'list_tools') return tools
      if (command === 'list_custom_tools') return custom
      if (command === 'save_custom_tool') { const saved = { ...args.tool, id: 'custom.1' }; custom.push(saved); tools.push(descriptor(saved)); return saved }
      if (['list_favorites', 'list_recent_tools', 'list_modules', 'list_websites'].includes(command)) return []
      return null
    } }
  }, { settings, existing, web })
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.waitForFunction(() => { const app = document.querySelector('.app-shell'); return app && getComputedStyle(app).display !== 'none' })
  return { context, page }
}
const navigate = (page, name) => page.locator('.nav-button').filter({ hasText: name }).evaluate(button => button.click())
const sourceGroup = page => page.locator('.home-categories > [data-group-id="source:自定义工具"]')
try {
  await test('creating automation in Ungrouped never leaves an empty Custom Tools source group', async () => {
    for (const width of [1280, 390]) {
      const { context, page } = await pageFor({ width })
      try {
        await navigate(page, '工具管理')
        await page.getByRole('button', { name: '创建自动化工具', exact: true }).click()
        await page.locator('#custom-name').fill('自动化回归')
        await page.getByRole('button', { name: '保存工具', exact: true }).click()
        await page.locator('.editor-open .tool-title').filter({ hasText: '自动化回归' }).waitFor()
        await navigate(page, '首页')
        assert.equal(await sourceGroup(page).count(), 0)
        assert.match(await page.locator('.home-categories [data-group-id="home:other"]').textContent(), /自动化回归/)
        await navigate(page, '分组管理')
        assert.equal(await page.locator('.group-manager-card[data-swap-id="source:自定义工具"]').count(), 0)
      } finally { await context.close() }
    }
  })
  await test('existing real membership and explicitly named or manually created groups survive', async () => {
    for (const settings of [empty(), { ...empty(), names: { 'source:自定义工具': '我的流程' }, assignments: { 'custom.1': 'home:other' } },
      { ...empty(), custom: [{ id: 'home:mine', name: '自定义工具' }], assignments: { 'custom.1': 'home:other' } }]) {
      const { context, page } = await pageFor({ settings, existing: true })
      try {
        if (settings.custom.length) {
          assert.equal(await sourceGroup(page).count(), 0)
          assert.equal(await page.locator('.home-categories [data-group-id="home:mine"]').count(), 1)
        } else {
          assert.equal(await sourceGroup(page).count(), 1)
          assert.match(await sourceGroup(page).textContent(), settings.names['source:自定义工具'] ? /我的流程/ : /已有流程/)
        }
      } finally { await context.close() }
    }
  })
  await test('moving the last web tool hides automatic groups on both layouts and survives reload', async () => {
    for (const width of [1280, 390]) for (const ungrouped of [true, false]) {
      const settings = { ...empty(), otherCreated: true, assignments: ungrouped ? { 'local.web.main': 'home:other' } : {} }
      const { context, page } = await pageFor({ width, settings, web: true })
      try {
        const origin = ungrouped ? 'home:other' : 'source:自定义工具'
        assert.equal(await page.locator(`.home-categories > [data-group-id="${origin}"]`).count(), 1)
        await navigate(page, '分组管理')
        await page.locator('.group-manager-card[data-group-id="source:开发与文本"] .group-manager-card-toggle').click()
        await page.getByRole('button', { name: '选择工具加入开发与文本', exact: true }).click()
        await page.getByRole('option', { name: /^网页回归 · / }).click()
        assert.equal(await page.locator('.group-manager-card[data-group-id="home:other"]').count(), 1)
        await navigate(page, '首页')
        for (const id of ['home:other', 'source:自定义工具']) assert.equal(await page.locator(`.home-categories > [data-group-id="${id}"]`).count(), 0)
        await page.reload()
        await page.waitForFunction(() => !!document.querySelector('.home-categories'))
        for (const id of ['home:other', 'source:自定义工具']) assert.equal(await page.locator(`.home-categories > [data-group-id="${id}"]`).count(), 0)
        await navigate(page, '分组管理')
        await page.locator('.group-manager-card[data-group-id="source:开发与文本"] .group-manager-card-toggle').click()
        await page.getByRole('button', { name: '将网页回归移到未分组', exact: true }).click()
        await navigate(page, '首页')
        assert.equal(await page.locator('.home-categories > [data-group-id="home:other"]').count(), 1)
      } finally { await context.close() }
    }
  })
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
