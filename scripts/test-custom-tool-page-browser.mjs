import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { readFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { chromium } from 'playwright-core'

let server, browser, origin
const directory = path.resolve('target-check/custom-tool-page')
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

async function fixture(t, width = 390) {
  const context = await browser.newContext({ viewport: { width, height: 900 } }); t.after(() => context.close())
  const page = await context.newPage(), errors = []
  page.setDefaultTimeout(10000)
  page.on('pageerror', error => errors.push(error.message)); t.after(() => assert.deepEqual(errors, []))
  await page.addInitScript(() => {
    const text = { description: '', category: '开发与文本', builtin: true, custom: false, pipeline_compatible: true, ui_kind: 'text', aliases: [], tags: [] }
    const tools = [
      { ...text, id: 'text.case', name: '大小写转换', actions: [{ id: 'upper', label: '大写' }, { id: 'lower', label: '小写' }] },
      { ...text, id: 'base64.convert', name: 'Base64 编解码', actions: [{ id: 'encode', label: '编码' }, { id: 'decode', label: '解码' }] },
    ]
    const custom = []
    window.saveCalls = []; window.failSave = false; window.delaySave = false
    window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
      if (command === 'list_tools') return structuredClone(tools)
      if (command === 'list_custom_tools') return structuredClone(custom)
      if (['list_favorites', 'list_recent_tools', 'list_modules', 'list_websites'].includes(command)) return []
      if (command === 'save_custom_tool') {
        window.saveCalls.push(JSON.parse(JSON.stringify(args.tool)))
        if (window.delaySave) await new Promise(resolve => window.releaseSave = resolve)
        if (window.failSave) throw new Error('测试保存失败，请重试')
        const saved = { ...JSON.parse(JSON.stringify(args.tool)), id: args.tool.id || 'custom.page-test' }
        const index = custom.findIndex(tool => tool.id === saved.id)
        if (index < 0) custom.push(saved); else custom[index] = saved
        const descriptor = { ...text, ...saved, builtin: false, custom: true, pipeline_compatible: false, actions: [{ id: 'run', label: '运行' }] }
        const toolIndex = tools.findIndex(tool => tool.id === saved.id)
        if (toolIndex < 0) tools.push(descriptor); else tools[toolIndex] = descriptor
        return saved
      }
      return null
    } }
  })
  await page.goto(origin)
  await page.locator('.nav-button').filter({ hasText: '工具管理' }).evaluate(button => button.click())
  await page.getByRole('button', { name: '创建自动化工具', exact: true }).click()
  await page.locator('#custom-name').waitFor()
  return page
}
async function choose(page, label, option) {
  await page.getByRole('button', { name: label, exact: true }).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}
const back = page => page.locator('.top-title .top-icon-button').click()

for (const width of [320, 390, 1280]) test(`automation has a standalone page and preserves metadata and ordered steps when saving at ${width}px`, async t => {
  const page = await fixture(t, width)
  if (width === 320) await page.evaluate(() => document.documentElement.style.setProperty('--app-font-scale', '1.25'))
  assert.equal(await page.locator('dialog[open]').count(), 0)
  assert.equal(await page.locator('.top-title .tool-title').textContent(), '创建自动化工具')
  await page.locator('#custom-name').fill('页面自动化')
  await page.locator('#custom-description').fill('按步骤处理文字')
  await page.locator('#custom-tags').fill('编码，文本,编码')
  await choose(page, '选择内置图标', '代码')
  await page.getByRole('button', { name: '添加步骤', exact: true }).click()
  await choose(page, '第 2 步工具', 'Base64 编解码')
  await page.getByRole('button', { name: '上移第 2 步', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: '第 1 步工具', exact: true }).textContent(), 'Base64 编解码')
  await page.getByRole('button', { name: '删除第 2 步', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: '删除第 1 步', exact: true }).isDisabled(), true)
  for (let step = 1; step < 8; step++) await page.getByRole('button', { name: '添加步骤', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: '添加步骤', exact: true }).isDisabled(), true)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ path: path.join(directory, `creator-${width}.png`) })
  await page.getByRole('button', { name: '保存工具', exact: true }).click()
  await page.locator('.editor-open .tool-title').filter({ hasText: '页面自动化' }).waitFor()
  const saved = await page.evaluate(() => window.saveCalls[0])
  assert.equal(saved.name, '页面自动化'); assert.equal(saved.description, '按步骤处理文字'); assert.equal(saved.icon, 'code')
  assert.deepEqual(saved.tags, ['编码', '文本']); assert.equal(saved.steps.length, 8); assert.deepEqual(saved.steps[0], { tool_id: 'base64.convert', action: 'encode' })
  await back(page)
  assert.equal(await page.locator('.top-title .tool-title').textContent(), '工具管理')
})

