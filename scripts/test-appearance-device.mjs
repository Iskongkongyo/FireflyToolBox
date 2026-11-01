// Live UI regression on a connected Android WebView, including older engines.
// Restores the transparency preference and never clears application storage.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const adb = process.env.FIREFLY_ADB || path.join(process.env.ANDROID_HOME || path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk'), 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb')
const command = (...args) => execFileSync(adb, args, { encoding: 'utf8', timeout: 30000, windowsHide: true }).trim()
const devices = command('devices').split(/\r?\n/).slice(1).filter(line => /\tdevice$/.test(line)).map(line => line.split('\t')[0])
const serial = process.env.FIREFLY_TEST_SERIAL || (devices.length === 1 ? devices[0] : '')
assert.ok(serial, 'Connect one Android device or set FIREFLY_TEST_SERIAL.')
const device = (...args) => command('-s', serial, ...args)
const expectBroken = process.argv.includes('--expect-broken')
const directory = path.resolve('target-check/appearance-webview-review')
await mkdir(directory, { recursive: true })
const report = { android: device('shell', 'getprop', 'ro.build.version.release'), expectBroken, samples: [] }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
let socket, port, call, original

async function evaluate(fn, ...args) {
  const result = await call('Runtime.evaluate', { expression: `(${fn})(${args.map(value => JSON.stringify(value)).join(',')})`, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result.value
}

async function navigate(name) {
  await evaluate(async name => {
    const button = [...document.querySelectorAll('.nav-button')].find(node => node.textContent.trim() === name)
    if (!button) throw new Error(`Missing navigation: ${name}`)
    button.click()
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  }, name)
}

async function setTransparency(value) {
  await evaluate(async value => {
    const input = document.querySelector('#component-transparency')
    if (!input) throw new Error('The transparency control is missing.')
    input.value = String(value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  }, value)
}

async function backgrounds(selectors) {
  return evaluate(selectors => Object.fromEntries(Object.entries(selectors).map(([name, selector]) => {
    const node = document.querySelector(selector)
    if (!node) throw new Error(`Missing appearance surface: ${selector}`)
    return [name, getComputedStyle(node).backgroundColor]
  })), selectors)
}

function alpha(color) {
  if (color === 'transparent') return 0
  const match = /^rgba?\(([^)]+)\)$/.exec(color)
  assert.ok(match, `Expected a legacy-compatible RGB color: ${color}`)
  const parts = match[1].split(',').map(Number)
  return parts.length === 4 ? parts[3] : 1
}

try {
  device('shell', 'am', 'start', '-n', 'firefly.toolbox/.MainActivity')
  let target
  for (let attempt = 0; attempt < 60; attempt++) {
    const pid = device('shell', 'pidof', 'firefly.toolbox').split(' ')[0]
    if (pid && !port) port = device('forward', 'tcp:0', `localabstract:webview_devtools_remote_${pid}`)
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      target = targets.find(item => item.type === 'page' && /^https?:\/\/tauri\.localhost\//.test(item.url))
    } catch {}
    if (target) break
    await delay(200)
  }
  assert.ok(target, 'The installed app must be a debuggable APK.')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let sequence = 0
  const pending = new Map()
  socket.onmessage = ({ data }) => {
    const response = JSON.parse(data), task = pending.get(response.id)
    if (!task) return
    pending.delete(response.id); clearTimeout(task.timer)
    response.error ? task.reject(new Error(JSON.stringify(response.error))) : task.resolve(response.result)
  }
  call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 15000)
    pending.set(id, { resolve, reject, timer })
    socket.send(JSON.stringify({ id, method, params }))
  })
  let ready = false
  for (let attempt = 0; attempt < 60; attempt++) {
    ready = await evaluate(() => {
      document.querySelector('.startup-splash-skip')?.click()
      const app = document.querySelector('.app-shell')
      return !!app && getComputedStyle(app).display !== 'none' && !document.querySelector('.startup-splash')
    })
    if (ready) break
    await delay(200)
  }
  assert.ok(ready, 'The app did not finish startup.')
  report.engine = await evaluate(() => ({
    userAgent: navigator.userAgent,
    colorMix: CSS.supports('background', 'color-mix(in srgb, white 50%, transparent)'),
    rgba: CSS.supports('background', 'rgba(255, 255, 255, .5)'),
  }))
  const previousPage = await evaluate(() => document.querySelector('.nav-button[aria-current="page"]')?.textContent.trim() || '首页')
  await navigate('更多设置')
  original = await evaluate(previousPage => ({
    page: previousPage, value: document.querySelector('#component-transparency').value,
    preferences: Object.fromEntries(['firefly.component-transparency.v1', 'firefly.app-font-size.v1', 'firefly.card-gap.v1']
      .map(key => [key, localStorage.getItem(key)])),
  }), previousPage)
  for (const value of [0, 40, 80]) {
    await navigate('更多设置')
    await setTransparency(value)
    const sample = { value, settings: await backgrounds({ group: '.settings-group', control: '.home-appearance-control' }),
      preview: await backgrounds({ card: '.home-appearance-preview-card', label: '.home-appearance-preview-card span' }), main: {} }
    if (value !== 40) {
      const clip = await evaluate(() => {
        const preview = document.querySelector('.home-appearance-preview')
        preview.scrollIntoView({ block: 'center' })
        const box = preview.getBoundingClientRect()
        return { x: box.left + scrollX, y: box.top + scrollY, width: box.width, height: box.height, scale: 1 }
      })
      const capture = await call('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true })
      await writeFile(path.join(directory, `${expectBroken ? 'before' : 'after'}-${value}.png`), Buffer.from(capture.data, 'base64'))
    }
    for (const name of ['首页', '收藏', '网站']) {
      await navigate(name)
      sample.main[name] = await backgrounds({ header: '.topbar', bottom: '.bottom-nav',
        card: '.tab-panel-active .category:not(.ungrouped-flat), .tab-panel-active .favorite-card, .tab-panel-active .website-row, .tab-panel-active .empty-state' })
    }
    report.samples.push(sample)
  }
  assert.deepEqual(report.samples[0].settings, report.samples[2].settings, 'The settings page must keep its own background.')
  if (expectBroken) {
    assert.equal(report.engine.colorMix, false)
    assert.deepEqual(report.samples[0].preview, report.samples[2].preview, 'The old-WebView preview failure was not reproduced.')
    assert.equal(report.samples[0].main['首页'].card, report.samples[2].main['首页'].card)
    console.log('PASS: Reproduced unchanged preview/card backgrounds on a WebView without color-mix().')
  } else {
    for (const sample of report.samples) {
      const surface = (100 - sample.value) / 100, label = (92 - sample.value) / 100, header = Math.min(100, 104 - sample.value) / 100
      assert.equal(alpha(sample.preview.card), surface, `Preview card at ${sample.value}%`)
      assert.equal(alpha(sample.preview.label), label, `Preview label at ${sample.value}%`)
      for (const [name, main] of Object.entries(sample.main)) {
        assert.equal(alpha(main.card), surface, `${name} card at ${sample.value}%`)
        assert.equal(alpha(main.bottom), surface, `${name} navigation at ${sample.value}%`)
        assert.equal(alpha(main.header), header, `${name} header at ${sample.value}%`)
      }
    }
    console.log('PASS: Live slider updates preview and all three main pages at 0%, 40%, and 80%; the settings page stays unchanged.')
  }
  await writeFile(path.join(directory, `${expectBroken ? 'before' : 'after'}.json`), JSON.stringify(report, null, 2))
  console.log(`WebView: ${report.engine.userAgent}; color-mix(): ${report.engine.colorMix}`)
} finally {
  try {
    if (call && original) {
      await navigate('更多设置')
      await setTransparency(original.value)
      await evaluate(preferences => {
        for (const [key, value] of Object.entries(preferences)) {
          if (value === null) localStorage.removeItem(key)
          else localStorage.setItem(key, value)
        }
      }, original.preferences)
      await navigate(original.page)
    }
  } finally {
    socket?.close()
    if (port) device('forward', '--remove', `tcp:${port}`)
  }
}
