import { invoke, isTauri } from '@tauri-apps/api/core'

export const TOOL_STORAGE_BYTES = 1024 * 1024
type Values = Record<string, string>
type Backend = { read: (id: string) => Promise<string | null>; load: (id: string, legacy: string) => Promise<string>; save: (id: string, json: string) => Promise<void>; clearPreview: () => Promise<number> }
const pending = new Map<string, { json: string; dirty: boolean; job?: Promise<void> }>()
let database: Promise<IDBDatabase> | undefined
function db() {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('firefly-tool-storage', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('modules')
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = undefined }; resolve(request.result) }
    request.onerror = () => { database = undefined; reject(request.error ?? new Error('工具数据库不可用。')) }
    request.onblocked = () => { database = undefined; reject(new Error('请关闭其他旧页面后重试工具存储。')) }
  })
}
async function transaction<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
  const connection = await db()
  return new Promise<T>((resolve, reject) => {
    const tx = connection.transaction('modules', mode)
    let value: T
    tx.oncomplete = () => resolve(value)
    tx.onerror = () => reject(tx.error ?? new Error('工具数据保存失败。'))
    tx.onabort = () => reject(tx.error ?? new Error('工具数据事务已取消。'))
    try { work(tx.objectStore('modules'), result => { value = result }) } catch (error) { tx.abort(); reject(error) }
  })
}
const browser: Backend = {
  read: id => transaction<string | null>('readonly', (store, result) => {
    const request = store.get(id)
    request.onsuccess = () => {
      if (request.result !== undefined && typeof request.result !== 'string') { store.transaction.abort(); return }
      result(request.result ?? null)
    }
  }),
  load: (id, legacy) => transaction<string>('readwrite', (store, result) => {
    const request = store.get(id)
    request.onsuccess = () => { if (request.result !== undefined && typeof request.result !== 'string') { store.transaction.abort(); return }; const json = request.result ?? legacy; if (request.result === undefined) store.put(legacy, id); result(json) }
  }),
  save: (id, json) => transaction<void>('readwrite', store => { store.put(json, id) }),
  clearPreview: () => transaction<number>('readwrite', (store, result) => {
    let count = 0
    const request = store.openCursor()
    request.onsuccess = () => { const cursor = request.result; if (!cursor) { result(count); return }; if (String(cursor.key).startsWith('preview.')) { cursor.delete(); count++ }; cursor.continue() }
  }),
}
const native: Backend = {
  read: moduleId => invoke<string | null>('load_tool_storage', { moduleId, legacyJson: '{}', readOnly: true }),
  load: (moduleId, legacyJson) => invoke<string>('load_tool_storage', { moduleId, legacyJson }),
  save: (moduleId, valuesJson) => invoke<void>('save_tool_storage', { moduleId, valuesJson }),
  clearPreview: () => invoke<number>('clear_preview_tool_storage'),
}
function jsonValues(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('工具存储须为字符串键值。')
  for (const [key, item] of Object.entries(value)) if (key.length > 256 || typeof item !== 'string') throw new TypeError('工具存储键或值无效。')
  const json = JSON.stringify(value)
  if (new TextEncoder().encode(json).byteLength > TOOL_STORAGE_BYTES) throw new DOMException('工具存储已达到 1 MiB 上限。', 'QuotaExceededError')
  return json
}
function legacyValues(id: string): Values {
  const values: Values = Object.create(null), prefix = `firefly.browser-module.${id}.`
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index)
    if (key?.startsWith(prefix)) values[key.slice(prefix.length)] = localStorage.getItem(key) ?? ''
  }
  return values
}
function clearLegacy(id: string, copied: Values, stored: Values) {
  const prefix = `firefly.browser-module.${id}.`
  for (const [key, value] of Object.entries(copied)) {
    if (Object.prototype.hasOwnProperty.call(stored, key) && stored[key] === value && localStorage.getItem(prefix + key) === value) localStorage.removeItem(prefix + key)
  }
}
function save(backend: Backend, id: string, json?: string): Promise<void> {
  let state = pending.get(id)
  if (!state) { if (json === undefined) return Promise.resolve(); state = { json, dirty: true }; pending.set(id, state) }
  if (json !== undefined) { state.json = json; state.dirty = true }
  if (state.job) return state.job
  const current = state
  const job = Promise.resolve().then(async () => {
    try {
      while (current.dirty) { current.dirty = false; await backend.save(id, current.json) }
      if (pending.get(id) === current) pending.delete(id)
    } catch (error) { current.dirty = true; throw error }
    finally { current.job = undefined }
  })
  current.job = job
  return job
}
export async function flushToolStorageWrites(prefix = ''): Promise<void> {
  const backend = isTauri() ? native : browser
  await Promise.all([...pending.keys()].filter(id=>id.startsWith(prefix)).map(id => save(backend, id)))
}
export function collectLegacyToolStorage(toolIds: string[]): Record<string, string> {
  const prefixes = [...new Set(toolIds)].sort((a,b) => b.length-a.length).map(id => ({id:`tool.${id}`, prefix:`firefly.browser-module.tool.${id}.`}))
  const snapshots = new Map<string, Values>()
  for (let index=0;index<localStorage.length;index++) {
    const key=localStorage.key(index)
    if (!key) continue
    const scope=prefixes.find(item=>key.startsWith(item.prefix))
    if (!scope) continue
    const value=localStorage.getItem(key)
    if (value===null) continue
    const values=snapshots.get(scope.id) ?? Object.create(null) as Values
    values[key.slice(scope.prefix.length)]=value; snapshots.set(scope.id,values)
  }
  let bytes=0
  return Object.fromEntries([...snapshots].map(([id,values])=>{
    const json=jsonValues(values);bytes+=new TextEncoder().encode(json).byteLength
    if(bytes>128*1024*1024)throw new Error('网页保存数据超过 128 MiB 同步额度，请分批同步。')
    return[id,json]
  }))
}
export async function openToolStorage(id: string) {
  const backend = isTauri() ? native : browser
  await save(backend, id)
  const committed = await backend.read(id)
  let legacy: Values = Object.create(null)
  try { legacy = legacyValues(id) } catch (error) { if (committed === null) throw error }
  const json = committed ?? await backend.load(id, jsonValues(legacy))
  if (typeof json !== 'string') throw new Error('宿主未返回有效的工具存储。')
  const initial = JSON.parse(json) as Values
  jsonValues(initial)
  // Only remove the old copy after the authoritative database load commits.
  try { clearLegacy(id, legacy, initial) } catch { /* A read-only old copy must not block the migrated tool. */ }
  return {
    read: () => initial,
    update: (data: Record<string, unknown>) => save(backend, id, jsonValues(data.values)),
  }
}
export async function clearToolPreviewStorage(): Promise<number> {
  await Promise.all([...pending].filter(([id]) => id.startsWith('preview.')).map(([id]) => save(isTauri() ? native : browser, id)))
  const count = await (isTauri() ? native : browser).clearPreview()
  const ids = new Set<string>()
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index)
    if (key?.startsWith('firefly.browser-module.preview.')) ids.add(key)
  }
  for (const key of ids) localStorage.removeItem(key)
  return count + ids.size
}
