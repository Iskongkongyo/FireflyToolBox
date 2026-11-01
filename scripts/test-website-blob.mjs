import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { androidUiNodes } from './android-device-client.mjs'

test('Android save-dialog filenames decode emoji entities without decoding literal ampersands twice', () => {
  assert.equal(androidUiNodes('<node text="中文&#128512;&#x1F600;&amp;#128512;.txt"/>')[0].text, '中文😀😀&#128512;.txt')
})

const script = await readFile('src-tauri/gen/android/app/src/main/assets/website-blob-download.js', 'utf8')
let browser, server, origin
before(async () => {
  server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end('<!doctype html><meta charset="utf-8"><body>Blob download fixture</body>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${server.address().port}`
  const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  browser = await chromium.launch({ headless: true, executablePath: process.env.FIREFLY_TEST_BROWSER || (existsSync(chrome) ? chrome : 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe') })
})
after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)) })

function nativeFixture() {
  window.nativeMessages = []
  window.nativeFiles = []
  window.nativeReject = null
  const files = new Map()
  window.FireflyBlobDownload = {
    onmessage: null,
    postMessage(value) {
      const message = JSON.parse(value)
      window.nativeMessages.push(message)
      let response
      if (window.nativeReject === message.operation) {
        window.nativeReject = null
        response = { error: 'Canceled by native host' }
      } else if (message.operation === 'begin') {
        files.set(message.id, { name: message.name, size: message.size, mime: message.mime, chunks: [], written: 0 })
        response = { ready: true }
      } else if (message.operation === 'chunk') {
        const file = files.get(message.id)
        if (!file || message.offset !== file.written) throw new Error('Unexpected chunk offset')
        const bytes = Uint8Array.from(atob(message.data), character => character.charCodeAt(0))
        if (bytes.length > 262144) throw new Error('Oversized chunk')
        file.chunks.push(bytes)
        file.written += bytes.length
        response = { written: file.written }
      } else if (message.operation === 'finish') {
        const file = files.get(message.id)
        if (!file || file.written !== file.size) throw new Error('Incomplete file')
        const bytes = new Uint8Array(file.size)
        let offset = 0
        for (const chunk of file.chunks) { bytes.set(chunk, offset); offset += chunk.length }
        window.nativeFiles.push({ name: file.name, mime: file.mime, bytes: [...bytes] })
        files.delete(message.id)
        response = { saved: true }
      } else if (message.operation === 'error') { files.delete(message.id); return }
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ id: message.id, ...response }) }))
    },
  }
  // Keep the real anchor event dispatch and object-URL implementation, while
  // leaving actual system downloads to the Android device integration tests.
  document.addEventListener('click', event => event.preventDefault())
}

async function fixture(t) {
  const context = await browser.newContext()
  t.after(() => context.close())
  await context.addInitScript({ content: `(${nativeFixture})();\n${script}` })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  t.after(() => assert.deepEqual(errors, [], 'Unexpected page errors'))
  await page.goto(origin)
  return page
}

async function download(page, options = {}) {
  return page.evaluate(async options => {
    let blob
    if (options.realm) {
      const frame = document.createElement('iframe')
      frame.src = '/child'
      document.body.append(frame)
      await new Promise(resolve => { frame.onload = resolve })
      const Constructor = frame.contentWindow[options.realm === 'file' ? 'File' : 'Blob']
      blob = options.realm === 'file' ? new Constructor(['跨来源对象 😀'], 'source.txt', { type: 'text/plain' }) : new Constructor(['跨来源对象 😀'], { type: 'text/plain' })
    } else if (options.bytes !== undefined) {
      const bytes = new Uint8Array(options.bytes)
      for (let index = 0; index < bytes.length; index++) bytes[index] = (index * 29 + 7) & 255
      blob = new Blob([bytes], { type: 'application/octet-stream' })
    } else blob = new Blob(['中文 UTF-8 😀\n'], { type: 'text/plain' })
    const anchor = document.createElement('a'), url = URL.createObjectURL(blob)
    anchor.href = url
    anchor.download = options.name ?? '中文文件.txt'
    if (options.handlerName) anchor.addEventListener('click', event => {
      anchor.download = options.handlerName
      if (options.stopPropagation) event.stopPropagation()
    })
    if (options.dispatch) anchor.dispatchEvent(new MouseEvent('click'))
    else anchor.click()
    URL.revokeObjectURL(url)
    await window.__fireflyBlobDownload.start(crypto.randomUUID(), url, blob.type)
    return { files: window.nativeFiles, messages: window.nativeMessages }
  }, options)
}

test('detached anchors preserve UTF-8 content and filenames after immediate URL revocation', async t => {
  const result = await download(await fixture(t))
  assert.deepEqual(result.files, [{ name: '中文文件.txt', mime: 'text/plain', bytes: [...Buffer.from('中文 UTF-8 😀\n')] }])
  assert.deepEqual(result.messages.map(message => message.operation), ['begin', 'chunk', 'finish'])
})

