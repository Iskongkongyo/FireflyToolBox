import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { connectAndroid, androidUiNodes } from './android-device-client.mjs'

const client = await connectAndroid(), tag = 'firefly-blob-' + randomUUID().slice(0, 8)
const directory = path.resolve('target-check/website-blob-review', client.device('get-serialno').replace(/[^\w-]/g, '_'))
await mkdir(directory, { recursive: true })
const text = '网页临时文件 UTF-8\n中文 😀\n', textBytes = Buffer.from(text)
const binary = Buffer.alloc(3 * 1024 * 1024 + 19)
for (let i = 0; i < binary.length; i++) binary[i] = (i * 29 + 7) & 255
const fixtures = {
  text: { name: tag + '-中文.txt', bytes: textBytes },
  binary: { name: tag + '-binary.bin', bytes: binary },
  empty: { name: tag + '-empty.bin', bytes: Buffer.alloc(0) },
  realm: { name: tag + '-realm.txt', bytes: textBytes },
  realmFile: { name: tag + '-realm-file.txt', bytes: textBytes },
  handler: { name: tag + '-handler.txt', bytes: textBytes },
  emoji: { name: '', bytes: textBytes },
  limit: { name: tag + '-limit.bin' },
  oversized: { name: tag + '-oversized.bin' },
  offset: { name: tag + '-offset.bin' },
  incomplete: { name: tag + '-incomplete.bin' },
  chunk: { name: tag + '-chunk.bin' },
  timeout: { name: tag + '-timeout.bin' },
  picker: { name: tag + '-picker.txt', bytes: textBytes },
  cancel: { name: tag + '-cancel.bin' },
  navigate: { name: tag + '-navigate.bin' },
  retry: { name: tag + '-retry.txt', bytes: textBytes },
  close: { name: tag + '-close.bin' },
}
const emojiPrefix = tag + '-x', emojiSuffix = '.txt'
fixtures.emoji.name = emojiPrefix + '😀'.repeat(Math.floor((80 - emojiPrefix.length - emojiSuffix.length) / 2)) + emojiSuffix
const completed = [], sha = bytes => createHash('sha256').update(bytes).digest('hex')
const previousCache = new Set(client.device('shell', 'run-as', 'firefly.toolbox', 'ls', 'cache').split(/\r?\n/))
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const remoteXml = '/sdcard/' + tag + '.xml'
const names = Object.fromEntries(Object.entries(fixtures).map(([key, value]) => [key, value.name]))
names.emoji = emojiPrefix + '😀'.repeat(100) + emojiSuffix
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  if (request.url === '/child') { response.end('<script>addEventListener("message",event=>{if(event.data?.attack)FireflyBlobDownload.postMessage(JSON.stringify(event.data.message))})</script>'); return }
  response.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${request.url.includes('after') ? 'Blob after navigation' : 'Blob review'}</title><h1>Blob downloads</h1>${Object.keys(fixtures).map(id => `<p><button id="${id}">${id}</button></p>`).join('')}<iframe id="child" src="/child" hidden></iframe><script>
