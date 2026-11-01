import imageHtml from '../../examples/modules/image-adjust/index.html?raw'
import imageCss from '../../examples/modules/image-adjust/style.css?raw'
import imageJs from '../../examples/modules/image-adjust/main.js?raw'
import badge from '../../examples/modules/image-adjust/assets/badge.svg?raw'
import dots from '../../examples/modules/image-adjust/assets/dots.svg?raw'
import type { ModuleManifest } from './toolbox'
import { WEB_SOURCE_BYTES, WEB_SOURCE_TOTAL_BYTES, WEB_SOURCE_FILES, WEB_RESOURCE_BYTES, TOOL_WORKSPACE_MAX_CHARS } from './moduleLimits'

export type ToolKind = 'text' | 'web'
export type ModuleScriptDraft = { path: string; source: string }
export type ModuleStudioDraft = {
  moduleId: string; version: string; name: string; author: string; license: string; customLicense: string
  toolSuffix: string; toolName: string; description: string; category: string; icon: string; iconData: string
  tags: string; aliases: string; actionId: string; actionLabel: string; entry: string
  windows: boolean; android: boolean; runtime: 'quickjs' | 'web'; timeoutSeconds: number
  networkHosts: string; scripts: ModuleScriptDraft[]
  inputTypes: string[]
  fullscreen: boolean
  resources?: {path:string;size:number;sha256:string}[]
  resourceDraftId?: string
}
export type ToolContent = Pick<ModuleStudioDraft, 'runtime' | 'entry' | 'scripts' | 'timeoutSeconds' | 'networkHosts' | 'actionId' | 'actionLabel' | 'inputTypes' | 'fullscreen'>
export type ToolWorkspace = {
  schema_version: 1; draft: ModuleStudioDraft; contents: Partial<Record<ToolKind, ToolContent>>
  manifest: ModuleManifest | null
}
export const TOOL_DRAFT_KEY = 'firefly.tool-creator.draft.v1'
export const textInputTypes = [
  { id: 'text', label: '普通文本' }, { id: 'json', label: 'JSON' }, { id: 'jwt', label: 'JWT' },
  { id: 'uuid', label: 'UUID' }, { id: 'unix_timestamp', label: 'Unix 时间戳' }, { id: 'datetime', label: '日期时间' },
  { id: 'base64', label: 'Base64' }, { id: 'url', label: '网址' }, { id: 'url_encoding', label: 'URL 编码' },
  { id: 'hex_color', label: 'HEX 颜色' }, { id: 'rgb_color', label: 'RGB 颜色' },
]

