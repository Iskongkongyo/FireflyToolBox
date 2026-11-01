<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { open as openFileDialog } from '@tauri-apps/plugin-dialog'
import AppIcon from './AppIcon.vue'
import { nativeWebFiles } from '../services/webToolNativeFiles'
import ViewportSelect from './ViewportSelect.vue'
import { cancelWebToolFileOperations, mountWebTool, stopBrowserModule } from '../services/browserModule'
import { stoppedWebFileStatus, type WebFileStatus } from '../services/webToolFiles'
import type { WebToolOptions } from '../services/webToolRuntime'
import { toolbox, type ModuleDetails, type ModuleManifest, type ModuleSummary } from '../services/toolbox'

const props = defineProps<{ details: ModuleDetails; active: boolean; openFile: WebToolOptions['openFile']; saveFile: WebToolOptions['saveFile']; hashFile?: WebToolOptions['hashFile']; copyText?: WebToolOptions['copyText'] }>()
const emit = defineEmits<{ close: []; saved: [module: ModuleSummary]; notify: [message: string] }>()
const files = ref(Object.entries(props.details.scripts).map(([path, source]) => ({ path, source })))
const activeIndex = ref(0)
const activeFile = computed(() => files.value[activeIndex.value])
const manifestText = ref(JSON.stringify(props.details.manifest, null, 2))
const resourceDraftId=crypto.randomUUID()
const resourceBusy=ref(false)
const resourceEntries=computed(()=>{try{return (JSON.parse(manifestText.value) as ModuleManifest).resources ?? []}catch{return []}})
const canImportResources=computed(()=>webTools.value.length>0&&webTools.value.length===props.details.manifest.tools.length)
const saving = ref(false)
const error = ref('')
const previewError = ref('')
const previewCompleted = ref(false)
const textPreviewOpen = ref(false)
const textPreviewContainer = ref<HTMLElement | null>(null)
const webPreviewOpen = ref(false)
const webPreviewContainer = ref<HTMLElement | null>(null)
const webFileStatus = ref<WebFileStatus>({ busy: false, message: '' })
const webToolId = ref(props.details.manifest.tools.find(tool => tool.ui.kind === 'web')?.id ?? '')
const previewInput = ref('')
const previewOutput = ref('')
const previewAction = ref(props.details.manifest.tools[0]?.actions[0]?.id ?? '')
const previewBusy = ref(false)
let requestId: string | null = null
let revision = 0
let disposed = false
watch(error, value => { if (value && props.active && !disposed) emit('notify', value) }, { flush: 'sync' })

const previewTool = computed(() => {
  try {
    const manifest = JSON.parse(manifestText.value) as ModuleManifest
    const tool = manifest.tools.length === 1 ? manifest.tools[0] : undefined
    return tool?.ui?.kind === 'text' && !tool.runtime && Array.isArray(tool.actions) ? tool : undefined
  } catch { return undefined }
})
const webTools = computed(() => {
  try { return (JSON.parse(manifestText.value) as ModuleManifest).tools.filter(tool => tool.ui.kind === 'web' && tool.runtime === 'browser') }
  catch { return [] }
})
const selectedWebTool = computed(() => webTools.value.find(tool => tool.id === webToolId.value) ?? webTools.value[0])
function displayName(value?: Record<string, string>) { return value && typeof value === 'object' ? value['zh-CN'] || Object.values(value)[0] || '' : '' }
const previewActionOptions = computed(() => previewTool.value?.actions.map(action => ({ value: action.id, label: displayName(action.label) || action.id })) ?? [])
function message(value: unknown) {
  if (value && typeof value === 'object' && 'message' in value) return String(value.message)
  return String(value)
}
function cancelPreview() {
  revision++
  if (requestId) void toolbox.cancelModuleRun(requestId).catch(() => {})
  requestId = null
  previewBusy.value = false
  if (webPreviewOpen.value) stopBrowserModule()
  webPreviewOpen.value = false
  webFileStatus.value = { busy: false, message: '' }
}
watch(() => props.active, (active) => { if (!active) { cancelPreview(); textPreviewOpen.value = false } }, { flush: 'sync' })
watch([files, manifestText, previewInput, previewAction, webToolId], () => {
  cancelPreview()
  previewOutput.value = ''
  previewCompleted.value = false
  previewError.value = ''
  error.value = ''
}, { deep: true, flush: 'sync' })
watch(previewTool, (tool) => {
  if (!tool) { textPreviewOpen.value = false; return }
  if (tool && !tool.actions.some((action) => action.id === previewAction.value)) {
    previewAction.value = tool.actions[0]?.id ?? ''
  }
})
onBeforeUnmount(() => { disposed = true; cancelPreview();void toolbox.discardModuleResources(resourceDraftId).catch(()=>{}) })

