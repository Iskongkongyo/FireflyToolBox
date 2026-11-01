export type WebFileStage = 'selecting' | 'reading' | 'writing' | 'processing'
export type WebFileStatus = { busy: boolean; message: string; code?: string; stage?: WebFileStage }
export type WebFileProgress = (stage: WebFileStage) => void
export const WEB_SMALL_FILE_BYTES = 32 * 1024 * 1024

export function stoppedWebFileStatus(status: WebFileStatus): WebFileStatus {
  if (!status.busy) return status
  return { busy: false, code: 'FILE_CANCELED', message: status.stage === 'selecting'
    ? '网页工具已停止；系统文件对话框仍需手动关闭。'
    : status.stage === 'writing' ? '网页工具已停止；已经开始的文件写入可能仍会完成。' : status.stage === 'processing' ? '网页工具已停止，当前处理任务已取消。' : '网页工具已停止，文件读取已取消。' }
}

export class WebFileError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'WebFileError' }
}

export function ensureWebFileActive(signal: AbortSignal) {
  if (signal.aborted) throw new WebFileError('FILE_CANCELED', '文件操作已取消。')
}

export function describeWebFileError(error: unknown): { code: string; message: string } {
  if (error instanceof WebFileError) return { code: error.code, message: error.message }
  if (error instanceof Error && error.name === 'AbortError') return { code: 'FILE_CANCELED', message: '文件操作已取消。' }
  return { code: 'FILE_FAILED', message: error instanceof Error ? error.message : typeof error === 'string' ? error : '文件操作失败，请重试。' }
}
