<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { invoke, isTauri } from '@tauri-apps/api/core'
import AppIcon from './AppIcon.vue'
import { markMessageRead, messageKey, safeMessageUrl, sanitizeMessageHtml, wasMessageRead,
  type MessageCard, type RemoteMessageFeed } from '../services/remoteMessages'

const props = defineProps<{ ready: boolean; currentVersion: string }>()
const emit = defineEmits<{ notify: [message: string]; 'open-change': [open: boolean]; 'checking-change': [checking: boolean] }>()
const dialog = ref<HTMLDialogElement | null>(null)
const title = ref<HTMLElement | null>(null)
const current = ref<MessageCard | null>(null)
const queue: MessageCard[] = []
const force = computed(() => current.value?.kind === 'update' && current.value.data.force)
const html = computed(() => sanitizeMessageHtml(current.value?.data.content || ''))
const openingLink = ref(false)
const linkError = ref('')
let disposed = false
let request: Promise<RemoteMessageFeed> | null = null
let observer: MutationObserver | undefined
let presentPending = false

async function present() {
  if (disposed || presentPending || !props.ready || current.value || !queue.length
    || document.visibilityState === 'hidden' || document.querySelector('dialog[open]')) return
  presentPending = true
  current.value = queue.shift()!
  linkError.value = ''
  await nextTick()
  presentPending = false
  if (disposed || !current.value) return
  dialog.value?.showModal()
  emit('open-change', true)
  title.value?.focus({ preventScroll: true })
}
function enqueue(card: MessageCard, manual = false) {
  if (!card.data.enabled || (!manual && card.data.show_once !== false && !(card.kind === 'update' && card.data.force) && wasMessageRead(card))) return
  const key = messageKey(card)
  if (current.value && messageKey(current.value) === key || queue.some(item => messageKey(item) === key)) return
  // Keep update priority when a manual check finishes while a notification is waiting.
  if (card.kind === 'update') queue.unshift(card)
  else queue.push(card)
}
function fetchFeed(): Promise<RemoteMessageFeed> {
  if (request) return request
  emit('checking-change', true)
  request = invoke<RemoteMessageFeed>('fetch_remote_messages')
    .finally(() => { request = null; if (!disposed) emit('checking-change', false) })
  return request
}
async function checkUpdates(manual = true) {
  if (!isTauri()) { if (manual) emit('notify', '请在应用内检查更新。'); return }
  try {
    const feed = await fetchFeed()
    if (disposed) return
    if (feed.update) enqueue({ kind: 'update', data: feed.update }, manual)
    if (!manual && feed.notification) enqueue({ kind: 'notification', data: feed.notification })
    if (manual && !feed.configured) emit('notify', '尚未配置更新与通知地址。')
    else if (manual && !feed.update) emit('notify', `暂无可用更新，当前版本 ${props.currentVersion}。`)
    void present()
  } catch {
    if (manual && !disposed) emit('notify', '暂时无法检查更新，请稍后重试。')
    // Startup failures intentionally stay silent. Retries are bounded natively.
  }
}
function dismiss() {
  if (!current.value || force.value || openingLink.value) return
  if (current.value.data.show_once !== false) markMessageRead(current.value)
  dialog.value?.close()
}
function closed() {
  // Native Back and Escape cannot dismiss a mandatory update.
  if (force.value && !disposed) { dialog.value?.showModal(); return }
  current.value = null
  openingLink.value = false
  // Keep the queue blocking tool presentation between an update and its notice.
  void nextTick().then(async () => {
    await present()
    if (!current.value && !disposed) emit('open-change', false)
  })
}
function onCancel(event: Event) { event.preventDefault(); dismiss() }
async function visit(value: string) {
  const url = safeMessageUrl(value)
  if (!url || openingLink.value) return
  openingLink.value = true
  linkError.value = ''
  try {
    if (isTauri()) await invoke('open_remote_message_link', { url })
    else window.open(url, '_blank', 'noopener,noreferrer')
  } catch { if (!disposed) linkError.value = '未能打开浏览器，请稍后重试。' }
  finally { if (!disposed) openingLink.value = false }
}
function contentClick(event: MouseEvent) {
  const link = (event.target as Element).closest('a')
  if (!link) return
  event.preventDefault()
  const href = link.getAttribute('href')
  if (href) void visit(href)
}
defineExpose({ checkUpdates, handleBack: dismiss })
watch(() => props.ready, () => { void present() })
onMounted(() => {
  observer = new MutationObserver(() => { void present() })
  observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] })
  document.addEventListener('visibilitychange', present)
  void checkUpdates(false)
})
onBeforeUnmount(() => {
  disposed = true
  observer?.disconnect()
  document.removeEventListener('visibilitychange', present)
  dialog.value?.close()
})
</script>

