/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

interface Window {
  FireflyToolWindow?: { setFullscreen(enabled: boolean): Promise<void> }
  FireflyAndroid?: {
    postMessage(message: string): void
    onmessage: ((event: { data: string }) => void) | null
  }
  FireflyShortcutLaunch?: {
    hasPendingLaunch(): boolean
  }
  FireflyAppearance?: {
    setDark(dark: boolean): void
  }
  FireflyNavigation?: {
    setBackEnabled(enabled: boolean): void
  }
  FireflyWebsites?: {
    open(url: string): Promise<void>
  }
  FireflyInsets?: {
    top(): number
    bottom(): number
    cutoutTop?(): number
    cutoutRight?(): number
  }
}
