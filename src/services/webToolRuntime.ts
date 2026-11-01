import { describeWebFileError, WebFileError, WEB_SMALL_FILE_BYTES, type WebFileProgress, type WebFileStage, type WebFileStatus } from './webToolFiles'
import { toolbox } from './toolbox'
import { checkedWebsite } from './webToolLinks'
import type { WebFileHost } from './webToolNativeFiles'
import appManifest from '../../package.json'
import { createWebHttpHost } from './webToolHttp'
import { readWebToolBudgets, webToolMountTimeout } from './webToolBudgets'

export type WebToolOptions = {
  moduleId: string; scriptName?: string; html: string; css: string; script: string
  networkHosts: string[]; timeoutMs: number; inputBytes: number; outputBytes: number
  resourceModuleId?: string; resources?: { path: string; size: number; sha256: string }[]
  resourceDraftId?: string
  files?: WebFileHost
  openFile: (extensions: string[], maxBytes: number, signal: AbortSignal, progress: WebFileProgress) => Promise<{ name: string; bytes: Uint8Array; mimeType: string } | null>
  saveFile: (name: string, bytes: Uint8Array, signal: AbortSignal, progress: WebFileProgress) => Promise<boolean>
  hashFile?: (algorithm: string, signal: AbortSignal, progress: WebFileProgress, onProgress: (value: { processed: number; total?: number | null }) => void) => Promise<{ name: string; size: number; algorithm: string; digest: string } | null>
  copyText?: (text: string) => Promise<void>
  openWebsite?: (url: string, title: string) => Promise<void>
  onError: (message: string) => void
  onFileStatus?: (status: WebFileStatus) => void
  onStopped?: () => void
  onPresentation?: (action: 'exit' | 'reveal') => void
}

// A canceled native dialog may remain open. Keep its lease until the native call
// actually returns, even if its iframe has already been removed.
let nativeFileLease: object | null = null

async function legacyRead(options: WebToolOptions, run: string, extensions: string[], maxBytes: number, signal: AbortSignal, progress: WebFileProgress) {
  if (!options.files) return options.openFile(extensions,maxBytes,signal,progress)
  const values = await options.files.request(run,'open',{extensions,multiple:false},signal,progress) as {id:string;name:string;size:number;mime_type:string}[]
  const file = values[0]
  if (!file) return null
  try {
    if (file.size > maxBytes) throw new WebFileError('FILE_INPUT_LIMIT','所选文件超过整文件读取上限；较大文件请使用 files.open()。')
    const chunks: Uint8Array[] = [];let total=0
    while(true) {
      const bytes=await options.files.request(run,'read',{fileId:file.id,offset:total,length:Math.min(1024*1024,maxBytes-total+1)},signal,progress) as Uint8Array
      if (!bytes.length) break
      total+=bytes.length
      if (total>maxBytes) throw new WebFileError('FILE_INPUT_LIMIT','所选文件超过整文件读取上限。')
      chunks.push(bytes)
    }
    if (!total) throw new WebFileError('FILE_EMPTY','所选文件为空。')
    const bytes=new Uint8Array(total);let offset=0
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
    return {name:file.name,bytes,mimeType:file.mime_type}
  } finally {await options.files.request(run,'close',{fileId:file.id},new AbortController().signal,progress).catch(()=>{})}
}

async function legacySave(options: WebToolOptions, run: string, name: string, bytes: Uint8Array, signal: AbortSignal, progress: WebFileProgress): Promise<boolean> {
  if (!options.files) return options.saveFile(name,bytes,signal,progress)
  const created=await options.files.request(run,'createWriter',{},signal,progress) as string|{id:string}
  const fileId=typeof created==='string'?created:created.id
  try {
    for(let offset=0;offset<bytes.length;offset+=1024*1024) await options.files.request(run,'write',{fileId,bytes:bytes.slice(offset,offset+1024*1024)},signal,progress)
    return await options.files.request(run,'save',{fileId,name},signal,progress) as boolean
  } finally {await options.files.request(run,'close',{fileId},new AbortController().signal,progress).catch(()=>{})}
}