const names=${JSON.stringify(names)},text=${JSON.stringify(text)};
window.nativeReplies=[];
const read=Blob.prototype.arrayBuffer;
Blob.prototype.arrayBuffer=async function(){if(window.testKind==='timeout')await new Promise(()=>{});if(window.slowBlob)await new Promise(resolve=>setTimeout(resolve,1500));return read.call(this)};
const handler=FireflyBlobDownload.onmessage;
FireflyBlobDownload.onmessage=event=>{
 const message=JSON.parse(event.data);window.nativeReplies.push(message);
 if(message.ready&&window.attackFrame){
  FireflyBlobDownload.postMessage(JSON.stringify({id:message.id+'-wrong',operation:'finish'}));
  document.getElementById('child').contentWindow.postMessage({attack:true,message:{id:message.id,operation:'finish'}},'*');
 }
 if(message.ready&&['offset','incomplete','chunk'].includes(window.testKind)){
  const request=window.testKind==='incomplete'?{operation:'finish'}:{operation:'chunk',offset:window.testKind==='offset'?1:0,data:window.testKind==='chunk'?'A'.repeat(349527)+'=':'AA=='};
  FireflyBlobDownload.postMessage(JSON.stringify({id:message.id,...request}));
 }
 handler(event);
};
for(const button of document.querySelectorAll('button'))button.onclick=()=>{
 const kind=button.id;window.testKind=kind;window.nativeReplies=[];window.slowBlob=['cancel','navigate','close'].includes(kind);window.attackFrame=kind==='binary';
 let value;
 if(kind==='empty')value=new Uint8Array(0);
 else if(['binary','cancel','navigate','close'].includes(kind)){value=new Uint8Array(kind==='binary'?${binary.length}:8*1024*1024);for(let i=0;i<value.length;i++)value[i]=(i*29+7)&255}
 else value=text;
 const Realm=document.getElementById('child').contentWindow;
 const blob=kind==='realm'?new Realm.Blob([value],{type:'text/plain'}):kind==='realmFile'?new Realm.File([value],'source.txt',{type:'text/plain'}):new Blob([value],{type:typeof value==='string'?'text/plain':'application/octet-stream'});
 if(['limit','oversized'].includes(kind))Object.defineProperty(blob,'size',{value:2147483648+(kind==='oversized'?1:0)});
 const url=URL.createObjectURL(blob),anchor=document.createElement('a');
 anchor.href=url;anchor.download=names[kind];
 if(kind==='handler'){anchor.download='before.txt';anchor.addEventListener('click',event=>{anchor.download=names[kind];event.stopPropagation()})}
 if(kind==='binary')anchor.dispatchEvent(new MouseEvent('click'));else anchor.click();
 URL.revokeObjectURL(url);
};</script>`)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port, url = `http://127.0.0.1:${port}/`
const report = { serial: client.device('get-serialno'), android: client.device('shell', 'getprop', 'ro.build.version.release'), checks: [], files: [] }
let socket, opened = false, evaluate
function pass(text) { report.checks.push(text); console.log('PASS:', text) }
async function until(check, message, attempts = 35) { for (let i = 0; i < attempts; i++) { const value = await check(); if (value) return value; await delay(200) } throw new Error(message) }
function hierarchy() { client.device('shell', 'uiautomator', 'dump', remoteXml); return client.device('shell', 'cat', remoteXml) }
function nodes(xml = hierarchy()) { return androidUiNodes(xml) }
function tap(node) { assert(node, 'Native UI item missing'); const points = node.bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/); assert(points); client.device('shell', 'input', 'tap', String(Math.round((+points[1] + +points[3]) / 2)), String(Math.round((+points[2] + +points[4]) / 2))) }
function picker() { return until(() => { const xml = hierarchy(); return xml.includes('documentsui') ? xml : false }, 'The system save dialog did not open', 15) }
const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'"
function listFiles() { return client.device('shell', 'ls', '-1a', '/sdcard/Download').split(/\r?\n/) }
function size(name) { try { return Number(client.device('shell', 'stat', '-c', '%s', shellQuote('/sdcard/Download/' + name))) } catch { return -1 } }
async function save(name) {
  let list = nodes(await picker())
  const input = list.find(node => node.class === 'android.widget.EditText')
  assert(input?.text.includes(name.replace(/\.[^.]+$/, '')), 'The suggested filename was lost: ' + JSON.stringify(input))
  if (!list.some(node => /^(Downloads|下载|下载内容)$/.test(node.text || ''))) {
    const drawer = list.find(node => /Show roots|Show navigation|显示根目录|显示导航|打开导航/.test(node['content-desc'] || ''))
    if (drawer) { tap(drawer); await delay(200); list = nodes() }
    const downloads = list.find(node => /^(Downloads|下载|下载内容)$/.test(node.text || '')); assert(downloads); tap(downloads); list = nodes()
  }
  tap(list.find(node => /^(save|保存)$/i.test(node.text || '') && node.enabled === 'true'))
}
async function click(id) {
  await evaluate(`document.getElementById(${JSON.stringify(id)}).scrollIntoView({block:'center'})`)
  tap(nodes().find(node => node.text === id && node.class === 'android.widget.Button'))
}
async function received(id) {
  const fixture = fixtures[id]
  await until(() => listFiles().includes(fixture.name) && size(fixture.name) === fixture.bytes.length, 'Blob file did not finish: ' + fixture.name)
  await until(() => !/正在保存文件|正在完成保存/.test(hierarchy()), 'The save operation did not finish')
  const local = path.join(directory, fixture.name)
  client.device('pull', '/sdcard/Download/' + fixture.name, local)
  const data = await readFile(local)
  assert.equal(sha(data), sha(fixture.bytes))
  completed.push(fixture.name); report.files.push({ name: fixture.name, bytes: data.length, sha256: sha(data) })
}

