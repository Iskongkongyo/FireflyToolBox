import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { connectAndroid, androidUiNodes } from './android-device-client.mjs'

const client = await connectAndroid(), tag = 'firefly-download-' + randomUUID().slice(0, 8)
const httpsUrl = process.env.FIREFLY_TEST_HTTPS_URL || 'https://raw.githubusercontent.com/Stuk/jszip/v3.10.1/test/ref/all.zip'
assert.equal(new URL(httpsUrl).protocol, 'https:')
const httpsName = decodeURIComponent(new URL(httpsUrl).pathname.split('/').at(-1))
const directory = path.resolve('target-check/website-download-review', client.device('get-serialno').replace(/[^\w-]/g, '_'))
await mkdir(directory, { recursive: true })
const bytes = Buffer.alloc(96 * 1024)
for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 17) & 255
const text = Buffer.from('普通直链下载 UTF-8\n'.repeat(16))
const slowBytes = Buffer.concat(Array(8).fill(bytes))
const sha = value => createHash('sha256').update(value).digest('hex')
const cases = {
  plain: { name: tag + '-plain.bin', bytes },
  unicode: { name: tag + '-中文文件.txt', bytes: text },
  unsafe: { name: tag + '-unsafe_.txt', bytes: text },
  redirect: { name: tag + '-redirect.bin', bytes },
  slow: { name: tag + '-slow.bin', bytes: slowBytes },
  empty: { name: tag + '-empty.bin', bytes: Buffer.alloc(0) },
  chunked: { name: tag + '-chunked.bin', bytes },
  malformed: { name: tag + '-fallback.txt', bytes: text },
}
const emojiPrefix = tag + '-x', emojiSuffix = '.txt'
cases.emoji = { name: emojiPrefix + '😀'.repeat(Math.floor((80 - emojiPrefix.length - emojiSuffix.length) / 2)) + emojiSuffix, bytes: text }
const requests = [], slowResponses = new Map(), completed = new Set(), remoteXml = '/sdcard/' + tag + '.xml'
let released = false, opened = false
const server = createServer((request, response) => {
  const route = new URL(request.url, 'http://localhost').pathname.slice(1)
  requests.push({ route, userAgent: request.headers['user-agent'] })
  if (route === 'redirect-link') { response.writeHead(302, { Location: '/redirect' }); response.end(); return }
  const fixture = cases[route]
  if (fixture) {
    const name = route === 'unicode' || route === 'emoji' ? `filename="fallback.txt"; filename*=UTF-8''${encodeURIComponent(route === 'emoji' ? emojiPrefix + '😀'.repeat(100) + emojiSuffix : fixture.name)}`
      : route === 'malformed' ? `filename="${fixture.name}"; filename*=UTF-8''invalid%ZZ`
      : `filename="${route === 'unsafe' ? '../../' + tag + '-unsafe?.txt' : fixture.name}"`
    response.writeHead(200, { 'Content-Type': ['unicode', 'unsafe', 'emoji', 'malformed'].includes(route) ? 'text/plain; charset=utf-8' : 'application/octet-stream', 'Content-Disposition': 'attachment; ' + name, ...(route === 'chunked' ? {} : { 'Content-Length': fixture.bytes.length }) })
    if (route === 'slow' && !released) {
      response.write(fixture.bytes.subarray(0, 64 * 1024))
      const state = { offset: 64 * 1024 }
      state.timer = setInterval(() => {
        if (state.offset + 1024 < fixture.bytes.length) {
          response.write(fixture.bytes.subarray(state.offset, state.offset + 1024)); state.offset += 1024
        }
      }, 1000)
      slowResponses.set(response, state)
      response.on('close', () => { clearInterval(state.timer); slowResponses.delete(response) })
    } else if (route === 'chunked') {
      response.write(fixture.bytes.subarray(0, 32768))
      setTimeout(() => response.end(fixture.bytes.subarray(32768)), 100)
    } else response.end(fixture.bytes)
  } else {
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Download review</title><h1>Ordinary downloads</h1>' + ['slow', 'plain', 'unicode', 'unsafe', 'redirect-link', 'empty', 'chunked', 'malformed', 'emoji'].map(id => `<p><a href="/${id}">${id}</a></p>`).join('') + `<p><a href="${httpsUrl.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">https-zip</a></p>`)
  }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port, url = `http://127.0.0.1:${port}/`
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const report = { serial: client.device('get-serialno'), android: client.device('shell', 'getprop', 'ro.build.version.release'), httpsUrl, checks: [], downloads: [] }
function pass(message) { report.checks.push(message); console.log('PASS:', message) }
async function until(check, message, attempts = 100) {
  for (let i = 0; i < attempts; i++) { const result = await check(); if (result) return result; await delay(300) }
  throw new Error(message)
}
function hierarchy() { client.device('shell', 'uiautomator', 'dump', remoteXml); return client.device('shell', 'cat', remoteXml) }
function nodes(xml = hierarchy()) { return androidUiNodes(xml) }
function tap(node) {
  assert(node, 'Native UI item missing')
  const bounds = node.bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/); assert(bounds)
  client.device('shell', 'input', 'tap', String(Math.round((+bounds[1] + +bounds[3]) / 2)), String(Math.round((+bounds[2] + +bounds[4]) / 2)))
}
function listFiles() { return client.device('shell', 'ls', '-1a', '/sdcard/Download').split(/\r?\n/) }
const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'"
function size(name) { try { return Number(client.device('shell', 'stat', '-c', '%s', shellQuote('/sdcard/Download/' + name))) } catch { return -1 } }
async function received(fixture, choose = name => name === fixture.name) {
  const expectedHash = sha(fixture.bytes)
  // DownloadManager can preallocate the complete file length before writing
  // its remaining bytes. A matching length alone does not mean it is ready.
  const name = await until(() => listFiles().find(name => {
    if (completed.has(name) || !choose(name) || size(name) !== fixture.bytes.length) return false
    return client.device('shell', 'sha256sum', shellQuote('/sdcard/Download/' + name)).split(/\s/)[0] === expectedHash
  }), 'Download did not finish: ' + fixture.name)
  completed.add(name)
  const local = path.join(directory, name)
  client.device('pull', '/sdcard/Download/' + name, local)
  const actual = await readFile(local)
  assert.equal(sha(actual), sha(fixture.bytes))
  report.downloads.push({ name, bytes: actual.length, sha256: sha(actual) })
  return name
}
async function openWebsite() {
  await until(() => client.evaluate(() => !!window.FireflyWebsites), 'Native website bridge is not ready')
  await client.evaluate(url => window.FireflyWebsites.open(url), url); opened = true
  await until(() => nodes().some(node => node.text === 'Download review'), 'Website did not open', 15)
}
async function link(text) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const list = nodes(), node = list.find(node => node.text === text)
    if (node && node.bounds !== '[0,0][0,0]') { tap(node); return }
    const bounds = list[0].bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/), x = Math.round(+bounds[3] / 2), height = +bounds[4]
    client.device('shell', 'input', 'swipe', String(x), String(Math.round(height * .8)), String(x), String(Math.round(height * .3)), '250')
    await delay(150)
  }
  throw new Error('Download link is not visible: ' + text)
}
async function notifications() {
  client.device('shell', 'cmd', 'statusbar', 'expand-notifications')
  await delay(300)
  return hierarchy()
}
async function downloadNotification(name, complete = false) {
  return until(async () => {
    let xml = await notifications()
    if (!xml.includes(name)) {
      const list = nodes(xml), start = list.findIndex(node => /^(Download Manager|下载管理|下载管理程序)$/.test(node.text || ''))
      const expand = start < 0 ? null : list.slice(start + 1).find(node => /expand_button$/.test(node['resource-id'] || '') && /^(Expand|展开)$/.test(node['content-desc'] || ''))
      if (expand) { tap(expand); await delay(300); xml = hierarchy() }
    }
    return xml.includes(name) && (!complete || /Download complete|下载完成/i.test(xml)) ? xml : false
  }, 'No matching system download notification', 5)
}

