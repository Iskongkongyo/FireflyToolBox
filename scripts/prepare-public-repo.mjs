import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const stateName = '.firefly-public-export.json'
const stagePrefix = '.firefly-public-export-stage-'
const format = 'firefly-public-export-v1'
const localDirectories = new Set(['.git', 'node_modules', 'target', 'target-check', 'target-package', 'dist', 'build', '.gradle', '.cache', '.idea', '.vscode', '.npm-cache', '.gradle-home', '.tauri', '.cxx', '.externalnativebuild', '__pycache__'])
const localNames = new Set(['local.properties', 'key.properties', 'keystore.properties', 'signing.properties', '.npmrc', '.pypirc', '.netrc', '.git-credentials', 'credentials.json', '.ds_store', 'thumbs.db'])
const localSuffix = /\.(?:jks|keystore|p12|pfx|key|sqlite(?:-shm|-wal)?|db|apk|aab|exe|msi|fftool|pdb|dmp|log|tmp|temp|bak|swp|swo|tsbuildinfo)$/i
const binarySuffix = /\.(?:png|jpe?g|gif|webp|ico|icns|ttf|otf|woff2?|bin|a|jar|wasm|zlib|zip|pdf|mp[34]|wav|ogg|onnx)$/i
const secretRules = [
  ['PRIVATE_KEY', /-{5}BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-{5}/],
  ['GITHUB_TOKEN', /\b(?:gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/],
  ['API_SECRET', /\bsk-(?:proj-|svcacct-|ant-)?[A-Za-z0-9_-]{32,}\b/],
  ['AWS_ACCESS_KEY', /\bAKIA[0-9A-Z]{16}\b/],
  ['SLACK_TOKEN', /\bxox[baprs]-[A-Za-z0-9-]{24,}\b/],
]
const bookkeepingIgnores = `
# Local public-export bookkeeping and machine-specific files.
/${stateName}
/${stagePrefix}*/
.env
.env.*
.npmrc
.pypirc
.netrc
.git-credentials
local.properties
key.properties
keystore.properties
signing.properties
credentials.json
*.jks
*.keystore
*.p12
*.pfx
*.key
`

export class PublicExportError extends Error {
  constructor(code, message, details = []) { super(message); this.code = code; this.details = details }
}
const fail = (code, message, details) => { throw new PublicExportError(code, message, details) }
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const comparePath = value => process.platform === 'win32' ? value.toLowerCase() : value
const equalPath = (a, b) => comparePath(a) === comparePath(b)
function inside(root, candidate) {
  const relative = path.relative(comparePath(root), comparePath(candidate))
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)
}
function safeRelative(value) {
  return typeof value === 'string' && value.length > 0 && !/[\\:\x00-\x1f]/.test(value)
    && !path.posix.isAbsolute(value) && value.split('/').every(part => part !== '' && part !== '.' && part !== '..' && part.toLowerCase() !== '.git')
}
function localReason(relative) {
  const parts = relative.toLowerCase().split('/'), name = parts.at(-1)
  if (parts.some(part => localDirectories.has(part))) return 'local-directory'
  if (localNames.has(name) || name === '.env' || name.startsWith('.env.') || /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)/.test(name) || localSuffix.test(name)) return 'local-or-sensitive-file'
  if (relative.startsWith('src-tauri/builtin-tools/generated/media-assets/') || relative.startsWith('src-tauri/gen/schemas/') || relative.startsWith('src-tauri/gen/android/app/src/main/jniLibs/')) return 'generated-resource'
  return null
}
async function statOrNull(file) {
  try { return await fs.lstat(file) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
}
async function canonicalFuture(file) {
  let ancestor = path.resolve(file), tail = []
  while (!await statOrNull(ancestor)) {
    const parent = path.dirname(ancestor)
    if (parent === ancestor) fail('OUTPUT_PATH', '无法解析目标路径。')
    tail.unshift(path.basename(ancestor)); ancestor = parent
  }
  return path.join(await fs.realpath(ancestor), ...tail)
}
async function assertParents(root, relative) {
  let current = root
  for (const part of relative.split('/').slice(0, -1)) {
    current = path.join(current, part)
    const stat = await statOrNull(current)
    if (stat?.isSymbolicLink() || (stat && !stat.isDirectory())) fail('UNSAFE_PATH', '文件路径经过链接或非目录。', [relative])
  }
}
function git(root, args, input) {
  const result = spawnSync('git', ['-C', root, ...args], { input, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 })
  if (result.error) fail('GIT_UNAVAILABLE', '需要 Git 命令行，并在完整工作区中运行。')
  return result
}
function ignoredPaths(root, paths) {
  if (!paths.length) return new Set()
  const result = git(root, ['check-ignore', '--no-index', '--stdin', '-z'], paths.join('\0') + '\0')
  if (![0, 1].includes(result.status)) fail('GIT_IGNORE', '无法应用工作区的忽略规则。')
  return new Set(result.stdout.split('\0').filter(Boolean))
}
async function snapshot(root) {
  const listed = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.'])
  if (listed.status !== 0) fail('SOURCE_REPOSITORY', '源目录必须是可读取的 Git 工作区。')
  const candidates = [...new Set(listed.stdout.split('\0').filter(Boolean))].sort()
  const ignored = ignoredPaths(root, candidates), entries = [], excluded = [], secrets = [], folded = new Set()
  for (const relative of candidates) {
    if (ignored.has(relative)) { excluded.push({ path: relative, reason: 'gitignore' }); continue }
    if (!safeRelative(relative)) fail('UNSAFE_SOURCE_PATH', '源文件名不适合公开导出。', [relative])
    const reason = localReason(relative)
    if (reason) { excluded.push({ path: relative, reason }); continue }
    await assertParents(root, relative)
    const file = path.join(root, relative), stat = await statOrNull(file)
    if (!stat) { excluded.push({ path: relative, reason: 'deleted-in-working-tree' }); continue }
    if (stat.isSymbolicLink() || !stat.isFile()) fail('UNSAFE_SOURCE_PATH', '不导出链接、子模块目录或特殊文件。', [relative])
    const foldedPath = relative.toLowerCase()
    if (folded.has(foldedPath)) fail('CASE_COLLISION', '源目录包含仅大小写不同的重复路径。', [relative])
    folded.add(foldedPath)
    let bytes = await fs.readFile(file)
    if (!binarySuffix.test(relative) && !bytes.subarray(0, 8192).includes(0)) {
      const text = bytes.toString('utf8')
      for (const [rule, pattern] of secretRules) if (pattern.test(text)) secrets.push({ path: relative, rule })
    }
    if (relative === '.gitignore') bytes = Buffer.from(bytes.toString('utf8').trimEnd() + '\n' + bookkeepingIgnores)
    entries.push({ path: relative, bytes, sha256: hash(bytes), size: bytes.length, mode: stat.mode & 0o777 })
  }
  if (secrets.length) fail('SECRET_DETECTED', '发现疑似凭据；请先在源文件中核对处理，未写入目标目录。', secrets)
  for (const required of ['README.md', 'LICENSE', 'package.json', '.gitignore']) {
    if (!entries.some(entry => entry.path === required)) fail('REQUIRED_FILE', '缺少必要公开文件，或被忽略规则排除。', [required])
  }
  // Rust includes are necessary for a clean checkout, except resource files
  // explicitly rebuilt by npm run build:builtin-tools.
  const paths = new Set(entries.map(entry => entry.path))
  for (const entry of entries.filter(entry => entry.path.endsWith('.rs'))) {
    for (const match of entry.bytes.toString('utf8').matchAll(/include_(?:str|bytes)!\s*\(\s*"([^"]+)"/g)) {
      const absolute = path.resolve(root, path.dirname(entry.path), match[1])
      if (!inside(root, absolute)) continue
      const dependency = path.relative(root, absolute).split(path.sep).join('/')
      if (dependency.startsWith('src-tauri/builtin-tools/generated/media-assets/')) continue
      if (!paths.has(dependency)) fail('MISSING_BUILD_INPUT', 'Rust 引用的源文件未被导出，请核对忽略规则或先生成内置工具。', [entry.path, dependency])
    }
  }
  return { entries, excluded }
}
async function readState(output) {
  const file = path.join(output, stateName), stat = await statOrNull(file)
  if (!stat) return { files: {} }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 16 * 1024 * 1024) fail('INVALID_STATE', '导出记录不是有效的普通文件。')
  let data
  try { data = JSON.parse(await fs.readFile(file, 'utf8')) } catch { fail('INVALID_STATE', '导出记录无法解析，停止整理以保护已有文件。') }
  if (data.format !== format || !data.files || typeof data.files !== 'object' || Array.isArray(data.files)) fail('INVALID_STATE', '导出记录格式不受支持。')
  for (const [relative, digest] of Object.entries(data.files)) {
    if (!safeRelative(relative) || relative === stateName || relative.startsWith(stagePrefix) || typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) fail('INVALID_STATE', '导出记录包含不安全的文件路径或摘要。')
  }
  return data
}
async function outputFiles(output, source, managed) {
  const result = new Map(), candidates = []
  const managedPaths = new Set()
  for (const file of Object.keys(managed)) {
    const parts = file.split('/')
    while (parts.length) { managedPaths.add(parts.join('/')); parts.pop() }
  }
  if (!await statOrNull(output)) return result
  async function walk(directory, prefix = '') {
    for (const item of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = prefix + item.name
      if (item.name.toLowerCase() === '.git' || (!prefix && (item.name === stateName || item.name.startsWith(stagePrefix)))) continue
      if (!managedPaths.has(relative) && localReason(relative)) continue
      if (!safeRelative(relative)) fail('UNSAFE_OUTPUT_PATH', '目标含有不安全的文件路径。', [relative])
      const file = path.join(directory, item.name), stat = await fs.lstat(file)
      if (stat.isSymbolicLink()) fail('UNSAFE_OUTPUT_PATH', '目标含有链接或目录联接，未进行覆盖。', [relative])
      if (stat.isDirectory()) await walk(file, relative + '/')
      else if (stat.isFile()) candidates.push(relative)
      else fail('UNSAFE_OUTPUT_PATH', '目标含有特殊文件。', [relative])
    }
  }
  await walk(output)
  const ignored = ignoredPaths(source, candidates.filter(file => !Object.hasOwn(managed, file)))
  for (const relative of candidates) {
    if (ignored.has(relative)) continue
    result.set(relative, hash(await fs.readFile(path.join(output, relative))))
  }
  return result
}
function makeChanges(entries, previous, current) {
  const desired = new Map(entries.map(entry => [entry.path, entry])), conflicts = [], changes = { added: [], updated: [], removed: [], unchanged: [] }
  for (const entry of entries) {
    const existing = current.get(entry.path)
    if (existing === entry.sha256) changes.unchanged.push(entry.path)
    else if (existing === undefined) changes.added.push(entry.path)
    else if (existing === previous.files[entry.path]) changes.updated.push(entry.path)
    else conflicts.push({ path: entry.path, reason: '目标文件被人工修改或不属于上次导出' })
  }
  for (const [relative, digest] of current) {
    if (desired.has(relative)) continue
    if (!Object.hasOwn(previous.files, relative)) conflicts.push({ path: relative, reason: '目标存在未管理文件，请另选空目录或先自行整理' })
    else if (previous.files[relative] !== digest) conflicts.push({ path: relative, reason: '待移除的旧导出文件已被人工修改' })
    else changes.removed.push(relative)
  }
  if (conflicts.length) fail('OUTPUT_CONFLICT', '目标有需要保留的人工内容，未写入或删除文件。', conflicts)
  return changes
}
async function assertOutputStable(output, expected, source, managed) {
  const stat = await fs.lstat(output)
  if (stat.isSymbolicLink() || !stat.isDirectory() || !equalPath(await fs.realpath(output), output)) fail('OUTPUT_CHANGED', '目标目录发生变化，停止整理。')
  const current = await outputFiles(output, source, managed)
  if (current.size !== expected.size || [...current].some(([file, digest]) => expected.get(file) !== digest)) fail('OUTPUT_CHANGED', '整理期间目标内容发生变化，停止覆盖。')
}
async function clearStage(stage, output, name) {
  const stat = await statOrNull(stage)
  if (!stat) return
  if (stat.isSymbolicLink() || path.basename(stage) !== name || !inside(output, await fs.realpath(stage))) fail('UNSAFE_STAGE', '临时目录路径变化，未自动清理。')
  await fs.rm(stage, { recursive: true, force: true })
}

