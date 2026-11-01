import { savePreferences } from './preferences'
import { SCRIPT_BUDGET_KEYS } from './webToolBudgets'
import { WEB_TOOL_PRESENTATION_KEYS } from './webToolPresentation'

// Only controls on More Settings belong here. Theme, artwork, layouts, history
// and tool data are intentionally outside this reset.
export const MORE_SETTINGS_DEFAULTS: Readonly<Record<string, string | null>> = Object.freeze({
  'firefly.start-page.v1': 'home',
  'firefly.auto-hide-bars.v1': 'true',
  'firefly.smart-clipboard.v1': 'false',
  'firefly.usage-stats.v1': 'false',
  'firefly.component-transparency.v1': '40',
  'firefly.app-font-size.v1': '100',
  'firefly.card-gap.v1': '10',
  'firefly.home-font-size.v1': null,
  'firefly.home-card-gap.v1': null,
  ...Object.fromEntries([...SCRIPT_BUDGET_KEYS, ...WEB_TOOL_PRESENTATION_KEYS].map(key => [key, null])),
})

export type DesktopResetAdapter = {
  read: () => Promise<{ closeBehavior: 'tray' | 'exit'; autostart: boolean }>
  setCloseBehavior: (behavior: 'tray' | 'exit') => Promise<void>
  setAutostart: (enabled: boolean) => Promise<void>
}

export async function resetMoreSettings(desktop?: DesktopResetAdapter): Promise<void> {
  const rollback: (() => Promise<void>)[] = []
  try {
    if (desktop) {
      const before = await desktop.read()
      if (before.closeBehavior !== 'tray') {
        rollback.push(() => desktop.setCloseBehavior(before.closeBehavior))
        await desktop.setCloseBehavior('tray')
      }
      if (before.autostart) {
        rollback.push(() => desktop.setAutostart(before.autostart))
        await desktop.setAutostart(false)
      }
    }
    savePreferences({ ...MORE_SETTINGS_DEFAULTS })
  } catch (error) {
    let incomplete = false
    for (const restore of rollback.reverse()) {
      try { await restore() } catch { incomplete = true }
    }
    if (incomplete) throw new Error('重置未完成，部分 Windows 设置未能恢复，请检查关闭行为与开机自启。')
    throw error
  }
}
