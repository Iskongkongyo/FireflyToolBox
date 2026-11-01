// Exercises actual Android settings and sandbox execution, then restores preferences.
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { connectAndroid } from './android-device-client.mjs'

const bundle = await build({ entryPoints: ['src/services/browserModule.ts'], bundle: true, write: false, format: 'iife', globalName: 'BudgetSettingsReview', platform: 'browser' })
const client = await connectAndroid()
const directory = path.resolve('target-check/web-tool-budget-settings', client.device('get-serialno').replace(/[^\w-]/g, '_'))
await mkdir(directory, { recursive: true })
const initKey = 'firefly.web-tool-initialization-ms.v1', interactionKey = 'firefly.web-tool-interaction-ms.v1'
const keys = [initKey, interactionKey, 'firefly.startup-splash-enabled.v1']
const original = await client.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), keys)
await writeFile(path.join(directory, 'original-preferences.json'), JSON.stringify(original, null, 2))
const report = { android: client.device('shell', 'getprop', 'ro.build.version.release'), checks: [], preferencesRestored: false }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn, ...args) {
  for (let attempt = 0; attempt < 180; attempt++) {
    const result = await client.evaluate(fn, ...args)
    if (result) return result
    await delay(100)
  }
  throw new Error(`Timed out: ${fn}`)
}
async function reload() {
  await client.call('Page.reload')
  await until(() => { const app = document.querySelector('.app-shell'); return app && !app.inert && getComputedStyle(app).display !== 'none' })
}
async function settings() {
  await client.evaluate(() => [...document.querySelectorAll('.nav-button')].find(button => button.textContent.trim() === '更多设置').click())
  await until(() => !!document.getElementById('web-tool-initialization-budget'))
  await client.evaluate(async () => {
    await Promise.all(document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation => animation.finished.catch(() => {})))
  })
}
async function touch(selector) {
  const point = await client.evaluate(async selector => {
    const node = document.querySelector(selector)
    if (!node) throw new Error(`Missing control: ${selector}`)
    node.scrollIntoView({ block: 'center', behavior: 'instant' })
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    // The Android compositor can commit a programmatic scroll after main-thread
    // layout. Let that settle before sending physical viewport coordinates.
    await new Promise(resolve => setTimeout(resolve, 500))
    const rect = node.getBoundingClientRect()
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  }, selector)
  await client.call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] })
  await client.call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}
async function select(id, label) {
  await touch('#' + id)
  await until(label => [...document.querySelectorAll('[role="option"]')].some(node => node.textContent === label), label)
  const index = await client.evaluate(label => [...document.querySelectorAll('[role="option"]')].findIndex(node => node.textContent === label), label)
  await touch(`.viewport-select-menu [role="option"]:nth-child(${index + 1})`)
  await until(() => !document.querySelector('.viewport-select-menu'))
}
async function check(name, fn) { await fn(); report.checks.push(name); console.log('PASS:', name) }
async function runtime() {
  const result = await client.call('Runtime.evaluate', { expression: bundle.outputFiles[0].text })
  assert(!result.exceptionDetails)
  await client.evaluate(() => {
    const container = document.createElement('div'); container.id = 'budget-settings-review'
    container.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:white;overflow:auto'; document.body.append(container)
  })
}
async function mount(script, timeoutMs = 15000) {
  await client.evaluate((script, timeoutMs) => {
    window.budgetErrors = []; window.budgetReady = false
    window.BudgetSettingsReview.mountWebTool(document.getElementById('budget-settings-review'), {
      moduleId: 'preview.budget-review', html: '<main><button id="run">Run</button><output id="result">Ready</output></main>', css: 'main{padding:20px}button{min-height:44px}',
      script, networkHosts: [], resources: [], timeoutMs, inputBytes: 8388608, outputBytes: 4194304,
      openFile: async () => null, saveFile: async () => true, onError: error => window.budgetErrors.push(error),
    }).then(() => { window.budgetReady = true }).catch(error => window.budgetErrors.push(error.message))
  }, script, timeoutMs)
}
async function ready() {
  await until(() => window.budgetReady || window.budgetErrors.length)
  assert.deepEqual(await client.evaluate(() => window.budgetErrors), [])
  assert.equal(await client.evaluate(() => window.budgetReady), true)
}
async function frame() {
  const tree = await client.call('Page.getFrameTree')
  const find = item => item.frame.url === 'about:srcdoc' ? item.frame : item.childFrames?.map(find).find(Boolean)
  const child = find(tree.frameTree); assert(child)
  return (await client.call('Page.createIsolatedWorld', { frameId: child.id, worldName: 'budget-settings-review' })).executionContextId
}
async function run(expression) {
  const result = await client.call('Runtime.evaluate', { expression, contextId: await frame(), returnByValue: true })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result.value
}
const busy = 'function busy(ms){const until=performance.now()+ms;while(performance.now()<until){}}'

