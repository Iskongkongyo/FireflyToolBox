// Exercise actual Windows/Android preference backup and native device sync.
// Only UI preferences change; restore both clients' original values afterward.
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { connectWindows } from './windows-test-client.mjs'
import { connectAndroid } from './android-device-client.mjs'

const compiled = await build({ stdin: { contents: "export * from './src/services/configuration.ts'; export * from './src/services/deviceSync.ts'", resolveDir: process.cwd() }, bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'PreferenceReview' })
const code = compiled.outputFiles[0].text
const fullscreenKey = 'firefly.web-tool-default-fullscreen.v1', hintKey = 'firefly.web-tool-fullscreen-initial-hint.v1'
const extraKeys = ['firefly.startup-splash-enabled.v1', 'firefly.smart-clipboard.v1', 'firefly.usage-stats.v1', 'firefly.remote-messages.read.v1']
const clients = [], originals = new Map(), ownedSync = new Set(), report = { checks: [], restored: false }
const directory = 'target-check/presentation-preferences', pause = ms => new Promise(resolve => setTimeout(resolve, ms)), alive = setInterval(() => {}, 1000)
await mkdir(directory, { recursive: true })
async function until(client, fn) { for (let i = 0; i < 240; i++) { if (await client.evaluate(fn)) return; await pause(100) }; throw Error('Timed out: ' + fn) }
async function inject(client) { const result = await client.call('Runtime.evaluate', { expression: code }); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)) }
async function nav(client, name) { await until(client, () => !!document.querySelector('.nav-button')); await client.evaluate(name => [...document.querySelectorAll('.nav-button')].find(n => n.textContent.trim() === name).click(), name); await pause(200) }
async function ready(client) {
  await until(client, () => { document.querySelector('.startup-splash-skip')?.click(); const app = document.querySelector('.app-shell'); return app && getComputedStyle(app).display !== 'none' })
  await nav(client, '关于应用'); await until(client, () => document.querySelector('.about-link')?.disabled === false)
  for (let i = 0; i < 3; i++) {
    const closed = await client.evaluate(() => { const d = document.querySelector('.remote-message-dialog[open]'); if (!d) return false; if (d.classList.contains('remote-message-required')) throw Error('Mandatory update'); (d.querySelector('.secondary-button') || d.querySelector('.primary-button')).click(); return true })
    if (!closed) break; await pause(150)
  }
  await inject(client)
}
async function reload(client) { await client.call('Page.reload'); await ready(client) }
async function check(name, fn) { await fn(); report.checks.push(name); console.log('PASS:', name) }
async function setFlags(client, full, hint) {
  await nav(client, '更多设置')
  await client.evaluate(values => [...document.querySelectorAll('.web-tool-presentation-settings [role=switch]')].forEach((node, i) => { if (node.getAttribute('aria-checked') !== String(values[i])) node.click() }), [full, hint])
}
async function flags(client) { return client.evaluate(() => [...document.querySelectorAll('.web-tool-presentation-settings [role=switch]')].map(n => n.getAttribute('aria-checked'))) }
async function roundtrip(source, target, expected) {
  const options = { modules: false, automations: false, builtins: false, favorites: false, websites: false, layout: false, preferences: true, web_data: false }
  const preferences = await source.evaluate(options => PreferenceReview.collectSyncPreferences(options), options)
  const share = await source.invoke('sync_share', { options, preferences }); ownedSync.add(source)
  const port = String(Number(share.addresses[0].split(':').at(-1)))
  let forward, reverse
  try {
    let endpoint
    if (target.device) { reverse = target.device('reverse', 'tcp:0', `tcp:${port}`); endpoint = `127.0.0.1:${reverse}` }
    else { forward = source.device('forward', 'tcp:0', `tcp:${port}`); endpoint = `127.0.0.1:${forward}` }
    ownedSync.add(target)
    const preview = await target.invoke('sync_receive', { endpoint, code: share.code })
    assert.equal(preview.preferences[fullscreenKey], expected[0]); assert.equal(preview.preferences[hintKey], expected[1])
    const result = await target.invoke('sync_apply', { selection: { options, keys: [], replace: false }, legacyStorage: {} })
    await target.evaluate(result => PreferenceReview.saveSyncPreferences(PreferenceReview.prepareSyncPreferences(result, false)), result)
    await reload(target); await nav(target, '更多设置'); assert.deepEqual(await flags(target), expected)
  } finally {
    await source.invoke('sync_close').catch(() => {}); await target.invoke('sync_close').catch(() => {})
    if (reverse) target.device('reverse', '--remove', `tcp:${reverse}`)
    if (forward) source.device('forward', '--remove', `tcp:${forward}`)
  }
}
try {
  clients.push(await connectWindows()); clients.push(await connectAndroid())
  for (const [i, client] of clients.entries()) {
    const status = await client.invoke('sync_status'); assert(!status || !['waiting', 'transferring'].includes(status.state), 'A user sync is active')
    await until(client, () => !!document.querySelector('.app-shell')); await inject(client)
    const original = await client.evaluate(extra => Object.fromEntries([...new Set([...PreferenceReview.BACKUP_KEYS, ...extra])].map(k => [k, localStorage.getItem(k)])), extraKeys)
    originals.set(client, original); await writeFile(`${directory}/${i ? 'android' : 'windows'}-original.json`, JSON.stringify(original, null, 2))
    await client.evaluate(() => ['firefly.startup-splash-enabled.v1', 'firefly.smart-clipboard.v1', 'firefly.usage-stats.v1'].forEach(k => localStorage.setItem(k, 'false')))
    await reload(client)
    await check(`${i ? 'Android' : 'Windows'}: right-aligned group badges follow live transparency and the duplicate appearance title is removed`, async () => {
      const samples = []
      for (const value of [0, 80]) {
        await nav(client, '更多设置')
        assert.equal(await client.evaluate(() => document.querySelector('.settings-group-appearance').textContent.includes('应用外观')), false)
        await client.evaluate(value => { const node = document.querySelector('#component-transparency'); node.value = String(value); node.dispatchEvent(new Event('input', { bubbles: true })) }, value)
        await nav(client, '首页')
        samples.push(await client.evaluate(() => {
          const header = document.querySelector('.home-categories .category-header'), badge = header.querySelector('.category-count'), r = badge.getBoundingClientRect(), a = header.querySelector('.chevron').getBoundingClientRect(), label = header.querySelector('.category-label').getBoundingClientRect()
          return { color: getComputedStyle(badge).backgroundColor, aligned: Math.abs(r.right - label.right) < 1 && a.left > r.right, overflow: document.documentElement.scrollWidth > innerWidth }
        }))
      }
      assert(samples.every(s => s.aligned && !s.overflow)); assert.notEqual(samples[0].color, samples[1].color)
    })
    await check(`${i ? 'Android' : 'Windows'}: configuration backup restores both display switches and old backups restore defaults`, async () => {
      await setFlags(client, true, false)
      const database = await client.invoke('export_configuration')
      const backup = await client.evaluate(database => PreferenceReview.parseBackup(PreferenceReview.serializeBackup(database)), database)
      assert.equal(backup.preferences[fullscreenKey], 'true'); assert.equal(backup.preferences[hintKey], 'false')
      await setFlags(client, false, true)
      await client.evaluate(prefs => PreferenceReview.restoreBackupPreferences(prefs), backup.preferences)
      await reload(client); await nav(client, '更多设置'); assert.deepEqual(await flags(client), ['true', 'false'])
      const old = { ...backup.preferences }; delete old[fullscreenKey]; delete old[hintKey]
      await client.evaluate(prefs => PreferenceReview.restoreBackupPreferences(prefs), old)
      await reload(client); await nav(client, '更多设置'); assert.deepEqual(await flags(client), ['false', 'true'])
    })
  }
  const [windows, android] = clients
  await check('Windows → Android: actual native device sync applies both opt-in display preferences', async () => {
    await setFlags(windows, true, false); await setFlags(android, false, true)
    await roundtrip(windows, android, ['true', 'false'])
  })
  await check('Android → Windows: reverse native sync applies the opposite switch values', async () => {
    await setFlags(android, false, true)
    await roundtrip(android, windows, ['false', 'true'])
  })
  await check('restored defaults replace a receiver custom display policy through native sync', async () => {
    await windows.evaluate(keys => keys.forEach(k => localStorage.removeItem(k)), [fullscreenKey, hintKey])
    await setFlags(android, true, false)
    await roundtrip(windows, android, ['false', 'true'])
  })
} finally {
  try {
    for (const client of ownedSync) await client.invoke('sync_close').catch(() => {})
    for (const [client, original] of originals) {
      const restore = () => client.evaluate(saved => { for (const [k, v] of Object.entries(saved)) v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v) }, original)
      await nav(client, '首页'); await restore(); await reload(client); await nav(client, '首页'); await restore()
      assert.deepEqual(await client.evaluate(keys => Object.fromEntries(keys.map(k => [k, localStorage.getItem(k)])), Object.keys(original)), original)
    }
    report.restored = originals.size === 2
    await writeFile(`${directory}/results.json`, JSON.stringify(report, null, 2))
  } finally { for (const client of clients) client.close(); clearInterval(alive) }
}
