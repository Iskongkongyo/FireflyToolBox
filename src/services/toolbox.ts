import { invoke, isTauri } from '@tauri-apps/api/core'
import type { CacheReport } from './runtimeCache'

export interface ToolDescriptor {
  id: string
  name: string
  description: string
  category: string
  tags: string[]
  aliases: string[]
  actions: { id: string; label: string; input_types?: string[]; consumes_input?: boolean; accepts_empty_input?: boolean }[]
  pipeline_compatible?: boolean
  custom: boolean
  builtin: boolean
  module_id?: string | null
  runtime?: 'browser' | null
  ui_kind?: 'text' | 'web' | null
  icon?: string | null
  icon_data?: string | null
}

export interface ModuleSummary {
  module_id: string
  version: string
  name: string
  author: string
  tools: string[]
  tool_ids: string[]
  categories: string[]
  network_hosts: string[]
  builtin: boolean
  modified: boolean
}

export interface ModuleManifest {
  schema_version: number
  module_id: string
  version: string
  api_version: string
  min_app_version: string
  name: Record<string, string>
  author: string
  license: string
  platforms: string[]
  permissions: string[]
  network: { hosts: string[] }
  limits: { input_bytes: number; output_bytes: number; timeout_ms: number; heap_bytes: number }
  resources?: { path: string; size: number; sha256: string }[]
  tools: {
    id: string
    name: Record<string, string>
    description: Record<string, string>
    category: string
    icon?: string
    icon_data?: string
    tags: string[]
    aliases: string[]
    entry: string
    runtime?: 'browser'
    input_schema: unknown
    output_schema: unknown
    ui: { kind: string; input_field?: string; output_field?: string; script?: string; style?: string; fullscreen?: boolean }
    actions: { id: string; label: Record<string, string>; input_types?: string[] }[]
  }[]
}

export interface ModuleDetails {
  manifest: ModuleManifest
  scripts: Record<string, string>
  builtin: boolean
  modified: boolean
}

export interface ToolStep {
  tool_id: string
  action: string
}

export interface CustomTool {
  icon?: string | null
  icon_data?: string | null
  id: string
  name: string
  description: string
  tags: string[]
  steps: ToolStep[]
}

export interface ConfigurationSnapshot {
  schema_version: number
  favorites: string[]
  websites: Website[]
}

export interface DetectionResult {
  type_id: string
  label: string
  confidence: number
  actions: DetectionAction[]
}

export interface DetectionAction {
  id: string
  label: string
  tool_id: string
}

export interface ToolError {
  code: string
  message: string
  line?: number
  column?: number
}

export interface Website {
  id: number
  name: string
  url: string
  description: string
  tags: string
  favorite: boolean
}

export interface SavedWebsite {
  id: number
  websites: Website[]
}