const webCss = '* { box-sizing: border-box; }\nbody { margin: 0; padding: 24px; font: 16px/1.6 system-ui; color: #254d3d; background: #f7faf6; }\nmain { width: 100%; min-width: 0; margin: 0; }\ninput, textarea, button { font: inherit; }\ninput, textarea { width: 100%; padding: 10px; margin: 8px 0; }\nbutton { padding: 9px 18px; cursor: pointer; }\npre { white-space: pre-wrap; overflow-wrap: anywhere; }'
function webFiles(html: string, script: string, css = webCss): ModuleScriptDraft[] {
  return [{ path: 'index.html', source: html }, { path: 'style.css', source: css }, { path: 'main.js', source: script }]
}
const webRequestScript = [
  'export function mount({ request, signal }) {',
  '  const button = document.querySelector("#request");',
  '  const output = document.querySelector("#output");',
  '  button.addEventListener("click", async () => {',
  '    button.disabled = true;',
  '    output.textContent = "正在请求…";',
  '    try {',
  '      let url;',
  '      try { url = new URL(document.querySelector("#url").value.trim()); }',
  '      catch { throw new Error("请输入完整的 HTTPS 接口地址。"); }',
  '      if (url.protocol !== "https:") throw new Error("请输入 HTTPS 接口地址。");',
  '      const response = await request(url, { signal });',
  '      if (!response.ok) throw new Error("接口返回 HTTP " + response.status);',
  '      output.textContent = await response.text();',
  '    } catch (error) {',
  '      if (error?.name === "AbortError") output.textContent = "请求已取消。";',
  '      else output.textContent = error instanceof Error ? error.message : String(error);',
  '    } finally { button.disabled = false; }',
  '  });',
  '}',
].join('\n')
export const toolTemplates = [
  { id: 'text-blank', kind: 'text' as const, name: '空白文本工具', description: '填写自己的文本处理函数。',
    files: [{ path: 'main.js', source: 'export function run(input, action) {\n  return { text: input.text };\n}\n' }] },
  { id: 'text-clean', kind: 'text' as const, name: '文本整理', description: '去掉行首尾空白、空行和重复行。',
    files: [{ path: 'main.js', source: 'export function run(input) {\n  const lines = input.text.split(/\\r?\\n/).map(line => line.trim()).filter(Boolean);\n  return { text: [...new Set(lines)].join("\\n") };\n}\n' }] },
  { id: 'text-reverse', kind: 'text' as const, name: '文本反转', description: '将文字按字符反转。',
    files: [{ path: 'main.js', source: 'export function run(input) {\n  return { text: Array.from(input.text).reverse().join("") };\n}\n' }] },
  { id: 'web-blank', kind: 'web' as const, name: '空白网页工具', description: '从一个可交互的页面开始。',
    files: webFiles('<main>\n  <h1>我的网页工具</h1>\n  <textarea id="input" rows="5" placeholder="输入文字"></textarea>\n  <button id="run" type="button">运行</button>\n  <pre id="output"></pre>\n</main>', 'export function mount() {\n  document.querySelector("#run").addEventListener("click", () => {\n    document.querySelector("#output").textContent = document.querySelector("#input").value;\n  });\n}\n') },
  { id: 'web-request', kind: 'web' as const, name: '接口请求', description: '通过宿主读取允许来源的 HTTPS 接口，无需接口开启 CORS。',
    files: webFiles('<main>\n  <h1>接口请求</h1>\n  <p>填写已加入允许来源的 HTTPS 地址；请求由宿主发送，无需接口开启 CORS。</p>\n  <label>接口地址<input id="url" type="url" placeholder="https://jsonplaceholder.typicode.com/todos/1" /></label>\n  <button id="request" type="button">发送请求</button>\n  <pre id="output" role="status"></pre>\n</main>', webRequestScript) },
  { id: 'web-image', kind: 'web' as const, name: '图片处理', description: '选图、调整亮度或灰度，再保存 PNG。',
    files: webFiles(imageHtml.replace('{{asset:assets/badge.svg}}', `data:image/svg+xml,${encodeURIComponent(badge)}`), imageJs,
      imageCss.replace('{{asset:assets/dots.svg}}', `data:image/svg+xml,${encodeURIComponent(dots)}`)) },
  { id: 'web-notes', kind: 'web' as const, name: '本地记事本', description: '演示只属于这个工具的本地存储。',
    files: webFiles('<main>\n  <h1>本地记事本</h1>\n  <textarea id="notes" rows="10" placeholder="记录一些文字"></textarea>\n  <p id="status" role="status"></p>\n</main>', 'export function mount({ storage }) {\n  const notes = document.querySelector("#notes");\n  const status = document.querySelector("#status");\n  let revision = 0;\n  notes.value = localStorage.getItem("notes") ?? "";\n  notes.addEventListener("input", async () => {\n    const current = ++revision;\n    status.textContent = "正在保存…";\n    try { localStorage.setItem("notes", notes.value); await storage.flush(); if (current === revision) status.textContent = "已保存到本机"; }\n    catch (error) { if (current === revision) status.textContent = error.message; }\n  });\n}\n') },
]

