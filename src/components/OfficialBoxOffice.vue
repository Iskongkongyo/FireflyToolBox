<script setup lang="ts">
import { ref } from 'vue'
import { DESKTOP_BOX_OFFICE_URL } from '../services/officialBoxOffice'
withDefaults(defineProps<{ src?: string }>(), { src: DESKTOP_BOX_OFFICE_URL })
const emit = defineEmits<{ external: [] }>()
const revision = ref(0)
const loading = ref(true)
function reload() { loading.value = true; revision.value++ }
</script>
<template>
  <section class="official-boxoffice">
    <div class="official-boxoffice-toolbar"><strong>猫眼官方实时看板</strong><div><button class="secondary-button" type="button" @click="reload">刷新看板</button><button class="secondary-button" type="button" @click="emit('external')">独立窗口打开</button></div></div>
    <p v-if="loading" class="editor-status" role="status">正在加载官方看板…</p>
    <iframe :key="`${src}-${revision}`" :src="src" title="猫眼实时电影票房" sandbox="allow-scripts allow-same-origin allow-forms" referrerpolicy="no-referrer" @load="loading = false" />
    <p class="module-hint">数据由猫眼官方页面提供。若网络验证或站点限制影响加载，可使用独立窗口打开。</p>
  </section>
</template>
<style scoped>
.official-boxoffice{border:1px solid var(--border);border-radius:14px;overflow:hidden;margin:16px 0;background:var(--surface)}.official-boxoffice-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;flex-wrap:wrap}.official-boxoffice-toolbar>div{display:flex;gap:8px;flex-wrap:wrap}.official-boxoffice-toolbar button{font-size:12px}.official-boxoffice iframe{display:block;width:100%;height:clamp(480px,75vh,980px);border:0;background:#fff}.official-boxoffice>p{margin:10px 16px}@media(max-width:600px){.official-boxoffice-toolbar>div{width:100%}.official-boxoffice-toolbar .secondary-button{flex:1}.official-boxoffice iframe{height:70vh;min-height:480px}}
</style>