function addFile() {
  if (files.value.length >= 16) return
  let index = 1
  while (files.value.some((file) => file.path === `js/helper${index}.js`)) index++
  files.value.push({ path: `js/helper${index}.js`, source: '' })
  activeIndex.value = files.value.length - 1
}
function removeFile() {
  files.value.splice(activeIndex.value, 1)
  activeIndex.value = Math.max(0, activeIndex.value - 1)
}
function draft() {
  let manifest: ModuleManifest
  try { manifest = JSON.parse(manifestText.value) as ModuleManifest }
  catch { throw new Error('清单 JSON 格式无效，请检查逗号、引号和括号。') }
  if (manifest.module_id !== props.details.manifest.module_id) throw new Error('编辑已安装工具时不能修改工具包 ID。')
  const paths = files.value.map((file) => file.path.trim())
  if (new Set(paths).size !== paths.length) throw new Error('文件路径不能重复。')
  return { manifest, scripts: Object.fromEntries(files.value.map(file => [file.path.trim(), file.source])) }
}
async function importResource() {
  if(saving.value||resourceBusy.value||!canImportResources.value)return
  resourceBusy.value=true;error.value='';cancelPreview()
  try {
    const path=await openFileDialog({title:'导入工具资源',multiple:false,directory:false}) as string|null
    if(!path)return
    const resource=await toolbox.stageModuleResource(path,resourceDraftId)
    if(disposed){await toolbox.discardModuleResources(resourceDraftId);return}
    const manifest=JSON.parse(manifestText.value) as ModuleManifest
    manifest.schema_version=7;manifest.min_app_version=props.details.builtin?'0.1.28':'0.1.27'
    manifest.resources=[...(manifest.resources ?? []).filter(item=>item.path!==resource.path),resource]
    manifestText.value=JSON.stringify(manifest,null,2)
  }catch(value){if(!disposed)error.value=message(value)}finally{resourceBusy.value=false}
}
async function removeResource(path:string) {
  if(saving.value||resourceBusy.value)return
  const manifest=JSON.parse(manifestText.value) as ModuleManifest
  manifest.resources=(manifest.resources ?? []).filter(item=>item.path!==path)
  manifestText.value=JSON.stringify(manifest,null,2)
  await toolbox.discardModuleResources(resourceDraftId,path).catch(value=>{error.value=message(value)})
}
async function packageDraft() {
  const { manifest, scripts } = draft()
  return toolbox.createModulePackage(manifest, scripts)
}
async function openTextPreview() {
  if (!props.active || saving.value || previewBusy.value || !previewTool.value) return
  textPreviewOpen.value = true
  await nextTick()
  textPreviewContainer.value?.scrollIntoView({ block: 'nearest' })
  textPreviewContainer.value?.querySelector('textarea')?.focus({ preventScroll: true })
}
function closeTextPreview() { cancelPreview(); textPreviewOpen.value = false }
async function preview() {
  if (!props.active || saving.value || previewBusy.value || !previewTool.value || !textPreviewOpen.value) return
  cancelPreview()
  const current = revision
  previewBusy.value = true
  previewOutput.value = ''
  previewError.value = ''
  previewCompleted.value = false
  try {
    const bytes = await packageDraft()
    if (current !== revision || disposed) return
    requestId = crypto.randomUUID()
    const result = await toolbox.previewToolPackage(bytes, previewInput.value, previewAction.value, requestId)
    if (current === revision && !disposed) { previewOutput.value = result; previewCompleted.value = true }
  } catch (value) {
    if (current === revision && !disposed) previewError.value = message(value)
  } finally {
    if (current === revision) { requestId = null; previewBusy.value = false }
  }
}
async function previewWeb() {
  if (!props.active || saving.value || previewBusy.value || !selectedWebTool.value) return
  cancelPreview()
  const current = revision
  webPreviewOpen.value = true
  previewBusy.value = true
  previewError.value = ''
  try {
    const { manifest, scripts } = draft()
    await toolbox.validateModuleDraft(manifest, scripts, props.details.manifest.module_id,resourceDraftId)
    if (current !== revision || disposed) return
    const tool = manifest.tools.find(tool => tool.id === selectedWebTool.value?.id)
    if (!tool || tool.ui.kind !== 'web' || !tool.ui.script || !tool.ui.style) throw new Error('网页工具资源声明不完整。')
    const html = scripts[tool.entry], css = scripts[tool.ui.style], script = scripts[tool.ui.script]
    if (typeof html !== 'string' || typeof css !== 'string' || typeof script !== 'string') throw new Error('网页工具缺少 HTML、CSS 或 JS 文件。')
    await nextTick()
    if (current !== revision || disposed || !webPreviewContainer.value) return
    await mountWebTool(webPreviewContainer.value, {
      moduleId: `preview.installed.${manifest.module_id}.${tool.id}`, scriptName: tool.ui.script,
      resourceModuleId: props.details.manifest.module_id, resourceDraftId, resources: manifest.resources, files: nativeWebFiles,
      html, css, script, networkHosts: [...manifest.network.hosts],
      timeoutMs: manifest.limits.timeout_ms, inputBytes: manifest.limits.input_bytes, outputBytes: manifest.limits.output_bytes,
      openFile: props.openFile, saveFile: props.saveFile,
      hashFile: props.hashFile, copyText: props.copyText,
      onFileStatus: value => { if (current === revision && !disposed) webFileStatus.value = value },
      onStopped: () => { if (current === revision && !disposed) webFileStatus.value = stoppedWebFileStatus(webFileStatus.value) },
      onError: value => { if (current === revision && !disposed) previewError.value = value },
    })
  } catch (value) { if (current === revision && !disposed) previewError.value = message(value) }
  finally { if (current === revision) previewBusy.value = false }
}

