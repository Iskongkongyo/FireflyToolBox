// Runs inside an opaque-origin iframe, with explicit host API and layout messages.
const send = (message, transfer = []) => parent.postMessage({ fireflyWebTool: true, ...message }, '*', transfer)
const pendingSaves = new Map()
const pendingOpens = new Map()
const pendingRequests = new Map()
const pendingHashes = new Map()
const pendingCopies = new Map()
const pendingWebsites = new Map()
let started = false
let saveSequence = 0
let runId = ''
let dispose
let runtime
let assets
let tasks
let storage
let http
let layout
let presentation
let disposed = false
const describeError = (error) => error instanceof Error ? error.stack || error.message : String(error)

function fileError(value) {
  if (typeof value === 'string') return new Error(value)
  const error = new Error(value?.message || '文件操作失败。')
  error.code = value?.code || 'FILE_FAILED'
  if (error.code === 'FILE_CANCELED') error.name = 'AbortError'
  return error
}

function requestFile(type, values, signal, onProgress) {
  if (disposed || runtime?.signal.aborted || signal?.aborted) return Promise.reject(fileError({ code: 'FILE_CANCELED', message: '文件操作已取消。' }))
  if (signal && !(signal instanceof AbortSignal)) return Promise.reject(new TypeError('signal 必须是 AbortSignal。'))
  const requestId = String(++saveSequence)
  const pending = type === 'open' ? pendingOpens : type === 'hash' ? pendingHashes : pendingSaves
  return new Promise((resolve, reject) => {
    const cleanup = () => { signal?.removeEventListener('abort', cancel); runtime?.signal.removeEventListener('abort', cancel) }
    const cancel = () => {
      if (!pending.delete(requestId)) return
      cleanup()
      send({ type: 'cancelFile', id: runId, requestId })
      reject(fileError({ code: 'FILE_CANCELED', message: '文件操作已取消。' }))
    }
    pending.set(requestId, {
      onProgress,
      resolve(value) { cleanup(); resolve(value) },
      reject(error) { cleanup(); reject(error) },
    })
    signal?.addEventListener('abort', cancel, { once: true })
    runtime?.signal.addEventListener('abort', cancel, { once: true })
    send({ type, id: runId, requestId, ...values })
  })
}

function saveFile(name, blob, options = {}) {
  if (typeof name !== 'string' || !(blob instanceof Blob)) {
    return Promise.reject(new TypeError('saveFile 需要文件名和 Blob。'))
  }
  return requestFile('save', { name, blob }, options?.signal)
}

function openFile(options = {}) {
  const extensions = options?.extensions ?? []
  if (!Array.isArray(extensions) || extensions.length > 12
    || !extensions.every((value) => typeof value === 'string' && /^[a-z0-9]{1,10}$/.test(value))) {
    return Promise.reject(new TypeError('openFile 的 extensions 必须是文件扩展名数组。'))
  }
  return requestFile('open', { extensions }, options?.signal)
}

function request(url, options = {}) {
  return http.request(url, options)
}
function inspectCertificate(url, options = {}) { return networkRequest('certificate', url, options) }
function resolveLink(url, options = {}) { return networkRequest('resolve',url,options) }
function networkRequest(type, url, options = {}) {
  if (!options || typeof options !== 'object' || Object.keys(options).some(key => key !== 'signal')) return Promise.reject(new TypeError('证书与短链解析接口仅支持 signal 选项。'))
  if (disposed || runtime?.signal.aborted || options.signal?.aborted) return Promise.reject(new DOMException('请求已取消。', 'AbortError'))
  if (options.signal && !(options.signal instanceof AbortSignal)) return Promise.reject(new TypeError('signal 必须是 AbortSignal。'))
  const requestId = 'http-' + String(++saveSequence)
  return new Promise((resolve, reject) => {
    const cleanup = () => { options.signal?.removeEventListener('abort', cancel); runtime?.signal.removeEventListener('abort', cancel) }
    const cancel = () => {
      if (!pendingRequests.delete(requestId)) return
      cleanup(); send({ type: 'cancelHttp', id: runId, requestId })
      reject(new DOMException('请求已取消。', 'AbortError'))
    }
    pendingRequests.set(requestId, { resolve(value) { cleanup(); resolve(value) }, reject(error) { cleanup(); reject(error) } })
    options.signal?.addEventListener('abort', cancel, { once: true })
    runtime?.signal.addEventListener('abort', cancel, { once: true })
    send({ type, id: runId, requestId, url: String(url) })
  })
}

