import { invoke } from '@tauri-apps/api/core'
import { encodeFileChunk } from './webToolNativeFiles'

const MAX_BYTES = 16 * 1024 * 1024
type Job = { token?: string; active: boolean; reading: boolean; ready: boolean; deadline: number; timer: ReturnType<typeof setTimeout> }
type Send = (value: Record<string, unknown>, transfer?: Transferable[]) => void
const failure = (error: unknown) => {
  const value = error as { code?: string; message?: string }
  return { code: value?.code ?? 'HTTP_FAILED', message: value?.message ?? String(error) }
}
export function createWebHttpHost(hosts: string[], send: Send) {
  const jobs = new Map<string, Job>()
  let closed = false
  const finish = (requestId: string, job: Job) => {
    job.active = false; clearTimeout(job.timer)
    if (jobs.get(requestId) === job) jobs.delete(requestId)
    if (job.token) void invoke('web_tool_http_cancel', { id: job.token }).catch(() => {})
  }
  const fail = (requestId: string, job: Job, error: unknown) => {
    if (!job.active) return
    const timedOut = Date.now() >= job.deadline
    send({ type: 'httpError', requestId, error: timedOut ? { code: 'HTTP_TIMEOUT', message: 'HTTPS 请求超过设置的期限。' } : failure(error) })
    finish(requestId, job)
  }
  return {
    start(data: Record<string, unknown>) {
      const requestId = data.requestId
      if (closed || typeof requestId !== 'string' || requestId.length > 64) return
      if (jobs.size >= 4 || jobs.has(requestId)) { send({ type: 'httpError', requestId, error: { code: 'HTTP_BUSY', message: '同时最多进行 4 个宿主请求。' } }); return }
      const settings = (data.options ?? {}) as Record<string, unknown>
      const headers = settings.headers ?? {}
      if (!headers || typeof headers !== 'object' || Array.isArray(headers) || Object.values(headers).some(value => typeof value !== 'string') || Object.keys(headers).length > 64 || Object.entries(headers).reduce((total,[name,value]) => total + new TextEncoder().encode(name).byteLength + new TextEncoder().encode(String(value)).byteLength,0) > 16384) {
        send({type:'httpError',requestId,error:{code:'HTTP_HEADER_INVALID',message:'请求头须为最多 64 项、16 KiB 以内的字符串键值。'}}); return
      }
      const timeoutMs = settings.timeoutMs ?? 15000, maxResponseBytes = settings.maxResponseBytes ?? 4 * 1024 * 1024
      if (typeof data.url !== 'string' || data.url.length > 4096 || !Number.isSafeInteger(timeoutMs) || Number(timeoutMs) < 1 || Number(timeoutMs) > 60000 || !Number.isSafeInteger(maxResponseBytes) || Number(maxResponseBytes) < 1 || Number(maxResponseBytes) > MAX_BYTES || (data.body !== undefined && (!(data.body instanceof Uint8Array) || data.body.length > MAX_BYTES))) {
        send({ type: 'httpError', requestId, error: { code: 'HTTP_OPTIONS_INVALID', message: 'HTTPS 请求地址、正文或额度无效。' } }); return
      }
      const job: Job = { active: true, reading: false, ready: false, deadline: Date.now() + Number(timeoutMs), timer: setTimeout(() => fail(requestId, job, { code: 'HTTP_TIMEOUT', message: 'HTTPS 请求超时。' }), Number(timeoutMs)) }
      jobs.set(requestId, job)
      void (async () => {
        const token = await invoke<string>('web_tool_http_create', { url: data.url, allowedHosts: [...hosts], options: {
          method: settings.method ?? 'GET', headers, body_base64: data.body instanceof Uint8Array ? encodeFileChunk(data.body).data : null,
          timeout_ms: timeoutMs, max_response_bytes: maxResponseBytes,
        } })
        job.token = token
        if (!job.active || closed) { void invoke('web_tool_http_cancel', { id: token }).catch(() => {}); return }
        if (Date.now() >= job.deadline) { fail(requestId, job, { code: 'HTTP_TIMEOUT' }); return }
        const response = await invoke('web_tool_http_start', { id: token })
        if (!job.active || closed) return
        job.ready = true
        send({ type: 'httpHeaders', requestId, response })
      })().catch(error => fail(requestId, job, error))
    },
    pull(data: Record<string, unknown>) {
      const requestId = typeof data.requestId === 'string' ? data.requestId : '', job = jobs.get(requestId)
      if (!job || !job.active) return
      if (!job.ready || job.reading) { fail(requestId, job, { code: 'HTTP_SEQUENCE_INVALID', message: '响应读取顺序无效。' }); return }
      job.reading = true
      void invoke<ArrayBuffer | number[]>('web_tool_http_read', { id: job.token }).then(raw => {
        if (!job.active || closed) return
        if (!(raw instanceof ArrayBuffer) && !Array.isArray(raw)) throw new Error('宿主未返回有效的响应块。')
        const bytes = new Uint8Array(raw)
        if (bytes.length > 256 * 1024) throw new Error('宿主响应块超限。')
        job.reading = false
        const done = bytes.length === 0
        send({ type: 'httpChunk', requestId, bytes, done }, [bytes.buffer])
        if (done) finish(requestId, job)
      }).catch(error => fail(requestId, job, error))
    },
    cancel(requestId: string) { const job = jobs.get(requestId); if (job) finish(requestId, job) },
    dispose() { closed = true; for (const [id, job] of jobs) finish(id, job) },
  }
}
