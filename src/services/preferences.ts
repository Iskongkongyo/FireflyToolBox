import { parseHomeGroupSettings, parseFavoriteGroupSettings, parseWebsiteGroupSettings } from './groupSettings'
import { SCRIPT_BUDGET_KEYS, validScriptBudget } from './webToolBudgets'
import { WEB_TOOL_PRESENTATION_KEYS } from './webToolPresentation'

export const layoutKeys = ['firefly.groups.home.v1', 'firefly.groups.favorites.v1', 'firefly.groups.websites.v1', 'firefly.order.categories.v1', 'firefly.order.homeTools.v1', 'firefly.order.favorites.v1', 'firefly.order.favoriteGroups.v1', 'firefly.order.websites.v1', 'firefly.order.websiteGroups.v1']
export const preferenceKeys = ['firefly.theme.v1', 'firefly.start-page.v1', 'firefly.accent.v1', 'firefly.auto-hide-bars.v1', 'firefly.smart-clipboard.v1', 'firefly.usage-stats.v1', 'firefly.component-transparency.v1', 'firefly.home-font-size.v1', 'firefly.app-font-size.v1', 'firefly.card-gap.v1', ...SCRIPT_BUDGET_KEYS, ...WEB_TOOL_PRESENTATION_KEYS]
export const webDataPrefix = 'firefly.browser-module.tool.'

export function orderedStrings(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 1000 || value.some(item => typeof item !== 'string' || item.length > 160)) throw new Error('排序设置无效。')
  return [...new Set(value)] as string[]
}

export function validatePreferences(preferences: Record<string, string>, allowWebData = false) {
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences) || Object.keys(preferences).length > 500) throw new Error('设置格式无效。')
  let bytes = 0
  const ranges: Record<string, [number, number]> = {
    'firefly.component-transparency.v1': [0, 80],
    'firefly.home-font-size.v1': [85, 125],
    'firefly.app-font-size.v1': [85, 125],
    'firefly.card-gap.v1': [6, 22],
  }
  for (const [key, value] of Object.entries(preferences)) {
    if (typeof value !== 'string' || value.length > 100_000 || key.length > 400) throw new Error('设置格式无效或内容过大。')
    bytes += new TextEncoder().encode(value).byteLength
    if (key === 'firefly.groups.home.v1') parseHomeGroupSettings(JSON.parse(value))
    else if (key === 'firefly.groups.favorites.v1') parseFavoriteGroupSettings(JSON.parse(value))
    else if (key === 'firefly.groups.websites.v1') parseWebsiteGroupSettings(JSON.parse(value))
    else if (key === 'firefly.order.homeTools.v1') {
      const data: unknown = JSON.parse(value)
      if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length > 1000 || Object.keys(data).some(group => group.length > 160)) throw new Error('首页排序无效。')
      Object.values(data).forEach(orderedStrings)
    } else if (layoutKeys.includes(key)) orderedStrings(JSON.parse(value))
    else if (key === 'firefly.theme.v1' && !['system', 'light', 'dark'].includes(value)) throw new Error('主题设置无效。')
    else if (key === 'firefly.start-page.v1' && !['home', 'favorites', 'websites'].includes(value)) throw new Error('启动页设置无效。')
    else if (key === 'firefly.accent.v1' && value !== '' && !/^#[0-9a-fA-F]{6}$/.test(value)) throw new Error('主题颜色无效。')
    else if (['firefly.auto-hide-bars.v1', 'firefly.smart-clipboard.v1', 'firefly.usage-stats.v1', ...WEB_TOOL_PRESENTATION_KEYS].includes(key) && !['true', 'false'].includes(value)) throw new Error('使用偏好无效。')
    else if (SCRIPT_BUDGET_KEYS.includes(key)) { if (!validScriptBudget(value)) throw new Error('网页工具运行预算无效。') }
    else if (ranges[key]) {
      const [min, max] = ranges[key]
      if (!value.trim() || !Number.isFinite(Number(value)) || Number(value) < min || Number(value) > max) throw new Error('显示设置超出支持范围。')
    } else if (!layoutKeys.includes(key) && !preferenceKeys.includes(key) && !(allowWebData && key.startsWith(webDataPrefix))) throw new Error('设置包含不支持的项目。')
  }
  if (bytes > 2 * 1024 * 1024) throw new Error('设置总大小超过 2 MiB。')
}

/** Apply removals first so replacing a full storage area can still succeed. */
export function savePreferences(values: Record<string, string | null>) {
  const entries = Object.entries(values)
  const old = new Map(entries.map(([key]) => [key, localStorage.getItem(key)]))
  try {
    for (const [key] of entries) localStorage.removeItem(key)
    for (const [key, value] of entries) if (value !== null) localStorage.setItem(key, value)
  } catch (error) {
    let rollbackFailed = false
    for (const [key] of entries) {
      try { localStorage.removeItem(key) } catch { rollbackFailed = true }
    }
    for (const [key, value] of old) {
      try { if (value !== null) localStorage.setItem(key, value) } catch { rollbackFailed = true }
    }
    if (rollbackFailed) throw new Error('设置保存失败，且部分原设置无法恢复，请检查存储空间后重新导入。')
    throw error
  }
}
