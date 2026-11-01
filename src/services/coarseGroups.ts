import { coarseCategory, LEGACY_BUILTIN_CATEGORIES } from './builtinCategories'
import { DEFAULT_HOME_CATEGORIES, HOME_OTHER_GROUP, type HomeGroupSettings } from './groupSettings'
export function coarseGroupId(id: string, settings: HomeGroupSettings): string {
  return id.startsWith('source:') && !settings.names[id] ? `source:${coarseCategory(id.slice(7))}` : id
}
export function defaultHomeGroupId(tool: { id: string; category: string }, settings: HomeGroupSettings): string {
  const legacy = LEGACY_BUILTIN_CATEGORIES[tool.id] ?? tool.category, oldId = legacy ? `source:${legacy}` : ''
  if (oldId && coarseCategory(legacy) === coarseCategory(tool.category)) {
    if (settings.deleted.includes(oldId)) return HOME_OTHER_GROUP
    if (settings.names[oldId]) return oldId
  }
  const id = `source:${coarseCategory(tool.category)}`
  return settings.deleted.includes(id) ? HOME_OTHER_GROUP : id
}
export function resolveHomeGroupId(tool: { id: string; category: string }, settings: HomeGroupSettings): string {
  const assigned = settings.assignments[tool.id]
  if (assigned === HOME_OTHER_GROUP || settings.custom.some(group => group.id === assigned)
    || (assigned?.startsWith('source:') && !settings.deleted.includes(assigned))) {
    const id = coarseGroupId(assigned, settings)
    return settings.deleted.includes(id) ? HOME_OTHER_GROUP : id
  }
  return defaultHomeGroupId(tool, settings)
}

export function homeSourceGroupIds(tools: readonly { id: string; category: string }[], settings: HomeGroupSettings): string[] {
  const populated = new Set(tools.map(tool => resolveHomeGroupId(tool, settings)))
  const presets = new Set<string>(DEFAULT_HOME_CATEGORIES.map(category => `source:${category}`))
  const sources = [...new Set([...tools.map(tool => `source:${coarseCategory(tool.category)}`),
    ...Object.keys(settings.names).filter(id => id.startsWith('source:'))])]
  // Category metadata alone must not create an empty non-preset group when
  // all of its tools have explicitly been placed in other groups.
  return sources.filter(id => !settings.deleted.includes(id)
    && (presets.has(id) || populated.has(id) || Object.prototype.hasOwnProperty.call(settings.names, id)))
}
export function coarseHomeToolOrder(id: string, orders: Record<string, string[]>, categoryOrder: string[], settings: HomeGroupSettings): string[] {
  const keys = [...new Set([id, ...categoryOrder, ...Object.keys(orders)])]
  return [...new Set(keys.filter(key => coarseGroupId(key, settings) === id).flatMap(key => orders[key] ?? []))]
}
