import assert from 'node:assert/strict'
import { mkdir, open, stat, writeFile, readFile, rm, copyFile, appendFile } from 'node:fs/promises'
import { copyFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { capacityFixture, MiB } from './module-capacity-fixtures.mjs'
import { connectAndroid } from './android-device-client.mjs'
import { connectWindows } from './windows-test-client.mjs'
import { unzipSync, zipSync, strToU8 } from 'fflate'

const windows = process.argv.includes('--windows')
const client = await (windows ? connectWindows() : connectAndroid()), serial = windows ? 'windows' : client.device('get-serialno')
const adb = process.env.FIREFLY_ADB || path.join(process.env.ANDROID_HOME || path.join(process.env.LOCALAPPDATA, 'Android/Sdk'), 'platform-tools/adb.exe')
const directory = path.resolve('target-check/module-capacity-review', serial.replace(/[^\w-]/g, '_'))
await mkdir(directory, { recursive: true })
await rm(path.join(directory, 'error.txt'), { force: true })
const token = crypto.randomUUID().replaceAll('-', '').slice(0, 12), prefix = `capacity-${token}`
const moduleId = `dev.example.capacity_${token}`, draftId = crypto.randomUUID()
const staged = [], cached = []
const report = { platform: windows ? 'windows' : 'android', android: windows ? undefined : client.device('shell', 'getprop', 'ro.build.version.release'), checks: [] }
const pass = message => { report.checks.push(message); console.log('PASS:', message) }
const uri = name => windows ? path.join(directory, name) : `content://firefly.toolbox.fileprovider/my_cache_images/${name}`
async function cleanupModules(connection) {
  const owned = new Set([moduleId, moduleId + '_sources', moduleId + '_escaped'])
  const modules = await connection.invoke('list_modules')
  for (const module of modules.filter(module => owned.has(module.module_id))) {
    await connection.invoke('delete_tools', { toolIds: module.tool_ids })
  }
  await connection.invoke('discard_module_resources', { resourceDraftId: draftId })
}
function pack(source, output) {
  const result = spawnSync(process.execPath, ['scripts/bundle-module.mjs', source, output], { windowsHide: true, encoding: 'utf8', timeout: 120000 })
  assert.equal(result.status, 0, result.stderr)
}
function upload(local, name) {
  if (windows) { cached.push(name); copyFileSync(local, uri(name)); return uri(name) }
  const remote = `/data/local/tmp/${name}`
  staged.push(remote); cached.push(name)
  client.device('push', local, remote)
  // The shell reads its own staging file; the app writes only its private cache.
  client.device('shell', `cat ${remote} | run-as firefly.toolbox sh -c 'cat > cache/${name}'`)
  return uri(name)
}
async function details(id) {
  return client.evaluate(async id => {
    const value = await window.__TAURI_INTERNALS__.invoke('get_module_details', { moduleId: id })
    const sizes = Object.values(value.scripts).map(source => new TextEncoder().encode(source).length)
    return { count: sizes.length, total: sizes.reduce((a, b) => a + b, 0), largest: Math.max(...sizes), resources: value.manifest.resources }
  }, id)
}
try {
  const source = path.join(directory, 'large-source'), input = path.join(directory, 'large.fftool')
  const manifest = await capacityFixture(source, { htmlBytes: 8 * MiB, resources: [96 * MiB], moduleId })
  pack(source, input)
  const packageUri = upload(input, `${prefix}.fftool`)
  const summary = await client.invoke('inspect_module_file', { path: packageUri })
  assert.equal(summary.module_id, moduleId)
  assert((await stat(input)).size > 64 * MiB)
  pass('The native importer inspects a package above 64 MiB containing 8 MiB HTML and a 96 MiB resource.')
  await client.invoke('install_module_file', { path: packageUri })
  const info = await details(moduleId)
  assert.equal(info.count, 3); assert.equal(info.largest, 8 * MiB)
  assert.equal(info.resources[0].size, 96 * MiB)
  assert.equal(info.resources[0].sha256, manifest.resources[0].sha256)
  pass('The package installs and its full 8 MiB source returns through the actual native IPC.')
  for (const offset of [0, 47 * MiB, 95 * MiB]) {
    const checked = await client.evaluate(async (moduleId, resource, offset) => {
      const bytes = new Uint8Array(await window.__TAURI_INTERNALS__.invoke('read_module_resource', { moduleId, path: resource.path, offset, length: 1048576, expectedSha256: resource.sha256 }))
      return { size: bytes.length, valid: bytes.every(value => value === 42) }
    }, moduleId, manifest.resources[0], offset)
    assert.deepEqual(checked, { size: MiB, valid: true })
  }
  await assert.rejects(client.invoke('read_module_resource', { moduleId, path: manifest.resources[0].path, offset: 96 * MiB + 1, length: 1 }))
  pass('First, middle and final resource chunks match every byte; reading beyond 96 MiB is rejected.')
  const resourceName = `${prefix}.bin`, resourceUri = upload(path.join(source, 'assets/model-0.bin'), resourceName)
  const stagedResource = await client.invoke('stage_module_resource', { path: resourceUri, resourceDraftId: draftId })
  assert.equal(stagedResource.size, 96 * MiB)
  assert.equal(stagedResource.sha256, manifest.resources[0].sha256)
  pass('The native resource importer accepts and hashes a 96 MiB draft resource.')
  await assert.rejects(client.evaluate(async moduleId => {
    const value = await window.__TAURI_INTERNALS__.invoke('get_module_details', { moduleId })
    value.scripts['page-0.html'] += ' '
    await window.__TAURI_INTERNALS__.invoke('validate_module_draft', { manifest: value.manifest, scripts: value.scripts, resourceModuleId: moduleId })
  }, moduleId))
  pass('The native draft validator rejects 8 MiB source plus one byte.')
  const outputName = `${prefix}-export.fftool`; cached.push(outputName)
  await client.invoke('export_module_file', { moduleId, path: uri(outputName) })
  assert.equal((await client.invoke('inspect_module_file', { path: uri(outputName) })).module_id, moduleId)
  const pulled = path.join(directory, 'native-export.fftool')
  if (windows) await copyFile(uri(outputName), pulled)
  else { const outputFile = await open(pulled, 'w'); try {
    const result = spawnSync(adb, ['-s', serial, 'exec-out', 'run-as', 'firefly.toolbox', 'cat', `cache/${outputName}`], { windowsHide: true, stdio: ['ignore', outputFile.fd, 'pipe'], timeout: 60000 })
    assert.equal(result.status, 0, result.stderr?.toString())
  } finally { await outputFile.close() } }
  assert((await stat(pulled)).size > 64 * MiB)
  if (process.env.FIREFLY_TEST_EXE) {
    const checked = spawnSync(process.env.FIREFLY_TEST_EXE, ['--check-fftool', pulled], { windowsHide: true, encoding: 'utf8', timeout: 120000 })
    assert.equal(checked.status, 0, checked.stdout + checked.stderr)
    assert.equal(JSON.parse(checked.stdout).ok, true)
  }
  pass('The native exporter saves the complete large package and reopens it; the export passes native validation.')
  const tooLarge = `${prefix}-oversize.fftool`; cached.push(tooLarge)
  if (windows) { const file = await open(uri(tooLarge), 'w'); try { await file.truncate(128 * MiB + 1) } finally { await file.close() } }
  else client.device('shell', 'run-as', 'firefly.toolbox', 'truncate', '-s', String(128 * MiB + 1), `cache/${tooLarge}`)
  await assert.rejects(client.invoke('inspect_module_file', { path: uri(tooLarge) }))
  pass('A package one byte above 128 MiB is rejected before unpacking.')
  if (windows) await appendFile(uri(resourceName), 'x')
  else client.device('shell', `run-as firefly.toolbox sh -c 'printf x >> cache/${resourceName}'`)
  await assert.rejects(client.invoke('stage_module_resource', { path: resourceUri, resourceDraftId: draftId }))
  pass('A resource one byte above 96 MiB is rejected by the native resource importer.')
  const manySource = path.join(directory, 'many-source'), manyPackage = path.join(directory, 'many.fftool')
  // The browser compatibility shim also counts toward the source quota.
  const generated = unzipSync(await readFile(input), { filter: file => /\.(js|css)$/.test(file.name) })
  const overhead = Object.values(generated).reduce((total, bytes) => total + bytes.length, 0)
  const htmlBytes = Math.floor((32 * MiB - 16 * overhead - 16384) / 16)
  const many = await capacityFixture(manySource, { entries: 16, htmlBytes, moduleId: moduleId + '_sources' })
  pack(manySource, manyPackage)
  const manyUri = upload(manyPackage, `${prefix}-many.fftool`)
  await client.invoke('install_module_file', { path: manyUri })
  const manyInfo = await details(many.module_id)
  assert.equal(manyInfo.count, 48)
  assert(manyInfo.total > 31 * MiB && manyInfo.total <= 32 * MiB)
  pass('A second package with 48 referenced sources and nearly 32 MiB source installs and returns through IPC.')
  const escapedSource = path.join(directory, 'escaped-source'), escapedPackage = path.join(directory, 'escaped.fftool')
  const escaped = await capacityFixture(escapedSource, { moduleId: moduleId + '_escaped' })
  const jsPrefix = 'export function mount(){}', escapedScript = jsPrefix + '\v'.repeat(8 * MiB - jsPrefix.length)
  const files = { 'manifest.json': strToU8(JSON.stringify(escaped)) }
  for (const name of ['page-0.html', 'style-0.css']) files[name] = await readFile(path.join(escapedSource, name))
  files['main-0.js'] = strToU8(escapedScript)
  await writeFile(escapedPackage, zipSync(files, { level: 0 }))
  const escapedUri = upload(escapedPackage, `${prefix}-escaped.fftool`)
  await client.invoke('install_module_file', { path: escapedUri })
  pass('An 8 MiB JavaScript entry with sixfold JSON expansion passes the native isolated syntax validator.')
  await writeFile(path.join(directory, windows ? 'windows.json' : 'android.json'), JSON.stringify(report, null, 2))
} catch (error) {
  await writeFile(path.join(directory, 'error.txt'), String(error.stack || error))
  throw error
} finally {
  let replacement
  try {
    try { await cleanupModules(client) }
    catch { replacement = await (windows ? connectWindows() : connectAndroid()); await cleanupModules(replacement) }
  } finally {
    for (const name of cached) { if (windows) await rm(uri(name), { force: true }); else client.device('shell', 'run-as', 'firefly.toolbox', 'rm', '-f', `cache/${name}`) }
    if (!windows) for (const remote of staged) client.device('shell', 'rm', '-f', remote)
    replacement?.close()
    client.close()
  }
}
