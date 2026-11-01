<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'

type SelectOption = { value: string; label: string }

const props = withDefaults(defineProps<{
  modelValue: string
  options: SelectOption[]
  placeholder?: string
  ariaLabel: string
  id?: string
  disabled?: boolean
  required?: boolean
}>(), { placeholder: '请选择', disabled: false, required: false })
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const trigger = ref<HTMLButtonElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const open = ref(false)
const menuId = useId()
const portalTarget = ref<HTMLElement | string>('body')
let activeDialog: HTMLDialogElement | null = null
const menuStyle = ref({ left: '0px', top: '0px', width: '0px', maxHeight: '0px' })
const selectedLabel = computed(() => props.options.find((option) => option.value === props.modelValue)?.label ?? props.placeholder)

function positionMenu() {
  if (!trigger.value || !open.value) return
  const rect = trigger.value.getBoundingClientRect()
  const viewport = window.visualViewport
  const topEdge = viewport?.offsetTop ?? 0
  const bottomEdge = topEdge + (viewport?.height ?? window.innerHeight)
  const leftEdge = viewport?.offsetLeft ?? 0
  const rightEdge = leftEdge + (viewport?.width ?? window.innerWidth)
  const gap = 5
  const below = Math.max(0, bottomEdge - rect.bottom - gap - 8)
  const above = Math.max(0, rect.top - topEdge - gap - 8)
  const desired = Math.min(320, props.options.length * 44 + 8)
  const useAbove = below < desired && above > below
  const height = Math.max(0, Math.min(desired, useAbove ? above : below))
  const width = Math.max(0, Math.min(rect.width, rightEdge - leftEdge - 16))
  menuStyle.value = {
    left: `${Math.max(leftEdge + 8, Math.min(rect.left, rightEdge - width - 8))}px`,
    top: `${useAbove ? rect.top - gap - height : rect.bottom + gap}px`,
    width: `${width}px`,
    maxHeight: `${height}px`,
  }
}

function onDocumentPointerDown(event: PointerEvent) {
  const target = event.target as Node
  if (!trigger.value?.contains(target) && !menu.value?.contains(target)) closeMenu()
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && open.value) {
    event.preventDefault()
    event.stopPropagation()
    closeMenu(true)
  }
}

function addListeners() {
  activeDialog?.addEventListener('close', onDialogClose)
  document.addEventListener('pointerdown', onDocumentPointerDown, true)
  document.addEventListener('keydown', onDocumentKeydown, true)
  window.addEventListener('scroll', positionMenu, true)
  window.addEventListener('resize', positionMenu)
  window.visualViewport?.addEventListener('resize', positionMenu)
  window.visualViewport?.addEventListener('scroll', positionMenu)
}

function removeListeners() {
  activeDialog?.removeEventListener('close', onDialogClose)
  activeDialog = null
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  document.removeEventListener('keydown', onDocumentKeydown, true)
  window.removeEventListener('scroll', positionMenu, true)
  window.removeEventListener('resize', positionMenu)
  window.visualViewport?.removeEventListener('resize', positionMenu)
  window.visualViewport?.removeEventListener('scroll', positionMenu)
}

async function openMenu(focusLast = false) {
  if (props.disabled || !props.options.length || open.value || !trigger.value) return
  activeDialog = trigger.value.closest<HTMLDialogElement>('dialog[open]')
  portalTarget.value = activeDialog ?? 'body'
  open.value = true
  addListeners()
  await nextTick()
  positionMenu()
  const selected = menu.value?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
  const options = menu.value?.querySelectorAll<HTMLButtonElement>('[role="option"]')
  const target = selected ?? (focusLast ? options?.[options.length - 1] : options?.[0])
  target?.focus({ preventScroll: true })
  target?.scrollIntoView({ block: 'nearest' })
}

function closeMenu(restoreFocus = false) {
  if (!open.value) return
  open.value = false
  removeListeners()
  if (restoreFocus) trigger.value?.focus({ preventScroll: true })
}

function onDialogClose() { closeMenu() }

function choose(value: string) {
  emit('update:modelValue', value)
  closeMenu(true)
}

function onTriggerKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === ' ' || event.key === 'Enter') {
    event.preventDefault()
    void openMenu(event.key === 'ArrowUp')
  }
}

function onMenuKeydown(event: KeyboardEvent) {
  const options = Array.from(menu.value?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])
  const index = options.indexOf(document.activeElement as HTMLButtonElement)
  let next = index
  if (event.key === 'ArrowDown') next = Math.min(index + 1, options.length - 1)
  else if (event.key === 'ArrowUp') next = Math.max(index - 1, 0)
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = options.length - 1
  else if (event.key === 'Tab') { closeMenu(); return }
  else return
  event.preventDefault()
  options[next]?.focus()
  options[next]?.scrollIntoView({ block: 'nearest' })
}

watch(() => props.disabled, (disabled) => { if (disabled) closeMenu() })
watch(() => props.options.length, () => { if (open.value) nextTick(positionMenu) })
onBeforeUnmount(removeListeners)
</script>

<template>
  <button
    :id="id"
    ref="trigger"
    class="viewport-select-trigger"
    type="button"
    :disabled="disabled"
    :aria-label="ariaLabel"
    :aria-required="required || undefined"
    aria-haspopup="listbox"
    :aria-expanded="open"
    :aria-controls="open ? menuId : undefined"
    @click="open ? closeMenu() : openMenu()"
    @keydown="onTriggerKeydown"
  ><span :class="{ 'viewport-select-placeholder': !modelValue }">{{ selectedLabel }}</span><span class="viewport-select-chevron" aria-hidden="true"></span></button>
  <Teleport :to="portalTarget">
    <div v-if="open" :id="menuId" ref="menu" class="viewport-select-menu" role="listbox" :aria-label="ariaLabel" :style="menuStyle" @keydown="onMenuKeydown">
      <button v-for="option in options" :key="option.value" type="button" role="option" class="viewport-select-option" :aria-selected="modelValue === option.value" @click="choose(option.value)">{{ option.label }}</button>
    </div>
  </Teleport>
</template>

<style scoped>
.viewport-select-trigger { display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; min-width: 0; min-height: 44px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: var(--text); font: inherit; font-weight: 400; text-align: left; cursor: pointer; }
.viewport-select-trigger > span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.viewport-select-trigger:hover:not(:disabled), .viewport-select-trigger[aria-expanded="true"] { border-color: var(--accent); }
.viewport-select-trigger:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.viewport-select-trigger:disabled { opacity: .55; cursor: not-allowed; }
.viewport-select-placeholder { color: var(--muted); }
.viewport-select-chevron { width: 8px; height: 8px; flex: 0 0 8px; margin-right: 3px; border-right: 2px solid currentColor; border-bottom: 2px solid currentColor; transform: translateY(-2px) rotate(45deg); }
.viewport-select-menu { position: fixed; z-index: 9999; box-sizing: border-box; overflow-y: auto; overscroll-behavior: contain; padding: 4px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: var(--text); box-shadow: 0 12px 32px #10251d35; }
.viewport-select-option { display: block; width: 100%; min-height: 40px; padding: 9px 10px; border: 0; border-radius: 7px; background: transparent; color: inherit; font: inherit; text-align: left; overflow-wrap: anywhere; cursor: pointer; }
.viewport-select-option:hover, .viewport-select-option:focus-visible, .viewport-select-option[aria-selected="true"] { outline: none; background: var(--accent-soft); color: var(--accent); }
</style>
