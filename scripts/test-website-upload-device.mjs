import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { connectAndroid } from './android-device-client.mjs'

const client = await connectAndroid(), tag = 'firefly-upload-' + randomUUID().slice(0, 8)
const directory = path.resolve('target-check/website-upload-review')
await mkdir(directory, { recursive: true })
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=', 'base64')
const samples = [
  { name: tag + '-a.png', bytes: png },
  { name: tag + '-b.png', bytes: Buffer.concat([png, Buffer.from('second fixture')]) },
  { name: tag + '.txt', bytes: Buffer.from('Firefly native website upload\nUTF-8 测试\n') },
]
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const uploads = [], remoteXml = '/sdcard/' + tag + '.xml'
const html = `<!doctype html><meta charset="utf-8"><title>Firefly upload review</title><h1>Upload review</h1><label>Single image<input id="single" type="file" accept="image/*"></label><label>Multiple images<input id="multiple" type="file" accept="image/png,image/jpeg" multiple></label><label>Any file<input id="any" type="file"></label><p id="status">Ready</p><script>for(const input of document.querySelectorAll('input'))input.onchange=async()=>{const form=new FormData();for(const file of input.files)form.append('file',file,file.name);try{const response=await fetch('/upload?case='+input.id,{method:'POST',body:form});document.getElementById('status').textContent=await response.text()}catch(error){document.getElementById('status').textContent=String(error)}};</script>`
const server = createServer(async (request, response) => {
  if (request.method !== 'POST') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html); return }
  const boundary = request.headers['content-type']?.match(/boundary=(?:"([^"]+)"|([^;]+))/)
  if (!boundary) { response.writeHead(400); response.end('Missing multipart boundary'); return }
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = Buffer.concat(chunks).toString('latin1'), files = []
  for (const part of body.split('--' + (boundary[1] || boundary[2]))) {
    const headerEnd = part.indexOf('\r\n\r\n'), name = part.slice(0, headerEnd).match(/filename="([^"]+)"/)
    if (headerEnd < 0 || !name) continue
    const bytes = Buffer.from(part.slice(headerEnd + 4, -2), 'latin1')
    files.push({ name: name[1], bytes: bytes.length, sha256: digest(bytes) })
  }
  uploads.push({ path: request.url, files })
  response.end('Uploaded ' + files.map(file => file.name).join(', '))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port, url = `http://127.0.0.1:${port}/review`
