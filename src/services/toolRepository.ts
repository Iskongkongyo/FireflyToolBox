import { computed, reactive, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import type { ModuleSummary } from './toolbox'

export type RepositoryRoute = 'auto' | 'github' | 'ghproxy'
export type RepositoryEntry = {
  id: string; path: string; file_name: string; category: string; size: number; sha: string
  title: string; description: string; updated_at: string; metadata_loaded: boolean
  module_id_hint: string | null; version_hint: string | null
}
export type RepositoryCatalog = { repository_url: string; commit: string; fetched_at: number; source: string; entries: RepositoryEntry[]; from_cache: boolean; skipped_entries?: { path: string; reason: string }[] }
export type PreparedRepositoryTool = {
  token: string; entry_id: string; file_name: string; bytes: number; source: string; commit: string; cached: boolean
  summary: ModuleSummary | null; license: string; description: string; platforms: string[]; compatible: boolean; inspection_error: string | null; installed_version: string | null
}
export type RepositoryProgress = { request_id: string; received: number; total: number; source: string }
export const REPOSITORY_ROUTE_KEY = 'firefly.tool-download-route.v1'
export const repositoryRoutes = [
  { value: 'auto', label: '自动（优先加速）' },
  { value: 'ghproxy', label: 'GH-Proxy 免费加速' },
  { value: 'github', label: 'GitHub 官方直连' },
]
export const repositoryClient = {
  catalog: (route: RepositoryRoute, refresh: boolean) => invoke<RepositoryCatalog>('repository_catalog', { route, refresh }),
  describe: (id: string, route: RepositoryRoute) => invoke<RepositoryEntry>('repository_describe', { id, route }),
  prepare: (id: string, route: RepositoryRoute, requestId: string) => invoke<PreparedRepositoryTool>('repository_prepare', { id, route, requestId }),
  cancel: (requestId: string) => invoke<void>('repository_cancel', { requestId }),
  release: (token: string) => invoke<void>('repository_release', { token }),
  install: (token: string, allowNetwork: boolean, expectedVersion: string | null) => invoke<ModuleSummary>('repository_install', { token, allowNetwork, expectedVersion }),
  save: (token: string, path: string) => invoke<void>('repository_save', { token, path }),
  openLink: (url: string) => invoke<void>('open_remote_message_link', { url }),
}
export function repositoryError(error: unknown): string {
  return error instanceof Error ? error.message : error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error)
}
export function repositorySize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KiB` : `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}
export function repositorySource(catalog: RepositoryCatalog | null, entry?: RepositoryEntry) {
  if (!entry || !catalog) return 'https://github.com/Iskongkongyo/FFTools'
  return `${catalog.repository_url}/blob/${catalog.commit}/${entry.path.split('/').map(encodeURIComponent).join('/')}`
}
function initialRoute(): RepositoryRoute {
  try { const value = localStorage.getItem(REPOSITORY_ROUTE_KEY); if (value === 'github' || value === 'ghproxy') return value } catch { /* Session choice remains usable. */ }
  return 'auto'
}
type Dependencies = typeof repositoryClient & {
  listInstalled: () => Promise<ModuleSummary[]>
  refreshTools: () => Promise<void>
  chooseSavePath: (name: string) => Promise<string | null>
  notify: (message: string) => void
}

