import { readFile, writeFile } from 'node:fs/promises'
import { deflateSync, inflateSync } from 'node:zlib'
import { createHash } from 'node:crypto'

// Manifests continue to describe the original bytes; compression is an app
// packaging detail and never changes exported fftool packages or engine code.
export async function packBuiltinAssets() {
  const directory = new URL('../src-tauri/builtin-tools/generated/media-assets/', import.meta.url)
  const resources = new Map()
  for (const kind of ['video', 'image', 'pdf', 'pdf-security', 'ocr', 'code']) {
    const manifest = JSON.parse(await readFile(new URL(`${kind}-resources.json`, directory), 'utf8'))
    for (const resource of manifest) resources.set(resource.path, resource)
  }
  let originalSize = 0, packedSize = 0
  for (const resource of resources.values()) {
    const name = resource.path.replace(/^engine\//, '')
    if (name.includes('/') || name.includes('..')) throw new Error('Unexpected bundled resource path')
    const bytes = await readFile(new URL(name, directory))
    if (bytes.length !== resource.size || createHash('sha256').update(bytes).digest('hex') !== resource.sha256) {
      throw new Error(`Bundled resource does not match its manifest: ${name}`)
    }
    const packed = deflateSync(bytes, { level: 9 })
    if (!inflateSync(packed).equals(bytes)) throw new Error(`Resource compression failed: ${name}`)
    const destination = new URL(`${name}.zlib`, directory)
    const previous = await readFile(destination).catch(() => null)
    if (!previous?.equals(packed)) await writeFile(destination, packed)
    originalSize += bytes.length
    packedSize += packed.length
  }
  console.log(`Bundled engines: ${(originalSize / 1048576).toFixed(1)} → ${(packedSize / 1048576).toFixed(1)} MiB (lossless)`)
}
