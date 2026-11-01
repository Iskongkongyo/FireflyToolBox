import { build } from 'esbuild'
import { zipSync, strToU8 } from 'fflate'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { builtinModules, createRequire } from 'node:module'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import stdLibBrowser from 'node-stdlib-browser'
import nodeStdlibPlugin from 'node-stdlib-browser/helpers/esbuild/plugin'
import { createHash } from 'node:crypto'

const require = createRequire(import.meta.url)
const nodeBuiltins = new Set(builtinModules.map((name) => name.replace(/^node:/, '')))
const supportedNodeBuiltins = new Set(Object.entries(stdLibBrowser)
  .filter(([name, path]) => name !== 'vm' && name !== 'node:vm'
    && !path.replaceAll('\\', '/').includes('/mock/empty.'))
  .map(([name]) => name.replace(/^node:/, '')))
const unsupportedNodeBuiltins = {
  name: 'reject-unavailable-node-apis',
  setup(build) {
    build.onResolve({ filter: /^(?:node:)?[a-zA-Z_][\w/-]*$/ }, (args) => {
      const name = args.path.replace(/^node:/, '')
      if (nodeBuiltins.has(name) && !supportedNodeBuiltins.has(name)) {
        return { errors: [{ text: `此接口需要原生 Node.js，不能在浏览器模块中使用：${args.path}` }] }
      }
    })
  },
}
const boundedEmbeddedAssets = {
  name: 'limit-embedded-assets',
  setup(build) {
    build.onLoad({ filter: /\.(?:wasm|png|jpe?g|webp|gif|svg|avif|bmp|ico|heic|heif|jxl|tiff?|woff2?|ttf|otf|mp3|wav|ogg|flac|m4a|aac|mp4|webm|mov)$/i, namespace: 'file' }, async (args) => {
      const bytes = await readFile(args.path)
      if (modern) {
        const digest = createHash('sha256').update(bytes).digest('hex')
        const extension = args.path.split('.').pop().toLowerCase()
        const path = `resources/${digest.slice(0, 24)}.${extension}`
        addResource(path, bytes)
        // V7 imports name package resources; mount's resources.url() loads them.
        return { contents: `export default ${JSON.stringify(path)}`, loader: 'js' }
      }
      if (args.path.endsWith('.wasm')) return { contents: bytes, loader: 'binary' }
      if (!bytes.length || bytes.length > 512 * 1024) {
        return { errors: [{ text: `静态资源 ${args.path} 不能超过 512 KiB，且不能为空。` }] }
      }
      return { contents: bytes, loader: 'dataurl' }
    })
  },
}

const [, , inputDirectory, outputFile] = process.argv
if (!inputDirectory) {
  console.error('用法：npm run module:bundle -- <模块目录> [输出.fftool]')
  process.exit(2)
}

function objectWithFields(value, label, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须是 JSON 对象。`)
  for (const key of required) if (!Object.hasOwn(value, key)) throw new Error(`${label} 缺少必填字段 ${key}。`)
  for (const key of Object.keys(value)) {
    if (!required.includes(key) && !optional.includes(key)) throw new Error(`${label} 包含未知字段 ${key}。`)
  }
}

function expectString(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} 必须是字符串。`)
}

function expectStrings(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(`${label} 必须是字符串数组。`)
}

function expectLocalized(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.values(value).some((item) => typeof item !== 'string')) throw new Error(`${label} 必须是语言到字符串的对象，例如 {"zh-CN":"名称"}。`)
}