export function createToolRepository(deps: Dependencies) {
  const route = ref<RepositoryRoute>(initialRoute())
  const catalog = ref<RepositoryCatalog | null>(null), loading = ref(false), error = ref(''), notice = ref('')
  const query = ref(''), category = ref(''), metadataPending = ref(0), metadataFailed = ref(0)
  const installed = ref<ModuleSummary[]>([]), resolved = reactive(new Map<string, string>())
  const phase = ref<'idle' | 'downloading' | 'saving' | 'installing'>('idle')
  const activeEntry = ref<RepositoryEntry | null>(null), prepared = ref<PreparedRepositoryTool | null>(null), reviewOpen = ref(false), allowNetwork = ref(false)
  const progress = reactive<RepositoryProgress>({ request_id: '', received: 0, total: 0, source: '' })
  const busy = computed(() => phase.value !== 'idle')
  const categories = computed(() => [...new Set(catalog.value?.entries.map(item => item.category) || [])].sort())
  const entries = computed(() => {
    const keywords = query.value.normalize('NFKC').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
    return (catalog.value?.entries || []).filter(item => (!category.value || item.category === category.value) && keywords.every(keyword =>
      `${item.title} ${item.description} ${item.path} ${item.module_id_hint || ''} ${item.version_hint || ''}`.normalize('NFKC').toLocaleLowerCase().includes(keyword)))
      .slice().sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'))
  })
  let disposed = false, revision = 0, activeRequest = '', cancelled = false
  function reportNotice(message: string) { if (!disposed) { notice.value = message; deps.notify(message) } }
  function reportError(reason: unknown) { if (!disposed) { error.value = repositoryError(reason); deps.notify(error.value) } }
  function installedFor(item: RepositoryEntry) { const id = resolved.get(item.id) || item.module_id_hint; return installed.value.find(value => value.module_id === id) }
  async function describe(value: RepositoryCatalog, current: number) {
    const pending = value.entries.filter(item => !item.metadata_loaded); metadataPending.value = pending.length; metadataFailed.value = 0
    let next = 0
    await Promise.all(Array.from({ length: Math.min(3, pending.length) }, async () => {
      while (!disposed && current === revision && next < pending.length) {
        const item = pending[next++]!
        try {
          const result = await deps.describe(item.id, route.value)
          if (disposed || current !== revision || !catalog.value) return
          const index = catalog.value.entries.findIndex(entry => entry.id === result.id)
          if (index >= 0) catalog.value.entries[index] = result
        } catch { if (!disposed && current === revision) metadataFailed.value++ }
        finally { if (!disposed && current === revision) metadataPending.value-- }
      }
    }))
  }
  async function load(refresh = false) {
    if (disposed || loading.value) return
    const current = ++revision; loading.value = true; error.value = ''; metadataPending.value = 0
    try {
      const value = await deps.catalog(route.value, refresh)
      if (disposed || current !== revision) return
      catalog.value = value
      if (category.value && !value.entries.some(item => item.category === category.value)) category.value = ''
      void describe(value, current)
      try { const values = await deps.listInstalled(); if (!disposed && current === revision) installed.value = values } catch { /* Downloading remains available. */ }
      if (value.from_cache && Date.now() / 1000 - value.fetched_at > 900) {
        loading.value = false; void load(true)
      }
    } catch (reason) { if (!disposed && current === revision) reportError(reason) }
    finally { if (!disposed && current === revision) loading.value = false }
  }
  function setRoute(value: string) {
    if (busy.value || loading.value || !['auto', 'github', 'ghproxy'].includes(value)) return
    route.value = value as RepositoryRoute
    try { localStorage.setItem(REPOSITORY_ROUTE_KEY, value) } catch { /* Keep route for this session. */ }
    void load(true)
  }
  function onProgress(value: RepositoryProgress) { if (!disposed && activeRequest === value.request_id && !cancelled) Object.assign(progress, value) }
  async function cancel() {
    if (phase.value !== 'downloading' || !activeRequest) return
    cancelled = true
    try { await deps.cancel(activeRequest) } catch { /* A completed request is handled below without showing its dialog. */ }
  }
  async function save() {
    const value = prepared.value
    if (!value || busy.value) return
    phase.value = 'saving'; error.value = ''
    try {
      const path = await deps.chooseSavePath(value.file_name)
      if (disposed) return
      if (!path) { reportNotice('已取消保存。'); return }
      await deps.save(value.token, path)
      reportNotice(value.inspection_error ? '文件已保存；此工具包暂未通过安装检查。' : `已保存 ${value.file_name}。`)
    } catch (reason) { reportError(reason) }
    finally { if (!disposed) phase.value = 'idle' }
  }
  async function start(item: RepositoryEntry, mode: 'install' | 'save') {
    if (disposed || busy.value || loading.value) return
    phase.value = 'downloading'; activeEntry.value = item; cancelled = false; notice.value = ''; error.value = ''; allowNetwork.value = false
    const request = crypto.randomUUID(); activeRequest = request
    Object.assign(progress, { request_id: request, received: 0, total: item.size, source: '' })
    try {
      const value = await deps.prepare(item.id, route.value, request)
      if (disposed || activeRequest !== request || cancelled) { await deps.release(value.token).catch(() => {}); return }
      prepared.value = value
      if (value.summary) resolved.set(item.id, value.summary.module_id)
      phase.value = 'idle'
      if (mode === 'save') await save()
      else { reviewOpen.value = true; if (value.inspection_error) reportError(value.inspection_error) }
    } catch (reason) { if (!cancelled) reportError(reason) }
    finally {
      if (activeRequest === request) activeRequest = ''
      if (!disposed) { if (cancelled) reportNotice('已取消下载。'); phase.value = 'idle' }
    }
  }
  async function install() {
    const value = prepared.value
    if (!value?.summary || !value.compatible || busy.value || (value.summary.network_hosts.length > 0 && !allowNetwork.value)) return
    phase.value = 'installing'; error.value = ''
    try {
      const summary = await deps.install(value.token, allowNetwork.value, value.installed_version)
      if (disposed) return
      installed.value = [...installed.value.filter(item => item.module_id !== summary.module_id), summary]
      reviewOpen.value = false
      let message = `已安装「${summary.name}」。`
      try { await deps.refreshTools() } catch { message += ' 工具列表刷新失败，可重新进入工具管理。' }
      reportNotice(message)
    } catch (reason) { reportError(reason) }
    finally { if (!disposed) phase.value = 'idle' }
  }
  function closeReview() { if (!busy.value) { reviewOpen.value = false; allowNetwork.value = false } }
  function dispose() {
    disposed = true; revision++
    if (activeRequest) void deps.cancel(activeRequest).catch(() => {})
    if (prepared.value) void deps.release(prepared.value.token).catch(() => {})
  }
  return { route, catalog, loading, error, notice, query, category, categories, entries, metadataPending, metadataFailed, installed, installedFor,
    phase, busy, activeEntry, prepared, reviewOpen, allowNetwork, progress, load, setRoute, start, save, install, cancel, closeReview, onProgress, dispose }
}
