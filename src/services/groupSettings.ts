export const HOME_OTHER_GROUP = 'home:other'
export const DEFAULT_HOME_CATEGORIES = ['开发与文本', '图片与影音', '文件与文档', '生活与查询', '效率工具', '趣味与AI'] as const
export const FAVORITE_UNGROUPED = 'favorite:ungrouped'
export const WEBSITE_UNGROUPED = 'website:ungrouped'
export const HOME_GROUPS_KEY = 'firefly.groups.home.v1'
export const FAVORITE_GROUPS_KEY = 'firefly.groups.favorites.v1'
export const WEBSITE_GROUPS_KEY = 'firefly.groups.websites.v1'

export type NamedGroup = { id: string; name: string }
export type HomeGroupSettings = {
  names: Record<string, string>
  custom: NamedGroup[]
  deleted: string[]
  assignments: Record<string, string>
  otherCreated: boolean
}
export type FavoriteGroupSettings = {
  enabled: boolean
  groups: NamedGroup[]
  assignments: Record<string, string>
}
export type WebsiteGroupSettings = FavoriteGroupSettings

export function emptyHomeGroupSettings(): HomeGroupSettings {
  return { names: {}, custom: [], deleted: [], assignments: {}, otherCreated: false }
}

export function emptyFavoriteGroupSettings(): FavoriteGroupSettings {
  return { enabled: false, groups: [], assignments: {} }
}

export function emptyWebsiteGroupSettings(): WebsiteGroupSettings {
  return { enabled: false, groups: [], assignments: {} }
}

function stringRecord(value: unknown): value is Record<string, string> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length <= 1000
    && Object.entries(value).every(([key, entry]) => key.length <= 160 && typeof entry === 'string' && entry.length <= 160)
}

function namedGroups(value: unknown): value is NamedGroup[] {
  return Array.isArray(value) && value.length <= 100
    && value.every((group) => group && typeof group === 'object' && !Array.isArray(group)
      && typeof group.id === 'string' && group.id.length <= 100
      && typeof group.name === 'string' && group.name.trim().length > 0 && group.name.length <= 40)
    && new Set(value.map((group) => group.id)).size === value.length
}

export function parseHomeGroupSettings(value: unknown): HomeGroupSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('首页分组设置无效')
  const data = value as Partial<HomeGroupSettings>
  if (!stringRecord(data.names) || !namedGroups(data.custom) || !stringRecord(data.assignments)
    || !Array.isArray(data.deleted) || data.deleted.length > 1000
    || !data.deleted.every((id) => typeof id === 'string' && id.length <= 160)
    || typeof data.otherCreated !== 'boolean') throw new Error('首页分组设置无效')
  return data as HomeGroupSettings
}

export function parseFavoriteGroupSettings(value: unknown): FavoriteGroupSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('收藏分组设置无效')
  const data = value as Partial<FavoriteGroupSettings>
  if (typeof data.enabled !== 'boolean' || !namedGroups(data.groups) || !stringRecord(data.assignments)) {
    throw new Error('收藏分组设置无效')
  }
  return data as FavoriteGroupSettings
}

export function parseWebsiteGroupSettings(value: unknown): WebsiteGroupSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('网站分组设置无效')
  const data = value as Partial<WebsiteGroupSettings>
  if (typeof data.enabled !== 'boolean' || !namedGroups(data.groups) || !stringRecord(data.assignments)
    || data.groups.some((group) => group.id === WEBSITE_UNGROUPED || !group.id.startsWith('website:'))
    || Object.keys(data.assignments).some((id) => !/^\d+$/.test(id))) throw new Error('网站分组设置无效')
  return data as WebsiteGroupSettings
}