function validateManifestShape(manifest) {
  objectWithFields(manifest, 'manifest.json', [
    'schema_version', 'module_id', 'version', 'api_version', 'min_app_version', 'name',
    'author', 'license', 'platforms', 'permissions', 'network', 'limits', 'tools',
  ], ['resources'])
  if (!Number.isInteger(manifest.schema_version) || manifest.schema_version < 0) throw new Error('schema_version 必须是非负整数。')
  for (const key of ['module_id', 'version', 'api_version', 'min_app_version', 'author', 'license']) expectString(manifest[key], key)
  expectLocalized(manifest.name, 'name')
  expectStrings(manifest.platforms, 'platforms')
  expectStrings(manifest.permissions, 'permissions')
  objectWithFields(manifest.network, 'network', ['hosts'])
  expectStrings(manifest.network.hosts, 'network.hosts')
  if (manifest.network.hosts.length > 64) throw new Error('network.hosts 最多 64 个 HTTPS 来源。')
  objectWithFields(manifest.limits, 'limits', ['input_bytes', 'output_bytes', 'timeout_ms', 'heap_bytes'])
  for (const [key, value] of Object.entries(manifest.limits)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`limits.${key} 必须是非负整数。`)
  }
  if (!Array.isArray(manifest.tools)) throw new Error('tools 必须是工具数组。')
  manifest.tools.forEach((tool, index) => {
    const label = `tools[${index}]`
    objectWithFields(tool, label, [
      'id', 'name', 'description', 'category', 'tags', 'aliases', 'entry',
      'input_schema', 'output_schema', 'ui', 'actions',
    ], ['icon', 'icon_data', 'runtime'])
    for (const key of ['id', 'category', 'entry']) expectString(tool[key], `${label}.${key}`)
    for (const key of ['icon', 'icon_data', 'runtime']) {
      if (tool[key] != null) expectString(tool[key], `${label}.${key}`)
    }
    expectLocalized(tool.name, `${label}.name`)
    expectLocalized(tool.description, `${label}.description`)
    expectStrings(tool.tags, `${label}.tags`)
    expectStrings(tool.aliases, `${label}.aliases`)
    objectWithFields(tool.ui, `${label}.ui`, ['kind'], ['input_field', 'output_field', 'script', 'style'])
    expectString(tool.ui.kind, `${label}.ui.kind`)
    for (const key of ['input_field', 'output_field', 'script', 'style']) {
      if (tool.ui[key] != null) expectString(tool.ui[key], `${label}.ui.${key}`)
    }
    if (!Array.isArray(tool.actions)) throw new Error(`${label}.actions 必须是操作数组。`)
    tool.actions.forEach((action, actionIndex) => {
      const actionLabel = `${label}.actions[${actionIndex}]`
      objectWithFields(action, actionLabel, ['id', 'label'], ['input_types'])
      if (action.input_types !== undefined) {
        expectStrings(action.input_types, `${actionLabel}.input_types`)
        if (manifest.schema_version < 5) throw new Error('input_types 需要 Manifest v5。')
      }
      expectString(action.id, `${actionLabel}.id`)
      expectLocalized(action.label, `${actionLabel}.label`)
    })
  })
}

