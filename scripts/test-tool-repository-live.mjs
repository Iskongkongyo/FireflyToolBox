// Run against normal debug clients, without FIREFLY_REPOSITORY_TEST_URL.
// Read the public repository and inspect downloads; never install its tools.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { connectWindows } from './windows-test-client.mjs'
import { connectAndroid } from './android-device-client.mjs'

const windows = process.argv.includes('--windows'), keep = setInterval(() => {}, 1000)
const nativeFetch = fetch
globalThis.fetch = (url, init = {}) => nativeFetch(url, { ...init, signal: init.signal || AbortSignal.timeout(3000) })
const keys = ['firefly.smart-clipboard.v1', 'firefly.startup-splash-enabled.v1', 'firefly.remote-messages.read.v1']
let client, saved, lease = '', directory
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn, ...args) { for (let i = 0; i < 300; i++) { if (await client.evaluate(fn, ...args)) return; await pause(100) }; throw new Error('Timed out: ' + fn) }
async function ready() { await until(() => { document.querySelector('.startup-splash-skip')?.click(); return document.querySelector('.app-shell') && !document.querySelector('.app-shell').inert }) }
async function nav(name) { await client.evaluate(name => [...document.querySelectorAll('.nav-button')].find(node => node.textContent.trim() === name).click(), name) }
async function shot(name) { const value = await client.call('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(directory, name + '.png'), Buffer.from(value.data, 'base64')) }
try {
  client = await (windows ? connectWindows() : connectAndroid())
  directory = path.resolve('target-check/tool-download/live', windows ? 'windows' : client.device('get-serialno')); await mkdir(directory, { recursive: true })
  await ready(); saved = await client.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), keys)
  await client.evaluate(keys => { localStorage.setItem(keys[0], 'false'); localStorage.setItem(keys[1], 'false') }, keys)
  await client.call('Page.reload'); await ready(); await nav('关于应用')
  await until(() => { const button = document.querySelector('.about-link'); return button && !button.disabled })
  for (let i = 0; i < 3; i++) {
    if (!await client.evaluate(() => !!document.querySelector('.remote-message-dialog[open]'))) break
    await client.evaluate(() => { const modal = document.querySelector('.remote-message-dialog[open]'); if (modal.classList.contains('remote-message-required')) throw new Error('Live feed requires an update'); (modal.querySelector('.secondary-button') || modal.querySelector('.primary-button')).click() }); await pause(150)
  }
  const before = (await client.invoke('list_modules')).map(value => `${value.module_id}:${value.version}`).sort()
  const catalog = await client.invoke('repository_catalog', { route: 'auto', refresh: true })
  assert.equal(catalog.repository_url, 'https://github.com/Iskongkongyo/FFTools'); assert(catalog.entries.length >= 10)
  assert(!catalog.entries.some(value => value.path.includes('test.repo_')))
  await nav('工具市场'); await until(count => document.querySelectorAll('.repository-card').length === count, catalog.entries.length)
  await until(() => !document.querySelector('.repository-catalog-info [role="status"]'))
  const titles = await client.evaluate(() => [...document.querySelectorAll('.repository-card h2')].map(node => node.textContent))
  assert(titles.some(value => /[\u4e00-\u9fff]/.test(value)), 'Commit names were not loaded'); await shot('catalog')
  const described = await client.invoke('repository_catalog', { route: 'auto', refresh: false })
  const small = described.entries.find(value => value.file_name.includes('photo_mosaic')) || described.entries.toSorted((a, b) => a.size - b.size)[0]
  await client.evaluate(id => [...document.querySelectorAll('.repository-card')].find(node => node.dataset.entryId === id).querySelector('.repository-card-actions .primary-button').click(), small.id)
  await until(() => !!document.querySelector('.repository-dialog[open]'))
  assert.equal(await client.evaluate(() => !!document.querySelector('.repository-consent input:checked')), false)
  assert.equal(await client.evaluate(() => !!document.querySelector('.repository-dialog .error-text')), false)
  await shot('preview'); await client.evaluate(() => document.querySelector('.repository-dialog .icon-button').click())
  const large = described.entries.toSorted((a, b) => b.size - a.size)[0]
  const value = await client.invoke('repository_prepare', { id: large.id, route: 'auto', requestId: crypto.randomUUID() }); lease = value.token
  assert.equal(value.bytes, large.size); assert(value.summary); assert(value.compatible); assert.equal(value.inspection_error, null)
  assert.deepEqual((await client.invoke('list_modules')).map(value => `${value.module_id}:${value.version}`).sort(), before)
  await writeFile(path.join(directory, 'results.json'), JSON.stringify({ count: catalog.entries.length, commit: catalog.commit, source: catalog.source, titles, large: { file: large.file_name, bytes: value.bytes, source: value.source, module: value.summary.module_id }, installedUnchanged: true }, null, 2))
  console.log('PASS: real FFTools catalog, commit titles, install preview and largest package integrity', JSON.stringify({ count: catalog.entries.length, bytes: value.bytes, source: value.source }))
} finally {
  try {
    if (client && lease) await client.invoke('repository_release', { token: lease })
    if (client && saved) { await nav('首页'); await client.evaluate(values => { for (const [key, value] of Object.entries(values)) value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value) }, saved); await client.call('Page.reload'); await ready(); assert.deepEqual(await client.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), keys), saved) }
  } finally { client?.close(); clearInterval(keep); globalThis.fetch = nativeFetch }
}
