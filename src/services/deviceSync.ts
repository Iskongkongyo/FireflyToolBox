import { invoke } from '@tauri-apps/api/core'
import { emptyHomeGroupSettings, parseHomeGroupSettings, parseFavoriteGroupSettings, parseWebsiteGroupSettings } from './groupSettings'
import { layoutKeys, preferenceKeys, orderedStrings, validatePreferences, savePreferences } from './preferences'
import { collectLegacyToolStorage, flushToolStorageWrites } from './webToolStorage'
import { INITIALIZATION_BUDGET_KEY, INTERACTION_BUDGET_KEY, readWebToolBudgets } from './webToolBudgets'
import { DEFAULT_WEB_TOOL_FULLSCREEN_KEY, INITIAL_FULLSCREEN_HINT_KEY, readWebToolPresentation } from './webToolPresentation'

export type SyncOptions = { modules: boolean; automations: boolean; builtins: boolean; favorites: boolean; websites: boolean; layout: boolean; preferences: boolean; web_data: boolean }
export type SyncItem = { key: string; kind: keyof SyncOptions; name: string; status: 'new' | 'same' | 'conflict' | 'blocked' | 'merge'; status_label?: string; reason: string; versions?: { local: string | null; incoming: string }; network_hosts: string[] }
export type SyncPreview = { app_version: string; platform: string; options: SyncOptions; items: SyncItem[]; bytes: number; preferences: Record<string, string>; storage_ids: string[]; web_data_count: number }
export type SyncShare = { addresses: string[]; code: string; expires_at: number }
export type SyncStatus = { state: 'waiting' | 'transferring' | 'sent' | 'interrupted' | 'locked' | 'expired' | 'stopped'; attempts_left: number }
export type SyncApplied = { imported: number; skipped: number; id_map: Record<string, string>; website_map: Record<string, string>; preferences: Record<string, string>; warnings: string[]; active_ids: string[]; site_ids: string[]; web_data_imported: number }
export const syncCategories: { key: keyof SyncOptions; name: string; description: string }[] = [
  { key: 'modules', name: '导入/创建的工具', description: '完整工具包及源码，接收时可逐个选择。' },
  { key: 'automations', name: '自动化工具', description: '自动化步骤；请同时选择依赖的工具包。' },
  { key: 'builtins', name: '自带工具的修改', description: '修改过的信息和源码；覆盖已删除的工具会恢复它。' },
  { key: 'favorites', name: '工具收藏', description: '合并收藏，保留接收端原有收藏。' },
  { key: 'websites', name: '网站书签', description: '网站信息与网站收藏，按同步标识或地址去重。' },
  { key: 'layout', name: '分组与排序', description: '使用发送端的分组和顺序，保留本机独有分组。' },
  { key: 'preferences', name: '界面与使用偏好', description: '主题、字号、启动页，以及网页工具的运行预算、默认全屏和退出提示；不含壁纸和电脑专用设置。' },
  { key: 'web_data', name: '网页工具保存的数据', description: '同步持久数据，每个工具最多 1 MiB；可能包含私人内容，仅向可信设备同步。两端需使用 0.1.69 或更新版本。' },
]
export function defaultSyncOptions(): SyncOptions { return { modules: true, automations: true, builtins: false, favorites: false, websites: false, layout: false, preferences: false, web_data: false } }
function enabled(key: string, options: SyncOptions) { return (options.layout && layoutKeys.includes(key)) || (options.preferences && preferenceKeys.includes(key)) }
export const deviceSync = {
  async share(options: SyncOptions, preferences: Record<string, string>, moduleIds?: string[]) {
    let legacyStorage: Record<string,string> = {}
    if(options.web_data) {
      await flushToolStorageWrites('tool.')
      const tools=await invoke<{id:string;ui_kind?:string}[]>('list_tools')
      legacyStorage=collectLegacyToolStorage(tools.filter(tool=>tool.ui_kind==='web').map(tool=>tool.id))
    }
    return invoke<SyncShare>('sync_share',{options,preferences,moduleIds,legacyStorage})
  },
  status: () => invoke<SyncStatus | null>('sync_status'),
  close: () => invoke<void>('sync_close'),
  receive: (endpoint: string, code: string) => invoke<SyncPreview>('sync_receive', { endpoint, code }),
  preview: () => invoke<SyncPreview>('sync_preview'),
  async apply(options: SyncOptions, keys: string[], replace: boolean, storageIds: string[] = []) {
    if(options.web_data)await flushToolStorageWrites('tool.')
    const selected=new Set(keys.filter(key=>key.startsWith('web_data:tool.')).map(key=>key.slice('web_data:tool.'.length)))
    const legacyStorage=options.web_data?collectLegacyToolStorage(storageIds.filter(id=>selected.has(id))):{}
    return invoke<SyncApplied>('sync_apply',{selection:{options,keys,replace},legacyStorage})
  },
}
export function validateSyncPreferences(preferences: Record<string, string>) {
  validatePreferences(preferences)
}
export function collectSyncPreferences(options: SyncOptions): Record<string, string> {
  const data: Record<string, string> = Object.create(null)
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && enabled(key, options)) data[key] = localStorage.getItem(key) ?? ''
  }
  if (options.preferences) {
    // Restoring defaults removes the keys locally; send the effective values so
    // a receiver's previous custom limits are replaced by those defaults too.
    const budgets = readWebToolBudgets()
    data[INITIALIZATION_BUDGET_KEY] = String(budgets.initializationMs)
    data[INTERACTION_BUDGET_KEY] = String(budgets.interactionMs)
    const presentation = readWebToolPresentation()
    data[DEFAULT_WEB_TOOL_FULLSCREEN_KEY] = String(presentation.defaultFullscreen)
    data[INITIAL_FULLSCREEN_HINT_KEY] = String(presentation.initialHint)
  }
  validateSyncPreferences(data)
  return data
}
function localJson(key: string, fallback: unknown) { try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback } catch { return fallback } }
function namedMerge<T extends { id: string }>(old: T[], incoming: T[]): T[] { return [...new Map([...old, ...incoming].map(group => [group.id, group])).values()] }
export function prepareSyncPreferences(result: SyncApplied, _replace: boolean): Record<string, string> {
  validateSyncPreferences(result.preferences)
  const output: Record<string, string> = Object.create(null)
  const active = new Set(result.active_ids), sites = new Set(result.site_ids)
  const toolId = (id: string) => id.startsWith('custom.') ? result.id_map[id] : id
  const remapTools = (ids: string[]) => ids.map(toolId).filter((id): id is string => !!id && active.has(id))
  const remapSites = (ids: string[]) => ids.map(id => result.website_map[id]).filter((id): id is string => !!id && sites.has(id))
  const assignments = (data: Record<string, string>, website: boolean) => Object.fromEntries(Object.entries(data).flatMap(([id, group]) => {
    const mapped = website ? result.website_map[id] : toolId(id)
    return mapped && (website ? sites : active).has(mapped) ? [[mapped, group]] : []
  }))
  for (const [key, value] of Object.entries(result.preferences)) {
    if (key === 'firefly.groups.home.v1') {
      const incoming = parseHomeGroupSettings(JSON.parse(value))
      let old = emptyHomeGroupSettings()
      try { old = parseHomeGroupSettings(localJson(key, old)) } catch { /* Ignore invalid local layout. */ }
      output[key] = JSON.stringify({ names: { ...old.names, ...incoming.names }, custom: namedMerge(old.custom, incoming.custom), deleted: [...new Set([...old.deleted, ...incoming.deleted])], assignments: { ...old.assignments, ...assignments(incoming.assignments, false) }, otherCreated: old.otherCreated || incoming.otherCreated })
    } else if (key === 'firefly.groups.favorites.v1' || key === 'firefly.groups.websites.v1') {
      const parse = key === 'firefly.groups.websites.v1' ? parseWebsiteGroupSettings : parseFavoriteGroupSettings
      const incoming = parse(JSON.parse(value))
      let old = { enabled: false, groups: [] as typeof incoming.groups, assignments: {} }
      try { old = parse(localJson(key, old)) } catch { /* Ignore invalid local layout. */ }
      output[key] = JSON.stringify({ enabled: incoming.enabled, groups: namedMerge(old.groups, incoming.groups), assignments: { ...old.assignments, ...assignments(incoming.assignments, key === 'firefly.groups.websites.v1') } })
    } else if (key === 'firefly.order.homeTools.v1') {
      const data = JSON.parse(value) as Record<string, string[]>
      let old: Record<string, string[]> = {}
      try {
        const saved = localStorage.getItem(key)
        if (saved !== null) { validatePreferences({ [key]: saved }); old = JSON.parse(saved) }
      } catch { /* Ignore invalid local ordering. */ }
      const merged: Record<string, string[]> = Object.create(null)
      for (const [group, ids] of Object.entries(data)) merged[group] = [...new Set([...remapTools(ids), ...(Array.isArray(old[group]) ? old[group]! : [])])]
      output[key] = JSON.stringify({ ...old, ...merged })
    } else if (layoutKeys.includes(key)) {
      const incoming = orderedStrings(JSON.parse(value))
      const ids = key === 'firefly.order.favorites.v1' ? remapTools(incoming) : key === 'firefly.order.websites.v1' ? remapSites(incoming) : incoming
      let old: string[] = []
      try { old = orderedStrings(localJson(key, [])) } catch { /* Ignore invalid local ordering. */ }
      output[key] = JSON.stringify([...new Set([...ids, ...old])])
    } else output[key] = value
  }
  validateSyncPreferences(output)
  return output
}
export function saveSyncPreferences(values: Record<string, string>) {
  savePreferences(values)
}