const directory = resolve(inputDirectory)
const canonicalDirectory = await realpath(directory)
const manifestBytes = await readFile(join(directory, 'manifest.json'))
if (manifestBytes[0] === 0xef && manifestBytes[1] === 0xbb && manifestBytes[2] === 0xbf) {
  throw new Error('manifest.json 必须使用 UTF-8 无 BOM 编码；Windows PowerShell 5.1 的 Set-Content -Encoding UTF8 会写入 BOM。')
}
const manifest = JSON.parse(manifestBytes.toString('utf8'))
validateManifestShape(manifest)
if ((manifest.schema_version === 7 || manifest.tools.some(tool => tool.ui.kind === 'web' || tool.runtime === 'browser'))
  && (manifest.schema_version !== 7 || manifest.tools.some(tool => tool.ui.kind !== 'web' || tool.runtime !== 'browser'))) {
  throw new Error('网页工具仅支持清单 v7 和 HTML/CSS/JS 页面入口，请重新制作旧版网页工具包。')
}
const modern = manifest.schema_version === 7
const sourceLimit = modern ? 8 * 1024 * 1024 : 1024 * 1024
const packageLimit = (modern ? 128 : 2) * 1024 * 1024
if (!/^[a-z][a-z0-9_.]{1,99}$/.test(manifest.module_id)
  || !/^[a-zA-Z0-9._+-]{1,64}$/.test(manifest.version)
  || !Array.isArray(manifest.tools) || manifest.tools.length === 0 || manifest.tools.length > 16) {
  throw new Error('模块清单中的 ID、版本或工具列表无效。')
}
const output = resolve(outputFile ?? join(directory, `${manifest.module_id}-${manifest.version}.fftool`))
if (basename(output).toLowerCase().endsWith('.fftool') === false) throw new Error('输出文件必须以 .fftool 结尾。')
const bundled = new Map()
const files = Object.create(null)
const resources = new Map()
const resourceExtensions = ['wasm', 'js', 'json', 'bin', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif', 'bmp', 'ico', 'heic', 'heif', 'jxl', 'tif', 'tiff', 'woff', 'woff2', 'ttf', 'otf', 'mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'mp4', 'webm', 'mov']
function addResource(path, bytes) {
  if (!modern || !bytes.length || bytes.length > 96 * 1024 * 1024) throw new Error('独立资源需要清单 v7，单个资源须在 96 MiB 以内。')
  if (!resourceExtensions.some(extension => path.endsWith('.' + extension))) throw new Error(`不支持的资源类型：${path}`)
  sourcePath(path, resourceExtensions.map(extension => '.' + extension), '资源')
  if (resources.size >= 128 && !resources.has(path)) throw new Error('工具包资源不能超过 128 个。')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const previous = resources.get(path)
  if (previous && previous.sha256 !== sha256) throw new Error(`资源路径冲突：${path}`)
  resources.set(path, { path, size: bytes.length, sha256 })
  files[path] = bytes
}
const assetMimeTypes = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2',
}
const embeddedAssets = new Map()
function sourcePath(path, extensions, label) {
  if (typeof path !== 'string' || path.length > 120 || !extensions.some((extension) => path.endsWith(extension))
    || isAbsolute(path) || path.includes('\\') || path.includes(':')
    || path.split('/').some((part) => !part || part === '..' || part === '.')) {
    throw new Error(`${label}路径无效。`)
  }
  const fullPath = resolve(directory, path)
  if (!fullPath.startsWith(directory + sep)) throw new Error(`${label}超出了模块目录。`)
  return fullPath
}

async function verifiedSourcePath(path, extensions, label) {
  const actual = await realpath(sourcePath(path, extensions, label))
  if (!actual.startsWith(canonicalDirectory + sep)) throw new Error(`${label}超出了模块目录。`)
  return actual
}

async function addTextFile(path, extension, label) {
  const fullPath = await verifiedSourcePath(path, [extension], label)
  const content = await readFile(fullPath)
  if (!content.length || content.length > sourceLimit) throw new Error(`${label}大小超限，且不能为空。`)
  let source = new TextDecoder('utf-8', { fatal: true }).decode(content)
  for (const match of source.matchAll(/\{\{asset:([^}]+)\}\}/g)) {
    const assetPath = match[1]
    if (!embeddedAssets.has(assetPath)) {
      const extension = Object.keys(assetMimeTypes).find((item) => assetPath.endsWith(item))
      if (!extension || !/^[a-zA-Z0-9_./-]+$/.test(assetPath)) throw new Error(`静态资源路径无效：${assetPath}`)
      const bytes = await readFile(await verifiedSourcePath(assetPath, [extension], '静态资源'))
      if (modern) {
        addResource(assetPath, bytes)
        embeddedAssets.set(assetPath, `{{resource:${assetPath}}}`)
      } else {
      if (!bytes.length || bytes.length > 512 * 1024) throw new Error(`静态资源 ${assetPath} 不能超过 512 KiB，且不能为空。`)
      embeddedAssets.set(assetPath, `data:${assetMimeTypes[extension]};base64,${bytes.toString('base64')}`)
      }
    }
    source = source.replaceAll(`{{asset:${assetPath}}}`, embeddedAssets.get(assetPath))
  }
  if (source.includes('{{asset:')) throw new Error(`${label}含有未完成的静态资源引用。`)
  const output = strToU8(source)
  if (output.byteLength > sourceLimit) throw new Error(`${label}源码大小超限。`)
  files[path] = output
}