export function createWebToolSession(container: HTMLElement, options: WebToolOptions, hook: string,
  storage: { read: () => Record<string, string>; update: (data: Record<string, unknown>) => void | Promise<void> }, stop: () => void) {
  const scriptBudgets = readWebToolBudgets()
  const frame = document.createElement('iframe')
  frame.title = '网页工具界面'
  frame.setAttribute('sandbox', 'allow-scripts')
  frame.setAttribute('referrerpolicy', 'no-referrer')
  frame.className = 'web-tool-frame'
  const appOrigin = window.location.origin
  const runtimeScripts = ['tool-storage.js', 'web-tool-safety.js', 'web-tool-layout.js', 'web-tool-assets.js', 'web-tool-tasks.js', 'web-tool-http.js', 'web-tool-presentation.js', 'web-tool-runner.js']
    .map(name => `<script src="${appOrigin}/${name}?v=${encodeURIComponent(appManifest.version)}&runtime=fullscreen-2"></script>`).join('')
  const sources = options.networkHosts.map(host => host === 'https://*' ? 'https://*:*' : host)
  const connect = sources.length
    ? [...sources, ...sources.map(host => host.replace(/^https:/, 'wss:'))].join(' ') : ''
  const mediaSources = 'ff-file: http://ff-file.localhost https://ff-file.localhost'
  const workspaceSources = 'ff-work: http://ff-work.localhost https://ff-work.localhost'
  function initializeFrame() {
    if (closed) return
    const localSources = (options.files?.protocolSources ?? []).join(' ')
    const policy = `default-src 'none'; script-src ${appOrigin} blob: 'wasm-unsafe-eval'; worker-src blob:; frame-src 'none'; connect-src blob: ${mediaSources} ${workspaceSources} ${localSources} ${connect}; media-src blob: data: ${mediaSources} ${localSources} ${options.networkHosts.join(' ')}; img-src data: blob: ${mediaSources} ${localSources} ${options.networkHosts.join(' ')}; style-src 'unsafe-inline'; font-src data: blob:; form-action 'none'; base-uri 'none'`
    frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${policy}"></head><body>${runtimeScripts}</body></html>`
    container.append(frame)
  }
  const id = crypto.randomUUID()
  let closed = false
  let started = false
  let mounted = false
  let storageError = false
  let settled = false
  let layoutHeight = 0
  let fullscreen = false
  let layoutTimer: number | undefined
  let pendingFocus: { top: unknown; bottom: unknown } | null = null
  const page = container.closest<HTMLElement>('.web-tool-page')
  page?.style.removeProperty('--web-tool-content-left')
  page?.style.removeProperty('--web-tool-content-width')
  const viewportHeight = () => Math.max(1, Math.min(20000, window.visualViewport?.height ?? window.innerHeight))
  frame.style.height = `${Math.ceil(viewportHeight())}px`
  let resolveReady: () => void
  let rejectReady: (error: Error) => void
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
  let operation: { controller: AbortController; requestId: string; stage: WebFileStage } | null = null
  const requests = new Map<string, AbortController>()
  const fileRequests = new Map<string, AbortController>()
  const tasks = new Map<string, {label: string; progress: number; state: 'queued' | 'running'}>()
  const nativeReady = options.files?.begin(id, options.inputBytes, options.outputBytes)
  void nativeReady?.catch(error => fail(String(error)))
  let openingWebsite = false
  let lastWebsiteOpened = -Infinity
  const status = (value: WebFileStatus) => { if (!closed) options.onFileStatus?.(value) }
  const send = (value: Record<string, unknown>, transfer: Transferable[] = []) => { if (!closed) frame.contentWindow?.postMessage({ id, ...value }, '*', transfer) }
  const http = createWebHttpHost(options.networkHosts, send)
  const onViewportResize = () => {
    if (fullscreen) frame.style.height = `${Math.ceil(viewportHeight())}px`
    send({ type: 'viewport', height: viewportHeight() })
  }
  function scheduleLayout() {
    if (layoutTimer !== undefined) return
    layoutTimer = window.requestAnimationFrame(() => {
      layoutTimer = undefined
      if (closed) return
      if (fullscreen) frame.style.height = `${Math.ceil(viewportHeight())}px`
      else if (layoutHeight) frame.style.height = `${layoutHeight}px`
      if (pendingFocus && !fullscreen) revealFocus(pendingFocus.top, pendingFocus.bottom)
      pendingFocus = null
    })
  }
  function applyHeight(height: unknown) {
    if (typeof height !== 'number' || !Number.isFinite(height) || height < 1 || height > 100000) return
    layoutHeight = Math.ceil(height)
    scheduleLayout()
  }
  function alignContent(left: unknown, width: unknown) {
    if (!page || typeof left !== 'number' || typeof width !== 'number' || !Number.isFinite(left) || !Number.isFinite(width)
      || left < 0 || width < 1 || left + width > frame.getBoundingClientRect().width + 1) return
    page.style.setProperty('--web-tool-content-left', `${left}px`)
    page.style.setProperty('--web-tool-content-width', `${width}px`)
  }
  function revealFocus(top: unknown, bottom: unknown) {
    if (typeof top !== 'number' || typeof bottom !== 'number' || !Number.isFinite(top) || !Number.isFinite(bottom)
      || top < 0 || bottom < top || bottom > layoutHeight + 1) return
    const viewport = window.visualViewport
    const viewportTop = viewport?.offsetTop ?? 0
    const toolbar = container.closest('.workspace')?.querySelector<HTMLElement>('.topbar')
    const pinned = toolbar && ['fixed', 'sticky'].includes(getComputedStyle(toolbar).position)
    const upper = Math.max(viewportTop, pinned ? toolbar.getBoundingClientRect().bottom : viewportTop) + 16
    const lower = viewportTop + (viewport?.height ?? window.innerHeight) - 16
    const position = frame.getBoundingClientRect().top
    const delta = position + bottom > lower ? position + bottom - lower : position + top < upper ? position + top - upper : 0
    if (delta) window.scrollBy({ top: delta, behavior: 'instant' })
  }
  const fail = (message: string) => {
    if (closed) return
    if (!settled) { settled = true; rejectReady(new Error(message)) }
    else options.onError(message)
    options.onStopped?.()
    stop()
  }
  const mountTimeout = webToolMountTimeout(options.timeoutMs, scriptBudgets.initializationMs)
  const loadTimer = mountTimeout ? window.setTimeout(() => fail('网页工具加载超时，已停止。'), mountTimeout) : undefined

  function fileRequest(kind: 'open' | 'save' | 'hash', data: Record<string, unknown>) {
    const requestId = data.requestId as string
    const reply = (result: unknown, error?: { code: string; message: string }) => send({
      type: kind === 'open' ? 'openResult' : kind === 'hash' ? 'hashResult' : 'saveResult', requestId,
      ...(kind === 'open' ? { file: result } : kind === 'hash' ? { result } : { saved: result }), error,
    })
    if (nativeFileLease) {
      reply(null, { code: 'FILE_BUSY', message: '已有文件操作未结束；请先关闭系统文件对话框。' })
      return
    }
    try {
      if (kind === 'open') {
        if (!Array.isArray(data.extensions) || data.extensions.length > 12
          || !data.extensions.every(value => typeof value === 'string' && /^[a-z0-9]{1,10}$/.test(value))) {
          throw new WebFileError('FILE_TYPES_INVALID', '文件扩展名列表无效。')
        }
      } else {
        if (kind === 'hash') {
          if (!options.hashFile || !['md5', 'sha1', 'sha256', 'sha384', 'sha512'].includes(data.algorithm as string)) throw new WebFileError('HASH_ALGORITHM_INVALID', '文件哈希接口或算法不可用。')
        } else {
        if (typeof data.name !== 'string' || !data.name.trim() || data.name.length > 120) throw new WebFileError('FILE_NAME_INVALID', '文件名须为 1 到 120 个字符。')
        if (!(data.blob instanceof Blob)) throw new WebFileError('FILE_DATA_INVALID', '保存内容必须是 Blob。')
        if (!data.blob.size) throw new WebFileError('FILE_EMPTY', '生成的文件为空。')
        if (data.blob.size > Math.min(options.outputBytes, WEB_SMALL_FILE_BYTES)) throw new WebFileError('FILE_OUTPUT_LIMIT', '整文件保存最多 32 MiB，且不能超过清单输出额度；较大输出请使用 files.createWriter()。')
        }
      }
    } catch (error) {
      const failure = describeWebFileError(error)
      reply(null, failure)
      status({ busy: false, ...failure })
      return
    }
    const lease = {}
    nativeFileLease = lease
    const current = { controller: new AbortController(), requestId, stage: 'selecting' as WebFileStage }
    operation = current
    let replied = false
    let ioTimer: number | undefined
    const finish = (result: unknown, error?: { code: string; message: string }) => {
      if (replied) return
      replied = true
      clearTimeout(ioTimer)
      reply(result, error)
      if (operation === current) operation = null
      status({ busy: false, code: error?.code, message: error?.message
        ?? (result ? kind === 'open' ? '文件已读取。' : kind === 'hash' ? '文件哈希已计算。' : '文件已保存。' : kind !== 'save' ? '已取消文件选择。' : '已取消保存。') })
    }
    const progress: WebFileProgress = stage => {
      if (current.controller.signal.aborted || closed || replied) return
      current.stage = stage
      status({ busy: true, stage, message: stage === 'selecting'
        ? kind !== 'save' ? '正在选择要读取的文件…' : '正在选择保存位置…'
        : stage === 'reading' ? '正在读取文件…' : stage === 'processing' ? '正在计算文件哈希…' : '正在写入文件…' })
      clearTimeout(ioTimer)
      if (stage !== 'selecting' && kind !== 'hash') ioTimer = window.setTimeout(() => {
        finish(null, { code: 'FILE_TIMEOUT', message: '文件操作等待超时；已经开始的系统读写可能仍会完成。' })
        current.controller.abort()
      }, 15000)
    }
    current.controller.signal.addEventListener('abort', () => finish(null, {
      code: 'FILE_CANCELED', message: current.stage === 'selecting'
        ? '已取消等待；已打开的系统文件对话框请手动关闭。'
        : current.stage === 'writing' ? '已取消等待；已经开始的文件写入可能仍会完成。' : current.stage === 'processing' ? '文件哈希计算已取消。' : '文件读取已取消。',
    }), { once: true })
    progress('selecting')
    void (async () => {
      if (kind === 'open') {
        await nativeReady
        const maxBytes = Math.min(options.inputBytes, WEB_SMALL_FILE_BYTES)
        const file = await legacyRead(options,id,data.extensions as string[],maxBytes,current.controller.signal,progress)
        if (current.controller.signal.aborted || closed) return
        if (file && file.bytes.byteLength > maxBytes) throw new WebFileError('FILE_INPUT_LIMIT', '所选文件超过整文件读取或清单输入额度；较大文件请使用 files.open()。')
        finish(file && { name: file.name, blob: new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }) })
      } else {
        if (kind === 'hash') {
          const result = await options.hashFile!(data.algorithm as string, current.controller.signal, progress, value => {
            if (!closed && !current.controller.signal.aborted) send({ type: 'hashProgress', requestId, progress: value })
          })
          if (!current.controller.signal.aborted && !closed) finish(result)
          return
        }
        const safeName = (data.name as string).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim()
        if (!safeName) throw new WebFileError('FILE_NAME_INVALID', '文件名无效。')
        const buffer = await (data.blob as Blob).arrayBuffer()
        if (current.controller.signal.aborted || closed) return
        await nativeReady
        finish(await legacySave(options,id,safeName,new Uint8Array(buffer),current.controller.signal,progress))
      }
    })().catch(error => finish(null, describeWebFileError(error))).finally(() => {
      clearTimeout(ioTimer)
      if (nativeFileLease === lease) nativeFileLease = null
      if (operation === current) operation = null
    })
  }
  function httpRequest(data: Record<string, unknown>) {
    const requestId = data.requestId as string
    const reply = (response?: unknown, error?: { code: string; message: string }) => send({ type: data.type === 'certificate' ? 'certificateResult' : data.type==='resolve'?'resolveResult':'httpResult', requestId, response, error })
    if (typeof data.url !== 'string' || data.url.length > 4096 || requestId.length > 64) {
      reply(undefined, { code: 'HTTP_URL_INVALID', message: 'HTTPS 请求地址无效。' }); return
    }
    if (requests.size >= 4 || requests.has(requestId)) { reply(undefined, { code: 'HTTP_BUSY', message: '正在请求的接口过多。' }); return }
    const controller = new AbortController()
    requests.set(requestId, controller)
    // Authority comes from this parent's captured manifest/draft, never iframe data.
    const task = data.type === 'certificate' ? toolbox.inspectCertificate(data.url, [...options.networkHosts]) : data.type==='resolve'?toolbox.resolveLink(data.url,[...options.networkHosts]):toolbox.webToolRequest(data.url, [...options.networkHosts])
    void task.then(response => {
      if (!controller.signal.aborted && !closed) reply(response)
    }).catch(error => {
      if (!controller.signal.aborted && !closed) reply(undefined, {
        code: typeof error?.code === 'string' ? error.code : 'HTTP_FAILED',
        message: typeof error?.message === 'string' ? error.message : String(error),
      })
    }).finally(() => { if (requests.get(requestId) === controller) requests.delete(requestId) })
  }
  function streamRequest(data: Record<string, unknown>) {
    const requestId = data.requestId as string
    if (requestId.length > 64 || fileRequests.size >= 8 || fileRequests.has(requestId)) { send({type:'streamResult',requestId,error:{code:'FILE_BUSY',message:'文件请求过多或重复。'}}); return }
    const controller = new AbortController()
    fileRequests.set(requestId, controller)
    controller.signal.addEventListener('abort', () => send({type:'streamResult',requestId,error:{code:'FILE_CANCELED',message:'文件操作已取消。'}}), {once:true})
    const kind = data.operation as string
    const dialog = kind === 'open' || kind === 'save'
    const lease = {}
    const reply = (result?: unknown, error?: {code: string; message: string}) => {
      if (!controller.signal.aborted && !closed) send({type:'streamResult',requestId,result,error}, result instanceof Uint8Array ? [result.buffer as ArrayBuffer] : [])
    }
    void (async () => {
      if (dialog) {
        if (nativeFileLease) throw new WebFileError('FILE_BUSY','已有文件对话框未结束。')
        nativeFileLease = lease
      }
      if (kind === 'resource') {
        const resource = options.resources?.find(resource => resource.path === data.path)
        if (!resource || !options.resourceModuleId || typeof data.offset !== 'number' || !Number.isSafeInteger(data.offset) || data.offset < 0 || data.offset > resource.size
          || typeof data.length !== 'number' || !Number.isSafeInteger(data.length) || data.length <= 0 || data.length > 1024 * 1024) throw new WebFileError('RESOURCE_SCOPE','资源读取范围无效。')
        reply(await toolbox.readModuleResource(options.resourceModuleId,resource.path,data.offset,data.length,resource.sha256,options.resourceDraftId))
      } else {
        if (!options.files) throw new WebFileError('FILE_UNAVAILABLE','此环境不支持文件句柄。')
        await nativeReady
        if (controller.signal.aborted || closed) return
        const progress: WebFileProgress = stage => status({busy:true,stage,message:stage === 'selecting' ? '正在选择文件…' : stage === 'reading' ? '正在分块读取…' : '正在写入处理结果…'})
        const result = await options.files.request(id,kind,data,controller.signal,progress)
        reply(result)
      }
    })().catch(error => reply(undefined,describeWebFileError(error))).finally(() => {
      fileRequests.delete(requestId)
      if (nativeFileLease === lease) nativeFileLease = null
      if (!fileRequests.size && !tasks.size) status({busy:false,message:''})
    })
  }
  const onMessage = (event: MessageEvent) => {
    if (closed || event.source !== frame.contentWindow || !event.data?.fireflyWebTool) return
    const data = event.data as Record<string, unknown>
    if (data.type === 'ready' && !started) {
      started = true
      send({ type: 'mount', html: options.html, css: options.css, script: options.script, hook, scriptBudgets,
        resources: options.resources ?? [], filesAvailable: !!options.files,
        viewportHeight: viewportHeight(), font: getComputedStyle(container).font, textColor: getComputedStyle(container).color,
        theme: document.documentElement.dataset.theme, accent: getComputedStyle(document.documentElement).getPropertyValue('--accent'),
        scriptName: options.scriptName ?? 'main.js', storage: storage.read() })
    } else if (data.id !== id) return
    else if (data.type === 'layout') { applyHeight(data.height); alignContent(data.left, data.width) }
    else if (data.type === 'presentation' && fullscreen && (data.action === 'exit' || data.action === 'reveal')) options.onPresentation?.(data.action)
    else if (data.type === 'focus') { pendingFocus = { top: data.top, bottom: data.bottom }; scheduleLayout() }
    else if (data.type === 'mounted' && !settled) {
      mounted = true; settled = true; clearTimeout(loadTimer); resolveReady()
    } else if (data.type === 'storage' && typeof data.requestId === 'string' && data.requestId.length <= 64) {
      const requestId = data.requestId
      void Promise.resolve().then(() => storage.update(data)).then(() => send({type:'storageResult',requestId})).catch(error => {
        send({type:'storageResult',requestId,error:{message:error?.message ?? String(error)}})
      })
    }
    else if (data.type === 'fatal') fail(typeof data.error === 'string' ? data.error : '网页工具运行已停止。')
    else if (data.type === 'error') {
      const message = typeof data.error === 'string' ? data.error : '网页工具运行失败。'
      storageError = data.code === 'STORAGE_WRITE_FAILED'
      if (mounted) options.onError(message)
      else fail(message)
    } else if (data.type === 'storageRecovered') {
      if (storageError) { storageError = false; options.onError('') }
    } else if ((data.type === 'open' || data.type === 'save' || data.type === 'hash') && typeof data.requestId === 'string') {
      fileRequest(data.type, data)
    } else if (data.type === 'http') {
      http.start(data)
    } else if (data.type === 'httpPull') {
      http.pull(data)
    } else if ((data.type === 'certificate' || data.type === 'resolve') && typeof data.requestId === 'string') {
      httpRequest(data)
    } else if (data.type === 'stream' && typeof data.requestId === 'string' && typeof data.operation === 'string') {
      streamRequest(data)
    } else if (data.type === 'cancelStream' && typeof data.requestId === 'string') {
      fileRequests.get(data.requestId)?.abort()
    } else if (data.type === 'taskProgress' && typeof data.taskId === 'string' && data.taskId.length <= 64) {
      if (data.state === 'finished') tasks.delete(data.taskId)
      else if ((data.state === 'queued' || data.state === 'running') && (tasks.has(data.taskId) || tasks.size < 136)) {
        const label = typeof data.label === 'string' ? data.label.slice(0,80) : '处理文件'
        const progress = typeof data.progress === 'number' && Number.isFinite(data.progress) ? Math.max(0,Math.min(1,data.progress)) : 0
        tasks.set(data.taskId,{label,progress,state:data.state})
      }
      if (tasks.size) {
        const values = [...tasks.values()], active = values.filter(task => task.state === 'running'), waiting = values.length - active.length
        const task = active[0] ?? values[0]!
        status({busy:true,stage:'processing',message:waiting ? `${active.length} 个任务处理中，${waiting} 个等待执行` : `${task!.label} ${Math.round(task!.progress*100)}%`})
      }
      if (!tasks.size && !fileRequests.size) status({busy:false,message:''})
    } else if (data.type === 'openWebsite' && typeof data.requestId === 'string') {
      const requestId = data.requestId
      if (data.external !== undefined && typeof data.external !== 'boolean') { send({type:'websiteResult',requestId,error:{message:'外部浏览器选项无效。'}}); return }
      if (!navigator.userActivation?.isActive || performance.now()-lastWebsiteOpened<1000) { send({type:'websiteResult',requestId,error:{message:'请点击按钮后打开网页，或稍候再试。'}}); return }
      if (requestId.length > 64 || !options.openWebsite || openingWebsite) { send({ type:'websiteResult',requestId,error:{message:'网页访问接口不可用或正在打开网页。'} }); return }
      let destination
      try { destination = checkedWebsite(data.url,data.title,options.networkHosts) }
      catch(error) { send({ type:'websiteResult',requestId,error:{message:String(error)} }); return }
      openingWebsite = true
      lastWebsiteOpened = performance.now()
      const opening = data.external === true
        ? toolbox.openExternalWebsite(destination.url, [...options.networkHosts])
        : options.openWebsite(destination.url,destination.title)
      void opening.then(()=>send({type:'websiteResult',requestId})).catch(error=>send({type:'websiteResult',requestId,error:{message:error?.message??String(error)}})).finally(()=>{openingWebsite=false})
    } else if (data.type === 'copyText' && typeof data.requestId === 'string' && typeof data.text === 'string') {
      const requestId = data.requestId
      if (!options.copyText || new TextEncoder().encode(data.text).byteLength > options.outputBytes) { send({ type: 'copyResult', requestId, error: { message: '复制内容超过上限或接口不可用。' } }); return }
      void options.copyText(data.text).then(() => send({ type: 'copyResult', requestId })).catch(error => send({ type: 'copyResult', requestId, error: { message: String(error) } }))
    } else if (data.type === 'cancelHttp' && typeof data.requestId === 'string') {
      requests.get(data.requestId)?.abort()
      http.cancel(data.requestId)
    } else if (data.type === 'cancelFile' && operation && data.requestId === operation.requestId) operation.controller.abort()
  }
  window.addEventListener('message', onMessage)
  window.addEventListener('resize', onViewportResize)
  window.visualViewport?.addEventListener('resize', onViewportResize)
  void Promise.resolve(nativeReady).then(initializeFrame).catch(() => {})
  return {
    frame, ready,
    setFullscreen(value: boolean) {
      if (closed) return
      fullscreen = value
      send({ type: 'presentationState', fullscreen })
      onViewportResize()
      scheduleLayout()
    },
    cancelFiles() {
      let canceled = false
      if (operation && !operation.controller.signal.aborted) { operation.controller.abort(); canceled = true }
      for (const controller of fileRequests.values()) { controller.abort(); canceled = true }
      if (tasks.size) { send({type:'cancelTasks'}); canceled = true }
      return canceled
    },
    dispose() {
      if (closed) return
      send({ type: 'dispose' })
      closed = true
      operation?.controller.abort()
      for (const controller of requests.values()) controller.abort()
      http.dispose()
      requests.clear()
      for (const controller of fileRequests.values()) controller.abort()
      fileRequests.clear()
      tasks.clear()
      void nativeReady?.then(() => options.files?.close(id)).catch(() => {})
      clearTimeout(loadTimer)
      if (layoutTimer !== undefined) window.cancelAnimationFrame(layoutTimer)
      window.removeEventListener('message', onMessage)
      window.removeEventListener('resize', onViewportResize)
      window.visualViewport?.removeEventListener('resize', onViewportResize)
      if (!settled) { settled = true; rejectReady(new Error('网页工具已停止。')) }
    },
  }
}
