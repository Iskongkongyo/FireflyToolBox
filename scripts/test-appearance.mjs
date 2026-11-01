import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'

async function bundled(entry) {
  const result = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'esm' })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text + '\n//# sourceURL=' + entry).toString('base64')}`)
}
const appearance = await bundled('src/services/appearance.ts')
const images = await bundled('src/services/wallpaper.ts')

test('HSV conversion preserves exact RGB values across the brightness range', () => {
  for (const hex of ['#000000', '#ffffff', '#123456', '#276653', '#010203', '#ff80aa', '#707070']) {
    const { hue, saturation, value } = appearance.hexToHsv(hex)
    assert.equal(appearance.hsvToHex(hue, saturation, value), hex)
  }
})

test('custom accent text and primary buttons stay readable in both modes without changing the chosen primary color', () => {
  for (const mode of ['light', 'dark']) for (const hex of ['#000000', '#ffffff', '#123456', '#276653', '#ffff00', '#808080', '#ff0000', '#0000ff', '#00ff00', '#717171']) {
    const palette = appearance.accentPalette(hex, mode)
    assert.equal(palette.primary, hex)
    for (const base of [palette.soft, mode === 'dark' ? '#1c2826' : '#ffffff', mode === 'dark' ? '#131c1b' : '#f7f8f5']) assert(appearance.colorContrast(palette.accent, base) >= 4.5, `${hex} ${mode}`)
    assert(appearance.colorContrast(palette.primary, palette.text) >= 4.5)
    assert(appearance.colorContrast(palette.hover, palette.text) >= 4.5)
  }
})

test('all appearance images enforce byte and pixel limits while accepting image filenames with missing MIME', () => {
  appearance.validateAppearanceFile({ type: '', name: 'phone.png', size: 12 })
  appearance.validateAppearanceFile({ type: 'application/octet-stream', name: 'phone.webp', size: 12 })
  appearance.validateAppearanceFile({ type: 'image/jpeg', name: 'large.jpg', size: 32 * 1024 * 1024 })
  assert.throws(() => appearance.validateAppearanceFile({ type: 'image/png', name: 'huge.png', size: 32 * 1024 * 1024 + 1 }), /32 MiB/)
  assert.throws(() => appearance.validateAppearanceFile({ type: 'text/plain', name: 'fake.png', size: 1 }))
  appearance.validateAppearanceDimensions(6000, 4000)
  for (const [width, height] of [[6001, 4000], [0, 1], [Infinity, 1]]) assert.throws(() => appearance.validateAppearanceDimensions(width, height))
})

test('potentially transparent images retain PNG output for wallpaper, startup and sidebar', () => {
  for (const target of ['wallpaper', 'startup', 'sidebar']) for (const type of ['image/png', 'image/webp', 'image/svg+xml', 'image/avif']) assert.equal(appearance.appearanceImageFormat({ type, name: 'photo' }, target), 'image/png')
  assert.equal(appearance.appearanceImageFormat({ type: 'image/jpeg', name: 'photo.jpg' }, 'wallpaper'), 'image/jpeg')
  assert.equal(appearance.appearanceImageFormat({ type: 'image/jpeg', name: 'photo.jpg' }, 'sidebar'), 'image/png')
})

test('blocked image storage rejects promptly and closes a connection that opens after rejection', async t => {
  const request = {}, database = { closed: false, close() { this.closed = true } }
  const previous = globalThis.indexedDB
  globalThis.indexedDB = { open() { queueMicrotask(() => request.onblocked()); return request } }
  t.after(() => { globalThis.indexedDB = previous })
  await assert.rejects(images.readStartupImage(), /其他窗口占用/)
  request.result = database
  request.onsuccess()
  assert.equal(database.closed, true)
})

test('unresponsive image storage has a bounded wait and closes a late connection', async t => {
  const request = {}, database = { closed: false, close() { this.closed = true } }
  const timer = globalThis.setTimeout
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => timer(callback, delay === 5000 ? 0 : delay))
  const previous = globalThis.indexedDB
  globalThis.indexedDB = { open() { return request } }
  t.after(() => { globalThis.indexedDB = previous })
  await assert.rejects(images.readWallpaper(), /超时/)
  request.result = database
  request.onsuccess()
  assert.equal(database.closed, true)
})

test('an aborted image save rejects and always closes its database connection', async t => {
  const request = {}, transaction = { error: new Error('quota'), objectStore() { return { put() { queueMicrotask(() => transaction.onabort()) } } } }
  const database = { closed: false, close() { this.closed = true }, transaction() { return transaction } }
  const previous = globalThis.indexedDB
  globalThis.indexedDB = { open() { queueMicrotask(() => { request.result = database; request.onsuccess() }); return request } }
  t.after(() => { globalThis.indexedDB = previous })
  await assert.rejects(images.saveSidebarImage(new Blob(['image'])), /quota/)
  assert.equal(database.closed, true)
})