export async function preparePublicRepository({ sourceRoot = scriptRoot, outputDir, dryRun = false } = {}) {
  if (!outputDir) {
    if (process.platform !== 'win32') fail('OUTPUT_REQUIRED', '非 Windows 平台请通过 --output 指定目标目录。')
    outputDir = 'D:\\流萤工具箱公开仓库'
  }
  const source = await fs.realpath(path.resolve(sourceRoot))
  const repository = git(source, ['rev-parse', '--show-toplevel'])
  if (repository.status !== 0 || !equalPath(await fs.realpath(repository.stdout.trim()), source)) fail('SOURCE_REPOSITORY', '源目录须为 Git 仓库根目录。')
  const output = await canonicalFuture(outputDir)
  const outputStat = await statOrNull(path.resolve(outputDir))
  if (equalPath(source, output) || inside(source, output) || inside(output, source) || equalPath(output, path.parse(output).root) || equalPath(output, await fs.realpath(os.homedir())) || output.split(path.sep).some(part => part.toLowerCase() === '.git')) fail('OUTPUT_PATH', '目标不能是源目录、源目录的上级或子目录、磁盘根目录、用户主目录或 .git 目录。')
  if (outputStat && (outputStat.isSymbolicLink() || !outputStat.isDirectory())) fail('OUTPUT_PATH', '目标必须是普通目录，不能是文件或目录联接。')
  const { entries, excluded } = await snapshot(source)
  const previous = await readState(output), current = await outputFiles(output, source, previous.files)
  const changes = makeChanges(entries, previous, current)
  const plan = { source, output, dryRun, files: entries.map(({ path, sha256, size }) => ({ path, sha256, size })), bytes: entries.reduce((total, entry) => total + entry.size, 0), excluded, ...changes }
  if (dryRun) return plan
  await fs.mkdir(output, { recursive: true })
  if (!equalPath(await fs.realpath(output), output)) fail('OUTPUT_CHANGED', '目标目录解析发生变化。')
  const stageName = stagePrefix + randomUUID(), stage = path.join(output, stageName)
  await fs.mkdir(stage)
  try {
    const changed = new Set([...changes.added, ...changes.updated])
    for (const entry of entries.filter(entry => changed.has(entry.path))) {
      const staged = path.join(stage, entry.path)
      await fs.mkdir(path.dirname(staged), { recursive: true })
      await fs.writeFile(staged, entry.bytes, { mode: entry.mode })
      if (hash(await fs.readFile(staged)) !== entry.sha256) fail('COPY_MISMATCH', '临时文件校验失败。', [entry.path])
    }
    await assertOutputStable(output, current, source, previous.files)
    for (const entry of entries.filter(entry => changed.has(entry.path))) {
      if (!equalPath(await fs.realpath(output), output)) fail('OUTPUT_CHANGED', '目标目录发生变化，停止覆盖。')
      await assertParents(output, entry.path)
      const destination = path.join(output, entry.path)
      await fs.mkdir(path.dirname(destination), { recursive: true })
      await fs.rename(path.join(stage, entry.path), destination)
    }
    for (const relative of changes.removed) {
      if (!equalPath(await fs.realpath(output), output)) fail('OUTPUT_CHANGED', '目标目录发生变化，停止移除。')
      await assertParents(output, relative)
      const destination = path.join(output, relative)
      const stat = await fs.lstat(destination)
      if (!stat.isFile() || stat.isSymbolicLink() || hash(await fs.readFile(destination)) !== previous.files[relative]) fail('OUTPUT_CHANGED', '旧导出文件变化，停止移除。', [relative])
      await fs.unlink(destination)
    }
    const state = { format, generatedAt: new Date().toISOString(), files: Object.fromEntries(entries.map(entry => [entry.path, entry.sha256])) }
    const stateTemp = path.join(stage, stateName)
    await fs.writeFile(stateTemp, JSON.stringify(state, null, 2) + '\n')
    await fs.rename(stateTemp, path.join(output, stateName))
    return plan
  } finally { await clearStage(stage, output, stageName) }
}

