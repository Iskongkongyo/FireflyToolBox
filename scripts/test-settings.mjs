import { build } from 'esbuild'
import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

async function bundled(entry) {
  const result = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent' })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text + '\n//# sourceURL=' + entry).toString('base64')}`)
}
const config = await bundled('src/services/configuration.ts')
const { cacheReportMessage } = await bundled('src/services/runtimeCache.ts')
class Storage {
  values = new Map()
  failKey = null
  get length() { return this.values.size }
  key(index) { return [...this.values.keys()][index] ?? null }
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) { if (key === this.failKey) throw new Error('quota'); this.values.set(key, String(value)) }
  removeItem(key) { this.values.delete(key) }
}
beforeEach(() => { globalThis.localStorage = new Storage() })
const database = () => ({ schema_version: 3, favorites: ['json.format'], websites: [] })
const backup = preferences => JSON.stringify({ format: 'firefly-config-v1', database: database(), preferences })

test('configuration round trips every group and order without exporting private tool data', () => {
  const orders = {
    'firefly.order.categories.v1': JSON.stringify(['source:效率工具', 'source:开发与文本']),
    'firefly.order.homeTools.v1': JSON.stringify({ 'source:开发与文本': ['url.convert', 'json.format'] }),
    'firefly.order.favorites.v1': JSON.stringify(['json.format', 'url.convert']),
    'firefly.order.favoriteGroups.v1': JSON.stringify(['favorite:test']),
    'firefly.order.websites.v1': JSON.stringify(['5', '2']),
    'firefly.order.websiteGroups.v1': JSON.stringify(['website:test']),
  }
  for (const [key, value] of Object.entries(orders)) localStorage.setItem(key, value)
  localStorage.setItem('firefly.browser-module.tool.local.test.note', 'private')
  localStorage.setItem('firefly.tool-draft.v1', 'private draft')
  const parsed = config.parseBackup(config.serializeBackup(database()))
  assert.deepEqual({ ...parsed.preferences }, orders)
  localStorage = new Storage()
  config.restoreBackupPreferences(parsed.preferences)
  assert.deepEqual(Object.fromEntries(localStorage.values), orders)
})

test('invalid imported values and orders are rejected before modifying stored preferences', () => {
  localStorage.setItem('firefly.theme.v1', 'light')
  for (const value of [{ 'firefly.theme.v1': 'wrong' }, { 'firefly.card-gap.v1': '-1' }, { 'firefly.order.favorites.v1': '{broken' }, { 'firefly.order.homeTools.v1': '[]' }, { unknown: 'value' }, null]) {
    assert.throws(() => config.parseBackup(backup(value)))
    assert.equal(localStorage.getItem('firefly.theme.v1'), 'light')
  }
  assert.throws(() => config.parseBackup(JSON.stringify({ format: 'firefly-config-v1', database: { ...database(), favorites: ['json.format', 'json.format'] }, preferences: {} })))
})

test('UTF-8 BOM backups and old backups without newly included order keys remain readable', () => {
  const parsed = config.parseBackup('\uFEFF' + backup({ 'firefly.theme.v1': 'dark' }))
  assert.equal(parsed.preferences['firefly.theme.v1'], 'dark')
})

test('execution budgets round trip in backups and reject unsupported imported limits', () => {
  const init = 'firefly.web-tool-initialization-ms.v1', interaction = 'firefly.web-tool-interaction-ms.v1'
  localStorage.setItem(init, '30000'); localStorage.setItem(interaction, '0')
  const parsed = config.parseBackup(config.serializeBackup(database()))
  assert.equal(parsed.preferences[init], '30000'); assert.equal(parsed.preferences[interaction], '0')
  localStorage = new Storage(); config.restoreBackupPreferences(parsed.preferences)
  assert.equal(localStorage.getItem(init), '30000'); assert.equal(localStorage.getItem(interaction), '0')
  for (const value of ['-1', '', 'Infinity', '1.5', '5001', '3000000', ' 5000', '05']) assert.throws(() => config.parseBackup(backup({ [init]: value })))
})

test('failed configuration writes restore replaced and removed settings while preserving tool data', () => {
  localStorage.setItem('firefly.theme.v1', 'light')
  localStorage.setItem('firefly.accent.v1', '#112233')
  localStorage.setItem('firefly.browser-module.tool.local.test.note', 'private')
  const original = Object.fromEntries(localStorage.values)
  localStorage.failKey = 'firefly.card-gap.v1'
  assert.throws(() => config.restoreBackupPreferences({ 'firefly.theme.v1': 'dark', 'firefly.card-gap.v1': '12' }), /quota/)
  assert.deepEqual(Object.fromEntries(localStorage.values), original)
})

test('fullscreen and first-hint preferences round trip and older backups restore their defaults', () => {
  const fullscreen = 'firefly.web-tool-default-fullscreen.v1', hint = 'firefly.web-tool-fullscreen-initial-hint.v1'
  localStorage.setItem(fullscreen, 'true'); localStorage.setItem(hint, 'false')
  const parsed = config.parseBackup(config.serializeBackup(database()))
  localStorage = new Storage(); config.restoreBackupPreferences(parsed.preferences)
  assert.equal(localStorage.getItem(fullscreen), 'true'); assert.equal(localStorage.getItem(hint), 'false')
  for (const value of ['', '1', 'TRUE', 'null']) assert.throws(() => config.parseBackup(backup({ [fullscreen]: value })))
  config.restoreBackupPreferences({})
  assert.equal(localStorage.getItem(fullscreen), null); assert.equal(localStorage.getItem(hint), null)
})

test('cache reports distinguish complete cleanup, skipped files and unavailable browser cleanup', () => {
  const report = { disk_cache_cleared: true, temporary_files: 2, temporary_bytes: 5, memory_bytes: 1048576, skipped_files: 0, warnings: [] }
  assert.match(cacheReportMessage(report, 3), /缓存清理完成.*2 个临时文件.*3 项预览数据.*1.0 MiB/)
  assert.match(cacheReportMessage({ ...report, skipped_files: 1 }), /部分清理.*1 项临时数据未能清理/)
  assert.match(cacheReportMessage({ ...report, disk_cache_cleared: false, warnings: ['浏览器缓存清理超时'] }), /部分清理.*超时/)
  assert.match(cacheReportMessage({ ...report, disk_cache_cleared: false }), /当前平台未提供/)
})
