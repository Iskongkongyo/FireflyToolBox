// Windows WebView2 controls and real Windows/Android encrypted preference sync.
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { connectWindows } from './windows-test-client.mjs'
import { connectAndroid } from './android-device-client.mjs'

const directory = path.resolve('target-check/web-tool-budget-settings/windows')
await mkdir(directory, { recursive: true })
const windows = await connectWindows()
let android
const keys = ['firefly.web-tool-initialization-ms.v1', 'firefly.web-tool-interaction-ms.v1']
const preferencesBundle = await build({ stdin: { contents: "export {preferenceKeys} from './src/services/preferences.ts'", resolveDir: process.cwd(), sourcefile: 'native-preferences.ts' }, bundle: true, write: false, format: 'esm', platform: 'node' })
const { preferenceKeys } = await import('data:text/javascript;base64,' + Buffer.from(preferencesBundle.outputFiles[0].text).toString('base64'))
const savedKeys = [...preferenceKeys, 'firefly.startup-splash-enabled.v1']
const originals = new Map(), ownedSync = new Set()
const report = { checks: [], preferencesRestored: false, transport: 'Native encrypted sync through ADB forwarding; does not test Wi-Fi reachability.' }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function wait(client, fn, ...args) {
  for (let attempt = 0; attempt < 180; attempt++) {
    const result = await client.evaluate(fn, ...args)
    if (result) return result
    await pause(100)
  }
  throw new Error(`Timed out: ${fn}`)
}
async function check(name, work) { await work(); report.checks.push(name); console.log('PASS:', name) }
async function ready(client) {
  await wait(client, () => { const app = document.querySelector('.app-shell'); return app && !app.inert && getComputedStyle(app).display !== 'none' })
}
async function settings(client) {
  await ready(client)
  await client.evaluate(() => [...document.querySelectorAll('.nav-button')].find(button => button.textContent.trim() === '更多设置').click())
  await wait(client, () => !!document.getElementById('web-tool-initialization-budget'))
  await client.evaluate(async () => { await Promise.all(document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation => animation.finished.catch(() => {}))) })
}
async function click(client, selector) {
  const point = await client.evaluate(async selector => {
    const node = document.querySelector(selector); if (!node) throw new Error(`Missing ${selector}`)
    node.scrollIntoView({ block: 'center', behavior: 'instant' })
    await new Promise(resolve => setTimeout(resolve, 500))
    const rect = node.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  }, selector)
  if (client === windows) {
    await client.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
    await client.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
  } else {
    await client.call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] })
    await client.call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
}
async function select(client, id, label) {
  await click(client, '#' + id)
  const index = await wait(client, label => { const index = [...document.querySelectorAll('[role="option"]')].findIndex(node => node.textContent === label); return index < 0 ? false : index + 1 }, label)
  await click(client, `.viewport-select-menu [role="option"]:nth-child(${index})`)
  await wait(client, () => !document.querySelector('.viewport-select-menu'))
}
async function press(client, name) {
  await wait(client, name => [...document.querySelectorAll('button')].some(node => node.textContent.trim() === name && !node.disabled), name)
  await client.evaluate(name => {
    const button = [...document.querySelectorAll('button')].find(node => node.textContent.trim() === name)
    if (!button || button.disabled) throw new Error(`Unavailable button: ${name}`)
    button.click()
  }, name)
}
async function syncPage(client) {
  await settings(client)
  await client.evaluate(() => [...document.querySelectorAll('.settings-page button')].find(node => node.querySelector('strong')?.textContent === '设备同步').click())
  await wait(client, () => !!document.querySelector('.device-sync'))
}
async function values(client) { return client.evaluate(keys => keys.map(key => localStorage.getItem(key)), keys) }
async function screenshot(client, filename) {
  await client.evaluate(() => document.querySelector('[aria-labelledby="settings-web-tool-title"]').scrollIntoView({ block: 'start', behavior: 'instant' }))
  await pause(200)
  const image = await client.call('Page.captureScreenshot', { format: 'png' })
  await writeFile(path.join(directory, filename), Buffer.from(image.data, 'base64'))
}
async function roundtrip(source, target, expected) {
  const before = await values(target)
  await syncPage(source); ownedSync.add(source)
  await source.evaluate(() => {
    document.querySelectorAll('.device-sync details').forEach(details => { details.open = true })
    for (const label of document.querySelectorAll('.device-sync .sync-option')) {
      const input = label.querySelector('input'), selected = label.querySelector('strong')?.textContent === '界面与使用偏好'
      if (input.checked !== selected) input.click()
    }
  })
  await press(source, '开启同步')
  const connection = await wait(source, () => {
    const address = document.querySelector('.sync-address code')?.textContent, code = document.querySelector('.sync-pair-code code')?.textContent
    const error = document.querySelector('.sync-error')?.textContent; if (error) throw new Error(error)
    return address && code ? { address, code } : false
  })
  const nativePort = connection.address.split(':').at(-1)
  const bridge = source === windows ? android.device('reverse', 'tcp:0', `tcp:${nativePort}`) : android.device('forward', 'tcp:0', `tcp:${nativePort}`)
  try {
    await syncPage(target); ownedSync.add(target); await press(target, '从其他设备接收')
    await target.evaluate(({ endpoint, code }) => {
      const inputs = document.querySelectorAll('.sync-field input')
      for (const [input, value] of [[inputs[0], endpoint], [inputs[1], code]]) { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })) }
    }, { endpoint: `127.0.0.1:${bridge}`, code: connection.code })
    await press(target, '连接并预览')
    await wait(target, () => {
      const error = document.querySelector('.sync-error')?.textContent; if (error) throw new Error(error)
      return !!document.querySelector('.sync-preview-heading')
    })
    assert.deepEqual(await values(target), before, 'Preview must not change the receiver settings.')
    const description = await target.evaluate(() => [...document.querySelectorAll('.sync-option')].find(node => node.querySelector('strong')?.textContent === '界面与使用偏好').textContent)
    assert.match(description, /初始化预算/); assert.match(description, /挂载后交互预算/)
    await target.evaluate(() => {
      const label = [...document.querySelectorAll('.sync-option')].find(node => node.querySelector('strong')?.textContent === '界面与使用偏好')
      const input = label.querySelector('input'); if (input.checked) throw new Error('Preference import should be opt-in.'); input.click()
    })
    await press(target, '导入所选内容'); await wait(target, () => !!document.querySelector('.sync-completed'))
    assert.equal(await target.evaluate(() => document.querySelector('.sync-completed .sync-error')?.textContent || ''), '')
    assert.deepEqual(await values(target), expected)
    try { await press(target, '完成') } catch (error) { if (!/context|navigation/i.test(error.message)) throw error }
    await settings(target)
    assert.deepEqual(await values(target), expected)
  } finally {
    android.device(source === windows ? 'reverse' : 'forward', '--remove', `tcp:${bridge}`)
    await source.invoke('sync_close')
  }
}

