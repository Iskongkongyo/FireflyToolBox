// Installed before the tool module, inside the same opaque-origin sandbox.
window.FireflyWebToolRuntime = (hook, id, send, budgets) => {
  const initializationMs = budgets?.initializationMs
  const interactionMs = budgets?.interactionMs
  if (![initializationMs, interactionMs].every(value => Number.isSafeInteger(value) && value >= 0)) {
    throw new TypeError('网页工具运行预算无效。')
  }
  const now = performance.now.bind(performance)
  const NativeWorker = window.Worker
  const nativeTerminate = NativeWorker?.prototype.terminate
  const nativeFetch = window.fetch.bind(window)
  const nativeSetTimeout = window.setTimeout.bind(window)
  const nativeClearTimeout = window.clearTimeout.bind(window)
  const controller = new AbortController()
  const workers = new Set()
  const workerQueue = []
  let workerLimit = 4, constructing = 0
  const fetchControllers = new Set()
  let stopped = false
  let disposing = false
  let checks = 0
  let initializing = true
  let turnStartedAt = null
  let resetTimer
  const resetTurn = () => {
    nativeClearTimeout(resetTimer)
    turnStartedAt = null
    checks = 0
    resetTimer = undefined
  }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', resetTurn)
  window.addEventListener?.('pageshow', resetTurn)
  const failure = (code, message) => Object.assign(new Error(message), { name: 'WebToolRuntimeError', code })
  const abortedWorker = () => Object.assign(new Error('Worker 创建已取消。'), { name: 'AbortError', code: 'FILE_CANCELED' })
  function pumpWorkers() {
    if (stopped || disposing) return
    while (workerQueue.length && workers.size + constructing < workerLimit) {
      const item = workerQueue.shift()
      item.cleanup()
      if (item.signal?.aborted) { item.reject(abortedWorker()); continue }
      try {
        const worker = new window.Worker(item.url, item.options)
        if (item.signal?.aborted || controller.signal.aborted) { terminateWorker(worker); item.reject(abortedWorker()) }
        else item.resolve(worker)
      } catch (error) { item.reject(error) }
    }
  }
  function terminateWorker(worker) {
    if (!workers.delete(worker)) return
    nativeTerminate.call(worker)
    pumpWorkers()
  }
  const dispose = () => {
    if (stopped || disposing) return
    disposing = true
    nativeClearTimeout(resetTimer)
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', resetTurn)
    window.removeEventListener?.('pageshow', resetTurn)
    window.removeEventListener?.('pagehide', dispose)
    window.removeEventListener?.('unload', dispose)
    controller.abort()
    for (const item of workerQueue.splice(0)) { item.cleanup(); item.reject(abortedWorker()) }
    for (const worker of workers) nativeTerminate.call(worker)
    workers.clear()
    for (const request of fetchControllers) request.abort()
    fetchControllers.clear()
    stopped = true
  }
  window.addEventListener?.('pagehide', dispose, { once: true })
  window.addEventListener?.('unload', dispose, { once: true })
  const checkBudget = () => {
    const budgetMs = initializing ? initializationMs : interactionMs
    if (budgetMs !== 0 && turnStartedAt !== null && now() - turnStartedAt > budgetMs) {
      const phase = initializing ? '初始化' : '交互处理'
      const error = failure('SCRIPT_TIME_LIMIT', `网页脚本在${phase}阶段持续占用界面超过 ${budgetMs / 1000} 秒，已停止。较长计算请使用 Web Worker。`)
      send({ type: 'fatal', id, code: error.code, error: error.message })
      dispose()
      throw error
    }
  }
  Object.defineProperty(globalThis, hook, { value: () => {
    if (stopped) throw failure('TOOL_STOPPED', '网页工具已停止。')
    if (turnStartedAt === null) {
      turnStartedAt = now()
      resetTimer = nativeSetTimeout(resetTurn, 0)
    }
    if ((checks++ & 255) === 0) checkBudget()
  }, configurable: false, writable: false })
  if (NativeWorker) Object.defineProperty(window, 'Worker', { value: class extends NativeWorker {
    constructor(url, options) {
      if (stopped || disposing) throw failure('TOOL_STOPPED', '网页工具已停止。')
      if (workers.size + constructing >= workerLimit) throw failure('WORKER_LIMIT', `每个网页工具当前最多同时创建 ${workerLimit} 个 Worker，可通过 tasks.configure 调整至 8 个。`)
      constructing++
      try { super(url, options) } finally { constructing--; Promise.resolve().then(pumpWorkers) }
      if (stopped || disposing) { nativeTerminate.call(this); throw failure('TOOL_STOPPED', '网页工具已停止。') }
      workers.add(this)
    }
    terminate() { terminateWorker(this) }
  }, configurable: false, writable: false })
  if ('SharedWorker' in window) Object.defineProperty(window, 'SharedWorker', {
    value: class { constructor() { throw failure('WORKER_UNSUPPORTED', '网页工具暂不支持 SharedWorker，请使用 Worker。') } },
    configurable: false, writable: false,
  })
  Object.defineProperty(window, 'fetch', { value: (input, options = {}) => {
    if (stopped || disposing) return Promise.reject(failure('TOOL_STOPPED', '网页工具已停止。'))
    const request = new AbortController()
    fetchControllers.add(request)
    const signal = options.signal ?? (input instanceof Request ? input.signal : null)
    const abort = () => request.abort()
    if (signal?.aborted || controller.signal.aborted) abort()
    signal?.addEventListener('abort', abort, { once: true })
    controller.signal.addEventListener('abort', () => {
      abort(); signal?.removeEventListener('abort', abort)
    }, { once: true })
    return nativeFetch(input, { ...options, signal: request.signal }).catch(error => {
      fetchControllers.delete(request)
      signal?.removeEventListener('abort', abort)
      throw error
    })
  }, configurable: false, writable: false })
  return Object.freeze({ signal: controller.signal, dispose, terminateWorker,
    configureWorkers(limit) {
      if (stopped || disposing) throw failure('TOOL_STOPPED', '网页工具已停止。')
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 8) throw new RangeError('Worker 上限须在 1 至 8 之间。')
      if (limit < workers.size + constructing) throw failure('WORKER_LIMIT', '请先释放正在运行的 Worker，再降低上限。')
      workerLimit = limit; pumpWorkers(); return workerLimit
    },
    createWorker(url, options = {}, signal) {
      if (stopped || disposing || signal?.aborted) return Promise.reject(abortedWorker())
      if (!NativeWorker) return Promise.reject(failure('WORKER_UNSUPPORTED', '当前环境不支持 Worker。'))
      if (signal && !(signal instanceof controller.signal.constructor)) return Promise.reject(new TypeError('signal 必须是 AbortSignal。'))
      if (workerQueue.length >= 128) return Promise.reject(failure('WORKER_LIMIT', '等待创建的 Worker 最多 128 个。'))
      return new Promise((resolve, reject) => {
        const abort = () => { const index = workerQueue.indexOf(item); if (index < 0) return; workerQueue.splice(index, 1); item.cleanup(); reject(abortedWorker()) }
        const item = { url, options, signal, resolve, reject, cleanup() { signal?.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', abort) } }
        signal?.addEventListener('abort', abort, { once: true })
        controller.signal.addEventListener('abort', abort, { once: true })
        workerQueue.push(item); pumpWorkers()
      })
    },
    finishMount() {
      if (stopped || disposing || !initializing) return
      checkBudget()
      initializing = false
      resetTurn()
    },
  })
}