export function toolKind(draft: ModuleStudioDraft): ToolKind { return draft.runtime === 'quickjs' ? 'text' : 'web' }
export function copyToolContent(draft: ToolContent): ToolContent {
  return { runtime: draft.runtime, entry: draft.entry, timeoutSeconds: draft.timeoutSeconds, networkHosts: draft.networkHosts, fullscreen: draft.fullscreen ?? false,
    actionId: draft.actionId, actionLabel: draft.actionLabel, scripts: draft.scripts.map(script => ({ ...script })), inputTypes: [...(draft.inputTypes ?? ['text'])] }
}
export function templateContent(id: string): ToolContent {
  const template = toolTemplates.find(template => template.id === id) ?? toolTemplates[0]!
  const web = template.kind === 'web'
  return { runtime: web ? 'web' : 'quickjs', entry: web ? 'index.html' : 'main.js', timeoutSeconds: web ? 15 : 3, fullscreen: false,
    networkHosts: '', actionId: web ? 'open' : 'run', actionLabel: web ? '打开' : '运行',
    scripts: template.files.map(file => ({ ...file })), inputTypes: web ? [] : ['text'] }
}
export function emptyModuleDraft(): ModuleStudioDraft {
  const identity = typeof crypto.randomUUID === 'function' ? crypto.randomUUID().replaceAll('-', '')
    : Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16).padStart(8, '0')).join('')
  return { moduleId: `local.tool_${identity.slice(0, 12)}`, version: '1.0.0', name: '',
    author: '本机用户', license: 'UNLICENSED', customLicense: '', toolSuffix: 'main', toolName: '', description: '',
    category: '文本处理', icon: '', iconData: '', tags: '', aliases: '', windows: true, android: true,
    ...templateContent('text-blank') }
}

function validContent(value: unknown): value is ToolContent {
  if (!value || typeof value !== 'object') return false
  const content = value as ToolContent
  if (content.fullscreen !== undefined && typeof content.fullscreen !== 'boolean') return false
  content.fullscreen ??= false
  if (!(['quickjs', 'web'].includes(content.runtime) && typeof content.entry === 'string'
    && typeof content.timeoutSeconds === 'number' && Number.isFinite(content.timeoutSeconds)
    && ['networkHosts', 'actionId', 'actionLabel'].every(key => typeof content[key as keyof ToolContent] === 'string')
    && Array.isArray(content.scripts) && content.scripts.length > 0 && content.scripts.length <= (content.runtime === 'web' ? WEB_SOURCE_FILES : 16)
    && content.scripts.every(file => file && typeof file.path === 'string' && file.path.length <= 120
      && typeof file.source === 'string'))) return false
  // Preserve recovery of unfinished text drafts; native execution validates them.
  if (content.runtime === 'quickjs') return content.scripts.every(file => file.source.length <= 4 * 1024 * 1024)
  let total = 0
  for (const file of content.scripts) {
    const bytes = new TextEncoder().encode(file.source).byteLength
    if (bytes > WEB_SOURCE_BYTES) return false
    total += bytes
    if (total > WEB_SOURCE_TOTAL_BYTES) return false
  }
  return true
}
export function readToolWorkspace(raw: string | null): ToolWorkspace | null {
  if (!raw || raw.length > TOOL_WORKSPACE_MAX_CHARS) return null
  try {
    const value = JSON.parse(raw) as ToolWorkspace
    if (value.schema_version !== 1 || !validContent(value.draft) || !value.contents || typeof value.contents !== 'object') return null
    const draft = value.draft
    if (draft.resourceDraftId !== undefined && (typeof draft.resourceDraftId !== 'string' || !/^[0-9a-f-]{36}$/i.test(draft.resourceDraftId))) return null
    if (draft.resources !== undefined && (!Array.isArray(draft.resources) || draft.resources.length > 128 || draft.resources.some(resource => !resource || typeof resource.path !== 'string' || resource.path.length > 120 || !Number.isSafeInteger(resource.size) || resource.size <= 0 || resource.size > WEB_RESOURCE_BYTES || typeof resource.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(resource.sha256)))) return null
    if (draft.inputTypes !== undefined && (!Array.isArray(draft.inputTypes) || draft.inputTypes.some(type => !textInputTypes.some(choice => choice.id === type)))) return null
    draft.inputTypes ??= draft.runtime === 'web' ? [] : ['text']
    const fields = ['moduleId', 'version', 'name', 'author', 'license', 'customLicense', 'toolSuffix', 'toolName', 'description', 'category', 'icon', 'iconData', 'tags', 'aliases'] as const
    if (fields.some(key => typeof draft[key] !== 'string' || draft[key].length > 40000)
      || typeof draft.windows !== 'boolean' || typeof draft.android !== 'boolean') return null
    if (Object.entries(value.contents).some(([kind, content]) => !['text', 'web'].includes(kind) || !validContent(content))) return null
    if (value.manifest && (value.manifest.module_id !== draft.moduleId || !Array.isArray(value.manifest.tools)
      || value.manifest.tools.length !== 1 || !value.manifest.name || !value.manifest.network || !value.manifest.limits)) return null
    return value
  } catch { return null }
}
