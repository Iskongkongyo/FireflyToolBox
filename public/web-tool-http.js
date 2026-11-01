// HTTPS API for the opaque tool; native session tokens stay in the parent.
window.FireflyWebToolHttp = (id, send, signal) => {
  const requests = new Map(), MAX_BYTES = 16 * 1024 * 1024
  let sequence = 0
  const error = value => Object.assign(new Error(value?.message || 'HTTPS 请求失败。'), { code: value?.code || 'HTTP_FAILED', name: value?.code === 'HTTP_CANCELED' ? 'AbortError' : 'WebHttpError' })
  const aborted = () => new DOMException('HTTPS 请求已取消。', 'AbortError')
  const finish = item => { requests.delete(item.id); item.signal?.removeEventListener('abort', item.cancel) }
  const cancel = item => {
    if (!requests.has(item.id)) return
    finish(item); send({ type: 'cancelHttp', id, requestId: item.id }); item.reject(aborted()); item.controller?.error(aborted())
  }
  const response = (item, body) => {
    const result = new Response(body, { status: item.meta.status, headers: item.meta.headers })
    Object.defineProperty(result, 'url', { value: item.meta.url })
    return result
  }
  const pull = item => { if (!item.reading && requests.has(item.id)) { item.reading = true; send({ type: 'httpPull', id, requestId: item.id }) } }
  const onMessage = event => {
    if (event.source !== parent || event.data?.id !== id) return
    const data = event.data, item = requests.get(data.requestId)
    if (!item) return
    try {
      if (data.type === 'httpError') {
        const failure = error(data.error); finish(item); item.reject(failure); item.controller?.error(failure)
      } else if (data.type === 'httpHeaders') {
        item.meta = data.response
        if ([204, 205, 304].includes(item.meta.status)) { item.resolve(response(item, null)); finish(item); send({type:'cancelHttp',id,requestId:item.id}); return }
        if (item.stream) {
          const stream = new ReadableStream({ start(controller) { item.controller = controller }, pull() { pull(item) }, cancel() { cancel(item) } })
          item.resolve(response(item, stream))
        } else { item.parts = []; pull(item) }
      } else if (data.type === 'httpChunk') {
        item.reading = false
        if (!(data.bytes instanceof Uint8Array) || data.bytes.length > 256 * 1024) throw new Error('HTTPS 响应块无效。')
        item.total += data.bytes.length
        if (item.total > item.max) throw Object.assign(new Error('HTTPS 响应超过设置的大小额度。'), {code:'HTTP_RESPONSE_LIMIT'})
        if (data.done) {
          finish(item)
          if (item.stream) item.controller.close()
          else item.resolve(response(item, new Blob(item.parts)))
        } else if (item.stream) item.controller.enqueue(data.bytes)
        else { item.parts.push(data.bytes); pull(item) }
      }
    } catch (failure) {
      finish(item); send({type:'cancelHttp',id,requestId:item.id}); item.reject(failure); item.controller?.error(failure)
    }
  }
  window.addEventListener('message', onMessage)
  signal.addEventListener('abort', () => { for (const item of [...requests.values()]) cancel(item); window.removeEventListener('message', onMessage) }, {once:true})
  return Object.freeze({
    async request(url, options = {}) {
      if (signal.aborted || options?.signal?.aborted) throw aborted()
      if (!options || typeof options !== 'object' || Object.keys(options).some(key => !['method','headers','body','timeoutMs','maxResponseBytes','stream','signal'].includes(key))) throw new TypeError('request 选项无效。')
      if (options.signal && !(options.signal instanceof AbortSignal)) throw new TypeError('signal 必须是 AbortSignal。')
      const method = String(options.method ?? 'GET').toUpperCase(), timeoutMs = options.timeoutMs ?? 15000, max = options.maxResponseBytes ?? 4194304
      if (!['GET','POST'].includes(method) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000 || !Number.isSafeInteger(max) || max < 1 || max > MAX_BYTES || (options.stream !== undefined && typeof options.stream !== 'boolean')) throw new TypeError('请求方法或额度无效；最长 60 秒、响应最多 16 MiB。')
      const headers = new Headers(options.headers), body = options.body
      let bytes
      if (body !== undefined && body !== null) {
        if (method === 'GET') throw new TypeError('GET 请求不能携带正文。')
        if (typeof body === 'string') { bytes = new TextEncoder().encode(body); if (!headers.has('content-type')) headers.set('content-type','text/plain;charset=UTF-8') }
        else if (body instanceof URLSearchParams) { bytes = new TextEncoder().encode(body.toString()); if (!headers.has('content-type')) headers.set('content-type','application/x-www-form-urlencoded;charset=UTF-8') }
        else if (body instanceof Blob) { if (body.size > MAX_BYTES) throw new RangeError('请求正文最多 16 MiB。'); bytes = new Uint8Array(await body.arrayBuffer()); if (body.type && !headers.has('content-type')) headers.set('content-type',body.type) }
        else if (body instanceof Uint8Array || body instanceof ArrayBuffer) {
          if (body.byteLength > MAX_BYTES) throw new RangeError('请求正文最多 16 MiB。')
          bytes = body instanceof Uint8Array ? body.slice() : new Uint8Array(body.slice(0))
        }
        else throw new TypeError('请求正文须为字符串、Blob、Uint8Array、ArrayBuffer 或 URLSearchParams。')
        if (bytes.length > MAX_BYTES) throw new RangeError('请求正文最多 16 MiB。')
      }
      const destination = String(url)
      if (signal.aborted || options.signal?.aborted) throw aborted()
      if (requests.size >= 4) throw new Error('同时最多进行 4 个宿主请求。')
      return new Promise((resolve, reject) => {
        const item = { id: `net-${++sequence}`, signal: options.signal, stream: options.stream === true, resolve, reject, max, total: 0, reading: false }
        item.cancel = () => cancel(item)
        requests.set(item.id, item); item.signal?.addEventListener('abort', item.cancel, {once:true})
        try { send({type:'http',id,requestId:item.id,url:destination,options:{method,headers:Object.fromEntries(headers),timeoutMs,maxResponseBytes:max},body:bytes},bytes?[bytes.buffer]:[]) }
        catch (failure) { finish(item); reject(failure) }
      })
    },
  })
}