try {
  await ready(windows)
  originals.set(windows, await windows.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), savedKeys))
  await settings(windows)
  await check('Windows: mouse selects both budgets, reload retains choices, and cards fit desktop', async () => {
    await select(windows, 'web-tool-initialization-budget', '10 秒')
    await select(windows, 'web-tool-interaction-budget', '30 秒')
    await windows.call('Page.reload'); await settings(windows)
    assert.deepEqual(await values(windows), ['10000', '30000'])
    assert.equal(await windows.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await screenshot(windows, 'cards-light.png')
    await windows.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
    await screenshot(windows, 'cards-dark.png')
    await windows.call('Emulation.setEmulatedMedia', { features: [] })
  })
  await check('Windows: the native sandbox accepts initialization and interaction longer than the defaults', async () => {
    const bundle = await build({ entryPoints: ['src/services/browserModule.ts'], bundle: true, write: false, format: 'iife', globalName: 'BudgetLayoutReview', platform: 'browser' })
    await windows.call('Runtime.evaluate', { expression: bundle.outputFiles[0].text })
    await windows.evaluate(() => {
      const host = document.createElement('div'); host.id = 'budget-layout-review'; host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:white'; document.body.append(host)
      window.budgetReady = false; window.budgetErrors = []
      window.BudgetLayoutReview.mountWebTool(host, { moduleId: 'preview.budget-review', html: '<button id="run">Run</button><output id="result"></output>', css: '',
        script: 'function busy(ms){const end=performance.now()+ms;while(performance.now()<end){}};export function mount(){busy(5400);document.getElementById("run").onclick=()=>{busy(10400);document.getElementById("result").textContent="Completed"}}',
        networkHosts: [], timeoutMs: 1000, inputBytes: 8388608, outputBytes: 4194304, openFile: async () => null, saveFile: async () => true, onError: error => window.budgetErrors.push(error),
      }).then(() => { window.budgetReady = true }).catch(error => window.budgetErrors.push(error.message))
    })
    await wait(windows, () => window.budgetReady || window.budgetErrors.length)
    assert.deepEqual(await windows.evaluate(() => window.budgetErrors), [])
    const tree = await windows.call('Page.getFrameTree'), child = tree.frameTree.childFrames.find(item => item.frame.url === 'about:srcdoc')
    assert(child)
    const world = await windows.call('Page.createIsolatedWorld', { frameId: child.frame.id, worldName: 'budget-layout-review' })
    await windows.call('Runtime.evaluate', { expression: 'document.getElementById("run").click()', contextId: world.executionContextId })
    const result = await windows.call('Runtime.evaluate', { expression: 'document.getElementById("result").textContent', contextId: world.executionContextId, returnByValue: true })
    assert.equal(result.result.value, 'Completed')
    assert.deepEqual(await windows.evaluate(() => window.budgetErrors), [])
    await windows.evaluate(() => { window.BudgetLayoutReview.stopBrowserModule(); document.getElementById('budget-layout-review').remove() })
  })
  await check('Windows: restore defaults clears both overrides', async () => {
    await settings(windows); await click(windows, '.web-tool-budget-settings .text-button')
    assert.deepEqual(await values(windows), [null, null])
  })
  if (process.argv.includes('--with-android-sync')) {
    android = await connectAndroid(); await ready(android)
    originals.set(android, await android.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), savedKeys))
    await writeFile(path.join(directory, 'android-original-preferences.json'), JSON.stringify(originals.get(android), null, 2))
    for (const client of [windows, android]) {
      const state = await client.invoke('sync_status'); assert(!state || !['waiting', 'transferring'].includes(state.state), 'A user sync is already active.')
    }
    await check('Windows → Android: the actual preference UI transfers a custom limit and unlimited', async () => {
      await settings(windows); await select(windows, 'web-tool-initialization-budget', '30 秒'); await select(windows, 'web-tool-interaction-budget', '不限制')
      await roundtrip(windows, android, ['30000', '0'])
      await screenshot(android, 'android-received.png')
    })
    await check('Android → Windows: the actual preference UI transfers both independent limits', async () => {
      await settings(android); await select(android, 'web-tool-initialization-budget', '60 秒'); await select(android, 'web-tool-interaction-budget', '120 秒')
      await roundtrip(android, windows, ['60000', '120000'])
    })
    await check('Windows → Android: restored defaults replace the receiver custom limits', async () => {
      await settings(windows); await click(windows, '.web-tool-budget-settings .text-button')
      assert.deepEqual(await values(windows), [null, null])
      await roundtrip(windows, android, ['5000', '10000'])
    })
  }
} catch (error) {
  await writeFile(path.join(directory, 'error.txt'), String(error.stack || error)); throw error
} finally {
  try {
    for (const client of ownedSync) await client.invoke('sync_close').catch(() => {})
    for (const [client, original] of originals) {
      await client.evaluate(original => {
        window.BudgetLayoutReview?.stopBrowserModule(); document.getElementById('budget-layout-review')?.remove()
        for (const [key, value] of Object.entries(original)) value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value)
      }, original)
      await client.call('Page.reload'); await ready(client)
      assert.deepEqual(await client.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), savedKeys), original)
    }
    report.preferencesRestored = true
    await writeFile(path.join(directory, 'windows-results.json'), JSON.stringify(report, null, 2))
  } finally { android?.close(); windows.close() }
}
