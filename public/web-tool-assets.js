// Scoped resource and streaming file API. Installed only inside the tool sandbox.
window.FireflyWebToolAssets = (id, send, signal, declared, filesAvailable, createWorker) => {
  const pending = new Map(), blobs = new Map(), urls = new Map()
  let sequence = 0, stopped = false
  const chunkSize = 1024 * 1024
  const error = (code, message) => Object.assign(new Error(message), { code, name: code === 'FILE_CANCELED' ? 'AbortError' : 'WebFileError' })
  const check = localSignal => { if (stopped || signal.aborted || localSignal?.aborted) throw error('FILE_CANCELED', '工具或文件操作已取消。') }
  function request(operation, values = {}, localSignal) {
    try { check(localSignal) } catch (value) { return Promise.reject(value) }
    if (localSignal && !(localSignal instanceof AbortSignal)) return Promise.reject(new TypeError('signal 必须是 AbortSignal。'))
    const requestId = `stream-${++sequence}`
    return new Promise((resolve, reject) => {
      const abort = () => { if (!pending.has(requestId)) return; finish(); send({type:'cancelStream',id,requestId}); reject(error('FILE_CANCELED','文件操作已取消。')) }
      const finish = () => { pending.delete(requestId); localSignal?.removeEventListener('abort',abort) }
      pending.set(requestId,{resolve,reject,finish})
      localSignal?.addEventListener('abort',abort,{once:true})
      const message = {type:'stream',id,requestId,operation,...values}
      const transfer = values.bytes instanceof Uint8Array ? [values.bytes.buffer] : []
      parent.postMessage({fireflyWebTool:true,...message},'*',transfer)
    })
  }
  const onMessage = event => {
    if (event.source !== parent || event.data?.id !== id || event.data.type !== 'streamResult') return
    const item = pending.get(event.data.requestId)
    if (!item) return
    item.finish()
    if (event.data.error) item.reject(error(event.data.error.code || 'FILE_FAILED',event.data.error.message || '文件操作失败。'))
    else item.resolve(event.data.result)
  }
  window.addEventListener('message',onMessage)
  function metadata(path) { const item = declared.find(item => item.path === path); if (!item) throw error('RESOURCE_SCOPE','资源未在工具包中声明。'); return item }
  const resources = Object.freeze({
    list: () => declared.map(item => ({...item})),
    async blob(path, options = {}) {
      check(options.signal)
      const item = metadata(path)
      // Independent cancellation never poisons the shared cache.
      if (options.signal) return readResource(item,options)
      if (!blobs.has(path)) blobs.set(path,readResource(item,options).catch(value => {blobs.delete(path);throw value}))
      return blobs.get(path)
    },
    async url(path, options = {}) {
      check(options.signal)
      if (urls.has(path)) return urls.get(path)
      const blob = await resources.blob(path,options)
      check(options.signal)
      if (!urls.has(path)) urls.set(path,URL.createObjectURL(blob))
      return urls.get(path)
    },
    async worker(path, options = {}) {
      if (!path.endsWith('.js')) throw error('RESOURCE_TYPE','Worker 资源必须是独立打包的 JS。')
      const { signal: localSignal, ...workerOptions } = options
      const url = await resources.url(path, { signal: localSignal })
      check(localSignal)
      return createWorker ? createWorker(url, workerOptions, localSignal) : new Worker(url, workerOptions)
    },
  })
  function mime(path) {
    return ({wasm:'application/wasm',js:'text/javascript',json:'application/json',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',svg:'image/svg+xml',avif:'image/avif',woff:'font/woff',woff2:'font/woff2',ttf:'font/ttf',otf:'font/otf',mp3:'audio/mpeg',wav:'audio/wav',ogg:'audio/ogg',flac:'audio/flac',m4a:'audio/mp4',mp4:'video/mp4',webm:'video/webm',mov:'video/quicktime'})[path.split('.').pop()] || 'application/octet-stream'
  }
  async function readResource(item, options) {
    const parts = []
    for (let offset = 0; offset < item.size;) {
      check(options.signal)
      const bytes = await request('resource',{path:item.path,offset,length:Math.min(chunkSize,item.size-offset)},options.signal)
      if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > item.size-offset) throw error('RESOURCE_DATA_INVALID','资源数据不完整。')
      parts.push(bytes); offset += bytes.length
      options.onProgress?.({processed:offset,total:item.size})
    }
    return new Blob(parts,{type:mime(item.path)})
  }
  function reader(info) {
    let closed = false
    const file = {
      name:info.name, size:info.size, type:info.mime_type, seekable:info.seekable, url:info.url,
      async read(offset, length = chunkSize, options = {}) {
        check(options.signal)
        if (closed) throw error('FILE_CANCELED','文件已关闭。')
        const bytes = await request('read',{fileId:info.id,offset,length},options.signal)
        if (!(bytes instanceof Uint8Array)) throw error('FILE_DATA_INVALID','文件块无效。')
        return bytes
      },
      stream(options = {}) {
        let offset = 0
        const length = options.chunkSize ?? chunkSize
        if (!Number.isSafeInteger(length) || length <= 0 || length > chunkSize) throw error('FILE_CHUNK_LIMIT','文件块大小须在 1 MiB 以内。')
        return new ReadableStream({
          async pull(controller) {
            try {
              const bytes = await file.read(offset,length,options)
              if (!bytes.length) {controller.close();return}
              offset += bytes.length; controller.enqueue(bytes)
              options.onProgress?.({processed:offset,total:info.size || null})
            } catch (value) {controller.error(value)}
          },
          cancel: () => file.close(),
        })
      },
      async blob(options = {}) {
        const maxBytes = options.maxBytes ?? 16 * 1024 * 1024
        if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 64 * 1024 * 1024 || info.size > maxBytes) throw error('FILE_INPUT_LIMIT','Blob 预览大小超限；音视频可直接使用文件的 url。')
        const parts = []; let total = 0
        const stream = file.stream(options).getReader()
        try { while (true) { const {done,value} = await stream.read(); if (done) break; total += value.byteLength; if (total > maxBytes) throw error('FILE_INPUT_LIMIT','Blob 预览大小超限。'); parts.push(value) } }
        finally {stream.releaseLock()}
        return new Blob(parts,{type:info.mime_type})
      },
      async close() { if (closed) return; closed = true; await request('close',{fileId:info.id}).catch(() => {}) },
    }
    return Object.freeze(file)
  }
  function writer(info, name) {
    const fileId=typeof info==='string'?info:info.id
    let closed = false, bytesWritten = 0, queue = Promise.resolve(), failure
    const enqueue = task => {
      const value = queue.then(() => {check();if(closed)throw error('FILE_CANCELED','输出已关闭。');if(failure)throw failure;return task()})
      queue = value.catch(value => {failure = value})
      return value
    }
    const output = {
      workspaceUrl:typeof info==='string'?'':info.workspaceUrl,
      get bytesWritten() {return bytesWritten},
      write(data, options = {}) {
        return enqueue(async () => {
          const write = async bytes => {
            for (let offset=0;offset<bytes.byteLength;offset+=chunkSize) {
              check(options.signal)
              const chunk = bytes.slice(offset,offset+chunkSize)
              bytesWritten = await request('write',{fileId,bytes:chunk},options.signal)
              options.onProgress?.({processed:bytesWritten})
            }
          }
          if (data instanceof Uint8Array) await write(data)
          else if (data instanceof ArrayBuffer) await write(new Uint8Array(data))
          else if (data instanceof Blob || data instanceof ReadableStream) {
            const stream = (data instanceof Blob ? data.stream() : data).getReader()
            try {while(true){check(options.signal);const {done,value}=await stream.read();if(done)break;if(!(value instanceof Uint8Array))throw error('FILE_DATA_INVALID','文件流须返回 Uint8Array。');await write(value)}}
            catch(value){await stream.cancel(value).catch(()=>{});throw value}
            finally {stream.releaseLock()}
          } else throw error('FILE_DATA_INVALID','输出须为 Blob、Uint8Array、ArrayBuffer 或 ReadableStream。')
          return bytesWritten
        })
      },
      save(options = {}) { return enqueue(async()=>{const saved=await request('save',{fileId,name},options.signal);if(saved)closed=true;return saved}) },
      preview(options = {}) {return enqueue(async()=>{const info=await request('preview',{fileId,name},options.signal);bytesWritten=info.size;return reader(info)})},
      async abort() {if(closed)return;closed=true;await request('close',{fileId}).catch(()=>{})},
    }
    return Object.freeze(output)
  }
  const files = Object.freeze({
    async open(options = {}) {
      if (!filesAvailable) throw error('FILE_UNAVAILABLE','此环境不支持文件句柄。')
      const values = await request('open',{extensions:options.extensions ?? [],multiple:false},options.signal)
      return values[0] ? reader(values[0]) : null
    },
    async openMany(options = {}) {
      if (!filesAvailable) throw error('FILE_UNAVAILABLE','此环境不支持文件句柄。')
      return (await request('open',{extensions:options.extensions ?? [],multiple:true},options.signal)).map(reader)
    },
    async createWriter(name) {
      if (!filesAvailable) throw error('FILE_UNAVAILABLE','此环境不支持文件句柄。')
      if(typeof name!=='string'||!name.trim()||name.length>120)throw error('FILE_NAME_INVALID','输出文件名无效。')
      return writer(await request('createWriter'),name)
    },
  })
  async function replaceResources(source) {
    const pattern = /\{\{resource:([^}]+)\}\}/g
    const paths = [...new Set([...source.matchAll(pattern)].map(match=>match[1]))]
    for (const path of paths) source = source.replaceAll(`{{resource:${path}}}`,await resources.url(path))
    return source
  }
  function dispose() {
    if(stopped)return;stopped=true
    window.removeEventListener('message',onMessage)
    for(const item of pending.values()){item.finish();item.reject(error('FILE_CANCELED','网页工具已停止。'))}
    pending.clear()
    for(const url of urls.values())URL.revokeObjectURL(url)
    urls.clear();blobs.clear()
  }
  signal.addEventListener('abort',dispose,{once:true})
  return {resources,files,replaceResources,dispose}
}
