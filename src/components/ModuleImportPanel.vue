<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from './AppIcon.vue'
import type { ModuleImportItem } from '../services/moduleImportQueue'

const props = defineProps<{
  items: ModuleImportItem[]; busy: boolean; phase: 'idle' | 'reading' | 'installing'
  progress: { done: number; total: number }; notice: string; error: string
  dragging: boolean; canDrop: boolean; illustration: string
}>()
defineEmits<{ pick: []; install: [id?: number]; retry: [id: number]; remove: [id: number]; clear: [] }>()
const pending = computed(() => props.items.filter(item => item.summary && (item.state === 'ready' || item.state === 'failed')).length)
const installed = computed(() => props.items.filter(item => item.state === 'installed').length)
const states = { waiting: '等待检查', checking: '正在检查', ready: '待安装', invalid: '无法导入', installing: '安装中', installed: '已安装', failed: '安装失败' }
const hosts = (item: ModuleImportItem) => item.summary?.network_hosts.map(host => host === 'https://*' ? '任意 HTTPS 来源' : host).join(' · ') || '无需联网'
</script>

<template>
  <div class="module-panel module-studio-import-card">
    <div class="module-panel-heading"><div><h2>导入工具包</h2><p>{{ canDrop ? '可选择或拖入多个 .fftool 文件，核对内容后逐个安装或一键安装全部。' : '可一次选择多个 .fftool 文件，核对内容后逐个安装或一键安装全部。' }}</p></div></div>
    <div class="module-studio-import-zone" :class="{ 'drag-over': dragging, 'has-imports': items.length }">
      <img class="module-studio-illustration" :src="illustration" alt="" />
      <div class="module-import-zone-copy"><strong>{{ items.length ? '继续添加工具包' : '把常用工具一次带进来' }}</strong><small>支持多选。文本包最多 2 MiB；网页包须为 v7，包文件和解包内容各最多 128 MiB。</small></div>
      <button class="primary-button module-import-button" type="button" :disabled="busy" @click="$emit('pick')">{{ phase === 'reading' ? '正在读取文件…' : items.length ? '继续选择文件' : '选择 .fftool 文件（可多选）' }}</button>
    </div>
    <p v-if="error" class="error-text module-page-error" role="alert">{{ error }}</p>
    <section v-if="items.length" class="module-import-list-section" aria-label="待导入工具包">
      <div class="module-import-toolbar">
        <div class="module-import-count"><h3>导入列表 <span>{{ items.length }}</span></h3><p>{{ pending }} 个待安装<span v-if="installed"> · {{ installed }} 个已安装</span></p></div>
        <div class="module-import-batch-actions"><button class="text-button" type="button" :disabled="busy" @click="$emit('clear')">清空列表</button><button class="primary-button" type="button" :disabled="busy || !pending" @click="$emit('install')">{{ phase === 'installing' ? `安装中 ${progress.done} / ${progress.total}` : `安装全部（${pending}）` }}</button></div>
      </div>
      <div v-if="phase === 'installing'" class="module-import-progress" role="status"><progress :value="progress.done" :max="progress.total" aria-label="工具包安装进度"></progress><span>正在安装第 {{ Math.min(progress.done + 1, progress.total) }} / {{ progress.total }} 个工具包</span></div>
      <ol class="module-import-list">
        <li v-for="item in items" :key="item.id" class="module-import-item" :class="`import-${item.state}`">
          <div class="module-import-item-heading"><span class="module-import-file-icon" aria-hidden="true"><AppIcon :name="item.state === 'installed' ? 'check' : 'module-file'" /></span><div class="module-import-item-title"><strong>{{ item.summary?.name || item.fileName }}</strong><small>{{ item.summary ? `v${item.summary.version} · ${item.summary.tools.length} 个工具 · ${item.summary.author}` : item.fileName }}</small></div><span class="module-import-state" role="status">{{ states[item.state] }}</span></div>
          <template v-if="item.summary">
            <div class="module-tool-tags"><span v-for="(name, index) in item.summary.tools" :key="index">{{ name }}</span></div>
            <details class="module-import-details"><summary>工具包信息<span class="module-import-network-hint">{{ item.summary.network_hosts.length ? '需联网' : '无需联网' }}</span></summary><dl><div><dt>文件</dt><dd>{{ item.fileName }}</dd></div><div><dt>功能分组</dt><dd>{{ item.summary.categories.join(' · ') }}</dd></div><div><dt>工具包 ID</dt><dd class="module-identifier">{{ item.summary.module_id }}</dd></div><div><dt>联网来源</dt><dd>{{ hosts(item) }}</dd></div></dl></details>
          </template>
          <p v-if="item.error" class="error-text module-import-item-error" role="alert">{{ item.error }}</p>
          <div class="module-import-item-actions"><button class="text-button" type="button" :disabled="busy" :aria-label="`从列表移除 ${item.summary?.name || item.fileName}`" @click="$emit('remove', item.id)">移出列表</button><button v-if="item.state === 'invalid'" class="secondary-button" type="button" :disabled="busy" @click="$emit('retry', item.id)">重新检查</button><button v-else-if="item.state === 'ready' || item.state === 'failed' || item.state === 'installing'" class="secondary-button" type="button" :disabled="busy" @click="$emit('install', item.id)">{{ item.state === 'failed' ? '重试安装' : item.state === 'installing' ? '安装中…' : '安装此工具包' }}</button></div>
        </li>
      </ol>
      <p class="module-hint">工具包包含可执行脚本，安装前请核对作者、包含的工具和联网来源。个别工具包失败时，其他工具包会继续安装。</p>
    </section>
    <p v-if="notice" class="module-studio-notice module-import-notice" role="status">{{ notice }}</p>
  </div>
</template>