function hashFile(options = {}) {
  if (!['md5', 'sha1', 'sha256', 'sha384', 'sha512'].includes(options.algorithm ?? 'sha256')) return Promise.reject(new TypeError('不支持此哈希算法。'))
  return requestFile('hash', { algorithm: options.algorithm ?? 'sha256' }, options.signal, options.onProgress)
}
function copyText(text) {
  if (disposed || runtime?.signal.aborted) return Promise.reject(new DOMException('工具已停止。', 'AbortError'))
  if (typeof text !== 'string') return Promise.reject(new TypeError('复制内容必须是文本。'))
  const requestId = 'copy-' + String(++saveSequence)
  return new Promise((resolve, reject) => { pendingCopies.set(requestId, { resolve, reject }); send({ type: 'copyText', id: runId, requestId, text }) })
}
function openWebsite(url, options = {}) {
  if (disposed || runtime?.signal.aborted) return Promise.reject(new DOMException('工具已停止。','AbortError'))
  if (!navigator.userActivation?.isActive) return Promise.reject(new Error('请点击按钮后打开网页。'))
  if (typeof url !== 'string' || url.length > 4096 || !options || typeof options !== 'object') return Promise.reject(new TypeError('网页地址或选项无效。'))
  if (options.external !== undefined && typeof options.external !== 'boolean') return Promise.reject(new TypeError('外部浏览器选项无效。'))
  if (pendingWebsites.size) return Promise.reject(new Error('正在打开网页，请稍候。'))
  const requestId = 'website-' + String(++saveSequence)
  return new Promise((resolve,reject)=>{pendingWebsites.set(requestId,{resolve,reject});send({type:'openWebsite',id:runId,requestId,url,title:options.title,external:options.external===true})})
}
function stopRuntime() {
  if (disposed) return
  disposed = true
  try { dispose?.() } catch { /* The host is already stopping this page. */ }
  finally {
    dispose = undefined
    layout?.dispose()
    layout = undefined
    presentation?.dispose()
    presentation = undefined
  runtime?.dispose()
  assets?.dispose()
    for (const pending of [...pendingOpens.values(), ...pendingSaves.values(), ...pendingHashes.values()]) pending.reject(fileError({ code: 'FILE_CANCELED', message: '网页工具已停止，文件操作已取消。' }))
    pendingOpens.clear(); pendingSaves.clear(); pendingHashes.clear()
    for (const pending of pendingCopies.values()) pending.reject(new DOMException('工具已停止。', 'AbortError'))
    pendingCopies.clear()
    for (const pending of pendingWebsites.values()) pending.reject(new DOMException('工具已停止。','AbortError'))
    pendingWebsites.clear()
    for (const pending of pendingRequests.values()) pending.reject(new DOMException('网页工具已停止。', 'AbortError'))
    pendingRequests.clear()
  }
}

