import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { connectWindows } from './windows-test-client.mjs'
import { connectAndroid } from './android-device-client.mjs'

const windows = process.argv.includes('--windows'), client = await (windows ? connectWindows() : connectAndroid())
const directory = path.resolve('target-check/custom-tool-page', windows ? 'windows' : client.device('get-serialno'))
await mkdir(directory, { recursive: true })
const name = `自动化页面测试-${crypto.randomUUID()}`, report = { platform: windows ? 'windows' : 'android', checks: [], cleaned: false }
const keys = ['firefly.groups.home.v1', 'firefly.usage-stats.v1']
let id
async function wait(fn, ...args) {
  for (let attempt = 0; attempt < 150; attempt++) { if (await client.evaluate(fn, ...args)) return; await new Promise(resolve => setTimeout(resolve, 100)) }
  throw new Error(`Timed out: ${fn}`)
}
async function click(label) {
  await client.evaluate(label => [...document.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === label || button.textContent.trim() === label).click(), label)
}
async function field(selector, value) {
  await client.evaluate((selector, value) => { const node = document.querySelector(selector); node.value = value; node.dispatchEvent(new Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) }, selector, value)
}
async function choose(label, option) {
  await click(label)
  await wait(option => [...document.querySelectorAll('[role=option]')].some(button => button.textContent.trim() === option), option)
  await client.evaluate(option => [...document.querySelectorAll('[role=option]')].find(button => button.textContent.trim() === option).click(), option)
}
async function check(title, run) { await run(); report.checks.push(title); console.log('PASS:', title) }
async function capture(filename) { const shot = await client.call('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(directory, filename), Buffer.from(shot.data, 'base64')) }
async function nativeBack() {
  if (windows) await client.evaluate(() => window.dispatchEvent(new Event('firefly:native-back')))
  else client.device('shell', 'input', 'keyevent', '4')
}
async function editor() { await wait(() => !!document.getElementById('tool-input') && !!document.querySelector('.editor-open')) }
try {
  await wait(() => { const app = document.querySelector('.app-shell'); return document.visibilityState === 'visible' && app && !app.inert && getComputedStyle(app).display !== 'none' })
  await client.evaluate(keys => {
    window.customPageTestPreferences = Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)]))
    localStorage.setItem('firefly.usage-stats.v1', 'false')
    sessionStorage.setItem('firefly.custom-page-test.preferences', JSON.stringify(window.customPageTestPreferences))
  }, keys)
  await client.call('Page.reload')
  await wait(() => { const app = document.querySelector('.app-shell'); return document.visibilityState === 'visible' && app && !app.inert && getComputedStyle(app).display !== 'none' })
  await client.evaluate(() => [...document.querySelectorAll('.nav-button')].find(button => button.textContent.trim() === '工具管理').click())
  await wait(() => !!document.getElementById('open-custom-tool'))
  await check('creation opens an independent page and native Back returns without saving', async () => {
    await click('创建自动化工具'); await wait(() => !!document.getElementById('custom-tool-form'))
    assert.equal(await client.evaluate(() => !!document.querySelector('dialog[open]')), false)
    await field('#custom-name', '取消本次测试')
    await nativeBack(); await wait(() => !!document.getElementById('open-custom-tool'))
    await click('创建自动化工具'); await wait(() => !!document.getElementById('custom-name'))
    assert.equal(await client.evaluate(() => document.getElementById('custom-name').value), '')
  })
  await check('metadata, eight-step limit, ordering and narrow-screen layout work on the page', async () => {
    await field('#custom-name', name); await field('#custom-description', '真实界面创建并运行'); await field('#custom-tags', '文本，测试,文本')
    await choose('第 1 步工具', '大小写转换'); await field('.custom-step select', 'upper')
    await choose('选择内置图标', '代码')
    await click('添加步骤'); await choose('第 2 步工具', 'Base64 编解码')
    await click('上移第 2 步'); await click('下移第 1 步')
    for (let count = 2; count < 8; count++) await click('添加步骤')
    assert.equal(await client.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === '添加步骤').disabled), true)
    await client.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    assert.equal(await client.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    for (let count = 8; count > 2; count--) await click(`删除第 ${count} 步`)
    await capture('creator.png')
  })
  await check('the real save persists metadata and both steps, and the created automation executes', async () => {
    await click('保存工具'); await editor()
    const tool = (await client.invoke('list_custom_tools')).find(tool => tool.name === name)
    assert(tool); id = tool.id
    assert.equal(tool.icon, 'code'); assert.deepEqual(tool.tags, ['文本', '测试'])
    assert.deepEqual(tool.steps, [{ tool_id: 'text.case', action: 'upper' }, { tool_id: 'base64.convert', action: 'encode' }])
    await field('#tool-input', 'Hello 流萤')
    await client.evaluate(() => document.querySelector('.editor-actions .primary-button').click())
    const expected = Buffer.from('Hello 流萤'.toUpperCase()).toString('base64')
    await wait(expected => document.getElementById('tool-output')?.value === expected, expected)
  })
  await check('editing uses the independent page and system return preserves the original input and output', async () => {
    await click('编辑自动化工具'); await wait(() => !!document.getElementById('custom-name'))
    assert.equal(await client.evaluate(() => document.querySelector('.top-title .tool-title').textContent), '编辑自动化工具')
    await field('#custom-name', '不保存的修改')
    await nativeBack(); await editor()
    assert.equal(await client.evaluate(() => document.getElementById('tool-input').value), 'Hello 流萤')
    assert.equal(await client.evaluate(() => document.getElementById('tool-output').value), Buffer.from('Hello 流萤'.toUpperCase()).toString('base64'))
  })
  await check('editing updates the same record and returns to its tool, then back to tool management', async () => {
    await click('编辑自动化工具'); await wait(() => !!document.getElementById('custom-name'))
    assert.equal(await client.evaluate(() => document.getElementById('custom-name').value), name)
    await field('#custom-description', '已通过独立编辑页更新')
    await click('保存工具'); await editor()
    assert.equal((await client.invoke('list_custom_tools')).find(tool => tool.id === id).description, '已通过独立编辑页更新')
    assert.equal(await client.evaluate(() => document.getElementById('tool-input').value), 'Hello 流萤')
    await nativeBack(); await wait(() => !!document.getElementById('open-custom-tool'))
    await capture('manager.png')
  })
  await check('editing from tool management saves back to tool management', async () => {
    await click('更多工具操作'); await click('编辑工具')
    await client.evaluate(name => [...document.querySelectorAll('.all-tool-item')].find(button => button.textContent.includes(name)).click(), name)
    await wait(() => !!document.getElementById('custom-name'))
    await field('#custom-description', '管理入口更新成功')
    await click('保存工具'); await wait(() => !!document.getElementById('open-custom-tool'))
    assert.equal((await client.invoke('list_custom_tools')).find(tool => tool.id === id).description, '管理入口更新成功')
  })
} catch (error) {
  await writeFile(path.join(directory, 'error.txt'), String(error.stack || error))
  try { await capture('error.png') } catch { /* Keep the original failure. */ }
  throw error
} finally {
  try {
    // Discover a just-saved record even if a UI assertion failed before its ID was read.
    const created = (await client.invoke('list_custom_tools')).filter(tool => tool.id === id || tool.name === name)
    for (const tool of created) await client.invoke('delete_custom_tool', { id: tool.id })
    await client.evaluate(() => {
      const saved = JSON.parse(sessionStorage.getItem('firefly.custom-page-test.preferences') || 'null')
      if (saved) for (const [key, value] of Object.entries(saved)) { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value) }
      sessionStorage.removeItem('firefly.custom-page-test.preferences')
    })
    await client.call('Page.reload')
    report.cleaned = true
    await writeFile(path.join(directory, 'results.json'), JSON.stringify(report, null, 2))
  } finally { client.close() }
}