export const toolbox = {
  stageModuleResource: (path: string, resourceDraftId: string) => invoke<{path:string;size:number;sha256:string}>('stage_module_resource',{path,resourceDraftId}),
  discardModuleResources: (resourceDraftId: string, path?: string) => invoke<void>('discard_module_resources',{resourceDraftId,path}),
  inspectModuleFile: (path: string) => invoke<ModuleSummary>('inspect_module_file', { path }),
  installModuleFile: (path: string) => invoke<ModuleSummary>('install_module_file', { path }),
  exportModuleFile: (moduleId: string, path: string) => invoke<void>('export_module_file', { moduleId, path }),
  validateModuleDraft: (manifest: ModuleManifest, scripts: Record<string, string>, resourceModuleId?: string, resourceDraftId?: string) => invoke<ModuleSummary>('validate_module_draft', { manifest, scripts, resourceModuleId, resourceDraftId }),
  installModuleDraft: (manifest: ModuleManifest, scripts: Record<string, string>, resourceModuleId?: string, resourceDraftId?: string) => invoke<ModuleSummary>('install_module_draft', { manifest, scripts, resourceModuleId, resourceDraftId }),
  exportModuleDraftFile: (manifest: ModuleManifest, scripts: Record<string, string>, path: string, resourceModuleId?: string, resourceDraftId?: string) => invoke<void>('export_module_draft_file', { manifest, scripts, path, resourceModuleId, resourceDraftId }),
  readModuleResource: async (moduleId: string, path: string, offset: number, length: number, expectedSha256?: string, resourceDraftId?: string) => new Uint8Array(await invoke<ArrayBuffer>('read_module_resource', { moduleId, path, offset, length, expectedSha256, resourceDraftId })),
  inspectCertificate: (url: string, allowedHosts: string[]) => invoke<Record<string, unknown>>('web_tool_certificate', { url, allowedHosts }),
  hashSelectedFile: (path: string, algorithm: string, requestId: string) => invoke<{ name: string; size: number; algorithm: string; digest: string }>('hash_selected_file', { path, algorithm, requestId }),
  cancelHashFile: (requestId: string) => invoke<void>('cancel_hash_file', { requestId }),
  webToolRequest: (url: string, allowedHosts: string[]) => invoke<{ status: number; url: string; content_type: string; body_base64: string }>('web_tool_request', { url, allowedHosts }),
  openExternalWebsite: async (url: string, allowedHosts: string[]) => {
    if (isTauri()) await invoke<void>('web_tool_open_external', { url, allowedHosts })
    else window.open(url, '_blank', 'noopener,noreferrer')
  },
  resolveLink: (url: string, allowedHosts: string[]) => invoke<{ url: string; hops: string[]; status: number; http_stopped: boolean }>('web_tool_resolve_link',{url,allowedHosts}),
  clearRuntimeCache: () => invoke<CacheReport>('clear_runtime_cache'),
  listTools: () => invoke<ToolDescriptor[]>('list_tools'),
  listDeletedBuiltinTools: () => invoke<ToolDescriptor[]>('list_deleted_builtin_tools'),
  deleteBuiltinTool: (toolId: string) => invoke<void>('delete_builtin_tool', { toolId }),
  restoreBuiltinTools: (toolIds: string[]) => invoke<void>('restore_builtin_tools', { toolIds }),
  searchTools: (query: string) => invoke<ToolDescriptor[]>('search_tools', { query }),
  runTool: (toolId: string, action: string, input: string, recordUsage = true, requestId?: string) => invoke<string>('run_text_tool', { toolId, action, input, recordUsage, requestId }),
  cancelModuleRun: (requestId: string) => invoke<boolean>('cancel_module_run', { requestId }),
  recordToolOpen: (toolId: string) => invoke<void>('record_tool_open', { toolId }),
  listRecentTools: () => invoke<string[]>('list_recent_tools'),
  clearRecentTools: () => invoke<void>('clear_recent_tools'),
  listCustomTools: () => invoke<CustomTool[]>('list_custom_tools'),
  saveCustomTool: (tool: CustomTool) => invoke<CustomTool>('save_custom_tool', { tool }),
  deleteCustomTool: (id: string) => invoke<void>('delete_custom_tool', { id }),
  inspectModule: (bytes: number[]) => invoke<ModuleSummary>('inspect_module', { bytes }),
  createModulePackage: (manifest: ModuleManifest, scripts: Record<string, string>) => invoke<number[]>('create_module_package', { manifest, scripts }),
  previewToolPackage: (bytes: number[], input: string, action: string, requestId: string) => invoke<string>('preview_tool_package', { bytes, input, action, requestId }),
  getModuleDetails: (moduleId: string) => invoke<ModuleDetails>('get_module_details', { moduleId }),
  resetBuiltinModule: (moduleId: string) => invoke<void>('reset_builtin_module', { moduleId }),
  exportModule: (moduleId: string) => invoke<number[]>('export_module', { moduleId }),
  installModule: (bytes: number[]) => invoke<ModuleSummary>('install_module', { bytes }),
  listModules: () => invoke<ModuleSummary[]>('list_modules'),
  deleteModule: (moduleId: string) => invoke<void>('delete_module', { moduleId }),
  deleteModuleTool: (moduleId: string, toolId: string) => invoke<void>('delete_module_tool', { moduleId, toolId }),
  deleteTools: (toolIds: string[]) => invoke<number>('delete_tools', { toolIds }),
  exportConfiguration: () => invoke<ConfigurationSnapshot>('export_configuration'),
  importConfiguration: (backup: ConfigurationSnapshot) => invoke<void>('import_configuration', { backup }),
  readConfigurationFile: (path: string) => invoke<string>('read_configuration_file', { path }),
  writeConfigurationFile: (path: string, contents: string) => invoke<void>('write_configuration_file', { path, contents }),
  detectText: (input: string) => invoke<DetectionResult[]>('detect_text', { input }),
  listFavorites: () => invoke<string[]>('list_favorites'),
  setFavorite: (toolId: string, favorite: boolean) =>
    invoke<void>('set_favorite', { toolId, favorite }),
  replaceFavorites: (toolIds: string[]) => invoke<string[]>('replace_favorites', { toolIds }),
  listWebsites: () => invoke<Website[]>('list_websites'),
  saveWebsite: (website: Website) => invoke<SavedWebsite>('save_website', { website }),
  deleteWebsite: (id: number) => invoke<Website[]>('delete_website', { id }),
}
