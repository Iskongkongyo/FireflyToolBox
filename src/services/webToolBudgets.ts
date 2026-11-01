export const INITIALIZATION_BUDGET_KEY = 'firefly.web-tool-initialization-ms.v1'
export const INTERACTION_BUDGET_KEY = 'firefly.web-tool-interaction-ms.v1'
export const SCRIPT_BUDGET_KEYS = [INITIALIZATION_BUDGET_KEY, INTERACTION_BUDGET_KEY]
export const SCRIPT_BUDGET_CHOICES = [5000, 10000, 30000, 60000, 120000, 300000, 0]
export const DEFAULT_SCRIPT_BUDGETS = Object.freeze({ initializationMs: 5000, interactionMs: 10000 })

export function validScriptBudget(value: string): boolean {
  return SCRIPT_BUDGET_CHOICES.some(choice => String(choice) === value)
}

export function readWebToolBudgets() {
  function read(key: string, fallback: number) {
    try {
      const value = localStorage.getItem(key)
      return value !== null && validScriptBudget(value) ? Number(value) : fallback
    } catch { return fallback }
  }
  return Object.freeze({
    initializationMs: read(INITIALIZATION_BUDGET_KEY, DEFAULT_SCRIPT_BUDGETS.initializationMs),
    interactionMs: read(INTERACTION_BUDGET_KEY, DEFAULT_SCRIPT_BUDGETS.interactionMs),
  })
}

export function webToolMountTimeout(manifestTimeoutMs: number, initializationMs: number): number {
  if (initializationMs === 0) return 0
  // Preserve the manifest deadline at the default setting. A larger CPU budget
  // also needs room for the mounted message to reach the host after computation.
  return initializationMs > DEFAULT_SCRIPT_BUDGETS.initializationMs
    ? Math.max(manifestTimeoutMs, initializationMs + 1000)
    : manifestTimeoutMs
}