async function save() {
  if (!props.active || saving.value || resourceBusy.value) return
  cancelPreview()
  textPreviewOpen.value = false
  saving.value = true
  error.value = ''
  try {
    const { manifest, scripts } = draft()
    if (disposed) return
    const installed = await toolbox.installModuleDraft(manifest, scripts, props.details.manifest.module_id,resourceDraftId)
    emit('saved', installed)
  } catch (value) { if (!disposed) error.value = message(value) }
  finally { saving.value = false }
}
</script>

<template>
  <form class="installed-source-editor" @submit.prevent="save">
    <h3 class="module-studio-detail-subtitle">编辑源码</h3>
    <p v-if="props.details.manifest.schema_version === 7" class="module-hint">网页源码按 UTF-8 字节计数：单文件最多 8 MiB，合计 32 MiB，最多 128 个文件。</p>
    <p v-if="resourceEntries.length" class="module-hint">此工具含 {{ resourceEntries.length }} 个独立资源。保存源码时会完整保留，也可在下方导入或移除资源。</p>
    <fieldset :disabled="saving || resourceBusy">
      <div class="tool-code-tabs" role="group" aria-label="工具包文件">
        <button v-for="(file, index) in files" :key="index" type="button" :class="{ selected: index === activeIndex }" :aria-pressed="index === activeIndex" @click="activeIndex = index">{{ file.path || '未命名文件' }}</button>
        <button type="button" :disabled="files.length >= 16" @click="addFile">添加文件</button>
      </div>
      <div v-if="activeFile" class="module-studio-script">
        <div><label>文件路径<input v-model="activeFile.path" required placeholder="如：main.js、js/main.js" spellcheck="false" /></label><button class="text-button" type="button" :disabled="files.length === 1" @click="removeFile">删除文件</button></div>
        <label>源码<textarea id="installed-tool-source" v-model="activeFile.source" rows="12" spellcheck="false" :aria-label="`${activeFile.path} 源码`"></textarea></label>
      </div>
      <section v-if="canImportResources" class="tool-resource-panel">
        <div class="tool-resource-heading"><h3>独立资源</h3><button class="secondary-button" type="button" :disabled="saving || resourceBusy" @click="importResource">{{ resourceBusy ? '正在读取…' : '导入资源' }}</button></div>
        <p class="module-hint">单资源最多 96 MiB、最多 128 项，源码与资源共同占用每包 128 MiB 额度。同名文件会替换本次编辑中的资源；保存修改后生效。资源会随工具包导出。</p>
        <ul v-if="resourceEntries.length" class="tool-resource-list"><li v-for="resource in resourceEntries" :key="resource.path"><span><code>{{ resource.path }}</code><small>{{ (resource.size / 1048576).toFixed(2) }} MiB</small></span><button class="text-button" type="button" @click="removeResource(resource.path)">移除</button></li></ul>
      </section>
      <details class="tool-advanced-settings">
        <summary>高级设置：清单 JSON</summary>
        <p class="module-studio-detail-note">可修改操作、适用内容和入口路径；保留已有工具包 ID 和工具 ID。</p>
        <label class="source-manifest-label">manifest.json<textarea v-model="manifestText" rows="10" spellcheck="false" aria-label="工具包清单 JSON"></textarea></label>
      </details>
      <section v-if="previewTool && textPreviewOpen" id="installed-source-text-preview" ref="textPreviewContainer" class="module-studio-preview installed-text-preview" aria-label="源码试运行">
        <div class="source-preview-heading"><span class="source-preview-icon"><AppIcon name="module-text" /></span><div><h3>试运行</h3><p>输入内容，查看当前代码的处理结果。</p></div><span v-if="previewBusy || previewCompleted" class="source-preview-state" role="status">{{ previewBusy ? '运行中' : '已完成' }}</span><button class="icon-button source-preview-close" type="button" aria-label="关闭试运行" title="关闭试运行" @click="closeTextPreview"><AppIcon name="close" /></button></div>
        <div class="source-preview-toolbar"><label class="source-preview-operation">操作<ViewportSelect v-model="previewAction" :options="previewActionOptions" ariaLabel="试运行操作" :disabled="previewBusy || saving" /></label><div class="source-preview-actions"><button class="primary-button" type="button" :disabled="previewBusy || !previewAction" @click="preview">{{ previewBusy ? '正在运行…' : '运行' }}</button><button v-if="previewBusy" class="secondary-button" type="button" @click="cancelPreview">取消运行</button></div></div>
        <div class="source-preview-panes"><label>输入内容<textarea v-model="previewInput" rows="5" placeholder="输入用于试运行的文字" spellcheck="false"></textarea></label><label>处理结果<textarea :value="previewOutput" rows="5" placeholder="运行后的结果会显示在这里" readonly></textarea></label></div>
        <p v-if="previewError" class="editor-status error" role="alert">{{ previewError }}</p>
      </section>
      <div v-if="webTools.length > 1" class="source-web-picker"><label>预览工具<ViewportSelect v-model="webToolId" :options="webTools.map(tool => ({ value: tool.id, label: displayName(tool.name) }))" ariaLabel="选择网页预览工具" :disabled="previewBusy || saving" /></label></div>
    </fieldset>
    <div class="module-studio-detail-actions"><button v-if="previewTool" class="secondary-button" type="button" :disabled="saving || previewBusy" aria-controls="installed-source-text-preview" :aria-expanded="textPreviewOpen" @click="openTextPreview">试运行</button><button v-if="selectedWebTool" class="secondary-button" type="button" :disabled="saving || previewBusy" @click="previewWeb">{{ previewBusy ? '正在运行…' : '预览网页工具' }}</button><button class="secondary-button" type="button" :disabled="saving" @click="emit('close')">取消</button><button class="primary-button" type="submit" :disabled="saving">{{ saving ? '检查并保存中…' : '保存修改' }}</button></div>
    <section v-if="webPreviewOpen" class="module-studio-preview installed-web-preview" aria-label="网页工具源码预览">
      <div class="module-studio-preview-heading"><h3>网页预览</h3><button class="text-button" type="button" @click="cancelPreview">关闭预览</button></div>
      <p>使用当前代码预览，预览数据与已安装工具的数据分开保存。</p>
      <div v-if="webFileStatus.message" class="web-tool-controls"><p class="web-file-status" :class="{ error: webFileStatus.code && webFileStatus.code !== 'FILE_CANCELED' }" role="status">{{ webFileStatus.message }}</p><button v-if="webFileStatus.busy" class="secondary-button" type="button" @click="cancelWebToolFileOperations">取消当前操作</button></div>
      <div ref="webPreviewContainer" class="web-tool-container" :aria-busy="previewBusy" aria-label="工具预览页面"></div>
      <p v-if="previewBusy" class="editor-status" role="status">正在运行预览…</p>
      <p v-if="previewError" class="editor-status error" role="alert">{{ previewError }}</p>
    </section>
  </form>