test('return and cancel discard unsaved automation without saving and preserve the manager history', async t => {
  const page = await fixture(t)
  await page.locator('#custom-name').fill('不应保存')
  await page.evaluate(() => window.dispatchEvent(new Event('firefly:native-back')))
  await page.getByRole('button', { name: '创建自动化工具', exact: true }).waitFor()
  await page.getByRole('button', { name: '创建自动化工具', exact: true }).click()
  assert.equal(await page.locator('#custom-name').inputValue(), '')
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('button', { name: '创建自动化工具', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.saveCalls.length), 0)
  await back(page)
  assert.equal(await page.locator('.top-title .top-brand').count(), 1)
})

test('saving blocks duplicate submission and navigation, and a failure keeps the form retryable', async t => {
  const page = await fixture(t)
  await page.locator('#custom-name').fill('保存重试')
  await page.evaluate(() => { window.delaySave = true; window.failSave = true })
  await page.getByRole('button', { name: '保存工具', exact: true }).click()
  await page.waitForFunction(() => typeof window.releaseSave === 'function')
  assert.equal(await page.locator('#custom-name').isDisabled(), true)
  assert.equal(await page.locator('.top-title .top-icon-button').isDisabled(), true)
  await page.evaluate(() => { document.getElementById('custom-tool-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); window.dispatchEvent(new Event('firefly:native-back')) })
  assert.equal(await page.locator('#custom-tool-form').count(), 1)
  assert.equal(await page.evaluate(() => window.saveCalls.length), 1)
  await page.evaluate(() => { window.releaseSave(); window.delaySave = false })
  await page.getByRole('alert').filter({ hasText: '测试保存失败' }).waitFor()
  assert.equal(await page.locator('#custom-name').inputValue(), '保存重试')
  await page.evaluate(() => window.failSave = false)
  await page.getByRole('button', { name: '保存工具', exact: true }).click()
  await page.locator('.editor-open .tool-title').filter({ hasText: '保存重试' }).waitFor()
})

test('editing returns to the original tool and input, updates in place, and does not leave editor history behind', async t => {
  const page = await fixture(t)
  await page.locator('#custom-name').fill('编辑页面')
  await page.getByRole('button', { name: '保存工具', exact: true }).click()
  await page.locator('#tool-input').fill('保留输入内容')
  await page.getByRole('button', { name: '编辑自动化工具', exact: true }).click()
  assert.equal(await page.locator('.top-title .tool-title').textContent(), '编辑自动化工具')
  await page.locator('#custom-name').fill('取消修改')
  await back(page)
  assert.equal(await page.locator('#tool-input').inputValue(), '保留输入内容')
  assert.equal(await page.locator('.top-title .tool-title').textContent(), '编辑页面')
  await page.getByRole('button', { name: '编辑自动化工具', exact: true }).click()
  assert.equal(await page.locator('#custom-name').inputValue(), '编辑页面')
  await page.locator('#custom-name').fill('已更新的页面')
  await page.getByRole('button', { name: '保存工具', exact: true }).click()
  await page.locator('.editor-open .tool-title').filter({ hasText: '已更新的页面' }).waitFor()
  assert.equal(await page.locator('#tool-input').inputValue(), '保留输入内容')
  assert.equal(await page.evaluate(() => window.saveCalls[1].id), 'custom.page-test')
  await back(page)
  assert.equal(await page.locator('.top-title .tool-title').textContent(), '工具管理')
})

test('editing from tool management returns to tool management after saving', async t => {
  const page = await fixture(t)
  await page.locator('#custom-name').fill('管理入口编辑')
  await page.getByRole('button', { name: '保存工具', exact: true }).click()
  await page.locator('.editor-open .tool-title').filter({ hasText: '管理入口编辑' }).waitFor()
  await back(page)
  await page.getByRole('button', { name: '更多工具操作', exact: true }).click()
  await page.getByRole('menuitem', { name: '编辑工具', exact: true }).click()
  await page.locator('.all-tool-item').filter({ hasText: '管理入口编辑' }).click()
  await page.locator('#custom-name').fill('已通过管理入口修改')
  await page.getByRole('button', { name: '保存工具', exact: true }).click()
  await page.getByRole('button', { name: '创建自动化工具', exact: true }).waitFor()
  assert.equal(await page.locator('.top-title .tool-title').textContent(), '工具管理')
  assert.equal(await page.locator('.all-tool-item').filter({ hasText: '已通过管理入口修改' }).count(), 1)
})
