const DB_NAME = 'firefly-wallpaper-v1'
const STORE_NAME = 'images'
const WALLPAPER_KEY = 'current'
const STARTUP_KEY = 'startup'
const SIDEBAR_KEY = 'sidebar'
const STORAGE_TIMEOUT_MS = 5000

export const STARTUP_ENABLED_KEY = 'firefly.startup-splash-enabled.v1'
export const SIDEBAR_ENABLED_KEY = 'firefly.sidebar-image-enabled.v1'
export const SIDEBAR_IMAGE_RATIO = 28 / 17
export const SIDEBAR_IMAGE_MAX_WIDTH = 896

export function startupSplashEnabled(): boolean {
  try { return localStorage.getItem(STARTUP_ENABLED_KEY) !== 'false' } catch { return true }
}

export function sidebarArtworkEnabled(): boolean {
  try { return localStorage.getItem(SIDEBAR_ENABLED_KEY) !== 'false' } catch { return true }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    let settled = false
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    }
    const timer = setTimeout(() => fail(new Error('图片存储响应超时，请稍后重试')), STORAGE_TIMEOUT_MS)
    request.onupgradeneeded = () => {
      if (settled) { request.transaction?.abort(); return }
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => {
      if (settled) { request.result.close(); return }
      settled = true
      clearTimeout(timer)
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
    request.onblocked = () => fail(new Error('图片存储被其他窗口占用，请关闭后重试'))
    request.onerror = () => fail(request.error ?? new Error('无法打开图片存储'))
  })
}

function transactionResult<T>(transaction: IDBTransaction, result: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { transaction.abort() } catch { /* The transaction may already have ended. */ }
      reject(new Error('图片存储响应超时，请稍后重试'))
    }, STORAGE_TIMEOUT_MS)
    transaction.oncomplete = () => { clearTimeout(timer); resolve(result()) }
    transaction.onerror = transaction.onabort = () => {
      clearTimeout(timer)
      reject(transaction.error ?? new Error('无法读取或保存图片'))
    }
  })
}

async function readImage(key: string): Promise<Blob | null> {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).get(key)
    return await transactionResult(transaction, () => request.result instanceof Blob ? request.result : null)
  } finally {
    database.close()
  }
}

async function saveImage(key: string, blob: Blob | null): Promise<void> {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const images = transaction.objectStore(STORE_NAME)
    if (blob) images.put(blob, key)
    else images.delete(key)
    await transactionResult(transaction, () => undefined)
  } finally {
    database.close()
  }
}

export const readWallpaper = () => readImage(WALLPAPER_KEY)
export const saveWallpaper = (blob: Blob) => saveImage(WALLPAPER_KEY, blob)
export const readStartupImage = () => readImage(STARTUP_KEY)
export const saveStartupImage = (blob: Blob) => saveImage(STARTUP_KEY, blob)
export const removeStartupImage = () => saveImage(STARTUP_KEY, null)
export const readSidebarImage = () => readImage(SIDEBAR_KEY)
export const saveSidebarImage = (blob: Blob) => saveImage(SIDEBAR_KEY, blob)
export const removeSidebarImage = () => saveImage(SIDEBAR_KEY, null)
