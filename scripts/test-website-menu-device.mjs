import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { connectAndroid } from './android-device-client.mjs'

const client = await connectAndroid()
const tag = 'firefly-menu-' + randomUUID().slice(0, 8)
const directory = path.resolve('target-check/website-menu-review')
await mkdir(directory, { recursive: true })
const remoteXml = '/sdcard/' + tag + '.xml'
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const server = createServer((request, response) => {
  if (request.url === '/start') { response.writeHead(302, { Location: '/article?redirected=1#content' }); response.end(); return }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end('<!doctype html><meta charset="utf-8"><title>Website menu review</title><main id="content"><h1>Menu review</h1><p>Needle first 中文</p><p>Needle second 中文</p><p>Needle third</p></main>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const startUrl = `http://127.0.0.1:${port}/start`
const currentUrl = `http://127.0.0.1:${port}/article?redirected=1#content`
const report = { android: client.device('shell', 'getprop', 'ro.build.version.release'), checks: [] }
let opened = false, inputLength = 0
async function until(check, message, attempts = 15) {
  for (let i = 0; i < attempts; i++) { const value = await check(); if (value) return value; await delay(200) }
  throw new Error(message)
}
function hierarchy() {
  client.device('shell', 'uiautomator', 'dump', remoteXml)
  return client.device('shell', 'cat', remoteXml)
}
function nodes(xml = hierarchy()) {
  return [...xml.matchAll(/<node\s+([^>]+)>/g)].map(match => Object.fromEntries([...match[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map(item => [item[1], item[2]])))
}
function tap(node) {
  assert(node, 'Native UI item was not found')
  const bounds = node.bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)
  assert(bounds)
  client.device('shell', 'input', 'tap', String(Math.round((+bounds[1] + +bounds[3]) / 2)), String(Math.round((+bounds[2] + +bounds[4]) / 2)))
}
function byDescription(description, list = nodes()) { return list.find(node => node['content-desc'] === description) }
function byText(text, list = nodes()) { return list.find(node => node.text === text) }
async function menu() {
  tap(byDescription('网页菜单'))
  return until(() => { const list = nodes(); return byText('页面内查找', list) ? list : false }, 'The website menu did not open')
}
async function selectMenu(text) { tap(byText(text, await menu())) }
async function count(expected) {
  return until(() => { const list = nodes(); return byText(expected, list) ? list : false }, 'Find count never became ' + expected)
}
async function typeFind(text) {
  tap(byDescription('页面内查找关键词'))
  client.device('shell', 'input', 'keyevent', '123')
  if (inputLength) client.device('shell', 'input', 'keyevent', ...Array(inputLength).fill('67'))
  if (text) client.device('shell', 'input', 'text', text)
  inputLength = text.length
}

try {
  client.device('reverse', `tcp:${port}`, `tcp:${port}`)
  await until(() => client.evaluate(() => !!window.FireflyWebsites), 'Native website bridge is not ready')
  await client.evaluate(url => window.FireflyWebsites.open(url), startUrl); opened = true
  await until(() => { const list = nodes(); return byDescription('网页菜单', list) && byText('Website menu review', list) }, 'The redirected website did not open')
  const toolbarOrder = nodes().filter(node => ['返回', '刷新页面', '关闭网站', '网页菜单'].includes(node['content-desc']))
    .sort((a, b) => Number(a.bounds.match(/\[(\d+),/)[1]) - Number(b.bounds.match(/\[(\d+),/)[1]))
  assert.deepEqual(toolbarOrder.map(node => node['content-desc']), ['返回', '刷新页面', '关闭网站', '网页菜单'])
  let list = await menu()
  const labels = ['分享', '复制网址', '默认浏览器打开', '页面内查找']
  for (const label of labels) assert(byText(label, list), 'Menu item missing: ' + label)
  assert.equal(list.filter(node => labels.includes(node.text)).length, 4)
  client.device('shell', 'input', 'keyevent', '4')
  report.checks.push('The vertical overflow menu is after Close at the right edge and contains exactly the four requested actions.')

  await selectMenu('复制网址')
  const copied = await client.invoke('plugin:clipboard-manager|read_text')
  assert.equal(copied, currentUrl)
  report.checks.push('Copy URL writes the actual redirected URL, including its query and fragment, to the system clipboard.')

  await selectMenu('分享')
  const share = await until(() => { const xml = hierarchy(); return /intentresolver|ChooserActivity|resolver/.test(xml) || xml.includes('分享网页') ? xml : false }, 'The Android sharesheet did not open')
  assert(share.includes('127.0.0.1') || share.includes('Website menu review'), 'The sharesheet has no page preview')
  await writeFile(path.join(directory, 'sharesheet.xml'), share)
  client.device('shell', 'input', 'keyevent', '4')
  report.checks.push('Share opens the native Android sharesheet with the current page preview, without sending anything.')

  await selectMenu('页面内查找')
  await typeFind('Needle'); await count('1/3')
  tap(byDescription('下一个匹配')); await count('2/3')
  tap(byDescription('上一个匹配')); await count('1/3')
  tap(byDescription('上一个匹配')); await count('3/3')
  tap(byDescription('下一个匹配')); await count('1/3')
  report.checks.push('Page find highlights three matches and previous/next navigation wraps in both directions.')

  await typeFind('Absent'); list = await count('0/0')
  assert.equal(byDescription('上一个匹配', list).enabled, 'false')
  assert.equal(byDescription('下一个匹配', list).enabled, 'false')
  await typeFind(''); await count('0/0')
  report.checks.push('Missing and empty queries clear matches and disable previous/next controls.')

  await client.invoke('plugin:clipboard-manager|write_text', { text: '中文' })
  tap(byDescription('页面内查找关键词')); client.device('shell', 'input', 'keyevent', '279'); inputLength = 2
  await count('1/2')
  report.checks.push('Chinese text can be searched with correct match counts.')

  tap(byDescription('关闭页面内查找'))
  assert.equal(byDescription('页面内查找关键词'), undefined)
  await selectMenu('页面内查找'); await count('1/2')
  client.device('shell', 'input', 'keyevent', '4')
  // Android may first consume Back to dismiss the soft keyboard.
  if (byDescription('页面内查找关键词')) client.device('shell', 'input', 'keyevent', '4')
  assert.equal(byDescription('页面内查找关键词'), undefined)
  assert(byDescription('网页菜单'))
  report.checks.push('Close and hardware Back exit page find while keeping the website open; reopening restores the query.')

  await selectMenu('默认浏览器打开')
  const activity = await until(() => {
    const text = client.device('shell', 'dumpsys', 'activity', 'activities')
    return /topResumedActivity=[^\r\n]*(?:chrome|browser|ResolverActivity)/i.test(text) ? text : false
  }, 'No external browser or browser chooser was launched')
  await writeFile(path.join(directory, 'external-browser.txt'), activity)
  report.checks.push('Open in default browser launches an external browser or the system browser chooser.')

  await writeFile(path.join(directory, 'android.json'), JSON.stringify(report, null, 2))
  for (const check of report.checks) console.log('PASS:', check)
} catch (error) {
  await writeFile(path.join(directory, 'error.txt'), String(error.stack || error))
  try { await writeFile(path.join(directory, 'error-ui.xml'), hierarchy()) } catch {}
  throw error
} finally {
  if (opened) client.device('shell', 'am', 'start', '-n', 'firefly.toolbox/.MainActivity')
  client.device('shell', 'rm', '-f', remoteXml)
  client.device('reverse', '--remove', `tcp:${port}`)
  client.close()
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
}
