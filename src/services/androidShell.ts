type ShellState = { top: number; bottom: number; shortcutPending: boolean; cutoutTop?: number; cutoutRight?: number }

// These adapters exist only in the app's main JS document. The native endpoint
// independently checks the sender origin and isMainFrame on every request.
export async function initializeAndroidShell() {
  if (window !== window.top) throw new Error('Android 原生接口仅供应用主页面使用。')
  const bridge = window.FireflyAndroid
  if (!bridge) throw new Error('请更新 Android System WebView 后重新打开应用。')
  let sequence = 0
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  bridge.onmessage = event => {
    let response: { id?: unknown; result?: unknown; error?: unknown }
    try { response = JSON.parse(event.data) } catch { return }
    if (!response || typeof response.id !== 'string') return
    const request = pending.get(response.id)
    if (!request) return
    pending.delete(response.id)
    clearTimeout(request.timer)
    if (typeof response.error === 'string') request.reject(new Error(response.error))
    else request.resolve(response.result)
  }
  function request(operation: string, value?: string | boolean): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = String(++sequence)
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error('Android 原生接口响应超时，请重新打开应用。'))
      }, 5000)
      pending.set(id, { resolve, reject, timer })
      try { bridge!.postMessage(JSON.stringify({ id, operation, value })) }
      catch (error) { clearTimeout(timer); pending.delete(id); reject(error) }
    })
  }
  const state = await request('state') as ShellState | null
  if (!state || !Number.isFinite(state.top) || state.top < 0 || !Number.isFinite(state.bottom) || state.bottom < 0 || typeof state.shortcutPending !== 'boolean') {
    throw new Error('Android 原生接口返回了无效的启动状态。')
  }
  const notify = (operation: string, value: boolean) => { void request(operation, value).catch(error => console.error(error)) }
  window.addEventListener('firefly:insets', event => {
    const insets = (event as CustomEvent<{ top: number; bottom: number }>).detail
    if (insets && Number.isFinite(insets.top) && insets.top >= 0 && Number.isFinite(insets.bottom) && insets.bottom >= 0) {
      state.top = insets.top
      state.bottom = insets.bottom
      const extra = insets as typeof insets & { cutoutTop?: number; cutoutRight?: number }
      if (Number.isFinite(extra.cutoutTop) && extra.cutoutTop! >= 0) state.cutoutTop = extra.cutoutTop
      if (Number.isFinite(extra.cutoutRight) && extra.cutoutRight! >= 0) state.cutoutRight = extra.cutoutRight
    }
  })
  window.FireflyInsets = { top: () => state.top, bottom: () => state.bottom, cutoutTop: () => state.cutoutTop ?? 0, cutoutRight: () => state.cutoutRight ?? 0 }
  window.FireflyShortcutLaunch = { hasPendingLaunch: () => state.shortcutPending }
  window.FireflyAppearance = { setDark: dark => notify('setDark', dark) }
  window.FireflyNavigation = { setBackEnabled: enabled => notify('setBackEnabled', enabled) }
  window.FireflyWebsites = { open: async url => { await request('openWebsite', url) } }
  window.FireflyToolWindow = { setFullscreen: async enabled => { await request('setToolFullscreen', enabled) } }
}
