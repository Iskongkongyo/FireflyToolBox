import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { connectWindows } from './windows-test-client.mjs'
import { connectAndroid } from './android-device-client.mjs'

export async function deviceCheck({ mode, directory, cases, measureButtons, assertFullRows, assertDesktopButtons }) {
  const windows = mode === 'windows', keepAlive = setInterval(() => {}, 1000)
  let client
  try { client = await (windows ? connectWindows() : connectAndroid()) }
  catch (error) { clearInterval(keepAlive); throw error }
  const keys = ['firefly.startup-splash-enabled.v1', 'firefly.smart-clipboard.v1', 'firefly.usage-stats.v1', 'firefly.web-tool-default-fullscreen.v1', 'firefly.web-tool-fullscreen-initial-hint.v1', 'firefly.remote-messages.read.v1']
  const out = path.join(directory, mode), report = { checks: [], unavailableFeeds: [], preferencesRestored: false, dataRestored: false }
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  let preferences, storage, stayAwake
  fs.mkdirSync(out, { recursive: true })
  async function until(fn, ...args) {
    for (let i = 0; i < 200; i++) { if (await client.evaluate(fn, ...args)) return; await pause(100) }
    throw Error('Timed out: ' + fn)
  }
  async function nav(label) { await client.evaluate(label => [...document.querySelectorAll('.nav-button')].find(b => b.textContent.trim() === label).click(), label) }
  async function ready() {
    await until(() => { document.querySelector('.startup-splash-skip')?.click(); const a = document.querySelector('.app-shell'); return a && getComputedStyle(a).display !== 'none' })
    await nav('关于应用'); await until(() => document.querySelector('.about-link')?.disabled === false)
    for (let i = 0; i < 4; i++) {
      const dismissed = await client.evaluate(() => { const d = document.querySelector('.remote-message-dialog[open]'); if (!d) return false; if (d.classList.contains('remote-message-required')) throw Error('Mandatory update'); (d.querySelector('.secondary-button') || d.querySelector('.primary-button')).click(); return true })
      if (!dismissed) break; await pause(150)
    }
  }
  async function frame(fn, ...args) {
    const tree = await client.call('Page.getFrameTree'), find = n => n.frame.url === 'about:srcdoc' ? n.frame : n.childFrames?.map(find).find(Boolean), target = find(tree.frameTree)
    assert(target, 'Missing web tool frame')
    const world = await client.call('Page.createIsolatedWorld', { frameId: target.id, worldName: 'mobile-tool-buttons' })
    const value = await client.call('Runtime.evaluate', { expression: `(${fn})(${args.map(v => JSON.stringify(v)).join(',')})`, contextId: world.executionContextId, returnByValue: true, awaitPromise: true })
    if (value.exceptionDetails) throw Error(JSON.stringify(value.exceptionDetails)); return value.result.value
  }
  async function open(id) {
    await nav('工具管理')
    const details = await client.invoke('get_module_details', { moduleId: 'builtin.' + id })
    assert.equal(details.modified, false, id + ': test the factory tool without replacing user edits')
    await client.evaluate(name => [...document.querySelectorAll('.all-tool-item')].find(n => n.querySelector('.all-tool-name')?.textContent === name && n.querySelector('.all-tool-source')?.textContent === '应用自带').click(), details.manifest.tools[0].name['zh-CN'])
    await until(() => document.querySelector('.web-tool-container')?.getAttribute('aria-busy') === 'false' && !document.querySelector('.web-tool-opening-cover'))
  }
  try {
    await until(() => { const a = document.querySelector('.app-shell'); return a && getComputedStyle(a).display !== 'none' })
    preferences = await client.evaluate(keys => Object.fromEntries(keys.map(k => [k, localStorage.getItem(k)])), keys)
    storage = Object.fromEntries(await Promise.all(cases.map(async ([id]) => [id, await client.invoke('load_tool_storage', { moduleId: 'tool.' + id, legacyJson: '{}', readOnly: true })])))
    fs.writeFileSync(path.join(out, 'original-state.json'), JSON.stringify({ preferences, storage }, null, 2))
    if (!windows) {
      assert(!/mIsShowing=true/.test(client.device('shell', 'dumpsys', 'window', 'policy')), 'Unlock the phone for native layout testing')
      stayAwake = client.device('shell', 'settings', 'get', 'global', 'stay_on_while_plugged_in'); client.device('shell', 'svc', 'power', 'stayon', 'usb')
    }
    await client.evaluate(keys => keys.filter(k => !k.includes('.read.')).forEach(k => localStorage.setItem(k, 'false')), keys)
    // Temporary feed caches give native rendering stable content even offline.
    await client.invoke('save_tool_storage', { moduleId: 'tool.trending.live', valuesJson: JSON.stringify({ platform: JSON.stringify('baidu'), 'last-board': JSON.stringify({ id: 'baidu', time: Date.now(), rows: [{ title: '布局验证热点', hot: '12345', rank: 1, url: 'https://www.baidu.com/s?wd=test' }] }) }) })
    await client.invoke('save_tool_storage', { moduleId: 'tool.currency.today', valuesJson: JSON.stringify({ 'daily-rates.cache': JSON.stringify({ rows: [{ code: 'USD', rate: .14, date: '2026-10-29' }, { code: 'EUR', rate: .13, date: '2026-10-29' }] }) }) })
    await client.call('Page.reload'); await ready()
    for (const [id, , allSelectors] of cases) {
      await open(id)
      if (id === 'date.calendar') for (let i = 0; i < 100 && !await frame(() => document.querySelector('#details').children.length > 0); i++) await pause(100)
      let selector = allSelectors
      if (id === 'history.today') {
        for (let i = 0; i < 60 && !await frame(() => !!document.querySelector('#events article button')); i++) await pause(100)
        if (!await frame(() => !!document.querySelector('#events article button'))) { selector = '#refresh'; report.unavailableFeeds.push(id) }
      }
      const rows = await frame(measureButtons, selector), viewport = await frame(() => ({ width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth }))
      assert.equal(viewport.overflow, false, id + ': horizontal overflow')
      if (windows) {
        assert(viewport.width > 600)
        assertDesktopButtons(rows, id)
      } else {
        assert.equal(await frame(() => matchMedia('(hover:none) and (pointer:coarse)').matches), true)
        assertFullRows(rows, id)
      }
      await frame(selector => document.querySelector(selector).scrollIntoView({ block: 'center', behavior: 'instant' }), selector.split(',')[0])
      const shot = await client.call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(out, id + '.png'), Buffer.from(shot.data, 'base64'))
      report.checks.push({ id, viewport, buttons: rows }); console.log('PASS:', mode, id, rows.length, 'buttons')
    }
  } catch (error) { report.error = String(error.stack || error); throw error }
  finally {
    try {
      await nav('首页'); await pause(200)
      if (storage) {
        for (const [id, json] of Object.entries(storage)) await client.invoke('save_tool_storage', { moduleId: 'tool.' + id, valuesJson: json ?? '{}' })
        for (const [id, json] of Object.entries(storage)) assert.deepEqual(JSON.parse(await client.invoke('load_tool_storage', { moduleId: 'tool.' + id, legacyJson: '{}', readOnly: true })), JSON.parse(json ?? '{}'))
        report.dataRestored = true
      }
      if (preferences) {
        const restore = () => client.evaluate(saved => { for (const [k, v] of Object.entries(saved)) v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v) }, preferences)
        await restore(); await client.call('Page.reload'); await ready(); await nav('首页'); await restore()
        assert.deepEqual(await client.evaluate(keys => Object.fromEntries(keys.map(k => [k, localStorage.getItem(k)])), keys), preferences); report.preferencesRestored = true
      }
    } finally {
      fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(report, null, 2))
      if (stayAwake !== undefined) { if (/^\d+$/.test(stayAwake)) client.device('shell', 'settings', 'put', 'global', 'stay_on_while_plugged_in', stayAwake); else if (stayAwake === 'null') client.device('shell', 'settings', 'delete', 'global', 'stay_on_while_plugged_in') }
      client.close(); clearInterval(keepAlive)
    }
  }
}
