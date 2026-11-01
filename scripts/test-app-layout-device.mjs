import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { connectAndroid } from './android-device-client.mjs'
import { connectWindows } from './windows-test-client.mjs'

// Keep startup HTTP discovery alive on WebViews whose debug socket is unreferenced.
const keepAlive = setInterval(() => {}, 1000)
const windows = process.argv.includes('--windows')
let client, original
const keys = ['firefly.auto-hide-bars.v1', 'firefly.startup-splash-enabled.v1']
const report = { platform: windows ? 'windows' : 'android', checks: [], preferencesRestored: false }
let directory
async function until(fn, ...args) {
  for (let attempt = 0; attempt < 180; attempt++) { if (await client.evaluate(fn, ...args)) return; await pause(100) }
  throw new Error(`Timed out: ${fn}`)
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function ready() {
  await until(() => { document.querySelector('.startup-splash-skip')?.click(); const app = document.querySelector('.app-shell'); return document.visibilityState === 'visible' && app && !app.inert && getComputedStyle(app).display !== 'none' })
}
async function tapSelector(selector) {
  const point = await client.evaluate(selector => {
    const node = document.querySelector(selector); if (!node) throw new Error('Missing control: ' + selector)
    node.scrollIntoView({ block: 'nearest', behavior: 'instant' }); const rect = node.getBoundingClientRect()
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  }, selector)
  await pause(300)
  if (windows) {
    await client.call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point })
    await client.call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point })
  } else {
    await client.call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] })
    await client.call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
}
async function menu(label) {
  await client.evaluate(() => [...document.querySelectorAll('.menu-button')].find(button => getComputedStyle(button).display !== 'none').click())
  await until(() => document.querySelector('.sidebar-visible')?.getBoundingClientRect().left >= 0)
  await pause(260)
  const index = await client.evaluate(label => [...document.querySelectorAll('.nav-button')].findIndex(button => button.textContent.trim() === label), label)
  await tapSelector(`.nav-button:nth-child(${index + 1})`)
}
async function back() {
  if (windows) await client.evaluate(() => window.dispatchEvent(new Event('firefly:native-back')))
  else client.device('shell', 'input', 'keyevent', '4')
}
async function swipe(selector, horizontal = true, reverse = false) {
  const box = await client.evaluate(selector => document.querySelector(selector).getBoundingClientRect().toJSON(), selector)
  const start = horizontal ? { x: box.x + box.width * .8, y: box.y + Math.min(130, box.height / 2) } : { x: box.x + box.width * .5, y: box.y + box.height * .75 }
  const end = horizontal ? { x: box.x + box.width * .2, y: start.y } : { x: start.x, y: box.y + box.height * .25 }
  const a = reverse ? end : start, b = reverse ? start : end
  await client.call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...a, id: 1 }] })
  for (let i = 1; i <= 6; i++) {
    await client.call('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + (b.x - a.x) * i / 6, y: a.y + (b.y - a.y) * i / 6, id: 1 }] }); await pause(25)
  }
  await client.call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await pause(350)
}
async function capture(name) { const shot = await client.call('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(directory, name), Buffer.from(shot.data, 'base64')) }
async function check(name, fn) { await fn(); report.checks.push(name); console.log('PASS:', name) }
try {
  client = await (windows ? connectWindows() : connectAndroid())
  directory = path.resolve('target-check/tablet-layout', windows ? 'windows' : client.device('get-serialno'))
  await mkdir(directory, { recursive: true }); await ready()
  original = await client.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), keys)
  await client.evaluate(() => { localStorage.setItem('firefly.auto-hide-bars.v1', 'true'); localStorage.setItem('firefly.startup-splash-enabled.v1', 'false') })
  await client.call('Page.reload'); await ready()
  report.viewport = await client.evaluate(() => ({ width: innerWidth, height: innerHeight, ua: navigator.userAgent }))
  await check(windows ? 'Windows keeps desktop menus and hides the bottom navigation' : 'the real tablet uses a mobile drawer and bottom navigation above 600 CSS pixels', async () => {
    const layout = await client.evaluate(() => ({ mode: document.documentElement.dataset.appLayout, bottom: getComputedStyle(document.querySelector('.bottom-nav')).display, desktop: getComputedStyle(document.querySelector('.desktop-menu-button')).display, mobile: getComputedStyle(document.querySelector('.mobile-menu-button')).display }))
    assert.equal(layout.mode, windows ? 'desktop' : 'mobile')
    assert.equal(layout.bottom === 'none', windows); assert.equal(layout.desktop === 'none', !windows); assert.equal(layout.mobile === 'none', windows)
    if (!windows) assert(report.viewport.width >= 600)
    await capture('home.png')
  })
  if (windows) {
    await check('desktop basic settings omit the mobile navigation switch', async () => {
      await menu('更多设置'); await until(() => !!document.querySelector('.settings-page'))
      assert.equal(await client.evaluate(() => !!document.querySelector('.mobile-navigation-preference')), false)
      await capture('settings.png'); await back()
    })
    await check('desktop navigation still opens tool management and the workbench', async () => {
      await menu('工具管理'); await until(() => !!document.querySelector('[aria-label="打开工具工作台"]'))
      await tapSelector('[aria-label="打开工具工作台"]'); await until(() => !!document.getElementById('studio-tab-create'))
      await tapSelector('#studio-tab-create'); await until(() => !document.querySelector('.panel-stage-settling'))
      assert.equal(await client.evaluate(() => document.getElementById('studio-tab-create').getAttribute('aria-selected')), 'true')
    })
  } else {
    await check('the auto-hide switch is visible on the tablet and persists off after reload', async () => {
      await menu('更多设置'); await until(() => !!document.querySelector('.mobile-navigation-preference'))
      await tapSelector('.mobile-navigation-preference')
      await until(() => document.querySelector('.mobile-navigation-preference')?.getAttribute('aria-checked') === 'false')
      await capture('settings.png')
      await client.call('Page.reload'); await ready(); await menu('更多设置')
      assert.equal(await client.evaluate(() => document.querySelector('.mobile-navigation-preference').getAttribute('aria-checked')), 'false')
      await back(); await until(() => !!document.querySelector('.tab-panel-active'))
      await client.evaluate(() => document.querySelectorAll('.tab-panel-active .category-header').forEach(button => button.click()))
      await swipe('.tab-panel-active', false)
      assert.equal(await client.evaluate(() => document.querySelector('.app-shell').classList.contains('bars-hidden')), false)
    })
    await check('enabling auto-hide makes upward and downward finger swipes hide and reveal both app bars', async () => {
      await menu('更多设置'); await tapSelector('.mobile-navigation-preference'); await back(); await pause(350)
      await swipe('.tab-panel-active', false)
      assert.equal(await client.evaluate(() => document.querySelector('.app-shell').classList.contains('bars-hidden')), true)
      await capture('hidden.png')
      await swipe('.tab-panel-active', false, true)
      assert.equal(await client.evaluate(() => document.querySelector('.app-shell').classList.contains('bars-hidden')), false)
    })
    await check('wide-tablet horizontal swipes switch the main pages without a desktop transform override', async () => {
      await swipe('.tab-panel-active')
      assert.equal(await client.evaluate(() => document.querySelector('.bottom-nav button[aria-current=page]').textContent), '收藏')
      assert.equal(await client.evaluate(() => Math.abs(document.querySelector('.tab-panel-active').getBoundingClientRect().left - document.querySelector('.tab-viewport').getBoundingClientRect().left) < 2), true)
      await capture('favorites.png')
    })
    await check('group management and workbench swipe navigation also work on the tablet', async () => {
      await menu('分组管理'); await until(() => !!document.querySelector('.group-manager-tabs'))
      await swipe('.module-studio-panel-viewport')
      assert.equal(await client.evaluate(() => document.getElementById('group-tab-favorites').getAttribute('aria-selected')), 'true')
      await back(); await menu('工具管理'); await until(() => !!document.querySelector('[aria-label="打开工具工作台"]'))
      await tapSelector('[aria-label="打开工具工作台"]'); await until(() => !!document.getElementById('studio-tab-import'))
      await swipe('.module-studio-panel-viewport')
      assert.equal(await client.evaluate(() => document.getElementById('studio-tab-create').getAttribute('aria-selected')), 'true')
      assert.equal(await client.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      await capture('workbench.png')
    })
  }
} catch (error) {
  if (directory) { await writeFile(path.join(directory, 'error.txt'), String(error.stack || error)); try { await capture('error.png') } catch {} }
  throw error
} finally {
  try {
    if (client && original) {
      await client.evaluate(saved => { for (const [key, value] of Object.entries(saved)) { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value) } }, original)
      await client.call('Page.reload'); report.preferencesRestored = true
    }
    if (directory) await writeFile(path.join(directory, 'results.json'), JSON.stringify(report, null, 2))
  } finally { client?.close(); clearInterval(keepAlive) }
}
