import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { connectWindows } from './windows-test-client.mjs'
import { connectAndroid } from './android-device-client.mjs'

const windows = process.argv.includes('--windows'), client = await (windows ? connectWindows() : connectAndroid())
const ids = ['screen.check', 'quote.card'], prefs = ['firefly.startup-splash-enabled.v1', 'firefly.smart-clipboard.v1', 'firefly.usage-stats.v1', 'firefly.web-tool-default-fullscreen.v1', 'firefly.web-tool-fullscreen-initial-hint.v1', 'firefly.remote-messages.read.v1']
const directory = path.resolve('target-check/supplied-builtins', windows ? 'windows' : 'android'), token = crypto.randomUUID().slice(0, 8)
const report = { checks: [], dataRestored: false, preferencesRestored: false }, alive = setInterval(() => {}, 1000)
let original, storage, windowOriginal, stayAwake, pickerOpen = false
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
async function frame(fn, ...args) {
  const tree = await client.call('Page.getFrameTree'), find = n => n.frame.url === 'about:srcdoc' ? n.frame : n.childFrames?.map(find).find(Boolean), target = find(tree.frameTree); assert(target)
  const world = await client.call('Page.createIsolatedWorld', { frameId: target.id, worldName: 'supplied-builtin-review' })
  const result = await client.call('Runtime.evaluate', { expression: `(${fn})(${args.map(v => JSON.stringify(v)).join(',')})`, contextId: world.executionContextId, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result.value
}
async function untilFrame(fn, ...args) { for (let i = 0; i < 200; i++) { if (await frame(fn, ...args)) return; await pause(100) }; throw Error('Frame timed out: ' + fn) }
async function click(selector) { await frame(selector => document.querySelector(selector).click(), selector) }
async function open(id) {
  await nav('工具管理')
  const details = await client.invoke('get_module_details', { moduleId: 'builtin.' + id }), name = details.manifest.tools[0].name['zh-CN']
  await client.evaluate(name => [...document.querySelectorAll('.all-tool-item')].find(n => n.querySelector('.all-tool-name')?.textContent === name && n.querySelector('.all-tool-source')?.textContent === '应用自带').click(), name)
  await until(() => document.querySelector('.web-tool-container')?.getAttribute('aria-busy') === 'false' && !document.querySelector('.web-tool-opening-cover'))
}
const data = async id => JSON.parse(await client.invoke('load_tool_storage', { moduleId: 'tool.' + id, legacyJson: '{}', readOnly: true }) || '{}')
async function shot(name) { const r = await client.call('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(directory, name + '.png'), Buffer.from(r.data, 'base64')) }
async function check(name, fn) { await fn(); report.checks.push(name); console.log('PASS:', name) }
try {
  await until(() => { const app = document.querySelector('.app-shell'); return app && getComputedStyle(app).display !== 'none' })
  original = await client.evaluate(keys => Object.fromEntries(keys.map(k => [k, localStorage.getItem(k)])), prefs)
  storage = Object.fromEntries(await Promise.all(ids.map(async id => [id, await client.invoke('load_tool_storage', { moduleId: 'tool.' + id, legacyJson: '{}', readOnly: true })])))
  await writeFile(path.join(directory, 'original-state.json'), JSON.stringify({ preferences: original, storage }, null, 2))
  if (windows) windowOriginal = await client.invoke('plugin:window|is_fullscreen', { label: 'main' })
  else {
    const state = client.device('shell', 'dumpsys', 'window', 'policy'); assert(!/mIsShowing=true/.test(state), 'Unlock the device before testing native fullscreen and the save picker')
    stayAwake = client.device('shell', 'settings', 'get', 'global', 'stay_on_while_plugged_in'); client.device('shell', 'svc', 'power', 'stayon', 'usb')
  }
  await client.evaluate(keys => keys.filter(k => !k.includes('.read.')).forEach(k => localStorage.setItem(k, 'false')), prefs)
  for (const id of ids) await client.invoke('save_tool_storage', { moduleId: 'tool.' + id, valuesJson: '{}' })
  await client.call('Page.reload'); await ready()
  await check('both tools appear once as editable built-in web tools with the supplied author and capabilities', async () => {
    const tools = await client.invoke('list_tools')
    for (const id of ids) {
      const matches = tools.filter(t => t.id === id); assert.equal(matches.length, 1); assert.equal(matches[0].builtin, true); assert.equal(matches[0].ui_kind, 'web')
      const details = await client.invoke('get_module_details', { moduleId: 'builtin.' + id }); assert.equal(details.builtin, true); assert.equal(details.modified, false); assert.equal(details.manifest.author, '流萤可爱捏')
    }
  })
  await check('screen checker enters true native fullscreen and switches pure color patterns', async () => {
    await open('screen.check'); assert.equal(await client.evaluate(() => document.documentElement.dataset.toolFullscreen), 'true')
    if (windows) assert.equal(await client.invoke('plugin:window|is_fullscreen', { label: 'main' }), true)
    else await until(() => window.FireflyInsets.top() === 0 && window.FireflyInsets.bottom() === 0)
    await click('#btnStart'); assert.equal(await frame(() => document.querySelector('#metaCount').textContent), '1 / 21')
    assert.equal(await frame(() => getComputedStyle(document.querySelector('#stage')).backgroundColor), 'rgb(255, 255, 255)')
    await click('#btnNext'); assert.equal(await frame(() => document.querySelector('#metaCount').textContent), '2 / 21')
    assert.equal(await frame(() => getComputedStyle(document.querySelector('#stage')).backgroundColor), 'rgb(0, 0, 0)')
    await frame(() => { for (let i = 0; i < 14; i++) document.querySelector('#btnNext').click() })
    const pixels = await frame(() => { const c = document.querySelector('#cv'), r = document.querySelector('#stage').getBoundingClientRect(); return { width: c.width, height: c.height, expectedWidth: Math.round(r.width * devicePixelRatio), expectedHeight: Math.round(r.height * devicePixelRatio), dpr: devicePixelRatio } })
    assert.equal(pixels.width, pixels.expectedWidth); assert.equal(pixels.height, pixels.expectedHeight); report.screenPixelMapping = pixels
    await shot('screen')
  })
  await check('screen preferences commit to real SQLite and survive reopening; leaving restores native bars/window', async () => {
    await click('#btnCfg'); await click('[data-key=autoMs] [data-v="3000"]'); await click('[data-key=groups] [data-g=motion]'); await click('#btnClose')
    for (let i = 0; i < 100 && JSON.parse((await data('screen.check'))['screen_check.prefs.v1'] || '{}').autoMs !== 3000; i++) await pause(100)
    assert.equal(JSON.parse((await data('screen.check'))['screen_check.prefs.v1']).autoMs, 3000)
    await nav('首页'); await until(() => !document.documentElement.dataset.toolFullscreen)
    if (windows) assert.equal(await client.invoke('plugin:window|is_fullscreen', { label: 'main' }), windowOriginal)
    else await until(() => window.FireflyInsets.top() > 0 || window.FireflyInsets.bottom() > 0)
    await open('screen.check'); assert.equal(await frame(() => document.querySelector('#intro').hidden), true); assert.match(await frame(() => document.querySelector('#metaCount').textContent), /\/ 18$/)
  })
  const text = '内置卡片真机测试 ' + token
  await check('quote card generates custom artwork and persists favorites and layout in SQLite', async () => {
    await open('quote.card'); assert.equal(await client.evaluate(() => !!document.documentElement.dataset.toolFullscreen), false)
    await click('#btnWrite'); await frame(text => { document.querySelector('#txt').value = text; document.querySelector('#who').value = '流萤测试'; document.querySelector('#btnApply').click() }, text)
    await untilFrame(text => document.querySelector('#card').getAttribute('aria-label')?.includes(text), text)
    await click('[data-theme=neon]'); await click('#segRatio [data-v="9-16"]'); await click('.switch:has(#chkVertical)'); await click('#btnFav')
    for (let i = 0; i < 100 && !(await data('quote.card'))['quote_card.favs.v1']; i++) await pause(100)
    assert.equal(JSON.parse((await data('quote.card'))['quote_card.favs.v1'])[0].text, text)
    await nav('首页'); await open('quote.card'); assert.equal(await frame(() => document.querySelector('#favCount').textContent), '1 条')
    await click('[data-i="0"]'); await untilFrame(text => document.querySelector('#card').getAttribute('aria-label')?.includes(text), text)
    assert.equal(await frame(() => document.querySelector('#chkVertical').checked), true); await shot('quote')
  })
  await check(windows ? 'real HD PNG export saves through the native Windows picker' : 'real HD PNG export reaches the Android document picker and cancellation recovers the tool', async () => {
    await click('#btnSave'); pickerOpen = true
    if (windows) {
      const output = path.join(directory, `quote-card-${token}.png`), spec = path.join(directory, 'save-dialog.json')
      await writeFile(spec, JSON.stringify({ title: '保存处理结果', processId: client.pid, path: output }))
      let saved = false
      for (let i = 0; i < 50; i++) {
        const r = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', 'scripts/windows-file-picker.ps1', '-Action', 'save', '-PathsFile', spec], { encoding: 'utf8', windowsHide: true }))
        if (r.saved) { saved = true; break }
        const status = await frame(() => document.querySelector('#status')?.textContent)
        if (status?.includes('保存失败')) throw Error(status)
        await pause(150)
      }
      assert(saved); await untilFrame(() => document.querySelector('#status').textContent.includes('已保存'))
      const png = await readFile(output); assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a'); assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [2160, 3840]); report.exportedPng = output
    } else {
      let opened = false
      for (let i = 0; i < 100; i++) { if (/(?:topResumedActivity=|ResumedActivity:).*documentsui/i.test(client.device('shell', 'dumpsys', 'activity', 'activities'))) { opened = true; break }; await pause(100) }
      assert(opened); client.device('shell', 'input', 'keyevent', '4'); await pause(500)
      if (/(?:topResumedActivity=|ResumedActivity:).*documentsui/i.test(client.device('shell', 'dumpsys', 'activity', 'activities'))) client.device('shell', 'input', 'keyevent', '4')
      await untilFrame(() => document.querySelector('#status').textContent.includes('取消')); assert.equal(await frame(() => document.querySelector('#btnSave').disabled), false)
    }
    pickerOpen = false
  })
} catch (error) {
  report.error = String(error.stack || error)
  try { report.toolStatus = await frame(() => ({ status: document.querySelector('#status')?.textContent, save: document.querySelector('#btnSave')?.textContent })); report.hostError = await client.evaluate(() => document.querySelector('.web-tool-page .editor-status.error')?.textContent); await shot('error') } catch {}
  throw error
} finally {
  try {
    if (pickerOpen && windows) {
      const spec = path.join(directory, 'cancel-dialog.json'); await writeFile(spec, JSON.stringify({ title: '保存处理结果', processId: client.pid }))
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', 'scripts/windows-file-picker.ps1', '-Action', 'cancel', '-PathsFile', spec], { encoding: 'utf8', windowsHide: true })
    }
    if (pickerOpen && !windows && /(?:topResumedActivity=|ResumedActivity:).*documentsui/i.test(client.device('shell', 'dumpsys', 'activity', 'activities'))) client.device('shell', 'input', 'keyevent', '4')
    await nav('首页'); await pause(150)
    if (storage) {
      for (const [id, json] of Object.entries(storage)) await client.invoke('save_tool_storage', { moduleId: 'tool.' + id, valuesJson: json ?? '{}' })
      for (const [id, json] of Object.entries(storage)) assert.deepEqual(await data(id), JSON.parse(json ?? '{}'))
      report.dataRestored = true
    }
    if (original) {
      const restore = () => client.evaluate(saved => { for (const [k, v] of Object.entries(saved)) v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v) }, original)
      await restore(); await client.call('Page.reload'); await ready(); await nav('首页'); await restore()
      assert.deepEqual(await client.evaluate(keys => Object.fromEntries(keys.map(k => [k, localStorage.getItem(k)])), prefs), original); report.preferencesRestored = true
    }
    await writeFile(path.join(directory, 'results.json'), JSON.stringify(report, null, 2))
  } finally {
    if (stayAwake !== undefined) { if (/^\d+$/.test(stayAwake)) client.device('shell', 'settings', 'put', 'global', 'stay_on_while_plugged_in', stayAwake); else if (stayAwake === 'null') client.device('shell', 'settings', 'delete', 'global', 'stay_on_while_plugged_in') }
    client.close(); clearInterval(alive)
  }
}