try {
  await client.evaluate(() => localStorage.setItem('firefly.startup-splash-enabled.v1', 'false'))
  await reload(); await settings()
  await check('real touch changes each budget independently; reload preserves both choices', async () => {
    await select('web-tool-initialization-budget', '10 秒')
    await select('web-tool-interaction-budget', '30 秒')
    await reload(); await settings()
    assert.deepEqual(await client.evaluate(keys => keys.map(key => localStorage.getItem(key)), [initKey, interactionKey]), ['10000', '30000'])
    assert.equal(await client.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await client.evaluate(() => document.querySelector('[aria-labelledby="settings-web-tool-title"]').scrollIntoView({ block: 'start', behavior: 'instant' }))
    const adb = process.env.FIREFLY_ADB || path.join(process.env.ANDROID_HOME || path.join(process.env.LOCALAPPDATA, 'Android/Sdk'), 'platform-tools/adb.exe')
    await writeFile(path.join(directory, 'settings.png'), execFileSync(adb, ['-s', client.device('get-serialno'), 'exec-out', 'screencap', '-p'], { timeout: 10000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }))
  })
  await runtime()
  await check('configured budgets allow 5.4-second initialization and 10.4-second interaction on the device', async () => {
    await mount(`${busy};export function mount(){busy(5400);document.getElementById('run').onclick=()=>{busy(10400);document.getElementById('result').textContent='Completed'}}`, 1000)
    await ready(); await run('document.getElementById("run").click()')
    assert.equal(await run('document.getElementById("result").textContent'), 'Completed')
    assert.deepEqual(await client.evaluate(() => window.budgetErrors), [])
  })
  await client.evaluate(() => { window.BudgetSettingsReview.stopBrowserModule(); document.getElementById('budget-settings-review').remove() })
  await settings()
  await select('web-tool-initialization-budget', '不限制'); await select('web-tool-interaction-budget', '不限制')
  await runtime()
  await check('unlimited choices allow long finite work and ignore the short manifest load deadline', async () => {
    await mount(`${busy};export async function mount(){await new Promise(resolve=>setTimeout(resolve,500));busy(5400);document.getElementById('run').onclick=()=>{busy(10400);document.getElementById('result').textContent='Unlimited completed'}}`, 200)
    await ready(); await run('document.getElementById("run").click()')
    assert.equal(await run('document.getElementById("result").textContent'), 'Unlimited completed')
    assert.deepEqual(await client.evaluate(() => window.budgetErrors), [])
    await client.evaluate(() => window.BudgetSettingsReview.stopBrowserModule())
    await mount('export async function mount(){await new Promise(()=>{})}', 200)
    await delay(400)
    assert.deepEqual(await client.evaluate(() => window.budgetErrors), [])
    await client.evaluate(() => window.BudgetSettingsReview.stopBrowserModule())
    await until(() => window.budgetErrors.length)
    assert.equal(await client.evaluate(() => document.querySelectorAll('#budget-settings-review iframe').length), 0)
  })
  await client.evaluate(() => document.getElementById('budget-settings-review').remove())
  await settings()
  await check('restore defaults clears both saved overrides and is retained after reload', async () => {
    await touch('.web-tool-budget-settings .text-button')
    assert.deepEqual(await client.evaluate(keys => keys.map(key => localStorage.getItem(key)), [initKey, interactionKey]), [null, null])
    await reload(); await settings()
    assert.match(await client.evaluate(() => document.getElementById('web-tool-initialization-budget').textContent), /5 秒（默认）/)
    assert.match(await client.evaluate(() => document.getElementById('web-tool-interaction-budget').textContent), /10 秒（默认）/)
  })
  await runtime()
  await check('default initialization still stops a genuine loop and the next tool recovers', async () => {
    await mount('export function mount(){for(;;){}}')
    await until(() => window.budgetErrors.length)
    assert.match((await client.evaluate(() => window.budgetErrors)).join('\n'), /初始化.*5 秒/)
    await mount('export function mount(){document.getElementById("result").textContent="Recovered"}')
    await ready(); assert.equal(await run('document.getElementById("result").textContent'), 'Recovered')
  })
} catch (error) {
  await writeFile(path.join(directory, 'error.txt'), String(error.stack || error)); throw error
} finally {
  try {
    await client.evaluate(original => {
      window.BudgetSettingsReview?.stopBrowserModule(); document.getElementById('budget-settings-review')?.remove()
      for (const [key, value] of Object.entries(original)) value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value)
    }, original)
    await reload()
    assert.deepEqual(await client.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), keys), original)
    report.preferencesRestored = true
    await writeFile(path.join(directory, 'device-results.json'), JSON.stringify(report, null, 2))
  } finally { client.close() }
}
