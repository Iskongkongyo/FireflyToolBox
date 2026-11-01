// Install in an isolated browser context before loading the Android app UI.
export function mockAndroidShell() {
  window.shellCalls = []
  window.FireflyAndroid = {
    onmessage: null,
    postMessage(text) {
      const request = JSON.parse(text)
      window.shellCalls.push(request)
      queueMicrotask(() => window.FireflyAndroid.onmessage?.({ data: JSON.stringify({
        id: request.id,
        result: request.operation === 'state' ? { top: 24, bottom: 16, shortcutPending: !!window.launchHint } : true,
      }) }))
    },
  }
}