let website, opened = false
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check, message, attempts = 50) {
  for (let i = 0; i < attempts; i++) { const result = await check(); if (result) return result; await delay(200) }
  throw new Error(message)
}
async function connectWebsite(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl), pending = new Map()
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let sequence = 0
  socket.onmessage = ({ data }) => {
    const value = JSON.parse(data), task = pending.get(value.id)
    if (!task) return
    pending.delete(value.id); clearTimeout(task.timer)
    value.error ? task.reject(new Error(JSON.stringify(value.error))) : task.resolve(value.result)
  }
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error('Website CDP timeout: ' + method)) }, 15000)
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  return { call, evaluate, close: () => socket.close() }
}
function nodes(xml) {
  return [...xml.matchAll(/<node\s+([^>]+)>/g)].map(match => Object.fromEntries([...match[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map(value => [value[1], value[2]])))
}
function fileNode(list, name) {
  return list.find(node => node.text === name || node['content-desc']?.startsWith(name + ','))
}
function hierarchy() {
  const result = client.device('shell', 'uiautomator', 'dump', remoteXml)
  if (!result.includes('dumped')) throw new Error(result)
  return client.device('shell', 'cat', remoteXml)
}
function tap(node, long = false) {
  const points = node.bounds?.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)
  assert(points, 'Missing native UI bounds: ' + JSON.stringify(node))
  const x = Math.round((Number(points[1]) + Number(points[3])) / 2), y = Math.round((Number(points[2]) + Number(points[4])) / 2)
  client.device('shell', 'input', ...(long ? ['swipe', String(x), String(y), String(x), String(y), '800'] : ['tap', String(x), String(y)]))
}
async function picker() {
  return until(() => {
    const xml = hierarchy()
    if (!xml.includes('documentsui')) return false
    return xml
  }, 'The system document picker did not open')
}
async function downloadFiles() {
  let xml = await picker(), list = nodes(xml)
  if (samples.some(sample => fileNode(list, sample.name))) return list
  const drawer = list.find(node => /Show roots|Show navigation|显示根目录|显示导航|打开导航/.test(node['content-desc'] || ''))
  if (drawer) { tap(drawer); await delay(250); list = nodes(hierarchy()) }
  const downloads = list.find(node => /^(Downloads|下载)$/.test(node.text || ''))
  assert(downloads, 'Downloads root not found: ' + JSON.stringify(list.map(node => ({ text: node.text, description: node['content-desc'] })).filter(node => node.text || node.description)))
  tap(downloads)
  return until(() => { const items = nodes(hierarchy()); return samples.some(sample => fileNode(items, sample.name)) ? items : false }, 'Fixture files were not listed in Downloads', 10)
}
async function choose(name) {
  const list = await downloadFiles(), file = fileNode(list, name)
  assert(file, 'File not shown: ' + name)
  tap(file)
}
async function clickInput(id) {
  await website.evaluate(`document.getElementById(${JSON.stringify(id)}).click()`)
  await picker()
}
async function received(count, expectedNames) {
  await until(() => uploads.length >= count, 'The selected file never reached the local upload server')
  assert.deepEqual(uploads[count - 1].files.map(file => file.name).sort(), [...expectedNames].sort())
  for (const uploaded of uploads[count - 1].files) {
    const expected = samples.find(sample => sample.name === uploaded.name)
    assert(expected, 'Unexpected file uploaded: ' + uploaded.name)
    assert.equal(uploaded.bytes, expected.bytes.length)
    assert.equal(uploaded.sha256, digest(expected.bytes))
  }
}

try {
  for (const sample of samples) {
    const file = path.join(directory, sample.name)
    await writeFile(file, sample.bytes)
    client.device('push', file, '/sdcard/Download/' + sample.name)
    client.device('shell', 'am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', 'file:///sdcard/Download/' + sample.name)
  }
  client.device('reverse', `tcp:${port}`, `tcp:${port}`)
  await until(() => client.evaluate(() => !!window.FireflyWebsites), 'Native website bridge is not ready')
  await client.evaluate(url => window.FireflyWebsites.open(url), url); opened = true
  const target = await until(async () => (await (await fetch(`http://127.0.0.1:${client.debugPort}/json/list`)).json()).find(target => target.url.startsWith(url)), 'Native website WebView was not exposed')
  website = await connectWebsite(target)
  await until(() => website.evaluate('document.readyState === "complete" && !!document.getElementById("single")'), 'Fixture page did not load')

  await clickInput('single')
  client.device('shell', 'input', 'keyevent', '4')
  await delay(400)
  assert.equal(uploads.length, 0)
  await clickInput('single'); await choose(samples[0].name); await received(1, [samples[0].name])
  console.log('PASS: cancel/retry and single-image multipart upload preserve exact bytes')

  await clickInput('multiple')
  let list = await downloadFiles()
  tap(fileNode(list, samples[0].name), true)
  await delay(250)
  list = nodes(hierarchy()); tap(fileNode(list, samples[1].name))
  await delay(250)
  list = nodes(hierarchy())
  const select = list.find(node => /action_menu_select$/.test(node['resource-id'] || '')) || list.find(node => /^(Open|Select|打开|选择)$/i.test(node.text || ''))
  assert(select, 'Native multi-file selection action was not found')
  tap(select); await received(2, samples.slice(0, 2).map(file => file.name))
  console.log('PASS: image MIME filtering and multi-file upload preserve both files')

  await clickInput('any'); await choose(samples[2].name); await received(3, [samples[2].name])
  console.log('PASS: unrestricted file inputs upload UTF-8 text files')

  await clickInput('any')
  await website.evaluate(`location.href=${JSON.stringify(url + '?next=1')}`)
  await until(() => website.evaluate('location.search === "?next=1" && document.readyState === "complete"'), 'Navigation while the picker was open did not complete')
  await choose(samples[2].name); await delay(500)
  assert.equal(uploads.length, 3, 'An old picker result was delivered after navigation')
  await clickInput('any'); await choose(samples[2].name); await received(4, [samples[2].name])
  console.log('PASS: navigation drops late selection results and a new request still succeeds')

  const report = { android: client.device('shell', 'getprop', 'ro.build.version.release'), webview: client.device('shell', 'dumpsys', 'webviewupdate').match(/Current WebView package[^\n]+/)?.[0], cancelledPickerReleased: true, singleImagePassed: true, multiFilePassed: true, arbitraryFilePassed: true, navigationLateResultDropped: true, uploads }
  await writeFile(path.join(directory, 'android.json'), JSON.stringify(report, null, 2))
} catch (error) {
  await writeFile(path.join(directory, 'last-upload-error.txt'), String(error.stack || error))
  try { await writeFile(path.join(directory, 'last-upload-page.html'), await website.evaluate('document.documentElement.outerHTML')) } catch {}
  try { await writeFile(path.join(directory, 'last-upload-ui.xml'), hierarchy()) } catch {}
  throw error
} finally {
  website?.close()
  if (opened) client.device('shell', 'am', 'start', '-n', 'firefly.toolbox/.MainActivity')
  for (const sample of samples) client.device('shell', 'rm', '-f', '/sdcard/Download/' + sample.name)
  client.device('shell', 'rm', '-f', remoteXml)
  client.device('reverse', '--remove', `tcp:${port}`)
  client.close()
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
}
