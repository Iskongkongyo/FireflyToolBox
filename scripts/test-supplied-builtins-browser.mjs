import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const bundle = await build({ stdin: { contents: "export {mountWebTool,stopBrowserModule,setWebToolFullscreen} from './src/services/browserModule.ts'", resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'browser' })
const specs = {}
for (const [stem, id] of [['screen-check', 'screen.check'], ['quote-card', 'quote.card']]) {
  const manifest = JSON.parse(fs.readFileSync(`src-tauri/builtin-tools/src/${stem}.manifest.json`, 'utf8'))
  specs[id] = { manifest, html: fs.readFileSync(`src-tauri/builtin-tools/src/${stem}.html`, 'utf8'), css: fs.readFileSync(`src-tauri/builtin-tools/src/${stem}.css`, 'utf8'), script: fs.readFileSync(`src-tauri/builtin-tools/generated/${stem}.js`, 'utf8') }
}
let server, browser, origin
before(async () => {
  server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname
    if (pathname === '/') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end('<!doctype html><meta charset="utf-8"><style>body{margin:0}#host{width:100%}.web-tool-frame{display:block;width:100%;border:0}</style><div id="host"></div>'); return }
    if (pathname === '/host.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0].text); return }
    const root = path.resolve('public'), file = path.resolve(root, '.' + pathname)
    if (!file.startsWith(root + path.sep)) { response.writeHead(404).end(); return }
    try { response.setHeader('Content-Type', 'text/javascript'); response.end(fs.readFileSync(file)) } catch { response.writeHead(404).end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch({ headless: true, executablePath: fs.existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe') ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' })
  fs.mkdirSync('target-check/supplied-builtins/browser', { recursive: true })
})
after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)) })
async function fixture(t, width, deviceScaleFactor = 1) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor }); context.setDefaultTimeout(12000)
  const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message))
  t.after(async () => { try { assert.deepEqual(errors, []); assert.deepEqual(await page.evaluate(() => window.hostErrors), []) } finally { await context.close() } })
  await page.addInitScript(() => {
    if (window !== window.top) return
    window.isTauri = true; window.stored = JSON.parse(sessionStorage.getItem('native-stores') || '{}'); window.hostErrors = []; window.httpMode = 'ok'; window.httpRequests = []; window.saveResult = true
    const sessions = new Map()
    window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
      if (command === 'load_tool_storage') { if (args.readOnly) return window.stored[args.moduleId] ?? null; return window.stored[args.moduleId] ?? args.legacyJson }
      if (command === 'save_tool_storage') { window.stored[args.moduleId] = args.valuesJson; sessionStorage.setItem('native-stores', JSON.stringify(window.stored)); return }
      if (command === 'web_tool_http_create') {
        window.httpRequests.push(args); if (window.httpMode === 'fail') throw Error('fixture offline')
        if (!args.allowedHosts.includes(new URL(args.url).origin)) throw Error('Origin denied')
        const id = crypto.randomUUID(); sessions.set(id, { ...args, read: false }); return id
      }
      if (command === 'web_tool_http_start') return { status: 200, url: sessions.get(args.id).url, headers: [['content-type', 'application/json']] }
      if (command === 'web_tool_http_read') {
        const state = sessions.get(args.id); if (state.read) return new ArrayBuffer(0); state.read = true
        return new TextEncoder().encode(JSON.stringify(window.httpMode === 'malformed' ? {} : { hitokoto: '来自测试接口的一句话', from_who: '测试作者', type: 'd' })).buffer
      }
      if (command === 'web_tool_http_cancel') { sessions.delete(args.id); return }
      throw Error(command)
    } }
  })
  await page.goto(origin)
  async function mount(id) {
    const spec = specs[id]
    await page.evaluate(async ({ spec, id }) => {
      window.api = await import('/host.js')
      await window.api.mountWebTool(document.getElementById('host'), {
        moduleId: 'tool.' + id, html: spec.html, css: spec.css, script: spec.script, networkHosts: spec.manifest.network.hosts,
        timeoutMs: spec.manifest.limits.timeout_ms, inputBytes: spec.manifest.limits.input_bytes, outputBytes: spec.manifest.limits.output_bytes,
        openFile: async () => null, saveFile: async (name, bytes) => { const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); window.saved = { name, bytes: bytes.length, signature: [...bytes.slice(0, 8)], width: view.getUint32(16), height: view.getUint32(20) }; return window.saveResult },
        copyText: async text => { window.copied = text }, onError: e => window.hostErrors.push(e),
      })
      if (spec.manifest.tools[0].ui.fullscreen) window.api.setWebToolFullscreen(true)
    }, { spec, id })
  }
  return { page, mount, frame: page.frameLocator('.web-tool-frame') }
}
for (const ratio of [1.5, 3.25]) test(`screen checker preserves physical pixels at DPR ${ratio} with fractional CSS sizes`, async t => {
  const f = await fixture(t, 375, ratio)
  await f.page.evaluate(() => document.getElementById('host').style.width = '374.75px')
  await f.mount('screen.check'); await f.frame.locator('#btnStart').click()
  for (let i = 0; i < 15; i++) await f.frame.locator('body').press('ArrowRight')
  const size = await f.frame.locator('#cv').evaluate(c => { const r = document.querySelector('#stage').getBoundingClientRect(); return { width: c.width, height: c.height, expectedWidth: Math.round(r.width * devicePixelRatio), expectedHeight: Math.round(r.height * devicePixelRatio), pixels: [...c.getContext('2d').getImageData(0, 0, 2, 2).data] } })
  assert.equal(size.width, size.expectedWidth); assert.equal(size.height, size.expectedHeight)
  assert.notEqual(size.pixels[0], size.pixels[4]); assert.equal(size.pixels[0], size.pixels[12])
})
for (const width of [1280, 390]) {
  test(`screen patterns cover all 21 modes and retain filter/settings across reopen at ${width}px`, async t => {
    const f = await fixture(t, width); await f.mount('screen.check'); await f.frame.locator('#btnStart').click()
    const seen = new Set()
    for (let i = 1; i <= 21; i++) {
      assert.equal(await f.frame.locator('#metaCount').textContent(), `${i} / 21`); seen.add(await f.frame.locator('#metaName').textContent())
      await f.frame.locator('body').press('ArrowRight')
    }
    assert.equal(seen.size, 21)
    await f.frame.locator('body').press('o'); await f.frame.locator('[data-key=autoMs] [data-v="3000"]').click(); await f.frame.locator('[data-key=groups] [data-g=motion]').click(); await f.frame.locator('#btnClose').click()
    assert.match(await f.frame.locator('#metaCount').textContent(), /\/ 18$/)
    await f.page.waitForFunction(() => JSON.parse(JSON.parse(window.stored['tool.screen.check'])['screen_check.prefs.v1']).autoMs === 3000)
    await f.page.screenshot({ path: `target-check/supplied-builtins/browser/screen-${width}.png` })
    await f.page.evaluate(() => window.api.stopBrowserModule()); await f.mount('screen.check')
    assert.equal(await f.frame.locator('#intro').isVisible(), false)
    assert.match(await f.frame.locator('#metaCount').textContent(), /\/ 18$/)
  })
  test(`quote cards render six themes, preserve favorites and export real HD PNG with cancellation at ${width}px`, async t => {
    const f = await fixture(t, width); await f.mount('quote.card')
    await f.frame.locator('#btnWrite').click(); await f.frame.locator('#txt').fill('内置卡片测试 🐱'); await f.frame.locator('#who').fill('流萤测试'); await f.frame.locator('#btnApply').click()
    await f.frame.getByRole('img', { name: /内置卡片测试/ }).waitFor()
    for (const theme of ['xuan', 'night', 'mist', 'film', 'press', 'neon']) {
      const button = f.frame.locator(`[data-theme="${theme}"]`); await button.click()
      await f.frame.locator('#card').evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)))
      assert.match(await button.getAttribute('class'), /on/)
      assert.equal(await f.frame.locator('#card').evaluate(c => c.getContext('2d').getImageData(1, 1, 1, 1).data[3]), 255)
      assert.equal((await f.frame.locator('#status').textContent()).includes('绘制失败'), false)
    }
    await f.frame.locator('#segRatio [data-v="9-16"]').click(); await f.frame.locator('.switch:has(#chkVertical)').click()
    assert.equal(await f.frame.locator('#chkVertical').isChecked(), true); assert.equal(await f.frame.locator('#chkHi').isChecked(), true)
    await f.frame.locator('#btnFav').click(); await f.frame.locator('#btnCopy').click()
    assert.equal(await f.page.evaluate(() => window.copied), '内置卡片测试 🐱\n—— 流萤测试')
    await f.frame.locator('#btnSave').click(); await f.frame.locator('#status').filter({ hasText: '已保存' }).waitFor()
    const saved = await f.page.evaluate(() => window.saved)
    assert.deepEqual([saved.width, saved.height], [2160, 3840]); assert.deepEqual(saved.signature, [137, 80, 78, 71, 13, 10, 26, 10]); assert(saved.bytes > 1000 && saved.bytes <= 32 * 1024 * 1024)
    await f.page.evaluate(() => { window.saveResult = false }); await f.frame.locator('#btnSave').click(); await f.frame.locator('#status').filter({ hasText: '已取消' }).waitFor(); assert.equal(await f.frame.locator('#btnSave').isEnabled(), true)
    await f.page.waitForFunction(() => !!JSON.parse(window.stored['tool.quote.card'])['quote_card.favs.v1'])
    await f.page.evaluate(() => window.api.stopBrowserModule()); await f.mount('quote.card')
    assert.equal(await f.frame.locator('#favCount').textContent(), '1 条'); await f.frame.locator('[data-i="0"]').click()
    await f.frame.getByRole('img', { name: /内置卡片测试/ }).waitFor()
    await f.page.screenshot({ path: `target-check/supplied-builtins/browser/quote-${width}.png` })
  })
  test(`quote content requests enforce the supplied hosts and fall back offline at ${width}px`, async t => {
    const f = await fixture(t, width); await f.mount('quote.card')
    await f.page.evaluate(() => { window.httpMode = 'fail' }); await f.frame.locator('#btnNext').click(); await f.frame.locator('#status').filter({ hasText: '内置语料' }).waitFor()
    await f.page.evaluate(() => { window.httpMode = 'ok' }); await f.frame.locator('#btnNext').click()
    await f.frame.getByRole('img', { name: /来自测试接口的一句话/ }).waitFor()
    const requests = await f.page.evaluate(() => window.httpRequests)
    assert.equal(new URL(requests.at(-1).url).origin, 'https://v1.hitokoto.cn'); assert.deepEqual(requests.at(-1).allowedHosts, specs['quote.card'].manifest.network.hosts)
    await f.page.evaluate(() => { window.httpMode = 'malformed' }); await f.frame.locator('#btnNext').click(); await f.frame.locator('#status').filter({ hasText: '内置语料' }).waitFor()
  })
}
