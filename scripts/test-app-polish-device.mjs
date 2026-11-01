import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { connectWindows } from './windows-test-client.mjs'
import { connectAndroid } from './android-device-client.mjs'

const windows = process.argv.includes('--windows'), client = await (windows ? connectWindows() : connectAndroid())
const token = crypto.randomUUID().slice(0, 8), name = `界面反馈测试 ${token}`
const directory = path.resolve('target-check/app-polish', windows ? 'windows' : client.device('get-serialno'))
await mkdir(directory, { recursive: true })
const keys = ['firefly.startup-splash-enabled.v1', 'firefly.smart-clipboard.v1', 'firefly.usage-stats.v1', 'firefly.tool-creator.draft.v1', 'firefly.remote-messages.read.v1']
const report = { platform: windows ? 'windows' : 'android', checks: [], cleaned: false, restored: false }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
let original, installed = []
async function wait(fn, ...args) { for (let i = 0; i < 150; i++) { if (await client.evaluate(fn, ...args)) return; await pause(100) }; throw new Error('Timed out: ' + fn) }
async function ready() { await wait(() => { document.querySelector('.startup-splash-skip')?.click(); return document.querySelector('.app-shell') && !document.querySelector('.app-shell').inert }) }
const nav = name => client.evaluate(name => [...document.querySelectorAll('.nav-button')].find(node => node.textContent.trim() === name).click(), name)
const click = selector => client.evaluate(selector => { const node = document.querySelector(selector); if (!node) throw new Error(selector); node.scrollIntoView({ block: 'center' }); node.click() }, selector)
async function fill(selector, value) { await client.evaluate(({ selector, value }) => { const node = document.querySelector(selector); node.value = value; node.dispatchEvent(new Event('input', { bubbles: true })) }, { selector, value }) }
async function shot(name) { const result = await client.call('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(directory, name + '.png'), Buffer.from(result.data, 'base64')) }
async function check(name, work) { await work(); report.checks.push(name); console.log('PASS:', name) }
async function toast(text) {
  await wait(text => { const node = document.querySelector('.toast:popover-open'); return node?.textContent.includes(text) }, text)
  assert.equal(await client.evaluate(() => {
    const r = document.querySelector('.toast:popover-open').getBoundingClientRect()
    return r.top > innerHeight / 2 && r.bottom <= innerHeight + 1 && !document.querySelector('.module-studio-content > .module-page-error, .module-studio-content > .module-studio-notice')
  }), true)
}
async function creatorVersion(value) { await client.evaluate(value => { const details = document.querySelector('#studio-panel-create .tool-advanced-settings'); details.open = true; const node = [...details.querySelectorAll('label')].find(node => node.textContent.trim().startsWith('版本')).querySelector('input'); node.value = value; node.dispatchEvent(new Event('input', { bubbles: true })) }, value) }
try {
  await ready(); original = await client.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), keys)
  await writeFile(path.join(directory, 'original-preferences.json'), JSON.stringify(original, null, 2))
  await client.evaluate(keys => { for (const key of keys.slice(0, 3)) localStorage.setItem(key, 'false'); localStorage.removeItem(keys[3]) }, keys)
  await client.call('Page.reload'); await ready(); await nav('关于应用')
  await wait(() => document.querySelector('.about-link') && !document.querySelector('.about-link').disabled)
  for (let i = 0; i < 3; i++) {
    if (!await client.evaluate(() => !!document.querySelector('.remote-message-dialog[open]'))) break
    await client.evaluate(() => { const dialog = document.querySelector('.remote-message-dialog[open]'); if (dialog.classList.contains('remote-message-required')) throw new Error('Forced update'); (dialog.querySelector('.secondary-button') || dialog.querySelector('.primary-button')).click() }); await pause(100)
  }
  await check('about page shows the exact disclaimer between two separators without overflow', async () => {
    assert.equal(await client.evaluate(() => document.querySelector('.about-disclaimer p').textContent), '本项目为个人开源项目，与米哈游（HoYoverse）无关。所以涉及的游戏角色名称及图标设计版权归米哈游所有。')
    assert.equal(await client.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.about-disclaimer')).borderTopWidth) > 0 && parseFloat(getComputedStyle(document.querySelector('.about-links')).borderTopWidth) > 0 && document.documentElement.scrollWidth <= innerWidth), true)
    await shot('about')
  })
  await nav('工具管理'); await click('[aria-label="打开工具工作台"]'); await wait(() => !!document.querySelector('#studio-tab-create'))
  await click('#studio-tab-create'); await wait(() => document.querySelector('#studio-tab-create').getAttribute('aria-selected') === 'true')
  await fill('#tool-creation-name', name); await creatorVersion('invalid-version'); await pause(400)
  await check('creator validation errors appear at the bottom and repeat after the previous message expires', async () => {
    await click('#studio-panel-create button[type="submit"]'); await toast('版本')
    await wait(() => !document.querySelector('.toast:popover-open'))
    await click('#studio-panel-create button[type="submit"]'); await toast('版本')
    assert.equal(await client.evaluate(() => document.getElementById('tool-creation-name').value), name)
    await shot('creator-error')
  })
  await check('real native creation reports success at the bottom and preserves the creator', async () => {
    await creatorVersion('1.0.0'); await pause(300)
    await click('#studio-panel-create button[type="submit"]'); await toast('已安装')
    installed = (await client.invoke('list_modules')).filter(module => module.name === name).flatMap(module => module.tool_ids)
    assert.equal(installed.length, 1)
    assert.equal(await client.evaluate(() => document.getElementById('studio-tab-create').getAttribute('aria-selected')), 'true')
    await shot('creator-success')
  })
  await click('#studio-tab-installed'); await click('#studio-library-module')
  await client.evaluate(name => [...document.querySelectorAll('#studio-library-module-list button')].find(node => node.textContent.includes(name)).click(), name)
  await wait(() => !!document.querySelector('.module-studio-detail-actions'))
  await check('installed metadata errors and native saves report at the bottom', async () => {
    await client.evaluate(() => [...document.querySelectorAll('button')].find(node => node.textContent.trim() === '修改信息').click())
    await wait(() => !!document.querySelector('.module-studio-metadata-form'))
    await client.evaluate(() => { const node = [...document.querySelectorAll('.module-studio-metadata-form label')].find(node => node.textContent.trim() === '版本').querySelector('input'); node.value = 'bad-version'; node.dispatchEvent(new Event('input', { bubbles: true })) })
    await click('.module-studio-metadata-form button[type="submit"]'); await toast('版本')
    await client.evaluate(() => { const node = [...document.querySelectorAll('.module-studio-metadata-form label')].find(node => node.textContent.trim() === '版本').querySelector('input'); node.value = '1.0.1'; node.dispatchEvent(new Event('input', { bubbles: true })) })
    await click('.module-studio-metadata-form button[type="submit"]'); await toast('的信息')
    await shot('metadata-success')
  })
  await check('installed source errors use bottom messages and leave the invalid input editable', async () => {
    await client.evaluate(() => [...document.querySelectorAll('button')].find(node => node.textContent.trim() === '编辑源码').click())
    await wait(() => !!document.querySelector('.installed-source-editor'))
    await client.evaluate(() => document.querySelector('.installed-source-editor .tool-advanced-settings').open = true)
    await fill('[aria-label="工具包清单 JSON"]', '{')
    await click('.installed-source-editor button[type="submit"]'); await toast('清单 JSON 格式无效')
    assert.equal(await client.evaluate(() => document.querySelector('[aria-label="工具包清单 JSON"]').value), '{')
    assert.equal(await client.evaluate(() => !!document.querySelector('.installed-source-editor > .editor-status.error')), false)
    await shot('source-error')
  })
  if (!windows) await check('shortcut permission wording omits the obsolete phone qualifier', async () => {
    await nav('快捷方式')
    assert.equal(await client.evaluate(() => document.querySelector('.shortcut-permission-card p').textContent.includes('部分手机')), false)
    await shot('shortcut')
  })
} catch (error) { await writeFile(path.join(directory, 'error.txt'), String(error.stack || error)); try { await shot('error') } catch {}; throw error }
finally {
  try {
    await nav('首页')
    const remaining = (await client.invoke('list_modules')).filter(module => module.name === name).flatMap(module => module.tool_ids)
    if (remaining.length) await client.invoke('delete_tools', { toolIds: remaining })
    report.cleaned = true
    if (original) { await client.evaluate(saved => { for (const [key, value] of Object.entries(saved)) value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value) }, original); await client.call('Page.reload'); await ready(); assert.deepEqual(await client.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), keys), original); report.restored = true }
    await writeFile(path.join(directory, 'results.json'), JSON.stringify(report, null, 2))
  } finally { client.close() }
}
