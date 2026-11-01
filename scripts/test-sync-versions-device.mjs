import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { connectWindows } from './windows-test-client.mjs'
import { connectAndroid } from './android-device-client.mjs'

const alive = setInterval(() => {}, 1000), clients = [], originals = new Map(), installed = new Set(), ownedSync = new Set()
const directory = path.resolve('target-check/sync-versions'), token = crypto.randomUUID().replaceAll('-', '').slice(0, 10)
const moduleId = `local.sync_version_${token}`, toolId = moduleId + '.main'
const keys = ['firefly.smart-clipboard.v1', 'firefly.startup-splash-enabled.v1', 'firefly.usage-stats.v1', 'firefly.remote-messages.read.v1']
const report = { checks: [], cleaned: false, transport: 'Native encrypted sync through ADB forwarding; no Wi-Fi reachability test.' }
const template = JSON.parse(await readFile('src-tauri/builtin-tools/src/diff.manifest.json', 'utf8'))
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const options = { modules: true, automations: false, builtins: false, favorites: false, websites: false, layout: false, preferences: false, web_data: false }
await mkdir(directory, { recursive: true })

async function until(c, fn, ...args) {
  for (let i = 0; i < 200; i++) { if (await c.evaluate(fn, ...args)) return; await pause(100) }
  throw Error('Timeout: ' + fn)
}
const nav = (c, label) => c.evaluate(label => [...document.querySelectorAll('.nav-button')].find(b => b.textContent.trim() === label).click(), label)
const press = (c, label) => c.evaluate(label => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === label).click(), label)
async function ready(c) {
  await until(c, () => { document.querySelector('.startup-splash-skip')?.click(); const app = document.querySelector('.app-shell'); return app && getComputedStyle(app).display !== 'none' })
  await nav(c, '关于应用'); await until(c, () => document.querySelector('.about-link')?.disabled === false)
  for (let i = 0; i < 4; i++) {
    if (!await c.evaluate(() => { const d = document.querySelector('.remote-message-dialog[open]'); if (!d) return false; if (d.classList.contains('remote-message-required')) throw Error('Mandatory update'); (d.querySelector('.secondary-button') || d.querySelector('.primary-button')).click(); return true })) break
    await pause(150)
  }
  await nav(c, '首页')
}
async function tap(c, selector) {
  await c.evaluate(selector => document.querySelector(selector).scrollIntoView({ block: 'center', behavior: 'instant' }), selector)
  await pause(180)
  await until(c, selector => { const n = document.querySelector(selector), r = n.getBoundingClientRect(); return n.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) }, selector)
  const p = await c.evaluate(selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } }, selector)
  if (c === clients[0]) {
    await c.call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...p })
    await c.call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...p })
  } else {
    await c.call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...p, id: 1 }] })
    await c.call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
  await pause(350)
}
async function shot(c, name) {
  const r = await c.call('Page.captureScreenshot', { format: 'png' })
  await writeFile(path.join(directory, name + '.png'), Buffer.from(r.data, 'base64'))
}
async function install(c, version, content) {
  if (installed.has(c) && (await c.invoke('list_modules')).some(m => m.module_id === moduleId)) await c.invoke('delete_tools', { toolIds: [toolId] })
  const manifest = structuredClone(template)
  manifest.module_id = moduleId; manifest.version = version; manifest.name = { 'zh-CN': '同步版本验证' }
  manifest.tools[0].id = toolId; manifest.tools[0].name = manifest.name; manifest.tools[0].aliases = []; manifest.tools[0].description = { 'zh-CN': '临时同步版本验证工具' }
  manifest.tools[0].ui.fullscreen = false
  await c.invoke('install_module_draft', { manifest, scripts: { 'index.html': '<main>Version test</main>', 'style.css': 'main{padding:16px}', 'main.js': `export function mount(){}\n// ${content}` } })
  installed.add(c)
}
async function syncPage(c) {
  await nav(c, '更多设置'); await until(c, () => !!document.querySelector('.settings-page'))
  await c.evaluate(() => [...document.querySelectorAll('.preference-option')].find(b => b.textContent.startsWith('设备同步')).click())
  await until(c, () => !!document.querySelector('.device-sync')); await press(c, '从其他设备接收')
  await until(c, () => !!document.querySelector('.sync-field input') && !document.querySelector('.sync-actions .primary-button').disabled)
}
async function receive(source, target, android, body) {
  await nav(source, '首页'); await syncPage(target)
  ownedSync.add(source); ownedSync.add(target)
  const offer = await source.invoke('sync_share', { options, preferences: {}, moduleIds: [moduleId], legacyStorage: {} })
  const direction = source === clients[0] ? 'reverse' : 'forward', nativePort = offer.addresses[0].split(':').at(-1)
  const port = android.device(direction, 'tcp:0', `tcp:${nativePort}`)
  try {
    await target.evaluate(({ endpoint, code }) => { for (const [i, value] of [endpoint, code].entries()) { const n = document.querySelectorAll('.sync-field input')[i]; n.value = value; n.dispatchEvent(new Event('input', { bubbles: true })) } }, { endpoint: `127.0.0.1:${port}`, code: offer.code })
    await press(target, '连接并预览')
    await until(target, () => { const e = document.querySelector('.sync-error'); if (e) throw Error(e.textContent); return !!document.querySelector('.sync-item') })
    assert.equal(await target.evaluate(() => document.querySelectorAll('.sync-item').length), 1)
    await body()
  } catch (error) {
    await shot(target, target === clients[0] ? 'failure-windows' : 'failure-android')
    throw error
  } finally {
    await target.invoke('sync_close'); await source.invoke('sync_close')
    android.device(direction, '--remove', `tcp:${port}`)
    await nav(target, '首页')
  }
}
const shown = c => c.evaluate(() => { const n = document.querySelector('.sync-item'), input = n.querySelector('input'); return { label: n.querySelector('.sync-item-status').textContent, versions: n.querySelector('.sync-item-versions')?.textContent, text: n.textContent, checked: input.checked, disabled: input.disabled, overflow: document.documentElement.scrollWidth > innerWidth } })
async function pass(name, body) { await body(); report.checks.push(name); console.log('PASS:', name) }

