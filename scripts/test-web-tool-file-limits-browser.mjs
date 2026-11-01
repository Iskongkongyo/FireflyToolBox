import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const bundle = await build({ entryPoints: ['scripts/web-tool-file-limit-fixture.mjs'], bundle: true, write: false, format: 'esm', platform: 'browser' })
const publicDir = path.resolve('public'), MiB = 1024 * 1024
let server, browser, origin
before(async () => {
  server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname
    if (pathname === '/') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end('<!doctype html><meta charset="utf-8"><div id="host"></div>'); return }
    if (pathname === '/review.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0].text); return }
    const file = path.resolve(publicDir, '.' + pathname)
    if (!file.startsWith(publicDir + path.sep)) { response.writeHead(404); response.end(); return }
    try { response.setHeader('Content-Type', 'text/javascript'); response.end(fs.readFileSync(file)) }
    catch { response.writeHead(404); response.end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${server.address().port}`
  const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  browser = await chromium.launch({ headless: true, executablePath: process.env.FIREFLY_TEST_BROWSER || (fs.existsSync(chrome) ? chrome : 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe') })
})
after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)) })
async function review(t, settings, expected, width = 1280) {
  const context = await browser.newContext({ viewport: { width, height: 900 } })
  t.after(() => context.close())
  const page = await context.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(origin)
  await page.evaluate(async settings => {
    window.review = await import('/review.js')
    window.stats = await window.review.start(document.getElementById('host'), settings)
  }, settings)
  const frame = page.frameLocator('.web-tool-frame')
  await frame.getByRole('button', { name: 'Run', exact: true }).click()
  await frame.locator('#result').filter({ hasText: expected }).waitFor({ timeout: 20000 })
  const stats = await page.evaluate(() => window.stats)
  assert.deepEqual(errors, [])
  assert.deepEqual(stats.errors, [])
  return stats
}
for (const width of [1280, 390]) test(`exactly 32 MiB opens and saves intact through the sandbox at ${width}px`, async t => {
  const stats = await review(t, {}, 'copied:33554432', width)
  assert.equal(stats.readBytes, 32 * MiB)
  assert.equal(stats.writtenBytes, 32 * MiB)
  assert.equal(stats.writes, 32)
  assert.equal(stats.largestChunk, MiB)
  assert.equal(stats.valid, true)
  assert.equal(stats.saves, 1)
  assert.deepEqual(stats.closed, ['input', 'output'])
})
test('a declared input one byte over 32 MiB is rejected before reading', async t => {
  const stats = await review(t, { size: 32 * MiB + 1 }, 'FILE_INPUT_LIMIT')
  assert.equal(stats.reads, 0)
  assert.equal(stats.saves, 0)
  assert.deepEqual(stats.closed, ['input'])
})
test('unknown-size input is bounded by actual bytes and closes on overflow', async t => {
  const stats = await review(t, { size: 32 * MiB + 1, unknownSize: true }, 'FILE_INPUT_LIMIT')
  assert.equal(stats.readBytes, 32 * MiB + 1)
  assert.equal(stats.largestChunk, MiB)
  assert.equal(stats.saves, 0)
  assert.deepEqual(stats.closed, ['input'])
})
test('output one byte over 32 MiB is rejected before creating a writer', async t => {
  const stats = await review(t, { size: 32 * MiB + 1, saveOnly: true }, 'FILE_OUTPUT_LIMIT')
  assert.equal(stats.writes, 0)
  assert.equal(stats.saves, 0)
  assert.deepEqual(stats.closed, [])
})
test('a lower manifest input quota is still enforced', async t => {
  const stats = await review(t, { size: MiB + 1, inputBytes: MiB }, 'FILE_INPUT_LIMIT')
  assert.equal(stats.reads, 0)
})
test('a lower manifest output quota is still enforced', async t => {
  const stats = await review(t, { size: MiB + 1, outputBytes: MiB, saveOnly: true }, 'FILE_OUTPUT_LIMIT')
  assert.equal(stats.writes, 0)
  assert.equal(stats.saves, 0)
})
test('the legacy callback receives the new cap and cannot return an oversized file', async t => {
  const stats = await review(t, { size: 32 * MiB + 1, fallback: true }, 'FILE_INPUT_LIMIT')
  assert.equal(stats.fallbackLimit, 32 * MiB)
  assert.equal(stats.saves, 0)
})
test('the actual sandbox accepts a two-hour task, cancels it, and rejects a longer deadline', async t => {
  await review(t, { tasksOnly: true }, 'tasks:42:AbortError:43:true')
})
