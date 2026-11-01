<script setup lang="ts">
import { ref } from 'vue'
import ViewportSelect from './ViewportSelect.vue'
import { savePreferences } from '../services/preferences'
import { DEFAULT_SCRIPT_BUDGETS, INITIALIZATION_BUDGET_KEY, INTERACTION_BUDGET_KEY, SCRIPT_BUDGET_CHOICES, readWebToolBudgets, validScriptBudget } from '../services/webToolBudgets'
import { DEFAULT_WEB_TOOL_PRESENTATION, DEFAULT_WEB_TOOL_FULLSCREEN_KEY, INITIAL_FULLSCREEN_HINT_KEY, readWebToolPresentation } from '../services/webToolPresentation'

const emit = defineEmits<{ error: [message: string] }>()
const initial = readWebToolBudgets()
const initialization = ref(String(initial.initializationMs))
const interaction = ref(String(initial.interactionMs))
const status = ref('')
const initialPresentation = readWebToolPresentation()
const defaultFullscreen = ref(initialPresentation.defaultFullscreen)
const initialHint = ref(initialPresentation.initialHint)
function togglePresentation(kind: 'defaultFullscreen' | 'initialHint') {
  const current = kind === 'defaultFullscreen' ? defaultFullscreen : initialHint
  const key = kind === 'defaultFullscreen' ? DEFAULT_WEB_TOOL_FULLSCREEN_KEY : INITIAL_FULLSCREEN_HINT_KEY
  try {
    savePreferences({ [key]: String(!current.value) })
    current.value = !current.value
    status.value = '已保存，下次进入网页工具时生效。'
  } catch { status.value = ''; emit('error', '网页工具显示设置未能保存，请重试。') }
}
function options(defaultMs: number) {
  return SCRIPT_BUDGET_CHOICES.map(value => ({ value: String(value), label: (value ? `${value / 1000} 秒` : '不限制') + (value === defaultMs ? '（默认）' : '') }))
}
function change(key: string, value: string) {
  if (!validScriptBudget(value)) return
  try {
    savePreferences({ [key]: value })
    if (key === INITIALIZATION_BUDGET_KEY) initialization.value = value
    else interaction.value = value
    status.value = '已保存，重新打开网页工具后生效。'
  } catch { status.value = ''; emit('error', '运行预算未能保存，请重试。') }
}
function reset() {
  try {
    savePreferences({ [INITIALIZATION_BUDGET_KEY]: null, [INTERACTION_BUDGET_KEY]: null, [DEFAULT_WEB_TOOL_FULLSCREEN_KEY]: null, [INITIAL_FULLSCREEN_HINT_KEY]: null })
    initialization.value = String(DEFAULT_SCRIPT_BUDGETS.initializationMs)
    interaction.value = String(DEFAULT_SCRIPT_BUDGETS.interactionMs)
    defaultFullscreen.value = DEFAULT_WEB_TOOL_PRESENTATION.defaultFullscreen
    initialHint.value = DEFAULT_WEB_TOOL_PRESENTATION.initialHint
    status.value = '已恢复默认，重新打开网页工具后生效。'
  } catch { status.value = ''; emit('error', '网页工具设置未能恢复默认，请重试。') }
}
</script>

<template>
  <div class="web-tool-budget-settings">
    <div class="home-appearance-heading"><p>工具连续计算超时后会自动停止。复杂工具被提前停止时，可以适当延长时间。</p><button class="text-button" type="button" @click="reset">恢复默认</button></div>
    <div class="web-tool-budget-controls">
      <div class="web-tool-budget-control">
        <label for="web-tool-initialization-budget"><strong>初始化预算</strong><small>打开工具、准备界面时，一次连续计算最多允许运行多久。</small></label>
        <ViewportSelect id="web-tool-initialization-budget" :model-value="initialization" :options="options(DEFAULT_SCRIPT_BUDGETS.initializationMs)" ariaLabel="初始化预算" @update:model-value="change(INITIALIZATION_BUDGET_KEY, $event)" />
        <p class="web-tool-budget-detail">调高后也会延长打开工具的等待时间；选择“不限制”会关闭打开超时。</p>
      </div>
      <div class="web-tool-budget-control">
        <label for="web-tool-interaction-budget"><strong>挂载后交互预算</strong><small>工具打开后，点击按钮等操作可连续计算的最长时间。</small></label>
        <ViewportSelect id="web-tool-interaction-budget" :model-value="interaction" :options="options(DEFAULT_SCRIPT_BUDGETS.interactionMs)" ariaLabel="挂载后交互预算" @update:model-value="change(INTERACTION_BUDGET_KEY, $event)" />
      </div>
    </div>
    <p class="module-hint">等待网络响应、选择文件等时间不计入以上时限。时间设得越长，界面可能越久无法操作；网络请求和文件任务仍有各自的超时限制。这些设置也用于工作台预览。修改后，重新打开工具或预览即可生效。</p>
    <p v-if="status" class="module-hint" role="status">{{ status }}</p>
    <div class="web-tool-presentation-settings preference-list">
      <button class="preference-option" type="button" role="switch" :aria-checked="defaultFullscreen" @click="togglePresentation('defaultFullscreen')"><span><strong>网页工具默认全屏显示</strong><small>支持全屏的网页工具，直接打开或通过桌面快捷方式打开时自动全屏。关闭时沿用工具自身设置。</small></span><span class="setting-switch" :class="{ enabled: defaultFullscreen }" aria-hidden="true"></span></button>
      <button class="preference-option" type="button" role="switch" :aria-checked="initialHint" @click="togglePresentation('initialHint')"><span><strong>退出全屏的初次提示</strong><small>进入全屏时显示退出按钮和操作提示。关闭后仍可通过 Esc、系统返回或边缘手势退出，也可手动呼出退出按钮。</small></span><span class="setting-switch" :class="{ enabled: initialHint }" aria-hidden="true"></span></button>
    </div>
  </div>
</template>
