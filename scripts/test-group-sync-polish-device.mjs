import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { connectWindows } from './windows-test-client.mjs'
import { connectAndroid } from './android-device-client.mjs'

const keepAlive = setInterval(() => {}, 1000), clients = [], originals = new Map(), modules = new Map(), ownedSync = new Set()
const windowsOnly = process.argv.includes('--windows-only')
const syncOnly = process.argv.includes('--sync-only')
const directory = path.resolve('target-check/group-sync-polish'), token = crypto.randomUUID().replaceAll('-', '').slice(0, 8)
const keys = ['firefly.groups.home.v1', 'firefly.smart-clipboard.v1', 'firefly.startup-splash-enabled.v1', 'firefly.usage-stats.v1', 'firefly.remote-messages.read.v1']
const report = { checks: [], cleaned: false, transport: 'Native encrypted sync through ADB forwarding; no Wi-Fi reachability test.' }
await mkdir(directory, { recursive: true })
const guide = (await readFile('skills/firefly-module-author/SKILL.md', 'utf8')).replaceAll('\r\n', '\n')
const template = JSON.parse(guide.split('## 网页工具模板')[1].match(/```json\n([\s\S]*?)\n```/)[1])
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(c, fn, ...args) { for (let i = 0; i < 180; i++) { if (await c.evaluate(fn, ...args)) return; await pause(100) }; throw new Error(`Timed out: ${fn}`) }
async function ready(c) { await until(c, () => { document.querySelector('.startup-splash-skip')?.click(); const app = document.querySelector('.app-shell'); return document.visibilityState === 'visible' && app && !app.inert && getComputedStyle(app).display !== 'none' }) }
async function nav(c, label) { await c.evaluate(label => [...document.querySelectorAll('.nav-button')].find(button => button.textContent.trim() === label).click(), label) }
async function press(c, text) { await c.evaluate(text => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === text).click(), text) }
async function tap(c, selector) {
  await c.evaluate(async selector => {
    document.querySelector(selector).scrollIntoView({ block: 'center', behavior: 'instant' })
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  }, selector)
  await pause(500)
  await until(c, selector => {
    const dialog = document.querySelector('.remote-message-dialog[open]')
    if (dialog) { if (dialog.classList.contains('remote-message-required')) throw new Error('Mandatory update blocks UI testing'); (dialog.querySelector('.secondary-button') || dialog.querySelector('.primary-button')).click(); return false }
    const node = document.querySelector(selector), rect = node.getBoundingClientRect()
    return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
  }, selector)
  const point = await c.evaluate(selector => { const rect = document.querySelector(selector).getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } }, selector)
  if (c === clients[0]) {
    await c.call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point }); await c.call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point })
  } else {
    await c.call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] }); await c.call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
}
async function capture(c, name) { await pause(250); const shot = await c.call('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(directory, name), Buffer.from(shot.data, 'base64')) }
async function check(name, fn) { await fn(); report.checks.push(name); console.log('PASS:', name) }
async function installed(c) {
  await nav(c, '工具管理'); await until(c, () => !!document.querySelector('[aria-label="打开工具工作台"]'))
  await c.evaluate(() => document.querySelector('[aria-label="打开工具工作台"]').click())
  await until(c, () => !!document.getElementById('studio-tab-installed'))
  await c.evaluate(() => document.getElementById('studio-tab-installed').click()); await until(c, () => !document.querySelector('.panel-stage-settling'))
  await c.evaluate(() => document.getElementById('studio-library-module').click())
  await until(c, name => [...document.querySelectorAll('.module-studio-list-item')].some(button => button.textContent.includes(name)), modules.get(c).name)
  await c.evaluate(name => [...document.querySelectorAll('.module-studio-list-item')].find(button => button.textContent.includes(name)).click(), modules.get(c).name)
  await until(c, () => !!document.querySelector('.module-studio-detail-tool .module-studio-tool-actions'))
}
async function syncPage(c) { await nav(c, '更多设置'); await until(c, () => !!document.querySelector('.settings-page')); await c.evaluate(() => [...document.querySelectorAll('.preference-option')].find(button => button.textContent.startsWith('设备同步')).click()); await until(c, () => !!document.querySelector('.device-sync')) }
try {
  const windows = await connectWindows(); clients.push(windows)
  const android = windowsOnly ? null : await connectAndroid(); if (android) clients.push(android)
  for (const [index, c] of clients.entries()) {
    await ready(c)
    const state = await c.invoke('sync_status'); assert(!state || !['waiting', 'transferring'].includes(state.state), 'A user sync is already active.')
    const saved = await c.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), keys)
    originals.set(c, saved); await writeFile(path.join(directory, `original-${index}.json`), JSON.stringify(saved, null, 2))
    await c.evaluate(() => { for (const key of ['firefly.smart-clipboard.v1', 'firefly.startup-splash-enabled.v1', 'firefly.usage-stats.v1']) localStorage.setItem(key, 'false') })
    await c.call('Page.reload'); await ready(c)
    const manifest = structuredClone(template), id = `local.polish_${token}.${index ? 'android' : 'windows'}`, name = `分组与联网验证-${index}-${token}`
    manifest.module_id = id; manifest.name = { 'zh-CN': name }; manifest.permissions = ['network']
    manifest.network.hosts = Array.from({ length: 12 }, (_, i) => `https://origin${i}.example.com`)
    manifest.tools[0].id = id + '.main'; manifest.tools[0].category = '自定义工具'; manifest.tools[0].name = { 'zh-CN': name }; manifest.tools[0].icon = 'file'
    await c.invoke('install_module_draft', { manifest, scripts: { 'index.html': '<main><p>本地界面验证</p></main>', 'style.css': 'main{padding:16px}', 'main.js': 'export function mount(){}' } })
    modules.set(c, { id, name, tool: id + '.main', hosts: manifest.network.hosts })
    if (syncOnly) continue
    const tools = await c.invoke('list_tools')
    const settings = { names: {}, custom: [{ id: 'user:review-' + token, name: '验证目标分组' }], deleted: [], assignments: Object.fromEntries(tools.map(tool => [tool.id, 'source:开发与文本'])), otherCreated: true }
    settings.assignments[id + '.main'] = 'home:other'
    await c.evaluate(settings => { localStorage.setItem('firefly.groups.home.v1', JSON.stringify(settings)); for (const key of ['firefly.smart-clipboard.v1', 'firefly.startup-splash-enabled.v1', 'firefly.usage-stats.v1']) localStorage.setItem(key, 'false') }, settings)
    await c.call('Page.reload'); await ready(c)
    await check(`${index ? 'Android' : 'Windows'}: moving the last web tool hides empty automatic groups and persists`, async () => {
      await nav(c, '首页'); await until(c, () => !!document.querySelector('.home-categories > [data-group-id="home:other"]'))
      await nav(c, '分组管理'); await until(c, () => !!document.querySelector('.group-manager-card'))
      await c.evaluate(id => document.querySelector(`[data-group-id="${id}"] .group-manager-card-toggle`).click(), 'user:review-' + token)
      await c.evaluate(() => document.querySelector('[aria-label="选择工具加入验证目标分组"]').click())
      await until(c, name => [...document.querySelectorAll('[role=option]')].some(button => button.textContent.startsWith(name + ' · ')), name)
      await c.evaluate(name => [...document.querySelectorAll('[role=option]')].find(button => button.textContent.startsWith(name + ' · ')).click(), name)
      assert.equal(await c.evaluate(() => !!document.querySelector('.group-manager-card[data-group-id="home:other"]')), true)
      await nav(c, '首页')
      assert.equal(await c.evaluate(() => !!document.querySelector('.home-categories > [data-group-id="home:other"], .home-categories > [data-group-id="source:自定义工具"]')), false)
      await c.call('Page.reload'); await ready(c); await nav(c, '首页')
      assert.equal(await c.evaluate(() => !!document.querySelector('.home-categories > [data-group-id="home:other"], .home-categories > [data-group-id="source:自定义工具"]')), false)
      await capture(c, `groups-${index}.png`)
    })
    await check(`${index ? 'Android' : 'Windows'}: installed-tool buttons align right and open/cancel-delete work`, async () => {
      await installed(c)
      const bounds = await c.evaluate(() => { const row = document.querySelector('.module-studio-detail-tool'), buttons = [...row.querySelectorAll('.module-studio-tool-actions button')]; return { row: row.getBoundingClientRect().toJSON(), buttons: buttons.map(button => button.getBoundingClientRect().toJSON()), overflow: document.documentElement.scrollWidth > innerWidth, mobile: innerWidth < 600 } })
      assert(Math.abs(bounds.row.right - bounds.buttons.at(-1).right) < 2)
      assert.equal(bounds.overflow, false); if (bounds.mobile) assert(bounds.buttons.every(button => button.height >= 44))
      await capture(c, `buttons-${index}.png`)
      await tap(c, '.module-studio-tool-actions .delete-action'); await until(c, () => !!document.querySelector('.confirm-dialog[open]'))
      await c.evaluate(() => document.querySelector('.confirm-dialog .secondary-button').click())
      assert((await c.invoke('list_modules')).some(module => module.module_id === id))
      await tap(c, '.module-studio-tool-actions button:first-child'); await until(c, () => !!document.querySelector('.web-tool-container iframe'))
      await c.evaluate(() => window.dispatchEvent(new Event('firefly:native-back'))); await until(c, () => !!document.getElementById('studio-tab-installed'))
    })
  }
  for (const [source, target, label] of android ? [[windows, android, 'Windows → Android'], [android, windows, 'Android → Windows']] : []) {
    await check(`${label}: real sync preview folds origins without changing selection`, async () => {
      const options = { modules: true, automations: false, builtins: false, favorites: false, websites: false, layout: false, preferences: false, web_data: false }
      ownedSync.add(source)
      const offer = await source.invoke('sync_share', { options, preferences: {}, moduleIds: [modules.get(source).id], legacyStorage: {} })
      const nativePort = offer.addresses[0].split(':').at(-1), direction = source === windows ? 'reverse' : 'forward'
      const port = android.device(direction, 'tcp:0', `tcp:${nativePort}`)
      try {
        await syncPage(target); ownedSync.add(target); await press(target, '从其他设备接收')
        await until(target, () => !!document.querySelector('.sync-field input') && !document.querySelector('.sync-actions .primary-button').disabled)
        await target.evaluate(({ endpoint, code }) => { for (const [node, value] of [[document.querySelectorAll('.sync-field input')[0], endpoint], [document.querySelectorAll('.sync-field input')[1], code]]) { node.value = value; node.dispatchEvent(new Event('input', { bubbles: true })) } }, { endpoint: `127.0.0.1:${port}`, code: offer.code })
        await press(target, '连接并预览')
        await until(target, () => { const error = document.querySelector('.sync-error'); if (error) throw new Error(error.textContent); return !!document.querySelector('.sync-network') })
        assert.deepEqual(await target.evaluate(() => ({ open: document.querySelector('.sync-network').open, selected: document.querySelector('.sync-item input').checked })), { open: false, selected: true })
        assert.equal(await target.evaluate(() => { const item = document.querySelector('.sync-item'); return Math.abs(item.querySelector('input').getBoundingClientRect().left - item.querySelector('.sync-summary-chevron').getBoundingClientRect().left) <= 1 }), true, 'Network disclosure aligns with the checkbox')
        await capture(target, `sync-${label.startsWith('Windows') ? 'android' : 'windows'}-collapsed.png`)
        await tap(target, '.sync-network summary')
        assert.equal(await target.evaluate(() => document.querySelector('.sync-item input').checked), true)
        assert.deepEqual((await target.evaluate(() => [...document.querySelectorAll('.sync-network li')].map(node => node.textContent))).sort(), [...modules.get(source).hosts].sort())
        await capture(target, `sync-${label.startsWith('Windows') ? 'android' : 'windows'}-expanded.png`)
        await tap(target, '.sync-item-choice'); assert.equal(await target.evaluate(() => document.querySelector('.sync-item input').checked), false)
        await tap(target, '.sync-network summary'); assert.equal(await target.evaluate(() => document.querySelector('.sync-item input').checked), false)
        await press(target, '取消本次同步'); await until(target, () => !document.querySelector('.sync-preview-heading'))
      } finally { android.device(direction, '--remove', `tcp:${port}`); await source.invoke('sync_close') }
    })
  }
} catch (error) {
  for (const [index, c] of clients.entries()) try { await capture(c, `error-${index}.png`) } catch {}
  await writeFile(path.join(directory, 'error.txt'), String(error.stack || error)); throw error
} finally {
  try {
    for (const c of ownedSync) await c.invoke('sync_close').catch(() => {})
    for (const [c, module] of modules) await c.invoke('delete_tools', { toolIds: [module.tool] })
    for (const [c, original] of originals) {
      await c.evaluate(saved => { for (const [key, value] of Object.entries(saved)) { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value) } }, original)
      await c.call('Page.reload'); await ready(c)
      assert.deepEqual(await c.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), keys), original)
    }
    report.cleaned = true; await writeFile(path.join(directory, 'results.json'), JSON.stringify(report, null, 2))
  } finally { for (const c of clients) c.close(); clearInterval(keepAlive) }
}
