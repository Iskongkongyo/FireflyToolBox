import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { build } from 'esbuild'
const built = await build({ entryPoints: ['src/services/resetSettings.ts'], bundle: true, write: false, platform: 'node', format: 'esm' })
const { MORE_SETTINGS_DEFAULTS, resetMoreSettings } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'))
class Storage {
  values = new Map(); failOnce = false
  getItem(key) { return this.values.get(key) ?? null }
  removeItem(key) { this.values.delete(key) }
  setItem(key, value) { if (this.failOnce && key === 'firefly.card-gap.v1') { this.failOnce = false; throw Error('quota') }; this.values.set(key, String(value)) }
}
beforeEach(() => { globalThis.localStorage = new Storage() })
function native({ failure = false, rollbackFailure = false } = {}) {
  const state = { closeBehavior: 'exit', autostart: true }, calls = []
  return { state, calls, adapter: {
    read: async () => ({ ...state }),
    setCloseBehavior: async value => { calls.push(['close', value]); if (rollbackFailure && value === 'exit') throw Error('restore failed'); state.closeBehavior = value },
    setAutostart: async value => { calls.push(['autostart', value]); state.autostart = value; if (failure && !value) throw Error('native failure') },
  } }
}
test('reset only changes More Settings keys and removes legacy appearance fallbacks', async () => {
  for (const key of Object.keys(MORE_SETTINGS_DEFAULTS)) localStorage.setItem(key, 'custom')
  const kept = { 'firefly.theme.v1': 'dark', 'firefly.accent.v1': '#123456', 'firefly.groups.home.v1': 'layout', 'firefly.startup-splash-enabled.v1': 'false', 'firefly.remote-messages.read.v1': 'history', 'firefly.browser-module.tool.test.secret': 'private', unrelated: 'preserved' }
  for (const [k, v] of Object.entries(kept)) localStorage.setItem(k, v)
  await resetMoreSettings()
  for (const [k, v] of Object.entries(MORE_SETTINGS_DEFAULTS)) assert.equal(localStorage.getItem(k), v)
  for (const [k, v] of Object.entries(kept)) assert.equal(localStorage.getItem(k), v)
})
test('Windows close behavior and autostart reset together with browser preferences', async () => {
  const desktop = native(); await resetMoreSettings(desktop.adapter)
  assert.deepEqual(desktop.state, { closeBehavior: 'tray', autostart: false })
  assert.equal(localStorage.getItem('firefly.start-page.v1'), 'home')
})
test('already-default Windows settings are not written again', async () => {
  await resetMoreSettings({ read: async () => ({ closeBehavior: 'tray', autostart: false }), setCloseBehavior: async () => { throw Error('unnecessary write') }, setAutostart: async () => { throw Error('unnecessary write') } })
  assert.equal(localStorage.getItem('firefly.start-page.v1'), 'home')
})
test('a partial native failure restores both Windows settings before touching local preferences', async () => {
  localStorage.setItem('firefly.card-gap.v1', '18')
  const desktop = native({ failure: true })
  await assert.rejects(resetMoreSettings(desktop.adapter), /native failure/)
  assert.deepEqual(desktop.state, { closeBehavior: 'exit', autostart: true })
  assert.deepEqual(Object.fromEntries(localStorage.values), { 'firefly.card-gap.v1': '18' })
})
test('a failed local write rolls back local and Windows settings', async () => {
  localStorage.setItem('firefly.start-page.v1', 'websites'); localStorage.setItem('firefly.card-gap.v1', '18')
  const before = Object.fromEntries(localStorage.values), desktop = native(); localStorage.failOnce = true
  await assert.rejects(resetMoreSettings(desktop.adapter), /quota/)
  assert.deepEqual(Object.fromEntries(localStorage.values), before)
  assert.deepEqual(desktop.state, { closeBehavior: 'exit', autostart: true })
})
test('incomplete native rollback reports partial restoration rather than success', async () => {
  const desktop = native({ failure: true, rollbackFailure: true })
  await assert.rejects(resetMoreSettings(desktop.adapter), /部分 Windows 设置未能恢复/)
  assert.equal(localStorage.getItem('firefly.start-page.v1'), null)
})
