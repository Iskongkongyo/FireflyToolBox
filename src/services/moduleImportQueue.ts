import { computed, reactive, ref, type Ref } from 'vue'
import type { ModuleSummary } from './toolbox'

export type ModuleImportItem = {
  id: number; path: string; fileName: string; summary?: ModuleSummary
  state: 'waiting' | 'checking' | 'ready' | 'invalid' | 'installing' | 'installed' | 'failed'
  error: string
}
type Dependencies = {
  busy: Ref<boolean>
  inspect: (path: string) => Promise<ModuleSummary>
  install: (path: string) => Promise<ModuleSummary>
  refresh: () => Promise<void>
  errorMessage: (error: unknown) => string
}
function fileName(path: string, index: number) {
  let name = path
  try { name = decodeURIComponent(path) } catch { /* Keep the original path if it is not URI encoded. */ }
  name = name.split(/[\\/]/).at(-1) ?? ''
  if (path.startsWith('content://')) name = name.split(':').at(-1) ?? ''
  return name && (!path.startsWith('content://') || /\.[a-z0-9]+$/i.test(name)) ? name : `所选文件 ${index}`
}

export function createModuleImportQueue(deps: Dependencies) {
  const items = ref<ModuleImportItem[]>([])
  const phase = ref<'idle' | 'reading' | 'installing'>('idle')
  const notice = ref('')
  const progress = reactive({ done: 0, total: 0 })
  const pending = computed(() => items.value.filter(item => item.summary && (item.state === 'ready' || item.state === 'failed')))
  let sequence = 0

  async function inspect(item: ModuleImportItem) {
    item.state = 'checking'; item.error = ''; item.summary = undefined
    try {
      const summary = await deps.inspect(item.path)
      const duplicate = items.value.find(other => other.id !== item.id && other.summary?.module_id === summary.module_id)
      if (duplicate) throw new Error(`与列表中的「${duplicate.summary!.name}」使用同一工具包 ID，请移除重复项后重新检查。`)
      item.summary = summary; item.state = 'ready'
    } catch (error) { item.state = 'invalid'; item.error = deps.errorMessage(error) }
  }
  async function add(paths: string[]) {
    if (deps.busy.value) return
    const known = new Set(items.value.map(item => item.path))
    const added: ModuleImportItem[] = []
    for (const path of paths) {
      if (!path || known.has(path)) continue
      known.add(path)
      const item = reactive<ModuleImportItem>({ id: ++sequence, path, fileName: fileName(path, sequence), state: 'waiting', error: '' })
      items.value.push(item); added.push(item)
    }
    if (!added.length) { if (paths.length) notice.value = '这些文件已在列表中，未重复添加。'; return }
    deps.busy.value = true; phase.value = 'reading'; notice.value = ''
    try { for (const item of added) await inspect(item) }
    finally { phase.value = 'idle'; deps.busy.value = false }
  }
  async function retryCheck(id: number) {
    const item = items.value.find(item => item.id === id)
    if (!item || deps.busy.value) return
    deps.busy.value = true; phase.value = 'reading'; notice.value = ''
    try { await inspect(item) } finally { phase.value = 'idle'; deps.busy.value = false }
  }
  async function install(id?: number) {
    if (deps.busy.value) return
    const selected = pending.value.filter(item => id === undefined || item.id === id)
    if (!selected.length) return
    deps.busy.value = true; phase.value = 'installing'; notice.value = ''
    progress.done = 0; progress.total = selected.length
    let installed = 0, failed = 0
    try {
      for (const item of selected) {
        item.state = 'installing'; item.error = ''
        try { item.summary = await deps.install(item.path); item.state = 'installed'; installed++ }
        catch (error) { item.state = 'failed'; item.error = deps.errorMessage(error); failed++ }
        progress.done++
      }
      notice.value = `已安装 ${installed} 个工具包${failed ? `，${failed} 个安装失败，可重试` : '。'}`
      if (installed) {
        try { await deps.refresh() }
        catch (error) { notice.value += ` 工具已安装，列表刷新失败：${deps.errorMessage(error)}；可重新进入工具工作台刷新。` }
      }
    } finally { phase.value = 'idle'; deps.busy.value = false }
  }
  function remove(id: number) { if (!deps.busy.value) { items.value = items.value.filter(item => item.id !== id); notice.value = '' } }
  function clear() { if (!deps.busy.value) { items.value = []; notice.value = '' } }
  return { items, phase, notice, progress, pending, add, retryCheck, install, remove, clear }
}
