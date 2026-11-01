import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import { ensureWebFileActive, WebFileError, type WebFileProgress } from './webToolFiles'

async function nativeInvoke<T>(command: string, args?: Parameters<typeof invoke>[1], options?: Parameters<typeof invoke>[2]): Promise<T> {
  try {return await invoke<T>(command,args,options)}
  catch(error) {const message=String(error);const matched=message.match(/^([A-Z_]+):\s*([\s\S]*)$/);throw new WebFileError(matched?.[1]??'FILE_FAILED',matched?.[2]??message)}
}

export const FILE_CHUNK_BYTES = 1024 * 1024
type NativeFile = { id: string; name: string; mime_type: string; size: number; seekable: boolean }
export interface WebFileHost {
  readonly protocolSources?: readonly string[]
  begin(run: string, inputLimit: number, outputLimit: number): Promise<void>
  request(run: string, kind: string, data: Record<string, unknown>, signal: AbortSignal, progress: WebFileProgress): Promise<unknown>
  close(run: string): Promise<void>
}
function binary(value: ArrayBuffer | number[]): Uint8Array { return new Uint8Array(value) }
function handleId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{32}$/.test(value)) throw new WebFileError('FILE_SCOPE', '文件句柄无效。')
  return value
}
function count(value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) throw new WebFileError('FILE_DATA_INVALID', '文件读取位置或大小无效。')
  return value
}

let transportUrl = ''
let transportReady: Promise<void> | undefined
const androidTransport = () => navigator.userAgent.includes('Android')
function initializeTransport(): Promise<void> {
  if (!androidTransport()) return Promise.resolve()
  if (!transportReady) transportReady = nativeInvoke<string>('web_file_transport').then(value => {
    if (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/[0-9a-f]{32}$/.test(value) || Number(new URL(value).port) > 65535) {
      throw new WebFileError('FILE_UNAVAILABLE', '本机文件通道地址无效。')
    }
    transportUrl = value
  }).catch(error => { transportReady = undefined; throw error })
  return transportReady
}

function fileUrl(run: string, id: string, protocol: 'ff-file' | 'ff-work'): string {
  if (androidTransport()) {
    if (!transportUrl) throw new WebFileError('FILE_UNAVAILABLE', '本机文件通道尚未就绪。')
    return `${transportUrl}/${protocol}/${run}/${id}`
  }
  return convertFileSrc(`/${run}/${id}`, protocol)
}

export function encodeFileChunk(bytes: Uint8Array): { encoding: string; data: string } {
  const parts: string[] = []
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)))
  }
  return { encoding: 'base64', data: btoa(parts.join('')) }
}

export const nativeWebFiles: WebFileHost = {
  get protocolSources() { return transportUrl ? [`${transportUrl}/`] : [] },
  async begin(run, inputLimit, outputLimit) {
    await initializeTransport()
    await nativeInvoke('web_file_begin_run', { run, inputLimit, outputLimit })
  },
  close: run => nativeInvoke('web_file_close_run', { run }),
  async request(run, kind, data, signal, progress) {
    ensureWebFileActive(signal)
    if (kind === 'open') {
      const extensions = data.extensions
      if (!Array.isArray(extensions) || extensions.length > 12 || !extensions.every(v => typeof v === 'string' && /^[a-z0-9]{1,10}$/.test(v))) throw new WebFileError('FILE_TYPES_INVALID', '文件类型无效。')
      progress('selecting')
      const selected = await open({ title: '选择要处理的文件', multiple: data.multiple === true, directory: false,
        ...(!navigator.userAgent.includes('Android') && extensions.length ? { filters: [{ name: '可选文件', extensions }] } : {}) })
      ensureWebFileActive(signal)
      if (!selected) return []
      const paths = typeof selected === 'string' ? [selected] : selected
      if (paths.length > 64) throw new WebFileError('FILE_COUNT_LIMIT', '一次最多选择 64 个文件。')
      const files: (NativeFile & { url: string })[] = []
      try {
        for (const path of paths) {
          const file = await nativeInvoke<NativeFile>('web_file_open', { run, path })
          files.push({ ...file, url: file.seekable && file.size > 0 ? fileUrl(run, file.id, 'ff-file') : '' })
          ensureWebFileActive(signal)
        }
        return files
      } catch (error) { await Promise.allSettled(files.map(file => nativeInvoke('web_file_close', { run, id: file.id }))); throw error }
    }
    if (kind === 'createWriter') {
      const id=await nativeInvoke<string>('web_file_create_writer', { run })
      return {id,workspaceUrl:fileUrl(run,id,'ff-work')}
    }
    const id = handleId(data.fileId)
    if (kind === 'read') {
      progress('reading')
      const offset = count(data.offset, 2 * 1024 * 1024 * 1024)
      const length = count(data.length, FILE_CHUNK_BYTES)
      if (!length) throw new WebFileError('FILE_CHUNK_LIMIT', '文件块大小必须大于零。')
      const bytes = binary(await nativeInvoke<ArrayBuffer>('web_file_read', { run, id, offset, length }))
      ensureWebFileActive(signal)
      return bytes
    }
    if (kind === 'preview') {
      if(typeof data.name!=='string'||!data.name.trim()||data.name.length>120)throw new WebFileError('FILE_NAME_INVALID','输出文件名无效。')
      const file=await nativeInvoke<NativeFile>('web_file_preview_writer',{run,id,name:data.name})
      return {...file,url:file.size>0?fileUrl(run,file.id,'ff-file'):''}
    }
    if (kind === 'write') {
      progress('writing')
      if (!(data.bytes instanceof Uint8Array) || data.bytes.byteLength > FILE_CHUNK_BYTES) throw new WebFileError('FILE_CHUNK_LIMIT', '每次写入最多 1 MiB。')
      const payload = androidTransport() ? encodeFileChunk(data.bytes) : data.bytes
      const size = await nativeInvoke<number>('web_file_write', payload, { headers: { 'x-firefly-run': run, 'x-firefly-file': id } })
      ensureWebFileActive(signal)
      return size
    }
    if (kind === 'close') return nativeInvoke<void>('web_file_close', { run, id })
    if (kind === 'save') {
      if (typeof data.name !== 'string' || !data.name.trim() || data.name.length > 120) throw new WebFileError('FILE_NAME_INVALID', '输出文件名无效。')
      const name = data.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim()
      progress('selecting')
      const path = await save({ title: '保存处理结果', defaultPath: name })
      ensureWebFileActive(signal)
      if (!path) return false
      progress('writing')
      await nativeInvoke('web_file_save_writer', { run, id, path })
      ensureWebFileActive(signal)
      return true
    }
    throw new WebFileError('FILE_OPERATION_INVALID', '不支持此文件操作。')
  },
}
