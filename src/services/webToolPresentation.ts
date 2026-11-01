export const DEFAULT_WEB_TOOL_FULLSCREEN_KEY = 'firefly.web-tool-default-fullscreen.v1'
export const INITIAL_FULLSCREEN_HINT_KEY = 'firefly.web-tool-fullscreen-initial-hint.v1'
export const WEB_TOOL_PRESENTATION_KEYS = [DEFAULT_WEB_TOOL_FULLSCREEN_KEY, INITIAL_FULLSCREEN_HINT_KEY]
export const DEFAULT_WEB_TOOL_PRESENTATION = Object.freeze({ defaultFullscreen: false, initialHint: true })

export function readWebToolPresentation() {
  function read(key: string, fallback: boolean) {
    try {
      const value = localStorage.getItem(key)
      return value === 'true' ? true : value === 'false' ? false : fallback
    } catch { return fallback }
  }
  return Object.freeze({
    defaultFullscreen: read(DEFAULT_WEB_TOOL_FULLSCREEN_KEY, DEFAULT_WEB_TOOL_PRESENTATION.defaultFullscreen),
    initialHint: read(INITIAL_FULLSCREEN_HINT_KEY, DEFAULT_WEB_TOOL_PRESENTATION.initialHint),
  })
}
