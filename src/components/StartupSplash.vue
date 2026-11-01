<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps<{ imageSrc: string; draggableWindow?: boolean }>()
const emit = defineEmits<{ done: []; drag: [] }>()
const remaining = ref(5)
let countdown: number | undefined
let finished = false

function onMouseDown(event: MouseEvent) {
  if (!props.draggableWindow || event.button !== 0 || event.detail !== 1
    || (event.target instanceof Element && event.target.closest('button'))) return
  event.preventDefault()
  emit('drag')
}

function finish() {
  if (finished) return
  finished = true
  window.clearInterval(countdown)
  emit('done')
}

onMounted(() => {
  const deadline = Date.now() + 5000
  countdown = window.setInterval(() => {
    remaining.value = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
    if (remaining.value === 0) finish()
  }, 100)
})
onBeforeUnmount(() => window.clearInterval(countdown))
</script>

<template>
  <div class="startup-splash" role="dialog" aria-modal="true" aria-label="应用启动画面" @mousedown="onMouseDown" @dragstart.prevent @contextmenu.prevent>
    <img class="startup-splash-image" :src="imageSrc" alt="" draggable="false" />
    <button class="startup-splash-skip" type="button" @click="finish">跳过 {{ remaining }}秒</button>
  </div>
</template>

<style scoped>
:global(html), :global(body), :global(#splash) { width: 100%; min-height: 100%; margin: 0; }
.startup-splash { position: fixed; inset: 0; z-index: 2147483647; overflow: hidden; background: #e5efdf; user-select: none; }
.startup-splash-image { display: block; width: 100%; height: 100%; object-fit: cover; object-position: center; pointer-events: none; -webkit-user-drag: none; }
.startup-splash-skip { position: absolute; top: calc(var(--safe-top, 0px) + 18px); right: 18px; min-height: 38px; padding: 7px 16px; border: 0; border-radius: 999px; background: #ffffff45; color: #fff; text-shadow: 0 1px 4px #152820b3; box-shadow: 0 4px 18px #1c2d2a18; backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); font: 600 14px/1.2 system-ui, sans-serif; cursor: pointer; }
.startup-splash-skip:hover { background: #ffffff60; }
.startup-splash-skip:focus-visible { outline: 3px solid #2c7760; outline-offset: 3px; }
@media (max-width: 599px) { .startup-splash-skip { top: max(0px, calc(var(--safe-top, 0px) - 8px)); } }
</style>
