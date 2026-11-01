import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const bundle = await build({ entryPoints: ['src/services/browserModule.ts'], bundle: true, write: false, format: 'esm', platform: 'browser' })
const publicDir = path.resolve('public')
const appVersion = JSON.parse(fs.readFileSync('package.json', 'utf8')).version
let server, browser, origin
before(async () => {
  server = createServer((request, response) => {
    const requestUrl = new URL(request.url, 'http://localhost'), pathname = requestUrl.pathname
    if (pathname === '/') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end('<!doctype html><meta charset="utf-8"><div id="host"></div>')
    } else if (pathname === '/host.js') {
      response.setHeader('Content-Type', 'text/javascript')
      response.end(bundle.outputFiles[0].text)
    } else {
      // Model an old cached public script: only the current version is usable.
      if (requestUrl.searchParams.get('v') !== appVersion) {
        response.setHeader('Content-Type', 'text/javascript')
        response.end('throw new Error("Old unversioned runtime was loaded")')
        return
      }
      const file = path.resolve(publicDir, '.' + pathname)
      if (!file.startsWith(publicDir + path.sep)) { response.writeHead(404); response.end(); return }
      try { response.setHeader('Content-Type', 'text/javascript'); response.end(fs.readFileSync(file)) }
      catch { response.writeHead(404); response.end() }
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${server.address().port}`
  const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  browser = await chromium.launch({ headless: true, executablePath: process.env.FIREFLY_TEST_BROWSER || (fs.existsSync(chrome) ? chrome : 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe') })
})
after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)) })

async function fixture(t, width = 1280, expectedGuardRejection = false) {
  const context = await browser.newContext({ viewport: { width, height: 900 } })
  t.after(() => context.close())
  const page = await context.newPage(), errors = []
  page.on('pageerror', error => {
    // A deliberate rejection can be reported after Chromium removes its iframe.
    if (expectedGuardRejection && /^(?:Uncaught \(in promise\) )?WebToolRuntimeError$/.test(error.name) && /交互.*10 秒/.test(error.message)) return
    errors.push(`${error.name}: ${error.message}`)
  })
  t.after(() => assert.deepEqual(errors, [], 'Unexpected host errors'))
  await page.goto(origin)
  await page.evaluate(async () => { window.reviewHost = await import('/host.js') })
  async function start(script, timeoutMs = 15000, networkHosts = []) {
    await page.evaluate(({ script, timeoutMs, networkHosts }) => {
      window.reviewErrors = []; window.reviewReady = false
      window.reviewMount = window.reviewHost.mountWebTool(document.getElementById('host'), {
        moduleId: 'preview.budget-review', html: '<main><button id="run">Run</button><output id="result">Ready</output></main>', css: 'button { min-width:80px; min-height:44px }', script,
        networkHosts, resources: [], timeoutMs, inputBytes: 2147483648, outputBytes: 2147483648,
        openFile: async () => null, saveFile: async () => true,
        onError: error => window.reviewErrors.push(error),
      }).then(() => { window.reviewReady = true }).catch(error => { window.reviewErrors.push(error.message) })
    }, { script, timeoutMs, networkHosts })
  }
  const ready = async () => {
    await page.waitForFunction(() => window.reviewReady || window.reviewErrors.length, null, { timeout: 20000 })
    assert.deepEqual(await page.evaluate(() => window.reviewErrors), [])
    assert.equal(await page.evaluate(() => window.reviewReady), true)
  }
  const stopped = async message => {
    await page.waitForFunction(() => window.reviewErrors.length, null, { timeout: 15000 })
    assert.match((await page.evaluate(() => window.reviewErrors)).join('\n'), message)
    assert.equal(await page.locator('.web-tool-frame').count(), 0)
  }
  return { page, frame: page.frameLocator('.web-tool-frame'), start, ready, stopped }
}

const busy = 'function busy(ms) { const end=performance.now()+ms; while(performance.now()<end){} }'
test('a sandbox can fetch its first and 64th declared origins and blocks an undeclared origin', async t => {
  const f = await fixture(t), contacted = []
  await f.page.route('https://*.example.com/**', async route => {
    contacted.push(new URL(route.request().url()).origin)
    await route.fulfill({ status: 200, contentType: 'text/plain', headers: { 'Access-Control-Allow-Origin': '*' }, body: 'Allowed' })
  })
  const hosts = Array.from({ length: 64 }, (_, index) => `https://host${index}.example.com`)
  await f.start(`export function mount(){document.getElementById('run').onclick=async()=>{
    const first=await (await fetch('https://host0.example.com/test')).text();
    const last=await (await fetch('https://host63.example.com/test')).text();
    let denied=false;try{await fetch('https://undeclared.example.com/test')}catch{denied=true}
    document.getElementById('result').textContent=first+','+last+','+denied;
  }}`, 15000, hosts)
  await f.ready()
  await f.frame.getByRole('button', { name: 'Run', exact: true }).click()
  await f.frame.locator('#result').filter({ hasText: 'Allowed,Allowed,true' }).waitFor()
  assert.deepEqual(contacted, [hosts[0], hosts[63]])
  assert.deepEqual(await f.page.evaluate(() => window.reviewErrors), [])
})

for (const width of [1280, 390]) {
  test(`3.4-second initialization and 6-second interaction succeed at ${width}px`, { timeout: 20000 }, async t => {
    const f = await fixture(t, width)
    await f.start(`${busy}; export function mount() { busy(3400); document.getElementById('run').onclick=()=>{busy(6000);document.getElementById('result').textContent='Done'} }`)
    await f.ready()
    await f.frame.getByRole('button', { name: 'Run', exact: true }).click()
    assert.equal(await f.frame.locator('#result').textContent(), 'Done')
    assert.deepEqual(await f.page.evaluate(() => window.reviewErrors), [])
  })
}

test('asynchronous initialization may wait longer than the synchronous execution budget', { timeout: 15000 }, async t => {
  const f = await fixture(t)
  await f.start(`${busy}; export async function mount() { await new Promise(resolve=>setTimeout(resolve,5400)); busy(100); document.getElementById('result').textContent='Loaded' }`)
  await f.ready()
  assert.equal(await f.frame.locator('#result').textContent(), 'Loaded')
})

test('a real initialization loop stops at its own budget and another tool can open afterward', { timeout: 15000 }, async t => {
  const f = await fixture(t)
  await f.start('export function mount() { for(;;) {} }')
  await f.stopped(/初始化.*5 秒/)
  assert.equal(await f.page.evaluate(() => window.reviewReady), false)
  await f.start('export function mount() { document.getElementById("result").textContent="Recovered" }')
  await f.ready()
  assert.equal(await f.frame.locator('#result').textContent(), 'Recovered')
})

test('a runaway interaction microtask loop stops under the interaction budget', { timeout: 20000 }, async t => {
  const f = await fixture(t, 1280, true)
  await f.start('export function mount() { document.getElementById("run").onclick=async()=>{for(;;){await Promise.resolve()}} }')
  await f.ready()
  const box = await f.frame.getByRole('button', { name: 'Run', exact: true }).boundingBox()
  assert(box)
  await f.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await f.stopped(/交互.*10 秒/)
})

test('the complete mount deadline still applies to an asynchronous mount', { timeout: 6000 }, async t => {
  const f = await fixture(t)
  await f.start('export async function mount() { await new Promise(resolve=>setTimeout(resolve,3000)) }', 1000)
  await f.stopped(/加载超时/)
  assert.equal(await f.page.evaluate(() => window.reviewReady), false)
})

test('raised budgets allow real initialization and interaction beyond the defaults', { timeout: 30000 }, async t => {
  const f = await fixture(t)
  await f.page.evaluate(() => {
    localStorage.setItem('firefly.web-tool-initialization-ms.v1', '10000')
    localStorage.setItem('firefly.web-tool-interaction-ms.v1', '30000')
  })
  await f.start(`${busy};export function mount(){busy(5400);document.getElementById('run').onclick=()=>{busy(10400);document.getElementById('result').textContent='Completed'}}`, 1000)
  await f.ready()
  await f.frame.getByRole('button', { name: 'Run', exact: true }).click({ timeout: 20000 })
  await f.frame.locator('#result').filter({ hasText: 'Completed' }).waitFor()
  assert.deepEqual(await f.page.evaluate(() => window.reviewErrors), [])
})

test('unlimited initialization can outlive the manifest deadline and still be stopped', { timeout: 6000 }, async t => {
  const f = await fixture(t)
  await f.page.evaluate(() => localStorage.setItem('firefly.web-tool-initialization-ms.v1', '0'))
  await f.start('export async function mount(){await new Promise(resolve=>setTimeout(resolve,1200));document.getElementById("result").textContent="Loaded"}', 200)
  await f.ready()
  assert.equal(await f.frame.locator('#result').textContent(), 'Loaded')
  await f.page.evaluate(() => window.reviewHost.stopBrowserModule())
  assert.equal(await f.page.locator('iframe').count(), 0)
  await f.start('export async function mount(){await new Promise(()=>{})}', 200)
  await f.page.waitForTimeout(400)
  assert.deepEqual(await f.page.evaluate(() => window.reviewErrors), [])
  await f.page.evaluate(() => window.reviewHost.stopBrowserModule())
  await f.page.waitForFunction(() => window.reviewErrors.length > 0)
  assert.equal(await f.page.locator('iframe').count(), 0)
})
