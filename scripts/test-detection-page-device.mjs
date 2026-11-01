import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { connectAndroid } from './android-device-client.mjs'
import { connectWindows } from './windows-test-client.mjs'

const keepAlive = setInterval(() => {}, 1000)
const windows = process.argv.includes('--windows'), keys = ['firefly.smart-clipboard.v1', 'firefly.startup-splash-enabled.v1', 'firefly.usage-stats.v1']
const report = { platform: windows ? 'windows' : 'android', inputFixture: true, checks: [], preferencesRestored: false }
let client, directory, original
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn, ...args) { for (let i = 0; i < 180; i++) { if (await client.evaluate(fn, ...args)) return; await pause(100) }; throw new Error(`Timed out: ${fn}`) }
async function ready() { await until(() => { document.querySelector('.startup-splash-skip')?.click(); const app = document.querySelector('.app-shell'); return document.visibilityState === 'visible' && app && !app.inert && getComputedStyle(app).display !== 'none' }) }
async function tap(selector) {
  await client.evaluate(selector => { const node = document.querySelector(selector); if (!node) throw new Error('Missing control: ' + selector); node.scrollIntoView({ block: 'center', behavior: 'instant' }) }, selector)
  await pause(300)
  const point = await client.evaluate(selector => { const rect = document.querySelector(selector).getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } }, selector)
  if (windows) {
    await client.call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point })
    await client.call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point })
  } else {
    await client.call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] })
    await client.call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
}
async function open() {
  await client.evaluate(() => [...document.querySelectorAll('.nav-button')].find(button => button.textContent.trim() === '智能识别').click())
  await until(() => !!document.getElementById('detect-input'))
}
async function back() { if (windows) await client.evaluate(() => window.dispatchEvent(new Event('firefly:native-back'))); else client.device('shell', 'input', 'keyevent', '4') }
async function capture(name) { await pause(250); const shot = await client.call('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(directory, name), Buffer.from(shot.data, 'base64')) }
async function check(name, fn) { await fn(); report.checks.push(name); console.log('PASS:', name) }
try {
  client = await (windows ? connectWindows() : connectAndroid())
  directory = path.resolve('target-check/detection-page', windows ? 'windows' : client.device('get-serialno')); await mkdir(directory, { recursive: true })
  await ready()
  original = await client.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), keys)
  await client.evaluate(keys => keys.forEach(key => localStorage.setItem(key, 'false')), keys)
  await client.call('Page.reload'); await ready()
  await check('recognition is a standalone page with no modal or forced text focus', async () => {
    await open()
    assert.deepEqual(await client.evaluate(() => ({ modal: !!document.querySelector('dialog[open]'), focused: document.activeElement?.id === 'detect-input', title: document.querySelector('.top-title .tool-title').textContent })), { modal: false, focused: false, title: '智能识别' })
    assert.equal(await client.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await capture('input.png')
  })
  await check('ordinary text counts every native recommendation rather than just its content type', async () => {
    await client.evaluate(() => { const node = document.getElementById('detect-input'); node.value = 'ordinary words for recognition'; node.dispatchEvent(new Event('input', { bubbles: true })) })
    await tap('.detection-input-actions .primary-button')
    await until(() => !!document.querySelector('.detection-result-card[data-type-id=text]'))
    const counts = await client.evaluate(() => ({ actions: document.querySelectorAll('.detection-action').length, caption: document.querySelector('.detection-count').textContent }))
    assert(counts.actions > 1)
    assert.equal(counts.caption, `${counts.actions} 项操作`)
    report.recommendationCount = counts.actions
    await capture('results.png')
  })
  const input = '  \n{"hello":"流萤百宝箱","keepWhitespace":true}\n  '
  await check('native recognition keeps complete input and opens a tool without running it', async () => {
    await client.evaluate(value => { const node = document.getElementById('detect-input'); node.value = value; node.dispatchEvent(new Event('input', { bubbles: true })) }, input)
    await tap('.detection-input-actions .primary-button')
    await until(() => !!document.querySelector('[data-tool-id="json.format"][data-action-id=format]'))
    assert.equal(await client.evaluate(() => document.getElementById('detect-input').value), input)
    await tap('[data-tool-id="json.format"][data-action-id=format]')
    await until(() => !!document.getElementById('tool-input'))
    assert.equal(await client.evaluate(() => document.getElementById('tool-input').value), input)
    assert.equal(await client.evaluate(() => document.getElementById('tool-output').value), '')
    await back(); await until(() => !!document.getElementById('detect-input'))
    assert.equal(await client.evaluate(() => document.getElementById('detect-input').value), input)
    assert.equal(await client.evaluate(() => !!document.querySelector('.detection-result-card[data-type-id=json]')), true)
  })
  await check('oversized multibyte input shows a recoverable limit error', async () => {
    await client.evaluate(() => { const node = document.getElementById('detect-input'); node.value = '中'.repeat(350000); node.dispatchEvent(new Event('input', { bubbles: true })) })
    await tap('.detection-input-actions .primary-button')
    await until(() => document.querySelector('.detection-message[role=alert]')?.textContent.includes('1 MiB'))
    assert.equal(await client.evaluate(() => document.getElementById('detect-input').value.length), 350000)
  })
  await check('clear removes the input and results; page and system Back restore the originating page', async () => {
    await tap('.detection-card-heading .text-button')
    assert.equal(await client.evaluate(() => document.getElementById('detect-input').value), '')
    assert.equal(await client.evaluate(() => document.querySelectorAll('.detection-result-card').length), 0)
    await tap('.top-title .top-icon-button')
    await until(() => !document.querySelector('.detection-page'))
    await open(); assert.equal(await client.evaluate(() => document.getElementById('detect-input').value), '')
    await back(); await until(() => !document.querySelector('.detection-page'))
    assert.equal(await client.evaluate(() => !!document.querySelector('.tab-shell')), true)
  })
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
