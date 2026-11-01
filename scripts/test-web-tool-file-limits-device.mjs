import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { connectAndroid } from './android-device-client.mjs'

const bundle = await build({ entryPoints: ['scripts/web-tool-file-limit-fixture.mjs'], bundle: true, write: false, format: 'iife', globalName: 'FileLimitReview', platform: 'browser' })
const client = await connectAndroid(), MiB = 1024 * 1024
const directory = path.resolve('target-check/web-tool-limit-review', client.device('get-serialno').replace(/[^\w-]/g, '_'))
await mkdir(directory, { recursive: true })
const report = { android: client.device('shell', 'getprop', 'ro.build.version.release'), checks: [] }
const pass = message => { report.checks.push(message); console.log('PASS:', message) }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function frameContext() {
  const tree = await client.call('Page.getFrameTree')
  const find = node => node.frame.url === 'about:srcdoc' ? node.frame : node.childFrames?.map(find).find(Boolean)
  const frame = find(tree.frameTree)
  assert(frame)
  return (await client.call('Page.createIsolatedWorld', { frameId: frame.id, worldName: 'file-limit-review' })).executionContextId
}
async function run(expression, contextId) {
  const result = await client.call('Runtime.evaluate', { expression, contextId, returnByValue: true })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result.value
}
async function review(settings, expected) {
  await client.evaluate(async settings => {
    window.fileLimitStats = await window.FileLimitReview.start(document.getElementById('file-limit-review'), settings)
  }, settings)
  const context = await frameContext()
  await run('document.getElementById("run").click()', context)
  let value
  for (let attempt = 0; attempt < 200; attempt++) {
    value = await run('document.getElementById("result").textContent', context)
    if (value === expected) break
    await delay(100)
  }
  assert.equal(value, expected)
  const stats = await client.evaluate(() => window.fileLimitStats)
  assert.deepEqual(stats.errors, [])
  return stats
}
const nativeRun = crypto.randomUUID()
try {
  await client.invoke('web_file_begin_run', { run: nativeRun, inputLimit: 2 ** 31, outputLimit: 2 ** 31 })
  const handles = []
  for (let index = 0; index < 128; index++) handles.push(await client.invoke('web_file_create_writer', { run: nativeRun }))
  assert.equal(new Set(handles).size, 128)
  await assert.rejects(client.invoke('web_file_create_writer', { run: nativeRun }), error => String(error).includes('FILE_BUSY:'))
  await client.invoke('web_file_close', { run: nativeRun, id: handles[0] })
  const reused = await client.invoke('web_file_create_writer', { run: nativeRun })
  assert.equal(typeof reused, 'string')
  await client.invoke('web_file_close_run', { run: nativeRun })
  pass('128 native writer handles open; the 129th is rejected; closing one frees a reusable slot.')
  const loaded = await client.call('Runtime.evaluate', { expression: bundle.outputFiles[0].text })
  assert(!loaded.exceptionDetails)
  await client.evaluate(() => {
    const container = document.createElement('div')
    container.id = 'file-limit-review'
    container.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:white;overflow:auto'
    document.body.append(container)
  })
  const exact = await review({}, 'copied:33554432')
  assert.equal(exact.readBytes, 32 * MiB)
  assert.equal(exact.writtenBytes, 32 * MiB)
  assert.equal(exact.writes, 32)
  assert.equal(exact.largestChunk, MiB)
  assert.equal(exact.valid, true)
  assert.equal(exact.saves, 1)
  pass('The Android sandbox opens and saves exactly 32 MiB with every output byte checked.')
  const declared = await review({ size: 32 * MiB + 1 }, 'FILE_INPUT_LIMIT')
  assert.equal(declared.reads, 0)
  assert.deepEqual(declared.closed, ['input'])
  pass('Declared input above 32 MiB is rejected before reading and its handle is closed.')
  const unknown = await review({ size: 32 * MiB + 1, unknownSize: true }, 'FILE_INPUT_LIMIT')
  assert.equal(unknown.readBytes, 32 * MiB + 1)
  assert.deepEqual(unknown.closed, ['input'])
  pass('Unknown-size input stops at the actual 32 MiB boundary and closes its handle.')
  const output = await review({ size: 32 * MiB + 1, saveOnly: true }, 'FILE_OUTPUT_LIMIT')
  assert.equal(output.writes, 0)
  assert.equal(output.saves, 0)
  pass('Output above 32 MiB never creates or writes a destination.')
  const inputQuota = await review({ size: MiB + 1, inputBytes: MiB }, 'FILE_INPUT_LIMIT')
  assert.equal(inputQuota.reads, 0)
  pass('A lower manifest input quota is enforced.')
  const outputQuota = await review({ size: MiB + 1, outputBytes: MiB, saveOnly: true }, 'FILE_OUTPUT_LIMIT')
  assert.equal(outputQuota.saves, 0)
  pass('A lower manifest output quota is enforced.')
  const fallback = await review({ size: 32 * MiB + 1, fallback: true }, 'FILE_INPUT_LIMIT')
  assert.equal(fallback.fallbackLimit, 32 * MiB)
  assert.equal(fallback.saves, 0)
  pass('The legacy callback receives 32 MiB and its actual returned size is checked.')
  await review({ tasksOnly: true }, 'tasks:42:AbortError:43:true')
  pass('A two-hour task is accepted and canceled; a longer deadline is rejected; the next task still runs.')
  await writeFile(path.join(directory, 'android.json'), JSON.stringify(report, null, 2))
} catch (error) {
  await writeFile(path.join(directory, 'error.txt'), String(error.stack || error))
  throw error
} finally {
  try {
    await client.invoke('web_file_close_run', { run: nativeRun })
    await client.evaluate(() => {
      window.FileLimitReview?.stopBrowserModule()
      document.getElementById('file-limit-review')?.remove()
      window.FileLimitReview = undefined
      delete window.fileLimitStats
    })
  } finally { client.close() }
}
