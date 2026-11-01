import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'

const bundle = await build({ entryPoints: ['src/services/detection.ts'], bundle: true, write: false, format: 'esm', platform: 'node' })
const { validateDetectionInput, createClipboardDetection } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text + '\n//# sourceURL=detection-fixture.mjs').toString('base64'))
const result = (confidence = 1) => [{ type_id: 'json', label: 'JSON', confidence, actions: [{ id: 'format', label: 'Format', tool_id: 'json.format' }] }]

test('input budget measures UTF-8 bytes and accepts the exact boundary', () => {
  assert.doesNotThrow(() => validateDetectionInput('a'.repeat(1024 * 1024)))
  assert.throws(() => validateDetectionInput('a'.repeat(1024 * 1024 + 1)), /1 MiB/)
  assert.throws(() => validateDetectionInput('中'.repeat(350000)), /1 MiB/)
})

test('a failed native detection retries identical clipboard text on the next activation', async () => {
  const shown = []; let calls = 0
  const detector = createClipboardDetection({ canCheck: () => true, read: async () => 'same', detect: async () => { if (++calls === 1) throw new Error('temporary'); return result() }, show: text => shown.push(text) })
  await detector.check(); await detector.check(); await detector.check()
  assert.equal(calls, 2); assert.deepEqual(shown, ['same'])
})

test('successful uninteresting text is deduplicated without showing a popup', async () => {
  let calls = 0, shown = 0
  const detector = createClipboardDetection({ canCheck: () => true, read: async () => 'plain', detect: async () => { calls++; return result(.2) }, show: () => shown++ })
  await detector.check(); await detector.check()
  assert.equal(calls, 1); assert.equal(shown, 0)
  detector.cancel(true); await detector.check(); assert.equal(calls, 2)
})

test('cancelling a pending read or detection prevents any late popup', async () => {
  let finishRead, finishDetection, shown = 0
  const detector = createClipboardDetection({ canCheck: () => true, read: () => new Promise(resolve => { finishRead = resolve }), detect: () => new Promise(resolve => { finishDetection = resolve }), show: () => shown++ })
  const first = detector.check(); detector.cancel(); finishRead('old'); await first
  assert.equal(finishDetection, undefined)
  const second = detector.check(); finishRead('new'); await Promise.resolve(); detector.cancel(); finishDetection(result()); await second
  assert.equal(shown, 0)
})

test('a newer activation while detection is outstanding reads the latest clipboard', async () => {
  let text = 'old', finishOld, calls = 0
  const shown = []
  const detector = createClipboardDetection({ canCheck: () => true, read: async () => text, detect: () => ++calls === 1 ? new Promise(resolve => { finishOld = resolve }) : Promise.resolve(result()), show: value => shown.push(value) })
  const old = detector.check(); await Promise.resolve()
  text = 'new'; const newer = detector.check(); finishOld(result()); await Promise.all([old, newer])
  assert.deepEqual(shown, ['new']); assert.equal(calls, 2)
})

test('modal, disabled and background states prevent reads, and oversized clipboard text never reaches detection', async () => {
  let eligible = false, reads = 0, detections = 0
  const detector = createClipboardDetection({ canCheck: () => eligible, read: async () => { reads++; return '中'.repeat(350000) }, detect: async () => { detections++; return result() }, show: () => assert.fail('unexpected popup') })
  await detector.check(); assert.equal(reads, 0)
  eligible = true; await detector.check(); assert.equal(reads, 1); assert.equal(detections, 0)
})
