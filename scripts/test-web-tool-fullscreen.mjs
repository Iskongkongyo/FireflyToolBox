import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { runInNewContext } from 'node:vm'
const compiled = await build({ entryPoints: ['src/services/webToolFullscreen.ts'], bundle: true, write: false, format: 'iife', globalName: 'Fullscreen', platform: 'browser' })
const context = {}; runInNewContext(compiled.outputFiles[0].text, context)
const create = context.Fullscreen.createToolFullscreenController
test('leaving wins over an asynchronous native enter and releases fullscreen', async () => {
  const calls = [], changes = [], errors = []; let release
  const control = create(value => { calls.push(value); return value ? new Promise(resolve => { release = resolve }) : Promise.resolve() }, value => changes.push(value), error => errors.push(error))
  control.set(true); await Promise.resolve(); control.set(false); release(); await control.settled()
  assert.deepEqual(calls, [true, false]); assert.deepEqual(changes, [true, false]); assert.deepEqual(errors, [])
})
test('obsolete queued transitions never re-enter a tool after navigation', async () => {
  const calls = []; const control = create(async value => { calls.push(value) }, () => {}, () => {})
  control.set(true); control.set(false); await control.settled(); assert.deepEqual(calls, [false])
  control.set(true); control.dispose(); control.set(true); await control.settled(); assert.deepEqual(calls, [false, false])
})
test('a failed enter restores ordinary UI and releases a possibly partial native lease', async () => {
  const calls = [], changes = [], errors = []
  const control = create(async value => { calls.push(value); if (value) throw new Error('partial failure') }, value => changes.push(value), message => errors.push(message))
  control.set(true); await control.settled(); assert.deepEqual(calls, [true, false]); assert.deepEqual(changes, [true, false]); assert.equal(errors.length, 1)
})
test('reset only releases the host-owned lease and remains silent during startup', async () => {
  const errors = []; const control = create(async () => { throw new Error('not ready') }, () => {}, message => errors.push(message))
  control.reset(); await control.settled(); assert.deepEqual(errors, [])
})
