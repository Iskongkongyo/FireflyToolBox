import type { ConfigurationSnapshot } from './toolbox'
import { layoutKeys, preferenceKeys, savePreferences, validatePreferences } from './preferences'

export const BACKUP_KEYS = [...preferenceKeys, ...layoutKeys]
export const MAX_CONFIG_BYTES = 20 * 1024 * 1024
type Backup = { format: 'firefly-config-v1'; database: ConfigurationSnapshot; preferences: Record<string, string> }

export function collectBackupPreferences(): Record<string, string> {
  const preferences: Record<string, string> = Object.create(null)
  for (const key of BACKUP_KEYS) {
    const value = localStorage.getItem(key)
    if (value !== null) preferences[key] = value
  }
  validatePreferences(preferences)
  return preferences
}

export function parseBackup(contents: string): Backup {
  if (new TextEncoder().encode(contents).byteLength > MAX_CONFIG_BYTES) throw new Error('配置文件不能超过 20 MiB，未导入。')
  const parsed = JSON.parse(contents.replace(/^\uFEFF/, ''))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.format !== 'firefly-config-v1'
    || !parsed.database || typeof parsed.database !== 'object' || Array.isArray(parsed.database)) throw new Error('配置文件格式无效。')
  const database = parsed.database
  if (database.schema_version !== 3 || Object.keys(database).some(key => !['schema_version', 'favorites', 'websites'].includes(key))
    || !Array.isArray(database.favorites) || database.favorites.length > 1000
    || database.favorites.some((id: unknown) => typeof id !== 'string' || id.length > 160)
    || new Set(database.favorites).size !== database.favorites.length
    || !Array.isArray(database.websites) || database.websites.length > 1000) throw new Error('配置中的收藏或网站格式无效。')
  validatePreferences(parsed.preferences)
  return parsed as Backup
}

export function serializeBackup(database: ConfigurationSnapshot): string {
  const contents = JSON.stringify({ format: 'firefly-config-v1', database, preferences: collectBackupPreferences() }, null, 2)
  parseBackup(contents)
  return contents
}

export function restoreBackupPreferences(preferences: Record<string, string>) {
  validatePreferences(preferences)
  savePreferences(Object.fromEntries(BACKUP_KEYS.map(key => [key, preferences[key] ?? null])))
}