for (const bytes of [0, 1, 262143, 262144, 262145, 3 * 1024 * 1024 + 19]) {
  test(`binary download preserves every byte at the ${bytes}-byte chunk boundary`, async t => {
    const result = await download(await fixture(t), { bytes, dispatch: true })
    assert.equal(result.files.length, 1)
    const expected = Buffer.alloc(bytes)
    for (let index = 0; index < bytes; index++) expected[index] = (index * 29 + 7) & 255
    assert(Buffer.from(result.files[0].bytes).equals(expected))
    assert.equal(result.messages.filter(message => message.operation === 'chunk').length, Math.ceil(bytes / 262144))
  })
}

for (const realm of ['blob', 'file']) {
  test(`a ${realm} from another same-origin frame survives immediate URL revocation`, async t => {
    const result = await download(await fixture(t), { realm })
    assert.equal(result.files.length, 1, JSON.stringify(result.messages))
    assert.deepEqual(result.files[0].bytes, [...Buffer.from('跨来源对象 😀')])
  })
}

for (const dispatch of [false, true]) {
  test(`a filename set by the click handler is used (${dispatch ? 'dispatchEvent' : 'click'})`, async t => {
    const result = await download(await fixture(t), { name: 'before.txt', handlerName: 'after.txt', stopPropagation: true, dispatch })
    assert.equal(result.files[0]?.name, 'after.txt')
  })
}

test('a trusted click uses the Blob URL and filename created by its handler', async t => {
  const page = await fixture(t)
  await page.evaluate(() => {
    const anchor = document.createElement('a')
    anchor.href = '#'; anchor.textContent = 'Create download'
    anchor.onclick = () => {
      window.clickedBlobUrl = URL.createObjectURL(new Blob(['trusted click']))
      anchor.href = window.clickedBlobUrl; anchor.download = 'created-on-click.txt'
      URL.revokeObjectURL(window.clickedBlobUrl)
    }
    document.body.append(anchor)
  })
  await page.getByRole('link', { name: 'Create download' }).click()
  const files = await page.evaluate(async () => {
    await window.__fireflyBlobDownload.start('trusted-click', window.clickedBlobUrl, 'text/plain')
    return window.nativeFiles
  })
  assert.deepEqual(files, [{ name: 'created-on-click.txt', mime: 'text/plain', bytes: [...Buffer.from('trusted click')] }])
})

for (const operation of ['begin', 'chunk', 'finish']) {
  test(`native cancellation at ${operation} releases the session and permits retry`, async t => {
    const page = await fixture(t)
    await page.evaluate(operation => { window.nativeReject = operation }, operation)
    const canceled = await download(page)
    assert.equal(canceled.files.length, 0)
    assert.equal(canceled.messages.at(-1).operation, 'error')
    assert.equal((await download(page)).files.length, 1)
  })
}

test('native cancellation during a pending Blob read permits immediate retry', async t => {
  const page = await fixture(t)
  await page.evaluate(() => {
    const read = Blob.prototype.arrayBuffer
    window.restoreBlobRead = () => { Blob.prototype.arrayBuffer = read }
    Blob.prototype.arrayBuffer = function () {
      window.blobReadStarted = true
      return new Promise(resolve => { window.releaseBlobRead = () => read.call(this).then(resolve) })
    }
    const blob = new Blob(['canceled']), url = URL.createObjectURL(blob), anchor = document.createElement('a')
    anchor.href = url; anchor.download = 'canceled.txt'; anchor.click()
    URL.revokeObjectURL(url)
    window.canceledTransfer = window.__fireflyBlobDownload.start('canceled-read', url, 'text/plain')
  })
  await page.waitForFunction(() => window.blobReadStarted)
  await page.evaluate(() => {
    window.FireflyBlobDownload.onmessage({ data: JSON.stringify({ id: 'canceled-read', error: 'Native read timeout' }) })
    window.restoreBlobRead()
  })
  const retried = await download(page)
  assert.equal(retried.files.length, 1, 'A canceled pending read still occupies the download adapter')
  await page.evaluate(async () => { window.releaseBlobRead(); await window.canceledTransfer })
})

test('the adapter is absent from subframes and leaves MediaSource object URLs usable', async t => {
  const page = await fixture(t)
  const result = await page.evaluate(async () => {
    const frame = document.createElement('iframe')
    frame.src = '/child'
    document.body.append(frame)
    await new Promise(resolve => { frame.onload = resolve })
    const source = new MediaSource(), url = URL.createObjectURL(source)
    URL.revokeObjectURL(url)
    return { childInstalled: !!frame.contentWindow.__fireflyBlobDownload, url }
  })
  assert.equal(result.childInstalled, false)
  assert(result.url.startsWith('blob:'))
})
