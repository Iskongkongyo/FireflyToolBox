import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { capacityFixture } from './module-capacity-fixtures.mjs'
import { connectAndroid, androidUiNodes } from './android-device-client.mjs'
import { connectWindows } from './windows-test-client.mjs'

const windows = process.argv.includes('--windows'), client = await (windows ? connectWindows() : connectAndroid())
const token = crypto.randomUUID().replaceAll('-', '').slice(0, 8)
const directory = path.resolve('target-check/module-import', windows ? 'windows' : client.device('get-serialno'))
await mkdir(directory, { recursive: true })
const remoteXml = `/data/local/tmp/firefly-import-${token}.xml`, samples = [], report = { platform: windows ? 'windows' : 'android', checks: [], cleaned: false }
const splashKey = 'firefly.startup-splash-enabled.v1'
let originalSplash
let pickerOpen = false
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function wait(fn, ...args) {
  for (let attempt = 0; attempt < 150; attempt++) { const value = await client.evaluate(fn, ...args); if (value) return value; await pause(100) }
  throw new Error(`Timed out: ${fn}`)
}
async function check(name, work) { await work(); report.checks.push(name); console.log('PASS:', name) }
async function ready() { await wait(() => { const app = document.querySelector('.app-shell'); return app && !app.inert && getComputedStyle(app).display !== 'none' }) }
async function click(selector) {
  const point = await client.evaluate(async selector => {
    const node = document.querySelector(selector); if (!node) throw new Error('Missing control ' + selector)
    node.scrollIntoView({ block: 'center', behavior: 'instant' }); await new Promise(resolve => setTimeout(resolve, 500))
    const rect = node.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  }, selector)
  if (windows) {
    await client.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
    await client.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
  } else {
    await client.call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] })
    await client.call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
}
async function pack(sample, broken = false) {
  const files = { 'manifest.json': strToU8(JSON.stringify(sample.manifest)) }
  for (const name of ['page-0.html', 'style-0.css', 'main-0.js']) files[name] = broken && name.endsWith('.js') ? strToU8('export function mount(') : await readFile(path.join(sample.folder, name))
  await writeFile(sample.file, zipSync(files, { level: 0 }))
  if (!windows) {
    client.device('push', sample.file, sample.remote)
    client.device('shell', 'am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', 'file://' + sample.remote)
  }
}
function windowsPicker(action) {
  const input = path.join(directory, 'picker-files.json'); writeFileSync(input, JSON.stringify({ title: '选择 .fftool 工具包' }))
  return JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', 'scripts/windows-file-picker.ps1', '-Action', action, '-PathsFile', input], { encoding: 'utf8', timeout: 15000, windowsHide: true }))
}
function hierarchy() { client.device('shell', 'uiautomator', 'dump', remoteXml); return androidUiNodes(client.device('shell', 'cat', remoteXml)) }
function tap(node, long = false) {
  assert(node, 'Native picker item is missing')
  const bounds = node.bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)
  const x = String(Math.round((Number(bounds[1]) + Number(bounds[3])) / 2)), y = String(Math.round((Number(bounds[2]) + Number(bounds[4])) / 2))
  client.device('shell', 'input', ...(long ? ['swipe', x, y, x, y, '800'] : ['tap', x, y]))
}
const fileNode = (nodes, name) => nodes.find(node => node.text === name || node['content-desc']?.startsWith(name + ','))
async function chooseSamples(selected, cancel = false) {
  if (windows && !cancel) {
    const paths = selected.map(sample => sample.file)
    await client.invoke('plugin:event|emit', { event: 'tauri://drag-drop', payload: { paths, position: { x: 50, y: 50 } } })
    await wait(() => !document.querySelector('.module-import-item.import-checking, .module-import-item.import-waiting') && document.querySelectorAll('.module-import-item').length > 0)
    return
  }
  await client.evaluate(() => document.querySelector('#studio-panel-import .module-import-button').click()); pickerOpen = true
  if (windows) {
    let found = false
    for (let attempt = 0; attempt < 30; attempt++) { found = windowsPicker('cancel').found; if (found) break; await pause(200) }
    assert(found, 'The real Windows file picker did not open')
  } else if (process.argv.includes('--manual-picker')) {
    console.log(cancel ? 'Cancel the Android file picker to continue.' : 'Select these files together in Downloads: ' + selected.map(sample => sample.name).join(', '))
    for (let attempt = 0; attempt < 1200; attempt++) {
      if (await client.evaluate(() => !document.querySelector('.module-import-button')?.disabled)) break
      await pause(100)
    }
  } else {
    let nodes
    for (let attempt = 0; attempt < 15; attempt++) { nodes = hierarchy(); if (nodes.some(node => node.package?.includes('documentsui'))) break; await pause(200) }
    assert(nodes.some(node => node.package?.includes('documentsui')), 'The Android file picker did not open')
    if (cancel) client.device('shell', 'input', 'keyevent', '4')
    else {
      if (!selected.some(sample => fileNode(nodes, sample.name))) {
        const drawer = nodes.find(node => /Show roots|Show navigation|显示根目录|显示导航|打开导航/.test(node['content-desc'] || ''))
        if (drawer) { tap(drawer); await pause(300); nodes = hierarchy() }
        tap(nodes.find(node => /^(Downloads|下载)$/.test(node.text || '')))
        await pause(400); nodes = hierarchy()
      }
      tap(fileNode(nodes, selected[0].name), selected.length > 1)
      for (const sample of selected.slice(1)) { nodes = hierarchy(); tap(fileNode(nodes, sample.name)) }
      nodes = hierarchy()
      const confirm = nodes.find(node => /^(Select|SELECT|Open|OPEN|选择|打开|确定)(?:[（(].*)?$/.test(node.text || '') && node.clickable === 'true')
      if (confirm) tap(confirm)
    }
  }
  await wait(() => !document.querySelector('.module-import-item.import-checking, .module-import-item.import-waiting') && !document.querySelector('.module-import-button')?.disabled)
  pickerOpen = false
}
async function capture(name) {
  await client.evaluate(() => document.querySelector('.module-import-toolbar').scrollIntoView({ block: 'start', behavior: 'instant' }))
  await pause(300)
  const image = await client.call('Page.captureScreenshot', { format: 'png' })
  await writeFile(path.join(directory, name), Buffer.from(image.data, 'base64'))
}

try {
  await ready()
  originalSplash = await client.evaluate(key => localStorage.getItem(key), splashKey)
  for (let index = 0; index < 3; index++) {
    const sample = { name: `ff-batch-${token}-${index + 1}.fftool`, folder: path.join(directory, 'source-' + index), file: path.join(directory, `ff-batch-${token}-${index + 1}.fftool`), remote: `/sdcard/Download/ff-batch-${token}-${index + 1}.fftool` }
    sample.manifest = await capacityFixture(sample.folder, { moduleId: `dev.example.batch_${token}_${index}` })
    sample.manifest.name = { 'zh-CN': `批量导入 ${index + 1}` }; sample.manifest.tools[0].name = { 'zh-CN': `测试工具 ${index + 1}` }
    samples.push(sample); await pack(sample, index === 1)
  }
  await client.evaluate(key => localStorage.setItem(key, 'false'), splashKey)
  await client.call('Page.reload'); await ready()
  await client.evaluate(() => [...document.querySelectorAll('.nav-button')].find(button => button.textContent.trim() === '工具管理').click())
  await wait(() => !!document.querySelector('[aria-label="打开工具工作台"]'))
  await client.evaluate(() => document.querySelector('[aria-label="打开工具工作台"]').click())
  await wait(() => !!document.querySelector('#studio-panel-import .module-import-button'))
  await check(windows ? 'native drop events import three packages in one operation' : 'the real system picker selects three packages in one operation', async () => {
    await chooseSamples(samples)
    assert.equal(await client.evaluate(() => document.querySelectorAll('.module-import-item.import-ready').length), 3, await client.evaluate(() => [...document.querySelectorAll('.module-import-item-error')].map(node => node.textContent).join('\n')))
    assert.equal(await client.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await capture('before-install.png')
  })
  await check('canceling another selection preserves the existing three packages', async () => {
    await chooseSamples([], true)
    assert.equal(await client.evaluate(() => document.querySelectorAll('.module-import-item').length), 3)
  })
  await check('install-all keeps successful packages, reports the syntax failure, and stays on import', async () => {
    await click('.module-import-batch-actions .primary-button')
    await wait(() => document.querySelectorAll('.import-installed').length === 2 && document.querySelectorAll('.import-failed').length === 1 && !document.querySelector('.module-import-batch-actions .text-button').disabled)
    assert.equal(await client.evaluate(() => document.getElementById('studio-tab-import').getAttribute('aria-selected')), 'true')
    const modules = await client.invoke('list_modules')
    assert.equal(modules.filter(module => samples.some(sample => sample.manifest.module_id === module.module_id)).length, 2)
    await capture('partial-result.png')
  })
  await check('retry reads the repaired package and installs it without reinstalling successful rows', async () => {
    await pack(samples[1], false)
    await click('.import-failed .secondary-button')
    await wait(() => document.querySelectorAll('.import-installed').length === 3)
    const details = await client.invoke('get_module_details', { moduleId: samples[1].manifest.module_id })
    assert.match(details.scripts['main-0.js'], /Capacity ready/)
    assert.equal(await client.evaluate(() => document.getElementById('studio-tab-import').getAttribute('aria-selected')), 'true')
  })
  await check('clearing the import list does not uninstall its packages', async () => {
    await click('.module-import-batch-actions .text-button')
    assert.equal(await client.evaluate(() => document.querySelectorAll('.module-import-item').length), 0)
    const modules = await client.invoke('list_modules')
    assert.equal(modules.filter(module => samples.some(sample => sample.manifest.module_id === module.module_id)).length, 3)
  })
  if (windows) await check('native multi-file drop events append unique files and install-all stays on import', async () => {
    const paths = [samples[0].file, samples[2].file, samples[0].file]
    await client.invoke('plugin:event|emit', { event: 'tauri://drag-enter', payload: { paths, position: { x: 50, y: 50 } } })
    await wait(() => !!document.querySelector('.file-drop-hint'))
    await client.invoke('plugin:event|emit', { event: 'tauri://drag-drop', payload: { paths, position: { x: 50, y: 50 } } })
    await wait(() => document.querySelectorAll('.import-ready').length === 2)
    assert.equal(await client.evaluate(() => document.querySelectorAll('.module-import-item').length), 2)
    await click('.module-import-batch-actions .primary-button'); await wait(() => document.querySelectorAll('.import-installed').length === 2)
    assert.equal(await client.evaluate(() => document.getElementById('studio-tab-import').getAttribute('aria-selected')), 'true')
  })
} catch (error) { await writeFile(path.join(directory, 'error.txt'), String(error.stack || error)); throw error }
finally {
  try {
    if (pickerOpen) { if (windows) windowsPicker('cancel'); else client.device('shell', 'input', 'keyevent', '4') }
    for (const sample of samples) {
      const installed = (await client.invoke('list_modules')).find(module => module.module_id === sample.manifest.module_id)
      if (installed) await client.invoke('delete_tools', { toolIds: installed.tool_ids })
      if (!windows) client.device('shell', 'rm', '-f', sample.remote)
    }
    if (!windows) client.device('shell', 'rm', '-f', remoteXml)
    if (originalSplash !== undefined) await client.evaluate(({ key, value }) => { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value) }, { key: splashKey, value: originalSplash })
    await client.call('Page.reload')
    report.cleaned = true
    await writeFile(path.join(directory, 'results.json'), JSON.stringify(report, null, 2))
  } finally { client.close() }
}