</template>

<style scoped>
.installed-source-editor { margin-top: 20px; min-width: 0; }
fieldset { min-width: 0; padding: 0; margin: 0; border: 0; }
.source-manifest-label { display: grid; gap: 7px; color: var(--text); font-size: 12px; }
.source-manifest-label textarea { width: 100%; min-width: 0; padding: 10px; resize: vertical; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: var(--text); font: 13px/1.5 Consolas, monospace; }

.installed-text-preview { padding: 18px; background: color-mix(in srgb, var(--accent-soft) 22%, var(--surface)); }
.source-preview-heading { display: flex; align-items: center; gap: 11px; margin-bottom: 18px; }
.source-preview-heading > div { min-width: 0; flex: 1; }
.source-preview-close { width: 36px; height: 36px; flex: 0 0 36px; padding: 8px; }
.source-preview-close svg { width: 20px; height: 20px; }
.source-preview-icon { display: grid; place-items: center; width: 38px; height: 38px; flex: 0 0 38px; border-radius: 11px; background: var(--accent-soft); color: var(--accent); }
.source-preview-icon svg { width: 20px; height: 20px; }
.source-preview-heading h3 { margin: 0; font-size: calc(15px * var(--app-font-scale)); }
.source-preview-heading p { margin: 5px 0 0; color: var(--muted); font-size: calc(11px * var(--app-font-scale)); line-height: 1.5; }
.source-preview-state { margin-left: auto; flex-shrink: 0; padding: 4px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-size: calc(11px * var(--app-font-scale)); }
.source-preview-toolbar { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; margin-bottom: 16px; }
.source-preview-operation { flex: 1 1 170px; min-width: 0; }
.source-preview-operation, .source-web-picker label { display: grid; gap: 7px; color: var(--text); font-size: calc(12px * var(--app-font-scale)); font-weight: 650; }
.source-preview-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.source-preview-actions button { min-height: 44px; }
.source-preview-panes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.source-preview-panes label { display: grid; gap: 8px; min-width: 0; color: var(--text); font-size: calc(12px * var(--app-font-scale)); font-weight: 650; }
.source-preview-panes textarea { width: 100%; min-width: 0; min-height: 156px; padding: 12px; border: 1px solid var(--border); border-radius: 11px; resize: vertical; background: var(--surface); color: var(--text); font: 13px/1.6 Consolas, monospace; }
.source-preview-panes textarea[readonly] { background: color-mix(in srgb, var(--accent-soft) 35%, var(--surface)); }
.source-web-picker { margin-top: 18px; }
.installed-web-preview { min-width: 0; }
.installed-web-preview .web-tool-container { margin-top: 14px; }
@media (max-width: 600px) { .source-preview-panes { grid-template-columns: 1fr; } .installed-text-preview { padding: 14px; } }

.editor-status { white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