try {
  const windows = await connectWindows(); clients.push(windows)
  const android = await connectAndroid(); clients.push(android)
  for (const [i, c] of clients.entries()) {
    await until(c, () => { const app = document.querySelector('.app-shell'); return app && getComputedStyle(app).display !== 'none' })
    const sync = await c.invoke('sync_status'); assert(!sync || !['waiting', 'transferring'].includes(sync.state), 'A user sync is active')
    assert(!(await c.invoke('list_modules')).some(m => m.module_id === moduleId))
    originals.set(c, await c.evaluate(keys => Object.fromEntries(keys.map(k => [k, localStorage.getItem(k)])), keys))
    await writeFile(path.join(directory, `original-${i}.json`), JSON.stringify(originals.get(c), null, 2))
    await c.evaluate(keys => keys.filter(k => !k.includes('.read.')).forEach(k => localStorage.setItem(k, 'false')), keys)
    await c.call('Page.reload'); await ready(c)
  }
  for (const [source, target, label] of [[windows, android, 'pc-to-android'], [android, windows, 'android-to-pc']]) {
    await pass(`${label}: newer versions show an update and explicit selection imports the complete package`, async () => {
      await install(source, '1.10.0', 'remote'); await install(target, '1.9.0', 'local')
      await receive(source, target, android, async () => {
        let s = await shown(target); assert.equal(s.label, '可更新'); assert.equal(s.versions, '本机 1.9.0 → 发送端 1.10.0'); assert.equal(s.disabled, true); assert.equal(s.checked, false); assert.equal(s.overflow, false)
        await tap(target, '.sync-replace input'); s = await shown(target); assert.equal(s.disabled, false); assert.equal(s.checked, false)
        await tap(target, '.sync-item input'); await tap(target, '.sync-replace input'); s = await shown(target); assert.equal(s.checked, false); assert.equal(s.disabled, true)
        await tap(target, '.sync-replace input'); await tap(target, '.sync-item input'); await shot(target, label + '-update')
        await tap(target, '.sync-actions .primary-button'); await until(target, () => !!document.querySelector('.sync-completed'))
        const d = await target.invoke('get_module_details', { moduleId }); assert.equal(d.manifest.version, '1.10.0'); assert.equal(d.scripts['main.js'], 'export function mount(){}\n// remote')
      })
    })
    await pass(`${label}: equal versions with edited source are distinguished and cancellation preserves local content`, async () => {
      await install(source, '1.10.0', 'remote'); await install(target, '1.10.0', 'local')
      await receive(source, target, android, async () => {
        let s = await shown(target); assert.equal(s.label, '内容不同'); assert(s.text.includes('版本相同，内容不同')); assert.equal(s.versions, '本机 1.10.0 → 发送端 1.10.0'); assert.equal(s.checked, false); assert.equal(s.disabled, true)
        await tap(target, '.sync-replace input'); s = await shown(target); assert.equal(s.disabled, false); assert.equal(s.checked, false); await shot(target, label + '-edited')
        await press(target, '取消本次同步'); assert.equal((await target.invoke('get_module_details', { moduleId })).scripts['main.js'], 'export function mount(){}\n// local')
      })
    })
    await pass(`${label}: an older package stays blocked after overwrite is enabled`, async () => {
      await install(source, '1.9.0', 'remote'); await install(target, '1.10.0', 'local')
      await receive(source, target, android, async () => {
        assert.equal((await shown(target)).label, '无法导入'); assert((await shown(target)).text.includes('发送端版本较旧')); await tap(target, '.sync-replace input'); const s = await shown(target); assert.equal(s.disabled, true); assert.equal(s.checked, false); assert.equal(s.versions, '本机 1.10.0 → 发送端 1.9.0'); await shot(target, label + '-older')
        await press(target, '取消本次同步'); assert.equal((await target.invoke('get_module_details', { moduleId })).manifest.version, '1.10.0')
      })
    })
    await pass(`${label}: identical packages stay unselectable and newly installed packages show the sending version`, async () => {
      await install(source, '1.10.0', 'remote'); await install(target, '1.10.0', 'remote')
      await receive(source, target, android, async () => {
        assert.equal((await shown(target)).label, '相同'); await tap(target, '.sync-replace input'); assert.equal((await shown(target)).disabled, true); await press(target, '取消本次同步')
      })
      await target.invoke('delete_tools', { toolIds: [toolId] })
      await receive(source, target, android, async () => {
        const s = await shown(target); assert.equal(s.label, '新增'); assert.equal(s.checked, true); assert.equal(s.disabled, false); assert.equal(s.versions, '发送端 1.10.0'); await press(target, '取消本次同步')
      })
    })
  }
} catch (error) {
  report.error = String(error.stack || error)
  for (const [i, c] of clients.entries()) try { await shot(c, `error-${i}`) } catch {}
  throw error
} finally {
  try {
    for (const c of ownedSync) await c.invoke('sync_close')
    for (const c of installed) if ((await c.invoke('list_modules')).some(m => m.module_id === moduleId)) await c.invoke('delete_tools', { toolIds: [toolId] })
    for (const [c, original] of originals) {
      await nav(c, '首页'); await c.evaluate(saved => { for (const [k, v] of Object.entries(saved)) v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v) }, original)
      await c.call('Page.reload'); await ready(c)
      await c.evaluate(saved => { for (const [k, v] of Object.entries(saved)) v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v) }, original)
      assert.deepEqual(await c.evaluate(keys => Object.fromEntries(keys.map(k => [k, localStorage.getItem(k)])), keys), original)
      assert(!(await c.invoke('list_modules')).some(m => m.module_id === moduleId))
    }
    report.cleaned = true
  } finally {
    await writeFile(path.join(directory, 'device-results.json'), JSON.stringify(report, null, 2))
    for (const c of clients) c.close()
    clearInterval(alive)
  }
}
