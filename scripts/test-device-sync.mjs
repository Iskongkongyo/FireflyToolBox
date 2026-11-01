import { build } from 'esbuild'
import assert from 'node:assert/strict'
import { test, beforeEach } from 'node:test'

const bundle = await build({ entryPoints: ['src/services/deviceSync.ts'], bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent' })
const sync = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
const storageBundle=await build({entryPoints:['src/services/webToolStorage.ts'],bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent'})
const storage=await import(`data:text/javascript;base64,${Buffer.from(storageBundle.outputFiles[0].text).toString('base64')}`)
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
function applied(preferences) { return { imported: 0, skipped: 0, id_map: { 'custom.1': 'custom.7' }, website_map: { '1': '9' }, active_ids: ['custom.1', 'custom.7', 'local.example.main'], site_ids: ['1', '9'], preferences, warnings: [] } }
const fullscreenKey = 'firefly.web-tool-default-fullscreen.v1', hintKey = 'firefly.web-tool-fullscreen-initial-hint.v1'
const presentationDefaults = { [fullscreenKey]: 'false', [hintKey]: 'true' }
test('saved tool data and unrelated machine settings stay excluded unless explicitly selected', () => {
  localStorage.setItem('firefly.theme.v1', 'dark')
  localStorage.setItem('firefly.browser-module.tool.local.example.main.secret', 'private')
  localStorage.setItem('firefly.browser-module.preview.installed.local.example.main.secret', 'temporary')
  localStorage.setItem('desktop-close-behavior', 'exit')
  localStorage.setItem('firefly.search-history.v1', 'private history')
  assert.deepEqual(Object.keys(sync.collectSyncPreferences(sync.defaultSyncOptions())), [])
  const options = { ...sync.defaultSyncOptions(), preferences: true, web_data: true }
  assert.deepEqual({ ...sync.collectSyncPreferences(options) }, { 'firefly.theme.v1': 'dark', 'firefly.web-tool-initialization-ms.v1': '5000', 'firefly.web-tool-interaction-ms.v1': '10000', ...presentationDefaults })
  assert.deepEqual(JSON.parse(storage.collectLegacyToolStorage(['local.example.main'])['tool.local.example.main']),{secret:'private'})
})

test('execution budgets sync only with preferences, including unlimited and restored defaults', () => {
  const init = 'firefly.web-tool-initialization-ms.v1', interaction = 'firefly.web-tool-interaction-ms.v1'
  const options = { ...sync.defaultSyncOptions(), preferences: true }
  localStorage.setItem(init, '60000'); localStorage.setItem(interaction, '0')
  assert.deepEqual({ ...sync.collectSyncPreferences(sync.defaultSyncOptions()) }, {})
  const incoming = sync.collectSyncPreferences(options)
  assert.deepEqual({ ...incoming }, { [init]: '60000', [interaction]: '0', ...presentationDefaults })
  localStorage.setItem(init, '5000'); localStorage.setItem(interaction, '30000')
  sync.saveSyncPreferences(sync.prepareSyncPreferences(applied(incoming), false))
  assert.equal(localStorage.getItem(init), '60000'); assert.equal(localStorage.getItem(interaction), '0')
  localStorage.removeItem(init); localStorage.removeItem(interaction)
  const defaults = sync.collectSyncPreferences(options)
  localStorage.setItem(init, '300000'); localStorage.setItem(interaction, '0')
  sync.saveSyncPreferences(sync.prepareSyncPreferences(applied(defaults), false))
  assert.equal(localStorage.getItem(init), '5000'); assert.equal(localStorage.getItem(interaction), '10000')
  for (const invalid of ['-1', 'NaN', '1', '5001']) assert.throws(() => sync.validateSyncPreferences({ [init]: invalid }))
})
test('cross-device grouping and sorting remap incoming local IDs while preserving local-only groups', () => {
  const old = { names: {}, custom: [{ id: 'home:local', name: 'Local' }], deleted: [], assignments: { 'custom.1': 'home:local' }, otherCreated: false }
  localStorage.setItem('firefly.groups.home.v1', JSON.stringify(old))
  const incoming = { names: {}, custom: [{ id: 'home:remote', name: 'Remote' }], deleted: [], assignments: { 'custom.1': 'home:remote', 'custom.99': 'home:remote' }, otherCreated: false }
  const website = { enabled: true, groups: [{ id: 'website:remote', name: 'Remote' }], assignments: { '1': 'website:remote' } }
  const result = sync.prepareSyncPreferences(applied({ 'firefly.groups.home.v1': JSON.stringify(incoming), 'firefly.groups.websites.v1': JSON.stringify(website), 'firefly.order.favorites.v1': JSON.stringify(['custom.1', 'custom.99']), 'firefly.order.websites.v1': JSON.stringify(['1']) }), false)
  const home = JSON.parse(result['firefly.groups.home.v1'])
  assert.deepEqual(home.assignments, { 'custom.1': 'home:local', 'custom.7': 'home:remote' })
  assert.deepEqual(home.custom.map(group => group.id), ['home:local', 'home:remote'])
  assert.deepEqual(JSON.parse(result['firefly.groups.websites.v1']).assignments, { '9': 'website:remote' })
  assert.deepEqual(JSON.parse(result['firefly.order.favorites.v1']), ['custom.7'])
  assert.deepEqual(JSON.parse(result['firefly.order.websites.v1']), ['9'])
})

test('fullscreen preferences are opt-in, accept only booleans, and propagate effective defaults after reset', () => {
  localStorage.setItem(fullscreenKey, 'true'); localStorage.setItem(hintKey, 'false')
  assert.deepEqual({ ...sync.collectSyncPreferences(sync.defaultSyncOptions()) }, {})
  const options = { ...sync.defaultSyncOptions(), preferences: true }, incoming = sync.collectSyncPreferences(options)
  assert.equal(incoming[fullscreenKey], 'true'); assert.equal(incoming[hintKey], 'false')
  for (const invalid of ['', '1', 'TRUE', 'null']) for (const key of [fullscreenKey, hintKey]) assert.throws(() => sync.validateSyncPreferences({ [key]: invalid }))
  localStorage.removeItem(fullscreenKey); localStorage.removeItem(hintKey)
  const defaults = sync.collectSyncPreferences(options)
  localStorage.setItem(fullscreenKey, 'true'); localStorage.setItem(hintKey, 'false')
  sync.saveSyncPreferences(sync.prepareSyncPreferences(applied(defaults), false))
  assert.equal(localStorage.getItem(fullscreenKey), 'false'); assert.equal(localStorage.getItem(hintKey), 'true')
})
test('web data cannot be injected through the UI preference importer', () => {
  const key = 'firefly.browser-module.tool.local.example.main.note'
  localStorage.setItem(key, 'local')
  assert.throws(()=>sync.prepareSyncPreferences(applied({ [key]: 'remote' }), false))
  assert.throws(()=>sync.prepareSyncPreferences(applied({ [key]: 'remote' }), true))
  assert.equal(localStorage.getItem(key),'local')
})
test('invalid peer preferences are rejected before import and code cannot be injected through settings', () => {
  for (const preferences of [{ 'firefly.theme.v1': 'javascript:alert(1)' }, { 'firefly.groups.home.v1': '{}' }, { 'firefly.order.favorites.v1': '[1]' }, { 'arbitrary-origin-secret': 'value' }]) assert.throws(() => sync.validateSyncPreferences(preferences))
})
test('legacy snapshot collection accepts one MiB and rejects overflow without changing the browser copy', () => {
  const prefix = 'firefly.browser-module.tool.local.example.main.'
  localStorage.setItem(prefix + 'x', 'x'.repeat(1048568))
  assert.equal(storage.collectLegacyToolStorage(['local.example.main'])['tool.local.example.main'].length,1048576)
  localStorage.setItem(prefix + 'x', 'x'.repeat(1048569))
  assert.throws(() => storage.collectLegacyToolStorage(['local.example.main']), /1 MiB/)
  assert.equal(localStorage.getItem(prefix + 'x').length,1048569)
})
test('a failed preferences write rolls back previous writes in the same batch', () => {
  localStorage.setItem('firefly.theme.v1', 'light')
  localStorage.failKey = 'firefly.card-gap.v1'
  assert.throws(() => sync.saveSyncPreferences({ 'firefly.theme.v1': 'dark', 'firefly.card-gap.v1': '16' }), /quota/)
  assert.equal(localStorage.getItem('firefly.theme.v1'), 'light')
  assert.equal(localStorage.getItem('firefly.card-gap.v1'), null)
})

test('a fresh receiver never assigns a source automation ID to an unrelated local tool', () => {
  const incoming = { names: {}, custom: [{ id: 'home:remote', name: 'Remote' }], deleted: [], assignments: { 'custom.1': 'home:remote', 'custom.99': 'home:remote' }, otherCreated: false }
  for (const local of [null, '{broken']) {
    if (local === null) localStorage.removeItem('firefly.groups.home.v1')
    else localStorage.setItem('firefly.groups.home.v1', local)
    const values = sync.prepareSyncPreferences(applied({ 'firefly.groups.home.v1': JSON.stringify(incoming) }), false)
    assert.deepEqual(JSON.parse(values['firefly.groups.home.v1']).assignments, { 'custom.7': 'home:remote' })
  }
})

test('preference-only sync does not reject unrelated legacy webpage data', () => {
  localStorage.setItem('firefly.browser-module.tool.local.example.main.old', 'x'.repeat(70000))
  assert.equal(sync.prepareSyncPreferences(applied({ 'firefly.theme.v1': 'dark' }), false)['firefly.theme.v1'], 'dark')
})

test('preference validation rejects non-string, empty and out-of-range display settings', () => {
  for (const preferences of [{ 'firefly.theme.v1': null }, { 'firefly.app-font-size.v1': '' }, { 'firefly.app-font-size.v1': '1000' }, { 'firefly.card-gap.v1': '-1' }]) {
    assert.throws(() => sync.validateSyncPreferences(preferences))
  }
})

test('valid incoming home order repairs an invalid local order instead of failing after database import', () => {
  const key = 'firefly.order.homeTools.v1'
  for (const invalid of ['"broken"', '[]', '{"home:remote":[1]}']) {
    localStorage.setItem(key, invalid)
    const result = sync.prepareSyncPreferences(applied({ [key]: JSON.stringify({ 'home:remote': ['custom.1'] }) }), false)
    assert.deepEqual(JSON.parse(result[key]), { 'home:remote': ['custom.7'] })
  }
})

test('legacy collection keeps overlapping tool IDs separate and preserves escaped UTF-16 values',()=>{
  localStorage.setItem('firefly.browser-module.tool.local.a.key','short')
  localStorage.setItem('firefly.browser-module.tool.local.a.long.key','long')
  localStorage.setItem('firefly.browser-module.tool.local.a.\udfff','\ud800')
  localStorage.setItem('firefly.browser-module.preview.local.a.key','private preview')
  const values=storage.collectLegacyToolStorage(['local.a','local.a.long'])
  assert.deepEqual(JSON.parse(values['tool.local.a']),{key:'short','\udfff':'\ud800'})
  assert.deepEqual(JSON.parse(values['tool.local.a.long']),{key:'long'})
  assert.equal(Object.keys(values).length,2)
})

test('sharing and applying collect legacy data only when explicitly selected and hand persistence to native commands',async t=>{
  const calls=[]
  globalThis.window={__TAURI_INTERNALS__:{invoke:async(command,args)=>{calls.push({command,args});if(command==='list_tools')return[{id:'local.web',ui_kind:'web'},{id:'local.text',ui_kind:'text'}];return{web_data_imported:1}}}}
  t.after(()=>delete globalThis.window)
  localStorage.setItem('firefly.browser-module.tool.local.web.note','legacy')
  localStorage.setItem('firefly.browser-module.tool.local.text.note','not web')
  await sync.deviceSync.share(sync.defaultSyncOptions(),{})
  assert.deepEqual(calls.map(item=>item.command),['sync_share']);assert.deepEqual(calls[0].args.legacyStorage,{})
  calls.length=0
  await sync.deviceSync.share({...sync.defaultSyncOptions(),web_data:true},{})
  assert.deepEqual(calls.map(item=>item.command),['list_tools','sync_share'])
  assert.deepEqual(JSON.parse(calls[1].args.legacyStorage['tool.local.web']),{note:'legacy'})
  assert.equal(calls[1].args.legacyStorage['tool.local.text'],undefined)
  await sync.deviceSync.apply({...sync.defaultSyncOptions(),web_data:true},['web_data:tool.local.web'],true,['local.web'])
  const applied=calls.at(-1);assert.equal(applied.command,'sync_apply');assert.equal(applied.args.selection.replace,true);assert.deepEqual(JSON.parse(applied.args.legacyStorage['tool.local.web']),{note:'legacy'})
  assert.equal(localStorage.getItem('firefly.browser-module.tool.local.web.note'),'legacy')
})
