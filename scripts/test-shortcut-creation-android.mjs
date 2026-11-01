import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { connectAndroid, androidUiNodes } from './android-device-client.mjs'

const pause = ms => new Promise(resolve => setTimeout(resolve, ms)), token = crypto.randomUUID().slice(0, 8)
const names = [`FFSC-Test-${token}-A`, `FFSC-Test-${token}-B`], owned = new Set(names)
const specArg = flag => { const i = process.argv.indexOf(flag); return i < 0 ? null : process.argv[i + 1] }
const legacy = specArg('--legacy-spec') ? JSON.parse(await readFile(specArg('--legacy-spec'), 'utf8')) : null
const extra = specArg('--cleanup-spec') ? JSON.parse(await readFile(specArg('--cleanup-spec'), 'utf8')) : null
if (legacy) owned.add(legacy.name)
if (extra) owned.add(extra.name)
assert([...owned].every(name => /^FFSC-(?:Test|Legacy|New)-[a-f0-9]{8}(?:-[AB])?$/.test(name)), 'Only owned test icons may be removed')
let client = await connectAndroid(), original
const device = client.device, directory = 'target-check/shortcut-reliability/android'
const keys = ['firefly.startup-splash-enabled.v1', 'firefly.smart-clipboard.v1', 'firefly.usage-stats.v1', 'firefly.remote-messages.read.v1']
const report = { checks: [], cleaned: false, restored: false }, alive = setInterval(() => {}, 1000)
await mkdir(directory, { recursive: true })
async function until(fn, ...args) { for (let i = 0; i < 200; i++) { if (await client.evaluate(fn, ...args)) return; await pause(100) }; throw Error('Timed out: ' + fn) }
async function nav(name) { await client.evaluate(name => [...document.querySelectorAll('.nav-button')].find(n => n.textContent.trim() === name).click(), name) }
async function ready() {
  await until(() => { document.querySelector('.startup-splash-skip')?.click(); const app = document.querySelector('.app-shell'); return app && getComputedStyle(app).display !== 'none' })
  await nav('关于应用'); await until(() => document.querySelector('.about-link')?.disabled === false)
  for (let i = 0; i < 3; i++) {
    const closed = await client.evaluate(() => { const d = document.querySelector('.remote-message-dialog[open]'); if (!d) return false; if (d.classList.contains('remote-message-required')) throw Error('Mandatory update'); (d.querySelector('.secondary-button') || d.querySelector('.primary-button')).click(); return true })
    if (!closed) break; await pause(150)
  }
}
function records(name) { return device('shell', 'dumpsys', 'shortcut').split(`shortLabel=${name},`).length - 1 }
function nodes() { device('shell', 'uiautomator', 'dump', '--compressed', '/sdcard/firefly-shortcut-test.xml'); return androidUiNodes(device('shell', 'cat', '/sdcard/firefly-shortcut-test.xml')) }
function point(node) { const [x, y, r, b] = node.bounds.match(/\d+/g).map(Number); return [Math.round((x + r) / 2), Math.round((y + b) / 2)] }
function tap(node) { device('shell', 'input', 'tap', ...point(node).map(String)) }
async function findIcon(name) {
  device('shell', 'input', 'keyevent', '3'); await pause(450)
  for (let page = 0; page < 7; page++) {
    const icon = nodes().find(n => n.text === name || n['content-desc'] === name)
    if (icon) return icon
    const size = device('shell', 'wm', 'size').match(/(\d+)x(\d+)/), w = +size[1], h = +size[2]
    device('shell', 'input', 'swipe', String(Math.round(w * .85)), String(Math.round(h * .65)), String(Math.round(w * .15)), String(Math.round(h * .65)), '250'); await pause(350)
  }
  return null
}
async function remove(name, required = false) {
  const icon = await findIcon(name)
  if (!icon) { assert(!required, `Owned icon missing: ${name}`); return }
  const [x, y] = point(icon)
  device('shell', 'input', 'swipe', String(x), String(y), String(x), String(y), '900'); await pause(400)
  const menu = nodes(), removeButton = menu.find(n => /^(移除|删除快捷方式|从桌面移除|Remove)$/.test(n.text || n['content-desc'] || ''))
  assert(removeButton, 'No safe Remove action was found for the owned shortcut')
  tap(removeButton); await pause(400)
  const confirmation = nodes()
  if (confirmation.some(n => n.text?.includes(name))) {
    const button = confirmation.find(n => /^(移除|删除|Remove)$/.test(n.text || ''))
    if (button) tap(button)
  }
}
async function create(toolId, name) {
  device('shell', 'am', 'start', '-n', 'firefly.toolbox/.MainActivity')
  assert.equal(await client.invoke('create_tool_shortcut', { toolId, name, iconData: null }), 'requested')
  await pause(500)
  if (records(name) === 0) {
    const ui = nodes()
    assert(ui.some(n => n.text?.includes(name) || n['content-desc']?.includes(name)), 'No owned pin confirmation or shortcut was found')
    const add = ui.find(n => /^(添加|添加到主屏幕|添加到桌面|Add|Add automatically)$/.test(n.text || '')); assert(add); tap(add); await pause(500)
  }
  assert.equal(records(name), 1, 'Exactly one owned shortcut record is expected')
}
async function check(name, fn) { await fn(); report.checks.push(name); console.log('PASS:', name) }
try {
  await until(() => !!document.querySelector('.app-shell'))
  original = await client.evaluate(keys => Object.fromEntries(keys.map(k => [k, localStorage.getItem(k)])), keys)
  await writeFile(`${directory}/original-preferences.json`, JSON.stringify(original, null, 2))
  await client.evaluate(keys => keys.filter(k => !k.includes('.read.')).forEach(k => localStorage.setItem(k, 'false')), keys)
  await client.call('Page.reload'); await ready()
  const tools = await client.invoke('list_tools'), tool = tools.find(t => t.id === 'json.format'); assert(tool)
  if (legacy) await check('legacy random-ID icons are recognized and the duplicate request is rejected', async () => {
    assert.equal(records(legacy.name), 1)
    await assert.rejects(client.invoke('create_tool_shortcut', { toolId: legacy.toolId, name: legacy.name, iconData: null }), /同名快捷方式/)
    assert.equal(records(legacy.name), 1)
  })
  await check('native creation produces one stable desktop shortcut', () => create(tool.id, names[0]))
  await check('same-tool same-name re-creation cannot produce a second pinned icon', async () => {
    await assert.rejects(client.invoke('create_tool_shortcut', { toolId: tool.id, name: names[0], iconData: null }), /同名快捷方式|已发起/)
    assert.equal(records(names[0]), 1)
  })
  await check('the same tool can still have another independently named desktop icon', () => create(tool.id, names[1]))
  await check('the actual launcher icon cold-starts the correct tool', async () => {
    const icon = await findIcon(names[0]); assert(icon)
    client.close(); device('shell', 'am', 'force-stop', 'firefly.toolbox'); tap(icon); await pause(700)
    client = await connectAndroid()
    await until(name => document.querySelector('.editor-open .tool-title')?.textContent.includes(name), tool.name)
  })
  await check('removing a pinned icon permits creating the same tool and name again', async () => {
    await remove(names[0], true); await pause(600); await create(tool.id, names[0])
  })
} finally {
  try {
    for (const name of owned) await remove(name)
    report.cleaned = true
  } finally {
    try {
      device('shell', 'am', 'start', '-n', 'firefly.toolbox/.MainActivity', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER')
      if (original) {
        const restore = () => client.evaluate(saved => { for (const [k, v] of Object.entries(saved)) v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v) }, original)
        await nav('首页'); await restore(); await client.call('Page.reload'); await ready(); await nav('首页'); await restore()
        assert.deepEqual(await client.evaluate(keys => Object.fromEntries(keys.map(k => [k, localStorage.getItem(k)])), keys), original); report.restored = true
      }
      await writeFile(`${directory}/results.json`, JSON.stringify(report, null, 2))
    } finally { device('shell', 'rm', '-f', '/sdcard/firefly-shortcut-test.xml'); client.close(); clearInterval(alive) }
  }
}