try {
  client.device('reverse', `tcp:${port}`, `tcp:${port}`)
  await openWebsite(); await link('slow')
  // Android may hide an in-progress public download until MediaStore commits it.
  await until(() => requests.filter(request => request.route === 'slow').length >= 2, 'System download did not start')
  const inProgress = await downloadNotification(cases.slow.name)
  await writeFile(path.join(directory, 'in-progress.xml'), inProgress)
  client.device('shell', 'cmd', 'statusbar', 'collapse')
  tap(nodes().find(node => node['content-desc'] === '关闭网站'))
  released = true
  for (const [response, state] of slowResponses) { clearInterval(state.timer); response.end(slowBytes.subarray(state.offset)) }
  await received(cases.slow)
  const complete = await downloadNotification(cases.slow.name, true)
  await writeFile(path.join(directory, 'completed.xml'), complete)
  client.device('shell', 'cmd', 'statusbar', 'collapse')
  pass('A system notification tracks progress and completion; the download continues after closing the website, with exact file bytes.')

  await openWebsite(); await link('plain'); await received(cases.plain)
  pass('An ordinary HTTP attachment is saved in the public Downloads folder with exact bytes.')
  await link('plain')
  const duplicate = await received(cases.plain, name => name.startsWith(tag + '-plain') && name.endsWith('.bin'))
  assert.notEqual(duplicate, cases.plain.name)
  pass('Repeated filenames receive a different destination without overwriting the existing file.')
  await link('unicode'); await received(cases.unicode)
  pass('RFC 6266 UTF-8 filenames and text contents are preserved.')
  await link('unsafe'); await received(cases.unsafe)
  pass('Server-supplied path segments and invalid filename characters are removed.')
  await link('redirect-link'); await received(cases.redirect)
  pass('An HTTP redirect to a file attachment is downloaded correctly.')

  for (const id of ['empty', 'chunked', 'malformed', 'emoji']) { await link(id); await received(cases[id]) }
  pass('Empty bodies, chunked responses without Content-Length, malformed filename* fallback and long emoji filenames preserve exact file contents.')

  const httpsResponse = await fetch(httpsUrl, { signal: AbortSignal.timeout(30000) })
  assert(httpsResponse.ok, 'The HTTPS fixture server did not return a file')
  const expected = Buffer.from(await httpsResponse.arrayBuffer())
  assert(expected.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])))
  const before = new Set(listFiles())
  await link('https-zip')
  const dot = httpsName.lastIndexOf('.'), stem = dot < 0 ? httpsName : httpsName.slice(0, dot), extension = dot < 0 ? '' : httpsName.slice(dot)
  const escaped = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const namePattern = new RegExp('^' + escaped(stem) + '(?:-\\d+)?' + escaped(extension) + '$')
  await received({ name: httpsName, bytes: expected }, name => !before.has(name) && namePattern.test(name))
  pass('A public HTTPS archive downloads using normal certificate validation, with exact expected bytes.')

  report.requests = requests
  await writeFile(path.join(directory, 'android.json'), JSON.stringify(report, null, 2))
} catch (error) {
  await writeFile(path.join(directory, 'error.txt'), String(error.stack || error))
  await writeFile(path.join(directory, 'error-requests.json'), JSON.stringify(requests, null, 2))
  await writeFile(path.join(directory, 'partial-report.json'), JSON.stringify(report, null, 2))
  try { await writeFile(path.join(directory, 'error-ui.xml'), hierarchy()) } catch {}
  throw error
} finally {
  for (const [response, state] of slowResponses) { clearInterval(state.timer); response.destroy() }
  client.device('shell', 'cmd', 'statusbar', 'collapse')
  if (opened) client.device('shell', 'am', 'start', '-n', 'firefly.toolbox/.MainActivity')
  for (const name of listFiles()) if (name.includes(tag) || completed.has(name)) client.device('shell', 'rm', '-f', shellQuote('/sdcard/Download/' + name))
  client.device('shell', 'rm', '-f', remoteXml)
  client.device('reverse', '--remove', `tcp:${port}`)
  client.close()
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
}
