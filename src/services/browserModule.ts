import { createWebToolSession, type WebToolOptions } from './webToolRuntime'
import { openToolStorage, clearToolPreviewStorage } from './webToolStorage'

let activeFrame: HTMLIFrameElement | null = null
let activeCleanup: (() => void) | null = null
let activeRevision = 0
let activeFileCancel: (() => boolean) | null = null
let activePresentation: ((fullscreen: boolean) => void) | null = null

export function setWebToolFullscreen(fullscreen: boolean) { activePresentation?.(fullscreen) }

export function stopBrowserModule() {
  activeRevision++
  activeFileCancel = null
  activePresentation = null
  const cleanup = activeCleanup
  activeCleanup = null
  cleanup?.()
  activeFrame?.remove()
  activeFrame = null
}

export async function clearPreviewStorage(): Promise<number> {
  stopBrowserModule()
  return clearToolPreviewStorage()
}

export function cancelWebToolFileOperations(): boolean {
  return activeFileCancel?.() ?? false
}

export async function mountWebTool(container: HTMLElement, options: WebToolOptions): Promise<void> {
  stopBrowserModule()
  const revision = activeRevision
  const hook = 'firefly_budget_' + crypto.randomUUID().replaceAll('-', '')
  const { protectWebToolScript } = await import('./webToolScript')
  const script = protectWebToolScript(options.script, hook, options.scriptName ?? 'main.js')
  const storage = await openToolStorage(options.moduleId)
  if (revision !== activeRevision) throw new DOMException('Web tool stopped.', 'AbortError')
  const session = createWebToolSession(container, { ...options, script }, hook, storage, stopBrowserModule)
  activeFrame = session.frame
  activeCleanup = session.dispose
  activeFileCancel = session.cancelFiles
  activePresentation = session.setFullscreen
  await session.ready
}