window.addEventListener('message', async (event) => {
  if (event.source !== parent || !event.data || typeof event.data !== 'object') return
  const data = event.data
  if (data.type === 'viewport' && data.id === runId) { layout?.setViewportHeight(data.height); return }
  if (data.type === 'presentationState' && data.id === runId) { presentation?.setFullscreen(data.fullscreen); return }
  if (data.type === 'dispose' && data.id === runId) { stopRuntime(); return }
  if (data.type === 'hashProgress' && data.id === runId) { try { pendingHashes.get(data.requestId)?.onProgress?.(data.progress) } catch {} return }
  if (data.type === 'websiteResult' && data.id === runId) {
    const pending = pendingWebsites.get(data.requestId)
    if (!pending) return
    pendingWebsites.delete(data.requestId)
    if (data.error) pending.reject(fileError(data.error))
    else pending.resolve(true)
    return
  }
  if ((data.type === 'hashResult' || data.type === 'copyResult') && data.id === runId) {
    const map = data.type === 'hashResult' ? pendingHashes : pendingCopies
    const pending = map.get(data.requestId)
    if (!pending) return
    map.delete(data.requestId)
    if (data.error) pending.reject(fileError(data.error))
    else pending.resolve(data.type === 'hashResult' ? data.result : true)
    return
  }
  if ((data.type === 'httpResult' || data.type === 'certificateResult' || data.type === 'resolveResult') && data.id === runId) {
    const pending = pendingRequests.get(data.requestId)
    if (!pending) return
    pendingRequests.delete(data.requestId)
    if (data.error) { pending.reject(Object.assign(new Error(data.error.message || '接口请求失败。'), { code: data.error.code || 'HTTP_FAILED' })); return }
    if (data.type === 'certificateResult' || data.type==='resolveResult') { pending.resolve(data.response); return }
    try {
      const value = data.response
      const bytes = Uint8Array.from(atob(value.body_base64), character => character.charCodeAt(0))
      const response = new Response([204, 205, 304].includes(value.status) ? null : bytes, { status: value.status, headers: { 'Content-Type': value.content_type } })
      Object.defineProperty(response, 'url', { value: value.url })
      pending.resolve(response)
    } catch (error) { pending.reject(error) }
    return
  }
  if (data.type === 'saveResult' && data.id === runId) {
    const pending = pendingSaves.get(data.requestId)
    if (!pending) return
    pendingSaves.delete(data.requestId)
    if (data.error) pending.reject(fileError(data.error))
    else pending.resolve(data.saved === true)
    return
  }
  if (data.type === 'openResult' && data.id === runId) {
    const pending = pendingOpens.get(data.requestId)
    if (!pending) return
    pendingOpens.delete(data.requestId)
    if (data.error) pending.reject(fileError(data.error))
    else if (data.file === null) pending.resolve(null)
    else if (data.file && typeof data.file.name === 'string' && data.file.blob instanceof Blob) {
      pending.resolve({ name: data.file.name, blob: data.file.blob })
    } else pending.reject(new Error('宿主返回的文件无效。'))
    return
  }
  if (started || data.type !== 'mount' || typeof data.id !== 'string') return
  started = true
  runId = data.id
  try {
    runtime = window.FireflyWebToolRuntime(data.hook, runId, send, data.scriptBudgets)
    http = window.FireflyWebToolHttp(runId, send, runtime.signal)
    assets = window.FireflyWebToolAssets(runId,send,runtime.signal,data.resources ?? [],data.filesAvailable,runtime.createWorker)
    tasks = window.FireflyWebToolTasks(runId,send,runtime.signal,assets.resources,runtime)
    storage = window.FireflyToolStorage(data.storage ?? {}, runId, send, runtime.signal)
    if (typeof data.html !== 'string' || typeof data.css !== 'string' || typeof data.script !== 'string') {
      throw new Error('网页工具资源不完整。')
    }
    const parsed = new DOMParser().parseFromString(await assets.replaceResources(data.html), 'text/html')
    document.body.replaceChildren(...[...parsed.body.childNodes].map((node) => document.importNode(node, true)))
    document.documentElement.dataset.theme = data.theme === 'dark' ? 'dark' : 'light'
    if (typeof data.accent === 'string' && data.accent.length < 128) document.documentElement.style.setProperty('--accent', data.accent)
    const style = document.createElement('style')
    style.textContent = await assets.replaceResources(data.css)
    document.head.append(style)
    layout = window.FireflyWebToolLayout(runId, send, data.viewportHeight, data.font, data.textColor)
    presentation = window.FireflyWebToolPresentation(runId, send)
    const scriptName = typeof data.scriptName === 'string' && /^[a-zA-Z0-9_./-]+$/.test(data.scriptName) ? data.scriptName : 'main.js'
    const scriptUrl = URL.createObjectURL(new Blob([data.script, `\n//# sourceURL=${scriptName}`], { type: 'text/javascript' }))
    try {
      const module = await import(scriptUrl)
      if (typeof module.mount !== 'function') throw new Error('网页工具必须导出 mount 函数。')
      const cleanup = await module.mount({ openFile, saveFile, request, inspectCertificate, hashFile, copyText, openWebsite, resolveLink, resources: assets.resources, files: assets.files, tasks, storage, signal: runtime.signal })
      if (disposed || runtime.signal.aborted) {
        if (typeof cleanup === 'function') cleanup()
        return
      }
      if (typeof cleanup === 'function') dispose = cleanup
      runtime.finishMount()
      send({ type: 'mounted', id: runId })
    } finally {
      URL.revokeObjectURL(scriptUrl)
    }
  } catch (error) {
    send({ type: 'error', id: runId, error: describeError(error) })
  }
})

window.addEventListener('error', (event) => {
  if (event.error?.code === 'SCRIPT_TIME_LIMIT' || event.error?.code === 'TOOL_STOPPED') { event.preventDefault(); return }
  if (runId) send({ type: 'error', id: runId, error: event.error ? describeError(event.error) : `${event.message || '网页工具发生错误。'} (${event.filename}:${event.lineno}:${event.colno})` })
})
window.addEventListener('unhandledrejection', (event) => {
  if (event.reason?.name === 'AbortError' || event.reason?.code === 'FILE_CANCELED') { event.preventDefault(); return }
  if (event.reason?.code === 'SCRIPT_TIME_LIMIT' || event.reason?.code === 'TOOL_STOPPED') { event.preventDefault(); return }
  if (runId) send({ type: 'error', id: runId, error: describeError(event.reason) })
})

window.addEventListener('pagehide', stopRuntime)
window.addEventListener('unload', stopRuntime)

send({ type: 'ready' })
