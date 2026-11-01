// Windows requires an isolated identifier/WebView profile, CDP port 19351, and
// productName "Firefly Settings Reset Test" so its autostart entry is disposable.
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { connectWindows } from './windows-test-client.mjs'
import { connectAndroid } from './android-device-client.mjs'

const windows = process.argv.includes('--windows'), client = await (windows ? connectWindows() : connectAndroid())
const bundled = await build({ stdin: { contents: "export {MORE_SETTINGS_DEFAULTS} from './src/services/resetSettings.ts';export {layoutKeys,preferenceKeys} from './src/services/preferences.ts'", resolveDir: process.cwd() }, bundle: true, write: false, platform: 'node', format: 'esm' })
const { MORE_SETTINGS_DEFAULTS, layoutKeys, preferenceKeys } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'))
const marker = 'firefly.browser-module.tool.reset-settings-test.keep'
const protectedKeys = ['firefly.theme.v1', 'firefly.accent.v1', 'firefly.wallpaper-enabled.v1', 'firefly.startup-splash-enabled.v1', 'firefly.sidebar-image-enabled.v1', ...layoutKeys, marker]
const keys = [...new Set([...Object.keys(MORE_SETTINGS_DEFAULTS), ...preferenceKeys, ...protectedKeys, 'firefly.remote-messages.read.v1'])]
const custom = { 'firefly.start-page.v1': 'websites', 'firefly.auto-hide-bars.v1': 'false', 'firefly.smart-clipboard.v1': 'false', 'firefly.usage-stats.v1': 'true', 'firefly.component-transparency.v1': '80', 'firefly.app-font-size.v1': '125', 'firefly.card-gap.v1': '22', 'firefly.home-font-size.v1': '120', 'firefly.home-card-gap.v1': '20', 'firefly.web-tool-initialization-ms.v1': '60000', 'firefly.web-tool-interaction-ms.v1': '0', 'firefly.web-tool-default-fullscreen.v1': 'true', 'firefly.web-tool-fullscreen-initial-hint.v1': 'false' }
const directory = `target-check/settings-reset/${windows ? 'windows' : 'android'}`, report = { checks: [], restored: false }, alive = setInterval(() => {}, 1000)
let original, nativeOriginal
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
await mkdir(directory, { recursive: true })
async function until(fn, ...args) { for (let i = 0; i < 250; i++) { if (await client.evaluate(fn, ...args)) return; await pause(100) }; throw Error('Timed out: ' + fn) }
async function nav(name) { await client.evaluate(name => [...document.querySelectorAll('.nav-button')].find(n => n.textContent.trim() === name).click(), name) }
async function ready() {
  await until(() => { document.querySelector('.startup-splash-skip')?.click(); const app = document.querySelector('.app-shell'); return app && getComputedStyle(app).display !== 'none' })
  await nav('关于应用'); await until(() => document.querySelector('.about-link')?.disabled === false)
  for (let i = 0; i < 3; i++) {
    const dismissed = await client.evaluate(() => { const d = document.querySelector('.remote-message-dialog[open]'); if (!d) return false; if (d.classList.contains('remote-message-required')) throw Error('Mandatory update'); (d.querySelector('.secondary-button') || d.querySelector('.primary-button')).click(); return true })
    if (!dismissed) break; await pause(150)
  }
}
const read = wanted => client.evaluate(keys => Object.fromEntries(keys.map(k => [k, localStorage.getItem(k)])), wanted)
async function clickReset() { await client.evaluate(() => [...document.querySelectorAll('.settings-page button')].find(n => n.querySelector('strong')?.textContent === '重置设置').click()); await until(() => !!document.querySelector('.confirm-dialog[open]')) }
async function confirm(accept) { await client.evaluate(accept => document.querySelector('.confirm-dialog ' + (accept ? '.primary-button' : '.secondary-button')).click(), accept) }
async function verifyControls() {
  const state = await client.evaluate(() => ({ appearance: [...document.querySelectorAll('.home-appearance-controls input')].map(n => n.value), smart: [...document.querySelectorAll('.settings-page [role=switch]')].find(n => n.textContent.includes('智能识别剪切板内容'))?.getAttribute('aria-checked'), usage: [...document.querySelectorAll('.settings-page [role=switch]')].find(n => n.textContent.includes('记录最近使用'))?.getAttribute('aria-checked'), display: [...document.querySelectorAll('.web-tool-presentation-settings [role=switch]')].map(n => n.getAttribute('aria-checked')), budgets: [...document.querySelectorAll('.web-tool-budget-control .viewport-select-trigger')].map(n => n.textContent), start: document.querySelector('.start-page-preference').textContent, overflow: document.documentElement.scrollWidth > innerWidth }))
  assert.deepEqual(state.appearance, ['40', '100', '10']); assert.equal(state.smart, 'false'); assert.equal(state.usage, 'false'); assert.deepEqual(state.display, ['false', 'true'])
  assert.match(state.start, /首页/); assert(state.budgets[0].includes('5 秒') && state.budgets[1].includes('10 秒')); assert.equal(state.overflow, false)
  for (const [k, v] of Object.entries(MORE_SETTINGS_DEFAULTS)) assert.equal(await client.evaluate(k => localStorage.getItem(k), k), v)
  if (windows) { assert.equal(await client.invoke('desktop_close_behavior'), 'tray'); assert.equal(await client.invoke('desktop_autostart_enabled'), false) }
}
async function check(name, fn) { await fn(); report.checks.push(name); console.log('PASS:', name) }
try {
  await until(() => !!document.querySelector('.app-shell')); original = await read(keys)
  await writeFile(`${directory}/original-preferences.json`, JSON.stringify(original, null, 2))
  if (windows) {
    assert.equal(await client.invoke('plugin:app|name'), 'Firefly Settings Reset Test', 'Use the isolated reset test configuration before changing autostart')
    nativeOriginal = { closeBehavior: await client.invoke('desktop_close_behavior'), autostart: await client.invoke('desktop_autostart_enabled') }
    await client.invoke('set_desktop_close_behavior', { behavior: 'exit' }); await client.invoke('set_desktop_autostart', { enabled: true })
  }
  await client.evaluate(({ custom, marker }) => { for (const [k, v] of Object.entries(custom)) localStorage.setItem(k, v); localStorage.setItem(marker, 'preserve tool data'); localStorage.setItem('firefly.startup-splash-enabled.v1', 'false') }, { custom, marker })
  await client.call('Page.reload'); await ready(); await nav('更多设置')
  // Store the nondefault clipboard preference without reading the user's clipboard.
  await client.evaluate(() => localStorage.setItem('firefly.smart-clipboard.v1', 'true'))
  const before = await read(keys), protectedBefore = await read(protectedKeys), recent = await client.invoke('list_recent_tools')
  await check('reset shows a second confirmation and cancellation preserves every setting', async () => {
    await clickReset(); assert.deepEqual(await read(keys), before); await confirm(false)
    await until(() => !document.querySelector('.confirm-dialog[open]')); assert.deepEqual(await read(keys), before)
    if (windows) { assert.equal(await client.invoke('desktop_close_behavior'), 'exit'); assert.equal(await client.invoke('desktop_autostart_enabled'), true) }
  })
  await check('confirmation resets all More Settings controls immediately, including native Windows settings', async () => {
    await clickReset(); await confirm(true)
    await until(() => document.querySelector('.toast')?.textContent.includes('已恢复初始状态'))
    await verifyControls()
  })
  await check('tool data, theme, images, groups and recent records survive reset', async () => {
    assert.deepEqual(await read(protectedKeys), protectedBefore); assert.deepEqual(await client.invoke('list_recent_tools'), recent)
  })
  await check('resetting already-default settings also succeeds', async () => {
    await clickReset(); await confirm(true)
    await until(() => document.querySelector('.settings-page')?.getAttribute('aria-busy') === 'false' && document.querySelector('.toast')?.textContent.includes('已恢复初始状态'))
    await verifyControls()
  })
  await check('reset defaults survive reload without navigating away from settings during the operation', async () => {
    await client.call('Page.reload'); await ready(); await nav('更多设置'); await verifyControls()
  })
} finally {
  try {
    if (nativeOriginal) {
      if (await client.invoke('desktop_close_behavior') !== nativeOriginal.closeBehavior) await client.invoke('set_desktop_close_behavior', { behavior: nativeOriginal.closeBehavior })
      if (await client.invoke('desktop_autostart_enabled') !== nativeOriginal.autostart) await client.invoke('set_desktop_autostart', { enabled: nativeOriginal.autostart })
    }
    if (original) {
      const restore = () => client.evaluate(saved => { for (const [k, v] of Object.entries(saved)) v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v) }, original)
      await nav('首页'); await restore(); await client.call('Page.reload'); await ready(); await nav('首页'); await restore()
      assert.deepEqual(await read(keys), original)
      if (nativeOriginal) { assert.equal(await client.invoke('desktop_close_behavior'), nativeOriginal.closeBehavior); assert.equal(await client.invoke('desktop_autostart_enabled'), nativeOriginal.autostart) }
      report.restored = true
    }
    await writeFile(`${directory}/results.json`, JSON.stringify(report, null, 2))
  } finally { client.close(); clearInterval(alive) }
}
