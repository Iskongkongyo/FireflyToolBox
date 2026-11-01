// Shared by text-compatible and page tools inside their opaque-origin iframe.
window.FireflyToolStorage = (initial, id, send, signal) => {
  const pending = new Map()
  let sequence = 0, version = 0, failed = 0, dirty = false, scheduled = false, stopped = false, last = Promise.resolve()
  const persistentValues = new Map(Object.entries(initial))
  const inactive = () => { if (stopped || signal?.aborted) throw new DOMException('工具已停止。', 'AbortError') }
  function persist() {
    if (!dirty || stopped) return last
    dirty = false
    const requestId = `storage-${++sequence}`, snapshotVersion = version
    last = new Promise((resolve, reject) => {
      pending.set(requestId, { resolve, reject, version: snapshotVersion })
      send({ type: 'storage', id, requestId, values: Object.fromEntries(persistentValues) })
    })
    void last.catch(() => {})
    return last
  }
  function changed() {
    version++; dirty = true
    if (scheduled) return
    scheduled = true
    void Promise.resolve().then(() => { scheduled = false; return persist() }).catch(() => {})
  }
  const onMessage = event => {
    if (event.source !== parent || event.data?.id !== id || event.data.type !== 'storageResult') return
    const item = pending.get(event.data.requestId)
    if (!item) return
    pending.delete(event.data.requestId)
    if (event.data.error) {
      failed = Math.max(failed, item.version)
      const error = Object.assign(new Error(event.data.error.message || '工具数据保存失败。'), { code: 'STORAGE_WRITE_FAILED' })
      item.reject(error)
      send({ type: 'error', id, code: 'STORAGE_WRITE_FAILED', error: '工具数据尚未保存：' + error.message })
    } else {
      if (failed && item.version >= failed) { failed = 0; send({ type: 'storageRecovered', id }) }
      item.resolve()
    }
  }
  window.addEventListener('message', onMessage)
  signal?.addEventListener('abort', () => {
    stopped = true; window.removeEventListener('message', onMessage)
    for (const item of pending.values()) item.reject(new DOMException('工具已停止。', 'AbortError'))
    pending.clear()
  }, { once: true })
  function createStorage(initialValues, persistent) {
    const values = persistent ? persistentValues : new Map(Object.entries(initialValues))
    const api = {
      get length() { return values.size },
      key(index) { return [...values.keys()][index] ?? null },
      getItem(key) { return values.get(String(key)) ?? null },
      setItem(key, value) {
        inactive()
        key = String(key); value = String(value)
        const next = new Map(values); next.set(key, value)
        if (key.length > 256 || new TextEncoder().encode(JSON.stringify(Object.fromEntries(next))).byteLength > 1048576) {
          throw new DOMException('工具存储已达到 1 MiB 上限。', 'QuotaExceededError')
        }
        values.set(key, value)
        if (persistent) changed()
      },
      removeItem(key) { inactive(); key = String(key); values.delete(key); if (persistent) changed() },
      clear() { inactive(); values.clear(); if (persistent) changed() },
    }
    return new Proxy(api, {
      get(target, key) { return key in target ? Reflect.get(target, key) : target.getItem(key) ?? undefined },
      set(target, key, value) { target.setItem(key, value); return true },
      deleteProperty(target, key) { target.removeItem(key); return true },
      ownKeys(target) { return [...new Set([...values.keys(), ...Reflect.ownKeys(target)])] },
      getOwnPropertyDescriptor(target, key) {
        return values.has(key) ? { value: values.get(key), writable: true, enumerable: true, configurable: true }
          : Reflect.getOwnPropertyDescriptor(target, key)
      },
    })
  }
  Object.defineProperty(window, 'localStorage', { configurable: true, value: createStorage(initial, true) })
  Object.defineProperty(window, 'sessionStorage', { configurable: true, value: createStorage({}, false) })
  return Object.freeze({ flush() { inactive(); if (failed) dirty = true; return persist() } })
}