if (manifest.resources !== undefined) {
  if (!modern || !Array.isArray(manifest.resources)) throw new Error('resources 需要清单 v7 和资源描述数组。')
  for (const resource of manifest.resources) {
    objectWithFields(resource, '资源', ['path'], ['size', 'sha256'])
    const bytes = await readFile(await verifiedSourcePath(resource.path, resourceExtensions.map(extension => '.' + extension), '资源'))
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if ((resource.size && resource.size !== bytes.length) || (resource.sha256 && resource.sha256 !== sha256)) throw new Error(`资源校验不匹配：${resource.path}`)
    addResource(resource.path, bytes)
  }
}
for (const [index, tool] of manifest.tools.entries()) {
  const webTool = manifest.schema_version === 7 && tool.ui?.kind === 'web'
  if (webTool) {
    if (tool.runtime !== 'browser' || typeof tool.ui.script !== 'string' || typeof tool.ui.style !== 'string') {
      throw new Error(`网页工具 ${index + 1} 缺少浏览器运行环境、JS 或 CSS 路径。`)
    }
    await addTextFile(tool.entry, '.html', `工具 ${index + 1} 的 HTML`)
    await addTextFile(tool.ui.style, '.css', `工具 ${index + 1} 的 CSS`)
  }
  const scriptPath = webTool ? tool.ui.script : tool.entry
  const entry = await verifiedSourcePath(scriptPath, ['.js'], `工具 ${index + 1} 的 JS`)
  if (!bundled.has(entry)) {
    const browserRuntime = tool.runtime === 'browser'
    const result = await build({
      entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'browser',
      target: 'es2022', logLevel: 'warning', sourcemap: false, minify: browserRuntime,
      ...(browserRuntime ? {
        loader: { '.wasm': 'binary', '.png': 'dataurl', '.jpg': 'dataurl', '.jpeg': 'dataurl',
          '.webp': 'dataurl', '.gif': 'dataurl', '.svg': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl' },
        inject: [require.resolve('node-stdlib-browser/helpers/esbuild/shim')],
        define: { global: 'global', process: 'process', Buffer: 'Buffer' },
        plugins: [unsupportedNodeBuiltins, boundedEmbeddedAssets, nodeStdlibPlugin(stdLibBrowser)],
      } : {}),
    })
    const code = result.outputFiles[0]?.text
    if (!code || Buffer.byteLength(code) > sourceLimit) throw new Error('打包后的单个脚本大小超限。')
    const fileName = `bundle_${bundled.size + 1}.js`
    bundled.set(entry, fileName)
    files[fileName] = strToU8(code)
  }
  if (webTool) tool.ui.script = bundled.get(entry)
  else tool.entry = bundled.get(entry)
}
  if (modern) manifest.resources = [...resources.values()].sort((a, b) => a.path.localeCompare(b.path))
  const manifestText = JSON.stringify(manifest, null, 2)
  if (Buffer.byteLength(manifestText) > 64 * 1024) throw new Error('模块清单不能超过 64 KiB。')
  const sources = Object.entries(files).filter(([path]) => !resources.has(path))
  if (sources.length > (modern ? 128 : 16) || sources.reduce((total, [,bytes]) => total + bytes.length, 0) > (modern ? 32 : 2) * 1024 * 1024) throw new Error('源码文件数量或源码总量超限；网页工具最多 128 个文件、合计 32 MiB。')
  files['manifest.json'] = strToU8(manifestText)
  if (Object.values(files).reduce((total, bytes) => total + bytes.length, 0) > packageLimit) throw new Error('工具包解包后总量超限。')
  const archive = zipSync(files, { level: 0 })
  if (archive.byteLength > packageLimit) throw new Error(`生成的工具包超过 ${modern ? 128 : 2} MiB。`)
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, archive)
  console.log(`已生成 ${output}`)
