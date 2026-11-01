<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from './AppIcon.vue'
import type { DetectionAction, DetectionResult } from '../services/toolbox'

const props = defineProps<{ value: string; results: DetectionResult[]; message: string; error: boolean; detecting: boolean; selecting: boolean; pasting: boolean; fromClipboard: boolean }>()
defineEmits<{ input: [value: string]; detect: []; clear: []; paste: []; select: [result: DetectionResult, action: DetectionAction] }>()
const bytes = computed(() => new TextEncoder().encode(props.value).byteLength)
const sizeLabel = computed(() => bytes.value < 1024 ? `${bytes.value} B` : `${(bytes.value / 1024).toFixed(1)} KiB`)
const actionCount = computed(() => props.results.reduce((count, result) => count + result.actions.length, 0))
const icons: Record<string, string> = { json: 'module-code', jwt: 'module-lock', uuid: 'module-hash', unix_timestamp: 'module-clock', base64: 'module-text', url_encoded: 'module-link' }
const icon = (type: string) => icons[type] ?? 'detect'
</script>

<template>
  <section class="content-section first-section detection-page" aria-label="智能识别">
    <div class="detection-intro"><span class="detection-intro-icon"><AppIcon name="detect" /></span><h2>让内容找到合适的工具</h2></div>
    <div class="detection-grid">
      <form class="module-panel detection-input-card" @submit.prevent="$emit('detect')">
        <div class="detection-card-heading"><label for="detect-input">待识别内容</label><button class="text-button" type="button" :disabled="!value && !detecting && !pasting" @click="$emit('clear')">清空</button></div>
        <textarea id="detect-input" :value="value" rows="7" spellcheck="false" placeholder="粘贴 JSON、JWT、UUID、时间戳、Base64 或 URL 编码…" aria-describedby="detect-input-help" @input="$emit('input', ($event.target as HTMLTextAreaElement).value)" @keydown.ctrl.enter.prevent="$emit('detect')" @keydown.meta.enter.prevent="$emit('detect')"></textarea>
        <div id="detect-input-help" class="detection-input-info"><span>{{ fromClipboard ? '内容来自剪贴板' : '内容仅用于本次识别' }}</span><span :class="{ 'error-text': bytes > 1024 * 1024 }">{{ sizeLabel }} / 1 MiB</span></div>
        <div class="detection-input-actions"><button class="secondary-button" type="button" :disabled="pasting || selecting" @click="$emit('paste')">{{ pasting ? '正在读取…' : '粘贴并识别' }}</button><button class="primary-button" type="submit" :disabled="!value.trim() || detecting || selecting || pasting">{{ detecting ? '识别中…' : '识别内容' }}</button></div>
      </form>
      <section class="detection-results" aria-labelledby="detection-results-title" :aria-busy="detecting || selecting || pasting">
        <div class="detection-card-heading"><h2 id="detection-results-title" tabindex="-1">识别结果</h2><span v-if="actionCount" class="detection-count">{{ actionCount }} 项操作</span></div>
        <p v-if="message" class="detection-message" :class="{ 'error-text': error }" :role="error ? 'alert' : 'status'">{{ message }}</p>
        <div v-if="detecting || pasting" class="detection-empty" role="status"><AppIcon name="detect" /><strong>{{ pasting ? '正在读取剪贴板' : '正在匹配可用工具' }}</strong><p>稍等一下，识别结果会显示在这里。</p></div>
        <template v-else-if="results.length">
          <article v-for="result in results" :key="result.type_id" class="detection-result-card" :data-type-id="result.type_id">
            <div class="detection-result-heading"><span class="detection-result-icon"><AppIcon :name="icon(result.type_id)" /></span><h3>{{ result.label }}</h3><span>{{ result.confidence >= .8 ? '匹配度高' : '可能匹配' }}</span></div>
            <button v-for="action in result.actions" :key="`${action.tool_id}:${action.id}`" class="result-action detection-action" :data-tool-id="action.tool_id" :data-action-id="action.id" type="button" :disabled="detecting || selecting" @click="$emit('select', result, action)"><span>{{ action.label }}</span><AppIcon name="chevron-right" /></button>
          </article>
          <p class="detection-results-hint">选择工具后会带入完整原文，保留空格和换行；工具由你确认运行。</p>
        </template>
        <div v-else class="detection-empty"><AppIcon name="detect" /><strong>{{ message ? '换一段内容试试' : value ? '准备好后，开始识别' : '先添加一段内容' }}</strong><p>{{ message ? '修改内容后可重新识别，也可以从工具管理中直接打开工具。' : '输入或粘贴文字，识别后在这里选择工具。' }}</p></div>
      </section>
    </div>
  </section>
</template>
