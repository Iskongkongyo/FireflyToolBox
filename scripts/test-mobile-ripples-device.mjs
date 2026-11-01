// Uses real WebView touch input. Restores every appearance preference it changes.
import assert from 'node:assert/strict'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { connectAndroid } from './android-device-client.mjs'

const artifacts = path.resolve('target-check/mobile-ripples')
await mkdir(artifacts, { recursive: true })
const client = await connectAndroid()
const { call, evaluate } = client
const adb = process.env.FIREFLY_ADB || path.join(process.env.ANDROID_HOME || path.join(process.env.LOCALAPPDATA, 'Android/Sdk'), 'platform-tools/adb.exe')
const serial = client.device('get-serialno')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const keys = ['firefly.theme.v1', 'firefly.accent.v1', 'firefly.start-page.v1', 'firefly.startup-splash-enabled.v1', 'firefly.auto-hide-bars.v1']
const original = await evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), keys)
await writeFile(path.join(artifacts, 'device-original-preferences.json'), JSON.stringify(original, null, 2))
const report = { android: client.device('shell', 'getprop', 'ro.build.version.release'), checks: [] }
async function wait(fn, ...args) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (await evaluate(fn, ...args)) return
    await delay(100)
  }
  throw new Error(`Timed out: ${fn}`)
}
async function reload(theme = 'light', accent = '') {
  await evaluate((theme, accent) => {
    localStorage.setItem('firefly.theme.v1', theme)
    localStorage.setItem('firefly.accent.v1', accent)
    localStorage.setItem('firefly.start-page.v1', 'home')
    localStorage.setItem('firefly.startup-splash-enabled.v1', 'false')
    localStorage.setItem('firefly.auto-hide-bars.v1', 'false')
  }, theme, accent)
  await call('Page.reload')
  await wait(() => {
    const app = document.querySelector('.app-shell')
    return app && !app.inert && getComputedStyle(app).display !== 'none' && document.querySelectorAll('.bottom-nav button').length === 3
  })
}
async function point(selector) {
  return evaluate(selector => {
    const rect = document.querySelector(selector)?.getBoundingClientRect()
    return rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null
  }, selector)
}
let touching = false
async function start(p) {
  await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...p, id: 1 }] })
  touching = true
}
async function end() {
  if (!touching) return
  try { await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }) }
  finally { touching = false }
}
const clean = () => wait(() => !document.querySelector('.mobile-ripple-layer, [data-mobile-ripple]'))
async function check(name, run) { await run(); report.checks.push(name); console.log(`PASS: ${name}`) }

try {
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
  await reload()
  await check('three bottom tabs respond to real touch, retain feedback after navigation and clean up', async () => {
    for (const [index, label] of [[2, '收藏'], [3, '网站'], [1, '首页']]) {
      const selector = `.bottom-nav button:nth-child(${index})`, p = await point(selector)
      await start(p)
      assert.equal(await evaluate(selector => document.querySelector(selector).querySelectorAll('.mobile-ripple-layer').length, selector), 1)
      await end()
      await wait(label => document.querySelector('.bottom-nav button.active')?.textContent.trim() === label, label)
      await clean()
    }
  })
  await check('default and custom accents match the light and dark theme on the device', async () => {
    for (const theme of ['light', 'dark']) for (const accent of ['', '#7056b6']) {
      await reload(theme, accent)
      await start(await point('.bottom-nav button'))
      await delay(130)
      const sample = await evaluate(() => {
        const layer = document.querySelector('.mobile-ripple-layer'), wave = layer?.firstElementChild
        const probe = document.createElement('i'); probe.style.color = 'var(--accent)'; document.body.append(probe)
        const accent = getComputedStyle(probe).color; probe.remove()
        return { color: layer && getComputedStyle(layer).color, opacity: wave && Number(getComputedStyle(wave).opacity), accent }
      })
      assert.equal(sample.color, sample.accent)
      assert.equal(sample.opacity, theme === 'dark' ? .18 : .14)
      // Capture the actual Android display; CDP screenshots can distort fixed
      // headers on WebViews with edge-to-edge system insets.
      const screenshot = execFileSync(adb, ['-s', serial, 'exec-out', 'screencap', '-p'], { maxBuffer: 8 * 1024 * 1024, timeout: 10000, windowsHide: true })
      await writeFile(path.join(artifacts, `device-${theme}${accent ? '-custom' : ''}.png`), screenshot)
      await end()
      await clean()
    }
  })
  await reload()
  const headerSelector = '.tab-panel-active .category-header'
  await wait(selector => !!document.querySelector(selector), headerSelector)
  await check('horizontal touch starting on a category still swipes to favorites', async () => {
    const p = await point(headerSelector)
    await start(p)
    await call('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x - 135, y: p.y, id: 1 }] })
    await end()
    await wait(() => document.querySelector('.bottom-nav button.active')?.textContent.trim() === '收藏')
    await clean()
  })
  await reload()
  await check('long-press sorting clears the ripple before sorting and suppresses the click', async () => {
    const before = await evaluate(selector => document.querySelector(selector).getAttribute('aria-expanded'), headerSelector)
    await start(await point(headerSelector))
    await delay(500)
    assert.equal(await evaluate(() => !!document.querySelector('.swap-origin')), true)
    await clean()
    await end()
    assert.equal(await evaluate(selector => document.querySelector(selector).getAttribute('aria-expanded'), headerSelector), before)
    assert.equal(await evaluate(() => !!document.querySelector('.swap-origin')), false)
  })
  await check('reduced-motion preference shows a still highlight without an expansion animation', async () => {
    await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    await start(await point('.bottom-nav button'))
    const css = await evaluate(() => {
      const wave = document.querySelector('.mobile-ripple-wave'), style = getComputedStyle(wave)
      return [style.animationName, style.transform, style.left, style.top]
    })
    assert.deepEqual(css, ['none', 'none', '0px', '0px'])
    await end()
    await clean()
  })
} finally {
  try {
    await end().catch(() => {})
    await call('Emulation.setEmulatedMedia', { features: [] })
    await evaluate(original => {
      for (const [key, value] of Object.entries(original)) value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value)
    }, original)
    await call('Page.reload')
    await wait(() => {
      const app = document.querySelector('.app-shell')
      return app && !app.inert && getComputedStyle(app).display !== 'none'
    })
    assert.deepEqual(await evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), keys), original)
    report.preferencesRestored = true
    await writeFile(path.join(artifacts, 'device-results.json'), JSON.stringify(report, null, 2))
  } finally { client.close() }
}
