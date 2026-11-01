<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
const props = withDefaults(defineProps<{ active: boolean; mobile: boolean; initialHint?: boolean }>(), { initialHint: true })
const emit = defineEmits<{ exit: [] }>()
const visible = ref(false)
const showHint = ref(false)
const panel = ref<HTMLElement | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined
let pressedPointer: number | null = null
let pointerClickReady = false
let mouseHover = false
function clearPointer() { pressedPointer = null; pointerClickReady = false }
function hide() { clearTimeout(timer); visible.value = false; showHint.value = false; mouseHover = false; clearPointer() }
function keepVisible() {
  if (!props.active || !visible.value) return
  clearTimeout(timer)
  timer = setTimeout(() => {
    const keyboardFocus = panel.value?.querySelector('button')?.matches(':focus-visible')
    if (!keyboardFocus && !mouseHover && pressedPointer === null) hide()
  }, 6000)
}
function show(initial = false) { if (!props.active) return; clearPointer(); visible.value = true; showHint.value = initial; keepVisible() }
function reveal() { show() }
function focusIn() { if (!visible.value) reveal(); else keepVisible() }
function pointerEnter(event: PointerEvent) { if (event.pointerType === 'mouse') { mouseHover = true; keepVisible() } }
function pointerLeave(event: PointerEvent) { if (event.pointerType === 'mouse') mouseHover = false; pressedPointer = null; keepVisible() }
function pointerDown(event: PointerEvent) {
  clearPointer()
  if (event.isPrimary && event.button === 0 && props.active && visible.value && !panel.value?.classList.contains('fullscreen-controls-hidden')) pressedPointer = event.pointerId
}
function pointerUp(event: PointerEvent) {
  pointerClickReady = pressedPointer === event.pointerId
  pressedPointer = null
  keepVisible()
}
function activate(event: MouseEvent) {
  if (!props.active) return
  if (!visible.value || panel.value?.classList.contains('fullscreen-controls-hidden')) { clearPointer(); reveal(); return }
  const pointer = event as PointerEvent & { sourceCapabilities?: { firesTouchEvents?: boolean } }
  const fromPointer = event.detail > 0 || !!pointer.pointerType || pointer.sourceCapabilities?.firesTouchEvents === true
  // A touch can reveal controls in the iframe, then deliver a compatibility
  // click to the newly visible button. Only a fresh visible-button press exits.
  if (fromPointer && !pointerClickReady) return
  clearPointer()
  emit('exit')
}
watch(() => props.active, active => { clearTimeout(timer); mouseHover = false; clearPointer(); if (active && props.initialHint) show(true); else hide() }, { immediate: true })
onBeforeUnmount(() => clearTimeout(timer))
defineExpose({ reveal })
</script>

<template>
  <div v-if="active" ref="panel" class="web-tool-fullscreen-controls" :class="{ 'fullscreen-controls-hidden': !visible }" @pointerenter="pointerEnter" @pointerleave="pointerLeave" @focusin="focusIn" @focusout="keepVisible">
    <button class="fullscreen-exit-button" type="button" aria-label="退出工具全屏" @pointerdown="pointerDown" @pointerup="pointerUp" @pointercancel="clearPointer" @click="activate"><AppIcon name="close" /><span>退出全屏</span></button>
    <span v-if="showHint" class="fullscreen-exit-hint"><span>{{ mobile ? '退出全屏：屏幕右边缘左滑或者点击系统返回键；' : '退出全屏：按ESC退出；' }}</span><span>{{ mobile ? '长按右上角空白处呼出退出按钮' : '鼠标靠近右上方顶边并停留，呼出退出按钮' }}</span></span>
  </div>
</template>

<style>
.web-tool-fullscreen-controls { position: fixed; z-index: 10001; top: calc(max(env(safe-area-inset-top, 0px), var(--system-cutout-top, 0px)) + 12px); right: calc(max(env(safe-area-inset-right, 0px), var(--system-cutout-right, 0px)) + 12px); display: grid; justify-items: end; gap: 7px; max-width: calc(100vw - 24px); transition: opacity .18s; pointer-events: none; }
.fullscreen-exit-button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 0 16px; border: 1px solid #ffffff65; border-radius: 999px; background: #17231fea; color: #fff; font-size: 14px; box-shadow: 0 3px 16px #0003; pointer-events: auto; }
.fullscreen-exit-button svg { width: 17px; height: 17px; }
.fullscreen-exit-hint { max-width: min(360px, calc(100vw - 24px)); padding: 8px 12px; border-radius: 8px; background: #17231fea; color: #fff; font-size: 12px; line-height: 1.65; text-align: left; pointer-events: none; }
.fullscreen-exit-hint > span { display: block; }
.fullscreen-controls-hidden { opacity: 0; pointer-events: none; }
.fullscreen-controls-hidden .fullscreen-exit-button { pointer-events: none; }
</style>
