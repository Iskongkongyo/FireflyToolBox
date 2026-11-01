import type { DetectionResult } from './toolbox'

export const MAX_DETECTION_BYTES = 1024 * 1024
export function detectionInputTooLarge(value: string) {
  return value.length > MAX_DETECTION_BYTES || new TextEncoder().encode(value).byteLength > MAX_DETECTION_BYTES
}
export function validateDetectionInput(value: string) {
  if (detectionInputTooLarge(value)) throw new Error('待识别内容不能超过 1 MiB。')
}

/** Coalesce foreground events and discard results from an obsolete activation. */
export function createClipboardDetection(options: {
  read: () => Promise<string>
  detect: (value: string) => Promise<DetectionResult[]>
  canCheck: () => boolean
  show: (value: string, results: DetectionResult[]) => void
}) {
  let revision = 0
  let requested = false
  let lastChecked: string | null = null
  let task: Promise<void> | null = null
  function cancel(forget = false) {
    revision++
    requested = false
    if (forget) lastChecked = null
  }
  async function drain() {
    while (requested && options.canCheck()) {
      requested = false
      const current = revision
      try {
        const value = await options.read()
        if (current !== revision || !options.canCheck() || !value.trim() || detectionInputTooLarge(value) || value === lastChecked) continue
        const results = await options.detect(value)
        if (current !== revision || !options.canCheck()) continue
        lastChecked = value
        const confident = results.filter(result => result.confidence >= .5 && result.actions.length > 0)
        if (confident.length) options.show(value, confident)
      } catch { /* Retry on the next foreground event; never expose clipboard text in an error. */ }
    }
  }
  function check(): Promise<void> {
    revision++
    requested = true
    if (task) return task
    if (!options.canCheck()) return Promise.resolve()
    task = drain().finally(() => {
      task = null
      if (requested && options.canCheck()) return check()
    })
    return task
  }
  return { check, cancel }
}
