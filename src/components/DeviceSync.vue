<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import AppIcon from './AppIcon.vue'
import { toolbox, type ModuleSummary } from '../services/toolbox'
import { collectSyncPreferences, defaultSyncOptions, deviceSync, prepareSyncPreferences, saveSyncPreferences, syncCategories, validateSyncPreferences, type SyncApplied, type SyncOptions, type SyncPreview, type SyncShare, type SyncStatus } from '../services/deviceSync'

const emit = defineEmits<{ applying: [value: boolean]; applied: []; finished: [reload: boolean] }>()
const mode = ref<'send' | 'receive'>('send')
const options = ref(defaultSyncOptions())
const shareModules=ref<ModuleSummary[]>([])
const selectedModuleIds=ref<string[]>([])
const moduleChoiceReady=ref(false)
onMounted(()=>{void toolbox.listModules().then(items=>{shareModules.value=items.filter(item=>!item.builtin);selectedModuleIds.value=shareModules.value.map(item=>item.module_id);moduleChoiceReady.value=true}).catch(value=>{error.value=message(value)})})
const sharing = ref<SyncShare | null>(null)
const status = ref<SyncStatus | null>(null)
const endpoint = ref('')
const code = ref('')
const preview = ref<SyncPreview | null>(null)
const selected = ref<string[]>([])
const replace = ref(false)
const busy = ref(false)
const applying = ref(false)
const error = ref('')
const notice = ref('')
const result = ref<SyncApplied | null>(null)
const settingsError = ref('')
let needsReload = false
let generation = 0
let disposed = false
let timer: ReturnType<typeof setInterval> | undefined
const now = ref(Date.now())
const activeShare = computed(() => status.value?.state === 'waiting' || status.value?.state === 'transferring')
const remaining = computed(() => Math.max(0, Math.ceil((sharing.value?.expires_at ?? 0) - now.value / 1000)))
const offer = computed(() => preview.value?.options)
const canApply = computed(() => !busy.value && !result.value && !!preview.value && (selected.value.length > 0 || options.value.favorites || options.value.layout || options.value.preferences))
const statuses = { waiting: '等待另一台设备连接', transferring: '正在传输', sent: '已传输到接收端，请在接收端确认导入', interrupted: '传输中断，请重新开启', locked: '配对次数已用完，请重新开启', expired: '配对码已过期，请重新开启', stopped: '已停止' }
const statusNames = { new: '新增', same: '相同', conflict: '本机已有', blocked: '无法导入', merge: '可合并' }
function formatSize(bytes: number) { return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(2)} MiB` : `${Math.max(1, Math.ceil(bytes / 1024))} KiB` }
function message(value: unknown) { return value && typeof value === 'object' && 'message' in value ? String(value.message) : String(value) }
function stopTimer() { if (timer) clearInterval(timer); timer = undefined }
async function close() {
  const current = ++generation
  stopTimer()
  sharing.value = null
  status.value = null
  busy.value = true
  try { await deviceSync.close() }
  finally { if (!disposed && generation === current) busy.value = false }
}
watch(mode, async () => {
  await close().catch(() => {})
  preview.value = null; selected.value = []; error.value = ''; notice.value = ''; result.value = null
  options.value = defaultSyncOptions()
})
watch(replace, (value) => { if (!value) selected.value = selected.value.filter(key => preview.value?.items.find(item => item.key === key)?.status !== 'conflict') })
onBeforeUnmount(() => {
  disposed = true; generation++; stopTimer()
  void deviceSync.close().catch(() => {})
  if (needsReload) window.location.reload()
})
function toggleOption(key: keyof SyncOptions, value: boolean) {
  options.value[key] = value
  if (preview.value) {
    if (value) selected.value = [...new Set([...selected.value, ...preview.value.items.filter(item => item.kind === key && (item.status === 'new' || item.status === 'merge')).map(item => item.key)])]
    else selected.value = selected.value.filter(id => preview.value?.items.find(item => item.key === id)?.kind !== key)
  }
}
async function share() {
  if (busy.value) return
  error.value = ''; notice.value = ''; busy.value = true
  const current = ++generation
  try {
    const data = await deviceSync.share(options.value, collectSyncPreferences(options.value),options.value.modules?selectedModuleIds.value:undefined)
    if (disposed || generation !== current) return
    sharing.value = data; status.value = { state: 'waiting', attempts_left: 5 }
    stopTimer()
    let polling = false
    timer = setInterval(async () => {
      now.value = Date.now()
      if (polling) return
      polling = true
      try {
        const value = await deviceSync.status()
        if (!disposed && generation === current) {
          status.value = value
          if (value && !['waiting', 'transferring'].includes(value.state)) stopTimer()
        }
      } catch (value) { if (generation === current) { error.value = message(value); stopTimer() } }
      finally { polling = false }
    }, 1000)
  } catch (value) { if (generation === current) error.value = message(value) }
  finally { if (generation === current) busy.value = false }
}
async function copyConnection(address: string) {
  try { await writeText(`${address}\n${sharing.value?.code ?? ''}`); notice.value = '地址和配对码已复制。' }
  catch (value) { error.value = `复制失败：${message(value)}` }
}
function pasteConnection(event: ClipboardEvent) {
  const text = event.clipboardData?.getData('text') ?? ''
  const matched = text.match(/(?:http:\/\/)?((?:\d{1,3}\.){3}\d{1,3}:\d{1,5})\s+(\d{8})/)
  if (matched) { event.preventDefault(); endpoint.value = matched[1]!; code.value = matched[2]! }
}
function setPreview(value: SyncPreview) {
  validateSyncPreferences(value.preferences)
  preview.value = value
  replace.value = false
  const defaults = defaultSyncOptions()
  for (const key of Object.keys(defaults) as (keyof SyncOptions)[]) defaults[key] = defaults[key] && value.options[key]
  options.value = defaults
  selected.value = value.items.filter(item => item.status === 'new' && defaults[item.kind]).map(item => item.key)
}
async function receive() {
  if (busy.value) return
  busy.value = true; error.value = ''; notice.value = ''; result.value = null; preview.value = null
  const current = ++generation
  try {
    const value = await deviceSync.receive(endpoint.value, code.value.trim())
    if (!disposed && generation === current) setPreview(value)
  } catch (value) { if (generation === current) error.value = message(value) }
  finally { if (generation === current) busy.value = false }
}
async function refreshPreview() {
  if (busy.value) return
  const current = ++generation
  busy.value = true; error.value = ''
  try { const value = await deviceSync.preview(); if (!disposed && generation === current) setPreview(value) }
  catch (value) { if (!disposed && generation === current) error.value = message(value) }
  finally { if (!disposed && generation === current) busy.value = false }
}
async function apply() {
  if (!canApply.value) return
  busy.value = true; applying.value = true; error.value = ''; settingsError.value = ''
  emit('applying', true)
  try {
    validateSyncPreferences(preview.value!.preferences)
    const applied = await deviceSync.apply(options.value, selected.value, replace.value, preview.value!.storage_ids)
    result.value = applied
    needsReload = (applied.web_data_imported ?? 0) > 0
    try {
      const preferences = prepareSyncPreferences(applied, replace.value)
      saveSyncPreferences(preferences)
      needsReload ||= Object.keys(preferences).length > 0
    } catch (value) { settingsError.value = `同步内容已导入，部分界面设置未能保存：${message(value)}` }
    emit('applied')
  } catch (value) { error.value = message(value) }
  finally { busy.value = false; applying.value = false; emit('applying', false) }
}
</script>

<template>
  <div class="device-sync">
    <div class="sync-intro"><span class="sync-intro-icon"><AppIcon name="sync" /></span><div><h2>把工具带到另一台设备</h2><p>两端连接同一局域网，PC 和手机都可以发送或接收。同步期间请保持应用在前台。</p></div></div>
    <div class="sync-tabs" role="group" aria-label="同步方向"><button type="button" :class="{ selected: mode === 'send' }" :aria-pressed="mode === 'send'" :disabled="busy || !!result" @click="mode = 'send'">发送到其他设备</button><button type="button" :class="{ selected: mode === 'receive' }" :aria-pressed="mode === 'receive'" :disabled="busy || !!result" @click="mode = 'receive'">从其他设备接收</button></div>
    <p v-if="error" class="sync-error" role="alert">{{ error }}</p><p v-if="notice" class="sync-notice" role="status">{{ notice }}</p>
    <section v-if="mode === 'send'" class="sync-panel">
      <h3>选择发送的内容</h3>
      <details v-if="options.modules && shareModules.length" class="sync-extra"><summary>选择要发送的工具包<small>{{ selectedModuleIds.length }} / {{ shareModules.length }}</small></summary><div class="sync-options"><label v-for="item in shareModules" :key="item.module_id" class="sync-option"><input v-model="selectedModuleIds" :value="item.module_id" type="checkbox" :disabled="busy || activeShare" /><span><strong>{{ item.name }}</strong><small>{{ item.tools.join('、') }}</small></span></label></div><p class="sync-note">大资源可分批发送；同步自动化时，同时选择它依赖的工具包。</p></details>
      <div class="sync-options"><label v-for="category in syncCategories.slice(0, 2)" :key="category.key" class="sync-option"><input v-model="options[category.key]" type="checkbox" :disabled="busy || activeShare" /><span><strong>{{ category.name }}</strong><small>{{ category.description }}</small></span></label></div>
      <details class="sync-extra"><summary><AppIcon class="sync-summary-chevron" name="chevron-right" />其他可选内容<small>{{ syncCategories.slice(2).filter(category => options[category.key]).length }} 项已选择</small></summary><div class="sync-options"><label v-for="category in syncCategories.slice(2)" :key="category.key" class="sync-option"><input v-model="options[category.key]" type="checkbox" :disabled="busy || activeShare" /><span><strong>{{ category.name }}</strong><small>{{ category.description }}</small></span></label></div></details>
      <p class="sync-note">发送时生成当前内容的快照；修改内容后需重新开启。删除状态、缓存、输入记录、快捷方式和壁纸图片留在本机。</p>
      <div v-if="!activeShare" class="sync-actions sync-primary-actions"><button class="primary-button" type="button" :disabled="busy || !moduleChoiceReady" @click="share">{{ busy ? '正在准备…' : '开启同步' }}</button></div>
      <div v-if="sharing" class="sync-connection">
        <div class="sync-connection-heading"><strong>{{ statuses[status?.state ?? 'stopped'] }}</strong><span v-if="activeShare">{{ Math.floor(remaining / 60) }}:{{ String(remaining % 60).padStart(2, '0') }} 后过期</span></div>
        <template v-if="activeShare"><p>在接收端填写一个可连接的地址和配对码。</p><div v-for="address in sharing.addresses" :key="address" class="sync-address"><code>{{ address }}</code><button class="text-button" type="button" @click="copyConnection(address)">复制连接信息</button></div><div class="sync-pair-code"><span>配对码</span><code>{{ sharing.code }}</code></div><small>剩余 {{ status?.attempts_left }} 次配对尝试，仅本次有效。</small><button class="secondary-button" type="button" @click="close().catch(value => error = message(value))">停止同步</button></template>
      </div>
    </section>
    <template v-else>
      <section v-if="!preview" class="sync-panel"><h3>连接发送端</h3><form @submit.prevent="receive"><label class="sync-field">发送端地址<input v-model="endpoint" type="text" required placeholder="如：192.168.1.8:12345" autocomplete="off" spellcheck="false" :disabled="busy" @paste="pasteConnection" /></label><label class="sync-field">8 位配对码<input v-model="code" type="text" required inputmode="numeric" pattern="[0-9]{8}" maxlength="8" autocomplete="one-time-code" placeholder="填写发送端显示的配对码" :disabled="busy" /></label><div class="sync-actions sync-primary-actions"><button class="primary-button" type="submit" :disabled="busy">{{ busy ? '正在连接并读取…' : '连接并预览' }}</button><button v-if="busy" class="secondary-button" type="button" @click="close().catch(value => error = message(value))">取消连接</button></div></form></section>
      <section v-else-if="!result" class="sync-panel">
        <div class="sync-preview-heading"><div><h3>选择接收的内容</h3><p>来自 {{ preview.platform === 'windows' ? 'PC' : '手机' }} · 版本 {{ preview.app_version }} · {{ formatSize(preview.bytes) }}</p></div><button class="text-button" type="button" :disabled="busy" @click="refreshPreview">重新预览</button></div>
        <div class="sync-options"><label v-for="category in syncCategories.slice(0, 2).filter(category => offer?.[category.key])" :key="category.key" class="sync-option"><input :checked="options[category.key]" type="checkbox" :disabled="busy" @change="toggleOption(category.key, ($event.target as HTMLInputElement).checked)" /><span><strong>{{ category.name }}</strong><small>{{ category.description }}</small></span></label></div>
        <details v-if="syncCategories.slice(2).some(category => offer?.[category.key])" class="sync-extra" :open="!offer?.modules && !offer?.automations"><summary><AppIcon class="sync-summary-chevron" name="chevron-right" />其他可选内容<small>{{ syncCategories.slice(2).filter(category => options[category.key]).length }} 项已选择</small></summary><div class="sync-options"><label v-for="category in syncCategories.slice(2).filter(category => offer?.[category.key])" :key="category.key" class="sync-option"><input :checked="options[category.key]" type="checkbox" :disabled="busy" @change="toggleOption(category.key, ($event.target as HTMLInputElement).checked)" /><span><strong>{{ category.name }}</strong><small>{{ category.description }}</small></span></label></div></details>
        <p v-if="offer?.web_data" class="sync-note">发送端提供 {{ preview.web_data_count }} 个网页工具的保存数据；仅导入到本机已有或本次安装的网页工具，不包含预览与会话数据。</p>
        <label class="sync-replace"><input v-model="replace" type="checkbox" :disabled="busy" /><span>覆盖所选的已有内容<small>同 ID 工具和已有网站使用发送端内容；已勾选的网页保存数据按工具整份替换，包括清空。</small></span></label>
        <p class="sync-note">默认保留本机已有内容；网页保存数据仅补充缺少的键，保留同名键。收藏合并，勾选的界面偏好会使用发送端设置；工具包按整包接收。安装前检查依赖和版本，工具与网页保存数据一起导入，失败会回滚。</p>
        <div class="sync-item-list">
          <div v-for="item in preview.items" :key="item.key" class="sync-item" :class="{ blocked: item.status === 'blocked' }">
            <label class="sync-item-choice"><input v-model="selected" type="checkbox" :value="item.key" :disabled="busy || !options[item.kind] || item.status === 'blocked' || item.status === 'same' || (item.status === 'conflict' && !replace)" /><span><strong>{{ item.name }}<small class="sync-item-status">{{ item.status_label || statusNames[item.status] }}</small></strong><small v-if="item.versions" class="sync-item-versions"><template v-if="item.versions.local">本机 {{ item.versions.local }} → </template>发送端 {{ item.versions.incoming }}</small><small v-if="item.reason">{{ item.reason }}</small></span></label>
            <details v-if="item.network_hosts.length" class="sync-network"><summary><AppIcon class="sync-summary-chevron" name="chevron-right" />允许联网（{{ item.network_hosts.length }} 个来源）</summary><ul><li v-for="host in item.network_hosts" :key="host">{{ host }}</li></ul></details>
          </div>
        </div>
        <p v-if="!preview.items.length" class="sync-note">此次没有工具或书签；可接收上方选择的收藏、布局和保存数据。</p>
        <div class="sync-actions"><button class="primary-button" type="button" :disabled="!canApply" @click="apply">{{ applying ? '正在检查并导入…' : '导入所选内容' }}</button><button class="secondary-button" type="button" :disabled="busy" @click="close().then(() => { preview = null; selected = [] }).catch(value => error = message(value))">取消本次同步</button></div>
      </section>
      <section v-else class="sync-panel sync-completed" role="status"><span class="sync-completed-icon" aria-hidden="true"><AppIcon name="check" /></span><h3>同步完成</h3><p v-if="result.imported || result.skipped">已导入 {{ result.imported }} 项工具或书签{{ result.skipped ? `，保留或跳过 ${result.skipped} 项已有内容` : '' }}。</p><p v-else>所选内容已处理。</p><p v-if="result.web_data_imported">已保存 {{ result.web_data_imported }} 个网页工具的同步数据。</p><p v-for="warning in result.warnings" :key="warning">{{ warning }}</p><p v-if="settingsError" class="sync-error" role="alert">{{ settingsError }}</p><p v-if="needsReload">完成后刷新界面，应用新的设置与保存数据。</p><button class="primary-button" type="button" @click="emit('finished', needsReload)">完成</button></section>
    </template>
    <details class="sync-help"><summary><AppIcon class="sync-summary-chevron" name="chevron-right" />无法连接时怎么处理？</summary><p>两端需运行支持同步的版本，连接同一 Wi-Fi 或同一个手机热点。填写发送端显示的地址；存在多个地址时可依次尝试。</p><p>保持两端应用在前台。Windows 防火墙若提示访问网络，请允许当前可信的专用网络。访客 Wi-Fi、路由器的设备隔离、VPN 或系统限制可能阻止互访；可以换普通 Wi-Fi 或手机热点重试。</p><p>配对码 10 分钟后失效，最多尝试 5 次。传输到接收端后本次通道关闭；接收端确认导入前，本机内容不变。反向同步时交换发送和接收角色。</p></details>
  </div>
</template>

<style scoped>
.device-sync { max-width: 900px; margin: 0 auto; }
.sync-intro { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; }
.sync-intro h2 { margin: 0 0 8px; font-size: 21px; }.sync-intro p { margin: 0; color: var(--muted); line-height: 1.7; }
.sync-intro-icon { display: grid; place-items: center; width: 56px; height: 56px; flex: 0 0 56px; border-radius: 18px; color: var(--accent); background: var(--accent-soft); }.sync-intro-icon svg { width: 28px; height: 28px; }
.sync-tabs { display: flex; gap: 5px; padding: 5px; margin-bottom: 20px; border-radius: 14px; background: var(--accent-soft); }.sync-tabs button { flex: 1; min-height: 44px; border: 1px solid transparent; border-radius: 10px; padding: 8px 10px; color: var(--muted); background: transparent; font-weight: 650; }.sync-tabs button.selected { color: var(--accent); border-color: var(--border); background: var(--surface); box-shadow: 0 2px 8px #142c2110; }
.sync-extra { margin-top: 14px; }.sync-extra summary { display: flex; align-items: center; gap: 12px; cursor: pointer; padding: 12px 0; font-size: 13px; font-weight: 650; }.sync-extra summary,.sync-help summary { list-style: none; }.sync-extra summary::-webkit-details-marker,.sync-help summary::-webkit-details-marker { display: none; }.sync-summary-chevron { width: 28px; height: 28px; flex: 0 0 28px; stroke-width: 3; transition: transform .15s; }.sync-extra[open] > summary .sync-summary-chevron,.sync-help[open] > summary .sync-summary-chevron { transform: rotate(90deg); }.sync-extra summary small { margin-left: auto; color: var(--muted); font-weight: 400; }
.sync-panel { padding: 24px; border: 1px solid var(--border); border-radius: 18px; background: var(--surface); }.sync-panel h3 { margin: 0 0 18px; font-size: 17px; }
.sync-options { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }.sync-option,.sync-item { display: flex; gap: 12px; align-items: flex-start; padding: 13px; border: 1px solid var(--border); border-radius: 12px; }.sync-option input,.sync-item input,.sync-replace input { width: 18px; height: 18px; flex: 0 0 18px; margin: 2px 0 0; accent-color: var(--accent); }.sync-option span,.sync-item span { display: grid; gap: 5px; min-width: 0; }.sync-option strong,.sync-item strong { font-size: 13px; overflow-wrap: anywhere; }.sync-option small,.sync-item small { color: var(--muted); line-height: 1.6; overflow-wrap: anywhere; }
.sync-note,.sync-help p { color: var(--muted); font-size: 13px; line-height: 1.8; }.sync-note { margin: 18px 0; }
.sync-connection { margin-top: 20px; padding: 18px; border-radius: 14px; background: var(--accent-soft); }.sync-connection-heading { display: flex; flex-wrap: wrap; gap: 10px; justify-content: space-between; }.sync-connection-heading span,.sync-connection>small { color: var(--muted); font-size: 12px; }.sync-connection p { font-size: 13px; line-height: 1.6; }.sync-address { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin: 8px 0; }.sync-address code { overflow-wrap: anywhere; font-size: 16px; }.sync-pair-code { display: grid; gap: 8px; margin: 20px 0 12px; }.sync-pair-code>span { font-size: 12px; color: var(--muted); }.sync-pair-code code { font-size: 29px; letter-spacing: 4px; }.sync-connection>.secondary-button { display: block; margin-top: 18px; }
.sync-field { display: grid; gap: 8px; margin: 0 0 18px; font-size: 13px; }.sync-field input { width: 100%; min-width: 0; padding: 13px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: var(--text); font-size: 15px; }.sync-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 20px; }
.sync-primary-actions { justify-content: flex-end; }
:root[data-app-layout='mobile'] .sync-primary-actions { flex-direction: column; }
:root[data-app-layout='mobile'] .sync-primary-actions > button { flex: 0 0 auto; width: 100%; }
.sync-preview-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }.sync-preview-heading h3 { margin-bottom: 8px; }.sync-preview-heading p { margin: 0 0 20px; color: var(--muted); font-size: 12px; }
.sync-replace { display: flex; gap: 10px; margin-top: 22px; font-size: 13px; }.sync-replace small { display: block; color: var(--muted); line-height: 1.7; margin-top: 5px; }
.sync-item-list { display: grid; gap: 10px; max-height: 500px; overflow-y: auto; }.sync-item.blocked { opacity: .65; }.sync-item-status { display: inline-block; margin-left: 8px; padding: 1px 6px; border-radius: 6px; background: var(--accent-soft); font-weight: 400; }.sync-item .sync-network { color: var(--accent); }
.sync-item { display: block; }.sync-item-choice { display: flex; align-items: flex-start; gap: 12px; cursor: pointer; }
.sync-item-choice>span { min-width: 0; overflow-wrap: anywhere; }.sync-item-versions { font-variant-numeric: tabular-nums; }
.sync-network { margin-left: 0; font-size: 12px; }.sync-network summary { display: flex; align-items: center; gap: 5px; min-height: 40px; cursor: pointer; list-style: none; }.sync-network summary::-webkit-details-marker { display: none; }.sync-network .sync-summary-chevron { width: 18px; height: 18px; flex-basis: 18px; }.sync-network[open] > summary .sync-summary-chevron { transform: rotate(90deg); }.sync-network ul { display: grid; gap: 6px; list-style: none; margin: 0 0 4px; padding: 10px 12px; border-radius: 9px; background: var(--accent-soft); line-height: 1.6; overflow-wrap: anywhere; }
.sync-error { color: var(--danger); font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; }.sync-notice { color: var(--accent); font-size: 13px; }.sync-help { margin: 24px 0; padding: 18px; border: 1px solid var(--border); border-radius: 14px; }.sync-help summary { display: flex; align-items: center; gap: 12px; cursor: pointer; font-size: 13px; font-weight: 650; }
.sync-completed { text-align: center; padding: 32px 20px; }.sync-completed-icon { display: grid; place-items: center; width: 56px; height: 56px; margin: 0 auto 16px; border-radius: 50%; background: var(--accent-soft); color: var(--accent); font-size: 32px; }.sync-completed-icon svg { width: 30px; height: 30px; stroke-width: 2.6; }.sync-completed p { color: var(--muted); font-size: 13px; line-height: 1.8; }.sync-completed .sync-error { color: var(--danger); }.sync-completed button { margin-top: 12px; }
@media (max-width: 600px) { .sync-options { grid-template-columns: 1fr; }.sync-panel { padding: 18px; }.sync-intro { align-items: flex-start; gap: 12px; }.sync-intro-icon { width: 44px; height: 44px; flex-basis: 44px; border-radius: 14px; }.sync-intro h2 { font-size: 18px; }.sync-intro p { font-size: 13px; }.sync-tabs button { font-size: 13px; }.sync-pair-code code { font-size: 26px; }.sync-actions>button { flex: 1; } }
</style>
