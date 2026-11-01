import { invoke, isTauri } from '@tauri-apps/api/core'

export async function applyNativeToolFullscreen(enabled: boolean): Promise<void> {
  if (!isTauri()) return
  if (navigator.userAgent.includes('Android')) {
    if (!window.FireflyToolWindow) throw new Error('当前 Android 界面尚未准备好。')
    await window.FireflyToolWindow.setFullscreen(enabled)
  } else if (navigator.userAgent.includes('Windows')) {
    await invoke('set_web_tool_fullscreen', { enabled })
  }
}

// Serialize native transitions. Leaving/switching tools must always win over an
// older asynchronous enter, and an abandoned enter must release its native lease.
export function createToolFullscreenController(apply: (enabled: boolean) => Promise<void>, changed: (enabled: boolean) => void, failed: (message: string) => void) {
  let active = false, revision = 0, disposed = false
  let pending = Promise.resolve()
  function enqueue(enabled: boolean, report: boolean) {
    const current = ++revision
    pending = pending.then(async () => {
      if (current === revision) await apply(enabled)
    }).catch(() => {
      if (current !== revision || disposed) return
      if (enabled) {
        active = false; changed(false)
        enqueue(false, false)
      }
      if (report) failed(enabled ? '无法进入系统全屏，请重试。' : '系统全屏恢复失败，请切回应用后重试。')
    })
  }
  return {
    set(enabled: boolean) {
      if (disposed || active === enabled) return
      active = enabled; changed(enabled); enqueue(enabled, true)
    },
    reset() { if (!disposed) enqueue(active, false) },
    dispose() { if (active) { active = false; changed(false) }; enqueue(false, false); disposed = true },
    async settled() { let current; do { current = pending; await current } while (current !== pending) },
  }
}
