<script setup lang="ts">
defineProps<{ html: string; loading: boolean; error: string }>()
defineEmits<{ retry: [] }>()
</script>

<template>
  <section class="content-section first-section tool-author-skill-page" aria-label="工具编写指南">
    <p class="tool-author-skill-intro">阅读 SKILL，或复制全文交给编写工具的 AI 助手。</p>
    <p v-if="loading" class="tool-author-skill-loading" role="status">正在加载工具编写指南…</p>
    <div v-else-if="error" class="tool-author-skill-error" role="alert"><p>{{ error }}</p><button class="secondary-button" type="button" @click="$emit('retry')">重新加载</button></div>
    <article v-else class="tool-author-skill-content" role="document" aria-label="工具编写指南正文" tabindex="0" v-html="html"></article>
  </section>
</template>