try {
  client.device('reverse', `tcp:${port}`, `tcp:${port}`)
  await until(() => client.evaluate(() => !!window.FireflyWebsites), 'Native website bridge not ready')
  await client.evaluate(url => window.FireflyWebsites.open(url), url); opened = true
  const target = await until(async () => { try { return (await (await fetch(`http://127.0.0.1:${client.debugPort}/json/list`)).json()).find(item => item.url === url) } catch { return false } }, 'Website debug target missing')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let sequence = 0; const pending = new Map()
  socket.onmessage = ({ data }) => { const result = JSON.parse(data), task = pending.get(result.id); if (task) { pending.delete(result.id); clearTimeout(task.timer); result.error ? task.reject(new Error(JSON.stringify(result.error))) : task.resolve(result.result) } }
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence, timer = setTimeout(() => reject(new Error('Website CDP timeout')), 15000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })) })
  evaluate = async expression => { const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value }
  await until(() => evaluate('!!window.__fireflyBlobDownload && document.getElementById("child")?.contentDocument?.readyState === "complete"'), 'The blob adapter did not load')
  await evaluate('FireflyBlobDownload.postMessage(JSON.stringify({id:"not-issued",operation:"begin",size:1,name:"forged.txt"}))')
  await delay(300)
  assert(!hierarchy().includes('documentsui'))
  pass('Unsolicited page messages cannot open a save dialog without a native download request.')

  await click('text'); await save(fixtures.text.name); await received('text')
  pass('A detached anchor with immediate URL revocation saves the exact UTF-8 text and Chinese filename.')
  await click('binary'); await save(fixtures.binary.name); await received('binary')
  pass('A detached dispatchEvent download saves a multi-chunk binary exactly; a same-origin child cannot interrupt its native transfer.')
  await click('empty'); await save(fixtures.empty.name); await received('empty')
  pass('An empty Blob produces a valid zero-byte file.')

  for (const id of ['realm', 'realmFile', 'handler', 'emoji']) {
    await click(id); await save(fixtures[id].name); await received(id)
  }
  pass('Cross-frame Blob and File objects, click-handler filenames and truncated emoji filenames save exact bytes with valid names.')

  await click('limit'); await picker(); client.device('shell', 'input', 'keyevent', '4'); await delay(300)
  await click('oversized')
  await until(() => evaluate('window.nativeReplies.some(message=>message.error?.includes("2 GiB"))'), 'An oversized Blob was not rejected')
  assert(!hierarchy().includes('documentsui'))
  pass('The native size boundary accepts 2 GiB before saving and rejects 2 GiB + 1 without opening the picker or allocating a large file.')

  for (const id of ['offset', 'incomplete', 'chunk']) {
    await click(id); await save(fixtures[id].name)
    await until(() => evaluate('window.nativeReplies.some(message=>message.error)'), 'An invalid transfer was not rejected: ' + id)
    await until(() => !listFiles().includes(fixtures[id].name), 'Invalid-transfer destination remained: ' + id)
  }
  pass('Out-of-order offsets, premature finish and a 256 KiB + 1 chunk are rejected and their selected destinations are deleted.')

  await click('timeout'); await save(fixtures.timeout.name)
  await until(() => evaluate('window.nativeReplies.some(message=>message.error?.includes("超时"))'), 'A stalled transfer did not time out', 200)
  await until(() => !listFiles().includes(fixtures.timeout.name), 'Timed-out transfer destination remained')
  pass('A stalled Blob read times out and cleans its destination without blocking subsequent downloads.')

  await click('picker'); await picker(); client.device('shell', 'input', 'keyevent', '4'); await delay(300)
  assert(!listFiles().includes(fixtures.picker.name))
  await click('cancel'); await save(fixtures.cancel.name)
  await until(() => hierarchy().includes('正在保存文件'), 'Save progress did not appear')
  tap(nodes().find(node => node.text === '取消' && node.class === 'android.widget.Button'))
  await until(() => !listFiles().includes(fixtures.cancel.name), 'Partial file remained after cancellation')
  pass('Cancelling the system picker or an in-progress transfer leaves no partial file.')

  await click('navigate'); await save(fixtures.navigate.name)
  await until(() => hierarchy().includes('正在保存文件'), 'Save progress did not appear before navigation')
  await evaluate(`location.href=${JSON.stringify(url + '?after=1')}`)
  await until(() => hierarchy().includes('Blob after navigation'), 'The next document did not load')
  await until(() => !listFiles().includes(fixtures.navigate.name), 'Partial file remained after navigation')
  await click('retry'); await save(fixtures.retry.name); await received('retry')
  pass('Navigation cancels the old transfer and deletes its partial file; the next document can save another Blob.')

  await click('close'); await save(fixtures.close.name)
  await until(() => hierarchy().includes('正在保存文件'), 'Save progress did not appear before closing')
  client.device('shell', 'am', 'start', '-n', 'firefly.toolbox/.MainActivity')
  await until(() => !listFiles().includes(fixtures.close.name), 'A partial file remained after closing the website')
  await until(() => !client.device('shell', 'run-as', 'firefly.toolbox', 'ls', 'cache').split(/\r?\n/).some(name => /^website-blob-.*\.part$/.test(name) && !previousCache.has(name)), 'A Blob temporary file remained in app cache')
  pass('Closing the website during transfer removes the selected destination and cached transfer files.')
  await writeFile(path.join(directory, 'android.json'), JSON.stringify(report, null, 2))
} catch (error) {
  await writeFile(path.join(directory, 'error.txt'), String(error.stack || error))
  try { await writeFile(path.join(directory, 'error-ui.xml'), hierarchy()) } catch {}
  if (evaluate) try { await writeFile(path.join(directory, 'error-page.html'), await evaluate('document.documentElement.outerHTML')) } catch {}
  throw error
} finally {
  socket?.close()
  if (opened) client.device('shell', 'am', 'start', '-n', 'firefly.toolbox/.MainActivity')
  for (const name of listFiles()) if (name.includes(tag)) client.device('shell', 'rm', '-f', shellQuote('/sdcard/Download/' + name))
  client.device('shell', 'rm', '-f', remoteXml)
  client.device('reverse', '--remove', `tcp:${port}`)
  client.close()
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
}