<template>
  <dialog ref="dialog" class="remote-message-dialog" :class="{ 'remote-message-required': force }" aria-labelledby="remote-message-title" @cancel="onCancel" @close="closed">
    <template v-if="current">
      <header class="remote-message-header">
        <div class="remote-message-eyebrow"><span class="remote-message-icon"><AppIcon :name="current.kind === 'update' ? 'download' : 'notification'" /></span><span>{{ current.kind === 'update' ? '发现新版本' : '流萤百宝箱来信' }}</span><span v-if="force" class="remote-message-badge">需要更新</span></div>
        <button v-if="!force" class="icon-button remote-message-close" type="button" :disabled="openingLink" :aria-label="current.kind === 'update' ? '关闭更新提示' : '关闭通知'" @click="dismiss"><AppIcon name="close" /></button>
        <h2 id="remote-message-title" ref="title" tabindex="-1">{{ current.data.title }}</h2>
        <p v-if="current.kind === 'update'" class="remote-message-version">{{ props.currentVersion }}<span aria-hidden="true">→</span><strong>{{ current.data.version }}</strong></p>
      </header>
      <div class="remote-message-body" tabindex="0" aria-label="正文内容" @click="contentClick" @auxclick.prevent v-html="html"></div>
      <footer class="remote-message-footer">
        <p v-if="force" class="remote-message-hint">更新后即可继续使用，下载将在浏览器中打开。</p>
        <p v-if="linkError" class="error-text" role="alert">{{ linkError }}</p>
        <div class="remote-message-actions">
          <button v-if="current.kind === 'update' && !force" type="button" class="secondary-button" :disabled="openingLink" @click="dismiss">稍后再说</button>
          <button v-if="current.kind === 'update'" type="button" class="primary-button" :disabled="openingLink" @click="visit(current.data.download_url)"><AppIcon v-if="!openingLink" name="download" />{{ openingLink ? '正在打开…' : '前往下载' }}</button>
          <button v-else type="button" class="primary-button" :disabled="openingLink" @click="dismiss">我知道了<AppIcon name="check" /></button>
        </div>
      </footer>
    </template>
  </dialog>
</template>