async function main(args) {
  const options = {}, flags = new Set(['--dry-run', '--json', '--help'])
  let json = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--help') {
      console.log('用法：node scripts/prepare-public-repo.mjs [--output 目录] [--source 仓库根目录] [--dry-run] [--json]\nWindows 默认输出：D:\\流萤工具箱公开仓库\n--dry-run 只检查并预览，不写入。导出当前工作区，不复制 .git，不初始化、提交或推送仓库。')
      return
    }
    if (flags.has(arg)) { if (arg === '--dry-run') options.dryRun = true; else json = true; continue }
    if (arg === '--source' || arg === '--output') {
      const value = args[++i]
      if (!value || value.startsWith('--')) fail('ARGUMENT', `${arg} 需要目录参数。`)
      options[arg === '--source' ? 'sourceRoot' : 'outputDir'] = value
    } else fail('ARGUMENT', `不支持的参数：${arg}`)
  }
  const plan = await preparePublicRepository(options)
  if (json) console.log(JSON.stringify(plan, null, 2))
  else {
    console.log(`${plan.dryRun ? '预览' : '整理完成'}：${plan.files.length} 个文件，${(plan.bytes / 1024 / 1024).toFixed(2)} MiB\n目标：${plan.output}\n新增 ${plan.added.length}，更新 ${plan.updated.length}，移除未修改的旧导出 ${plan.removed.length}，未变化 ${plan.unchanged.length}。`)
    if (plan.excluded.length) console.log(`另排除 ${plan.excluded.length} 个不适合公开的候选文件；--json 可查看路径与原因。`)
    if (plan.dryRun) console.log('未写入目标目录。确认清单后移除 --dry-run 再运行。')
  }
}
if (process.argv[1] && equalPath(path.resolve(process.argv[1]), fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch(error => {
    console.error(JSON.stringify({ code: error.code || 'EXPORT_FAILED', message: error.message, details: error.details || [] }, null, 2))
    process.exitCode = 1
  })
}
