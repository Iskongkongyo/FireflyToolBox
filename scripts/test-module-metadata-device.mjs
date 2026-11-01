import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { connectAndroid } from './android-device-client.mjs'
import { connectWindows } from './windows-test-client.mjs'

const windows = process.argv.includes('--windows'), client = await (windows ? connectWindows() : connectAndroid())
const directory = path.resolve('target-check/module-metadata', windows ? 'windows' : client.device('get-serialno'))
await mkdir(directory, { recursive: true })
const guide = (await readFile('skills/firefly-module-author/SKILL.md', 'utf8')).replace(/\r\n?/g, '\n')
const textSection = guide.split('## 文本处理模板')[1].split('## 网页工具模板')[0]
const webSection = guide.split('## 网页工具模板')[1].split('### 页面背景与配色')[0]
const textManifest = JSON.parse(textSection.match(/```json\n([\s\S]*?)\n```/)[1])
const textScript = textSection.match(/```js\n([\s\S]*?)\n```/)[1]
const webBlocks = [...webSection.matchAll(/```(?:json|html|css|js)\n([\s\S]*?)\n```/g)].map(match => match[1])
const webManifest = JSON.parse(webBlocks[0])
const icons = [...guide.split('### 内置图标')[1].split('### 自定义图标')[0].matchAll(/^\| `([^`]+)` \|/gm)].map(match => match[1])
const categories = guide.split('### 内置分组')[1].split('### 内置图标')[0].split('\n').filter(line => line.startsWith('|')).slice(2).map(line => line.split('|')[1].trim())
const token = crypto.randomUUID().replaceAll('-', '').slice(0, 8), prefix = `dev.example.metadata_${token}`
const category = '元数据验证-' + token, installed = [], report = { platform: windows ? 'windows' : 'android', icons, categories, checks: [], cleaned: false }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function wait(fn, ...args) { for (let attempt = 0; attempt < 150; attempt++) { if (await client.evaluate(fn, ...args)) return; await pause(100) }; throw new Error(`Timed out: ${fn}`) }
async function check(name, work) { await work(); report.checks.push(name); console.log('PASS:', name) }
function manifest(base, suffix) {
  const value = structuredClone(base); value.module_id = prefix + '.' + suffix
  value.tools[0].id = value.module_id + '.tool'; value.tools[0].category = category
  return value
}
async function install(value, scripts) {
  const result = await client.invoke('install_module_draft', { manifest: value, scripts })
  installed.push(result.module_id)
  return result
}
try {
  await wait(() => !!document.querySelector('.app-shell') && !!window.__TAURI_INTERNALS__)
  await check('both complete guide templates validate with their documented categories and default icons', async () => {
    const text = manifest(textManifest, 'text'); text.tools[0].category = textManifest.tools[0].category
    const web = manifest(webManifest, 'web'); web.tools[0].category = webManifest.tools[0].category
    assert.equal(text.tools[0].icon, 'text'); assert.equal(web.tools[0].icon, 'file')
    await client.invoke('validate_module_draft', { manifest: text, scripts: { 'main.js': textScript } })
    await client.invoke('validate_module_draft', { manifest: web, scripts: Object.fromEntries(['index.html', 'style.css', 'main.js'].map((name, index) => [name, webBlocks[index + 1]])) })
  })
  await check('all six category strings from the guide are accepted and preserved by native validation', async () => {
    assert.equal(categories.length, 6)
    for (const category of categories) {
      const value = manifest(textManifest, 'categories'); value.tools[0].category = category
      const result = await client.invoke('validate_module_draft', { manifest: value, scripts: { 'main.js': textScript } })
      assert.deepEqual(result.categories, [category])
    }
  })
  await check('all twenty documented icon identifiers install and survive native persistence', async () => {
    assert.equal(icons.length, 20)
    for (let group = 0; group < 2; group++) {
      const value = manifest(textManifest, 'icons_' + group)
      value.tools = icons.slice(group * 10, group * 10 + 10).map((icon, index) => ({ ...structuredClone(value.tools[0]), id: value.module_id + '.i' + index, name: { 'zh-CN': icon }, icon }))
      const result = await install(value, { 'main.js': textScript })
      const details = await client.invoke('get_module_details', { moduleId: result.module_id })
      assert.deepEqual(details.manifest.tools.map(tool => tool.icon), icons.slice(group * 10, group * 10 + 10))
    }
  })
  await check('a real custom PNG and custom category install without an icon-name fallback', async () => {
    const value = manifest(textManifest, 'png')
    delete value.tools[0].icon
    value.tools[0].icon_data = 'data:image/png;base64,' + (await readFile('src-tauri/icons/32x32.png')).toString('base64')
    const result = await install(value, { 'main.js': textScript })
    const details = await client.invoke('get_module_details', { moduleId: result.module_id })
    assert.equal(details.manifest.tools[0].category, category)
    assert.equal(details.manifest.tools[0].icon_data, value.tools[0].icon_data)
    for (const patch of [{ icon: 'my_custom_icon' }, { icon: 'module-file' }, { icon: 'file', icon_data: value.tools[0].icon_data }, { icon_data: 'https://example.com/icon.png' }, { category: '长'.repeat(41) }]) {
      const invalid = manifest(textManifest, 'invalid'); delete invalid.tools[0].icon
      Object.assign(invalid.tools[0], patch)
      await assert.rejects(client.invoke('validate_module_draft', { manifest: invalid, scripts: { 'main.js': textScript } }))
    }
  })
  await check('the native home page renders every glyph and the PNG inside the custom category', async () => {
    await client.call('Page.reload')
    await wait(() => { const app = document.querySelector('.app-shell'); return app && !app.inert && getComputedStyle(app).display !== 'none' })
    await client.evaluate(() => [...document.querySelectorAll('.nav-button')].find(button => button.textContent.trim() === '首页').click())
    await wait(category => [...document.querySelectorAll('.category-header')].some(button => button.textContent.includes(category)), category)
    await client.evaluate(category => { const header = [...document.querySelectorAll('.category-header')].find(button => button.textContent.includes(category)); if (header.getAttribute('aria-expanded') !== 'true') header.click() }, category)
    await wait(prefix => {
      const tools = [...document.querySelectorAll('.tool-pill')].filter(button => button.dataset.swapId?.startsWith(prefix))
      return tools.length === 21 && tools.filter(button => button.querySelector('svg')?.childElementCount > 0).length === 20 && tools.some(button => button.querySelector('img')?.naturalWidth === 32)
    }, prefix)
    await client.evaluate(category => [...document.querySelectorAll('.category-header')].find(button => button.textContent.includes(category)).scrollIntoView({ block: 'start', behavior: 'instant' }), category)
    const shot = await client.call('Page.captureScreenshot', { format: 'png' })
    await writeFile(path.join(directory, 'icons.png'), Buffer.from(shot.data, 'base64'))
  })
} catch (error) { await writeFile(path.join(directory, 'error.txt'), String(error.stack || error)); throw error }
finally {
  try {
    const modules = await client.invoke('list_modules')
    for (const item of modules.filter(item => installed.includes(item.module_id))) await client.invoke('delete_tools', { toolIds: item.tool_ids })
    await client.call('Page.reload')
    report.cleaned = true
    await writeFile(path.join(directory, 'results.json'), JSON.stringify(report, null, 2))
  } finally { client.close() }
}