<style>
.remote-message-dialog { width: min(560px, calc(100vw - 32px)); max-width: none; max-height: min(760px, calc(100dvh - var(--safe-top, 0px) - var(--safe-bottom, 0px) - 40px)); padding: 0; border: 1px solid var(--border); border-radius: 26px; background: var(--surface); color: var(--text); box-shadow: 0 28px 100px #102c3752; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif; }
.remote-message-dialog[open] { display: flex; flex-direction: column; }
.remote-message-dialog::backdrop { background: #10241fd0; backdrop-filter: blur(7px); }
.remote-message-header { position: relative; flex: 0 0 auto; padding: 26px 28px 22px; background: radial-gradient(ellipse at 90% 0, color-mix(in srgb, var(--accent) 13%, transparent), transparent 70%), linear-gradient(125deg, var(--accent-soft), var(--surface)); }
.remote-message-eyebrow { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding-right: 38px; color: var(--accent); font-size: calc(16px * var(--app-font-scale)); font-weight: 650; line-height: 1.5; }
.remote-message-icon { display: grid; place-items: center; width: 34px; height: 34px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; }
.remote-message-icon svg { width: 18px; height: 18px; }
.remote-message-badge { padding: 4px 8px; border-radius: 99px; background: var(--accent); color: var(--surface); font-size: calc(11px * var(--app-font-scale)); }
.remote-message-close { position: absolute; top: 19px; right: 17px; width: 44px; min-height: 44px; background: transparent; }
.remote-message-close svg { width: 19px; height: 19px; }
.remote-message-header h2 { margin: 18px 0 0; font-size: calc(25px * var(--app-font-scale)); line-height: 1.35; letter-spacing: -.4px; overflow-wrap: anywhere; }
.remote-message-header h2:focus { outline: none; }
.remote-message-version { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin: 12px 0 0; color: var(--muted); font-size: calc(12px * var(--app-font-scale)); }
.remote-message-version strong { color: var(--accent); }
.remote-message-body { flex: 1 1 auto; min-height: 60px; padding: 22px 28px; overflow: auto; overscroll-behavior: contain; overflow-wrap: anywhere; line-height: 1.75; font-size: calc(14px * var(--app-font-scale)); }
.remote-message-body > :first-child { margin-top: 0; }
.remote-message-body > :last-child { margin-bottom: 0; }
.remote-message-body :is(h1,h2,h3,h4,h5,h6) { margin: 1.2em 0 .5em; line-height: 1.4; color: var(--text); }
.remote-message-body h1 { font-size: 1.6em; }.remote-message-body h2 { font-size: 1.4em; }.remote-message-body h3 { font-size: 1.2em; }.remote-message-body :is(h4,h5,h6) { font-size: 1em; }
.remote-message-body p { margin: .8em 0; }
.remote-message-body img { display: block; max-width: 100%; height: auto; border-radius: 14px; margin: 14px auto; }
.remote-message-body a { color: var(--accent); text-decoration: underline; text-underline-offset: 3px; }
.remote-message-body :is(ul,ol) { padding-left: 1.6em; }
.remote-message-body li + li { margin-top: .35em; }
.remote-message-body blockquote { margin: 1em 0; padding: 10px 16px; border-left: 3px solid var(--accent); border-radius: 0 10px 10px 0; background: var(--accent-soft); }
.remote-message-body pre { max-width: 100%; padding: 12px; overflow: auto; border-radius: 10px; background: var(--accent-soft); white-space: pre-wrap; }
.remote-message-body code { font-size: .9em; }
.remote-message-body table { display: block; width: 100%; overflow: auto; border-collapse: collapse; }
.remote-message-body :is(th,td) { border: 1px solid var(--border); padding: 7px 10px; }
.remote-message-body hr { margin: 18px 0; border: 0; border-top: 1px solid var(--border); }
.remote-message-footer { flex: 0 0 auto; padding: 16px 28px 20px; border-top: 1px solid var(--border); background: var(--surface); }
.remote-message-hint { margin: 0 0 13px; color: var(--muted); font-size: calc(12px * var(--app-font-scale)); line-height: 1.6; }
.remote-message-actions { display: flex; justify-content: flex-end; gap: 10px; }
.remote-message-actions button { display: inline-flex; align-items: center; justify-content: center; gap: 9px; min-height: 46px; }
.remote-message-actions .secondary-button { background: var(--surface); color: var(--text); border-color: var(--border); }
.remote-message-actions .primary-button { background: var(--primary-bg, var(--accent)); color: var(--primary-text, #fff); }
.remote-message-actions svg { flex-shrink: 0; width: 18px; height: 18px; }
@media (max-width: 599px) {
  .remote-message-dialog { border-radius: 22px; width: calc(100vw - 24px); max-height: calc(100dvh - var(--safe-top, 0px) - var(--safe-bottom, 0px) - 28px); }
  .remote-message-header { padding: 22px 20px 18px; }
  .remote-message-header h2 { font-size: calc(22px * var(--app-font-scale)); }
  .remote-message-body { padding: 18px 20px; }
  .remote-message-footer { padding: 14px 20px 16px; }
  .remote-message-actions button { flex: 1; min-width: 0; padding: 0 8px; gap: 6px; white-space: nowrap; }
  .remote-message-actions svg { width: 16px; height: 16px; }
}
</style>
