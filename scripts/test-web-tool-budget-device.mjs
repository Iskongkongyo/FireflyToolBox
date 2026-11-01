import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { connectAndroid } from './android-device-client.mjs'

const bundle = await build({ entryPoints: ['src/services/browserModule.ts'], bundle: true, write: false, format: 'iife', globalName: 'BudgetReview', platform: 'browser' })
const client = await connectAndroid()
const directory = path.resolve('target-check/web-tool-budget-review', client.device('get-serialno').replace(/[^\w-]/g, '_'))
await mkdir(directory, { recursive: true })
const report = { android: client.device('shell', 'getprop', 'ro.build.version.release'), webview: client.device('shell', 'dumpsys', 'webviewupdate').match(/Current WebView package[^\n]+/)?.[0], checks: [] }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const busy = 'function busy(ms){const end=performance.now()+ms;while(performance.now()<end){}}'
const pass = message => { report.checks.push(message); console.log('PASS:', message) }
async function until(check, message) {
  for (let attempt = 0; attempt < 150; attempt++) { const value = await check(); if (value) return value; await delay(100) }
  throw new Error(message)
}
async function start(script, timeoutMs = 15000) {
  await client.evaluate((script, timeoutMs) => {
    window.budgetReviewErrors = []; window.budgetReviewReady = false
    window.budgetReviewMount = window.BudgetReview.mountWebTool(document.getElementById('budget-review'), {
      moduleId: 'preview.budget-review', html: '<main><button id="run">Run</button><output id="result">Ready</output></main>', css: 'button{min-height:44px;min-width:100px}main{padding:20px}', script,
      networkHosts: [], resources: [], timeoutMs, inputBytes: 2147483648, outputBytes: 2147483648,
      openFile: async () => null, saveFile: async () => true,
      onError: error => window.budgetReviewErrors.push(error),
    }).then(() => { window.budgetReviewReady = true }).catch(error => { window.budgetReviewErrors.push(error.message) })
  }, script, timeoutMs)
}
async function ready() {
  await until(() => client.evaluate(() => window.budgetReviewReady || window.budgetReviewErrors.length), 'The native web tool did not settle')
  assert.deepEqual(await client.evaluate(() => window.budgetReviewErrors), [])
  assert.equal(await client.evaluate(() => window.budgetReviewReady), true)
}
async function stopped(pattern) {
  await until(() => client.evaluate(() => window.budgetReviewErrors.length), 'The native web tool did not stop')
  assert.match((await client.evaluate(() => window.budgetReviewErrors)).join('\n'), pattern)
  assert.equal(await client.evaluate(() => document.querySelectorAll('#budget-review iframe').length), 0)
}
async function frameContext() {
  const tree = await client.call('Page.getFrameTree')
  const find = item => item.frame.url === 'about:srcdoc' ? item.frame : item.childFrames?.map(find).find(Boolean)
  const frame = find(tree.frameTree)
  assert(frame, 'The native sandbox frame is missing')
  return (await client.call('Page.createIsolatedWorld', { frameId: frame.id, worldName: 'budget-review' })).executionContextId
}
async function run(expression, contextId) {
  const result = await client.call('Runtime.evaluate', { expression, contextId, returnByValue: true })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result.value
}

try {
  const guide = (await readFile('skills/firefly-module-author/SKILL.md', 'utf8')).replace(/\r\n?/g, '\n')
  const section = guide.split('## 网页工具模板')[1].split('### 页面背景与配色')[0]
  const blocks = [...section.matchAll(/```(?:json|html|css|js)\n([\s\S]*?)\n```/g)].map(match => match[1])
  assert.equal(blocks.length, 4)
  const manifest = JSON.parse(blocks[0])
  assert.equal(manifest.limits.input_bytes, 2147483648)
  assert.equal(manifest.limits.output_bytes, 2147483648)
  manifest.permissions = ['network']
  manifest.network.hosts = Array.from({ length: 64 }, (_, index) => `https://host${index}.example.com`)
  const scripts = Object.fromEntries(['index.html', 'style.css', 'main.js'].map((name, index) => [name, blocks[index + 1]]))
  await client.invoke('validate_module_draft', { manifest, scripts })
  manifest.network.hosts.push('https://extra.example.com')
  await assert.rejects(client.invoke('validate_module_draft', { manifest, scripts }))
  pass('The standalone guide validates natively with 2 GiB input/output and 64 origins; 65 origins are rejected.')

  const loaded = await client.call('Runtime.evaluate', { expression: bundle.outputFiles[0].text })
  assert(!loaded.exceptionDetails, JSON.stringify(loaded.exceptionDetails))
  await client.evaluate(() => {
    const container = document.createElement('div')
    container.id = 'budget-review'
    container.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:white;overflow:auto'
    document.body.append(container)
  })
  await start(`${busy};export function mount(){busy(3400);document.getElementById('run').onclick=()=>{busy(6000);document.getElementById('result').textContent='Done'}}`)
  await ready()
  pass('Initialization lasting 3.4 seconds completes with the native iframe runtime.')
  let context = await frameContext()
  await run('document.getElementById("run").click()', context)
  assert.equal(await run('document.getElementById("result").textContent', context), 'Done')
  assert.deepEqual(await client.evaluate(() => window.budgetReviewErrors), [])
  pass('An interaction lasting 6 seconds completes after initialization.')

  client.device('shell', 'input', 'keyevent', '3')
  await delay(11000)
  client.device('shell', 'am', 'start', '-n', 'firefly.toolbox/.MainActivity')
  context = await frameContext()
  await run('document.getElementById("run").click()', context)
  assert.deepEqual(await client.evaluate(() => window.budgetReviewErrors), [])
  pass('Returning from the background leaves the next interaction usable.')

  await start(`${busy};export async function mount(){await new Promise(resolve=>setTimeout(resolve,5400));busy(100)}`)
  await ready()
  pass('Asynchronous initialization can wait longer than the five-second synchronous budget.')

  await start('export function mount(){for(;;){}}')
  await stopped(/初始化.*5 秒/)
  pass('A genuine initialization loop stops and removes its native sandbox.')

  await start('export function mount(){document.getElementById("run").onclick=async()=>{for(;;){await Promise.resolve()}}}')
  await ready()
  context = await frameContext()
  try { await run('document.getElementById("run").click()', context) }
  catch (error) { if (!/context|SCRIPT_TIME_LIMIT|WebToolRuntimeError/i.test(error.message)) throw error }
  await stopped(/交互.*10 秒/)
  pass('A runaway interaction microtask loop stops under the ten-second budget.')

  await start('export function mount(){document.getElementById("result").textContent="Recovered"}')
  await ready()
  assert.equal(await run('document.getElementById("result").textContent', await frameContext()), 'Recovered')
  pass('A new tool opens after a forced stop without retaining the previous budget.')

  await start('export async function mount(){await new Promise(resolve=>setTimeout(resolve,3000))}', 1000)
  await stopped(/加载超时/)
  pass('The manifest-controlled complete mount deadline remains independent.')
  await writeFile(path.join(directory, 'android.json'), JSON.stringify(report, null, 2))
} catch (error) {
  await writeFile(path.join(directory, 'error.txt'), String(error.stack || error))
  throw error
} finally {
  try { await client.evaluate(() => {
    window.BudgetReview?.stopBrowserModule()
    document.getElementById('budget-review')?.remove()
    window.BudgetReview = undefined
    delete window.budgetReviewErrors; delete window.budgetReviewReady; delete window.budgetReviewMount
  }) } finally { client.close() }
}
