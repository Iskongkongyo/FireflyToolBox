// Queued jobs and Worker slots are bounded independently of page mount.
window.FireflyWebToolTasks = (id, send, signal, resources, runtime) => {
  const jobs = new Set(), queue = []
  let sequence = 0, running = 0, concurrency = 4, workerLimit = 4
  const aborted = () => new DOMException('任务已取消。', 'AbortError')
  const terminate = worker => { if (runtime?.terminateWorker) runtime.terminateWorker(worker); else worker.terminate() }
  const notify = (job, state, progress = 0) => send({ type: 'taskProgress', id, taskId: job.id, label: job.label, state, progress })
  const detach = job => { job.external?.removeEventListener('abort', job.cancel); job.controller.signal.removeEventListener('abort', job.onAbort) }
  function cancelAll() { for (const job of [...jobs]) job.cancel() }
  signal.addEventListener('abort', cancelAll, { once: true })
  const onMessage = event => { if (event.source === parent && event.data?.id === id && event.data.type === 'cancelTasks') cancelAll() }
  window.addEventListener('message', onMessage)
  signal.addEventListener('abort', () => window.removeEventListener('message', onMessage), { once: true })
  function pump() {
    if (signal.aborted) return
    while (running < concurrency && queue.length) {
      const job = queue.shift()
      job.started = true; running++; notify(job, 'running')
      void execute(job).then(job.resolve, job.reject)
    }
  }
  async function execute(job) {
    const workers = new Set()
    const workerController = new AbortController()
    const releaseWorkers = () => { workerController.abort(); for (const worker of workers) terminate(worker); workers.clear() }
    let rejectStopped
    const stopped = new Promise((_, reject) => { rejectStopped = reject })
    job.stop = () => { releaseWorkers(); rejectStopped(aborted()) }
    if (job.controller.signal.aborted) job.stop()
    const timer = setTimeout(job.cancel, job.timeoutMs)
    try {
      return await Promise.race([stopped, Promise.resolve().then(() => {
        if (job.controller.signal.aborted) throw aborted()
        return job.work({
          signal: job.controller.signal,
          report(progress) { if (!workerController.signal.aborted && !job.controller.signal.aborted) notify(job, 'running', progress) },
          async worker(path, options = {}) {
            if (workerController.signal.aborted) throw aborted()
            const worker = await resources.worker(path, { ...options, signal: workerController.signal })
            if (workerController.signal.aborted) { terminate(worker); throw aborted() }
            workers.add(worker); return worker
          },
        })
      })])
    } finally {
      clearTimeout(timer); detach(job)
      releaseWorkers()
      jobs.delete(job); running--; notify(job, 'finished'); pump()
    }
  }
  return Object.freeze({
    configure(options = {}) {
      if (signal.aborted) throw aborted()
      if (!options || typeof options !== 'object' || Object.keys(options).some(key => !['concurrency', 'workerLimit'].includes(key))) throw new TypeError('仅支持 concurrency 和 workerLimit。')
      const nextConcurrency = options.concurrency ?? concurrency, nextWorkers = options.workerLimit ?? workerLimit
      if (![nextConcurrency, nextWorkers].every(value => Number.isSafeInteger(value) && value >= 1 && value <= 8)) throw new RangeError('任务并发和 Worker 上限须在 1 至 8 之间。')
      if (nextWorkers !== workerLimit) {
        if (!runtime?.configureWorkers) throw new Error('当前环境不支持调整 Worker 上限。')
        runtime.configureWorkers(nextWorkers)
      }
      workerLimit = nextWorkers; concurrency = nextConcurrency; pump()
      return { concurrency, workerLimit }
    },
    run(label, work, options = {}) {
      if (signal.aborted) return Promise.reject(aborted())
      if (typeof work !== 'function') return Promise.reject(new TypeError('任务须提供执行函数。'))
      if (!options || typeof options !== 'object' || Object.keys(options).some(key => !['signal', 'timeoutMs'].includes(key))) return Promise.reject(new TypeError('任务仅支持 signal 和 timeoutMs。'))
      const timeoutMs = options.timeoutMs ?? 1800000, external = options.signal
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 7200000) return Promise.reject(new RangeError('任务期限须在 2 小时以内。'))
      if (external && !(external instanceof AbortSignal)) return Promise.reject(new TypeError('signal 必须是 AbortSignal。'))
      if (external?.aborted) return Promise.reject(aborted())
      if (queue.length >= 128) return Promise.reject(new Error('等待执行的任务最多 128 个。'))
      return new Promise((resolve, reject) => {
        const job = { id: `task-${++sequence}`, label: String(label || '处理文件').slice(0, 80), work, timeoutMs, external, resolve, reject, controller: new AbortController(), started: false }
        job.cancel = () => job.controller.abort()
        job.onAbort = () => {
          if (job.started) { job.stop?.(); return }
          const index = queue.indexOf(job); if (index >= 0) queue.splice(index, 1)
          jobs.delete(job); detach(job); notify(job, 'finished'); reject(aborted())
        }
        job.controller.signal.addEventListener('abort', job.onAbort, { once: true })
        external?.addEventListener('abort', job.cancel, { once: true })
        jobs.add(job); queue.push(job); notify(job, 'queued')
        if (external?.aborted) job.cancel()
        pump()
      })
    },
    cancelAll,
  })
}
