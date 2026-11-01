import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'

const result = await build({ entryPoints: ['src/services/shortcuts.ts'], bundle: true, write: false, platform: 'node', format: 'esm' })
const { validateShortcutName, suggestedShortcutName, createShortcutLaunchQueue, requestShortcutCreation } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text + '\n//# sourceURL=shortcuts-fixture.mjs').toString('base64'))

test('a stuck Android creation expires, ignores its late result and permits a fresh request', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let finish
  const pending = requestShortcutCreation(() => new Promise(resolve => { finish = resolve }), true)
  const expired = assert.rejects(pending, /响应超时.*返回桌面/)
  t.mock.timers.tick(15000); await expired
  assert.equal(await requestShortcutCreation(async () => 'requested', true), 'requested')
  finish('created'); await Promise.resolve()
  await assert.rejects(requestShortcutCreation(async () => { throw Error('exists') }, true), /exists/)
  assert.equal(await requestShortcutCreation(async () => 'requested', true), 'requested')
})

test('Windows creation has time for its bounded native writer instead of using the mobile deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let finish, settled = false
  const pending = requestShortcutCreation(() => new Promise(resolve => { finish = resolve }), false)
  pending.then(() => { settled = true }, () => { settled = true })
  t.mock.timers.tick(21000); await Promise.resolve(); assert.equal(settled, false)
  finish('created'); assert.equal(await pending, 'created')
})

test('suggested Windows names handle actual tool punctuation, reserved names and long names', () => {
  assert.equal(suggestedShortcutName('CSV / JSON 互转', true), 'CSV - JSON 互转')
  assert.equal(suggestedShortcutName('CSV / JSON 互转', false), 'CSV / JSON 互转')
  for (const name of ['CON', 'con.txt', 'LPT³', 'COM1', '....', '???', '猫'.repeat(60), '工具 🐱']) assert.doesNotThrow(() => validateShortcutName(suggestedShortcutName(name, true), true))
})

test('Windows rejects invalid filesystem names while Android allows ordinary label punctuation', () => {
  for (const name of ['CON', 'com1.txt', 'name.', 'a/b', 'a:b', 'a\nb']) assert.throws(() => validateShortcutName(name, true))
  assert.equal(validateShortcutName(' JSON / CSV: 互转 ', false), 'JSON / CSV: 互转')
  assert.throws(() => validateShortcutName('\n', false))
})

test('a launch received while a write is busy is not consumed and resumes afterwards', async () => {
  let ready = false, takes = 0
  const opened = []
  const queue = createShortcutLaunchQueue({ canOpen: () => ready, take: async () => { takes++; return 'json.format' }, open: id => opened.push(id), onError: error => { throw error } })
  await queue.request(); assert.equal(takes, 0); assert.deepEqual(opened, [])
  ready = true; await queue.resume(); assert.equal(takes, 1); assert.deepEqual(opened, ['json.format'])
})

test('a second shortcut hint during an outstanding native request is drained instead of lost', async () => {
  let firstDone, takes = 0
  const opened = []
  const queue = createShortcutLaunchQueue({ canOpen: () => true, take: () => ++takes === 1 ? new Promise(resolve => { firstDone = resolve }) : Promise.resolve('url.convert'), open: id => opened.push(id), onError: error => { throw error } })
  const first = queue.request(), second = queue.request()
  firstDone('json.format'); await Promise.all([first, second])
  assert.deepEqual(opened, ['json.format', 'url.convert'])
})

test('an operation becoming busy after take preserves the launch and prefers a newer native hint on resume', async () => {
  let ready = true, firstDone, takes = 0
  const opened = []
  const queue = createShortcutLaunchQueue({ canOpen: () => ready, take: () => ++takes === 1 ? new Promise(resolve => { firstDone = resolve }) : Promise.resolve('url.convert'), open: id => opened.push(id), onError: error => { throw error } })
  const first = queue.request(); ready = false; firstDone('json.format'); await first
  assert.deepEqual(opened, []); ready = true; await queue.resume()
  assert.deepEqual(opened, ['url.convert'])
})

test('native failures are reported without locking subsequent launch attempts', async () => {
  let failed = false
  const opened = [], errors = []
  const queue = createShortcutLaunchQueue({ canOpen: () => true, take: async () => { if (!failed) { failed = true; throw new Error('native failure') }; return 'json.format' }, open: id => opened.push(id), onError: error => errors.push(error.message) })
  await queue.request(); await queue.request()
  assert.deepEqual(errors, ['native failure']); assert.deepEqual(opened, ['json.format'])
})
