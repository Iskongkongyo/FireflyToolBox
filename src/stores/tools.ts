import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { toolbox, type ToolDescriptor } from '../services/toolbox'

export const useToolsStore = defineStore('tools', () => {
  const allTools = ref<ToolDescriptor[]>([])
  const tools = ref<ToolDescriptor[]>([])
  const matches = ref<ToolDescriptor[]>([])
  const favorites = ref<string[]>([])
  const recent = ref<string[]>([])
  const query = ref('')
  const loadError = ref('')
  const loading = ref(true)
  let searchRequest = 0
  let recentRequest = 0
  let usageQueue = Promise.resolve()

  const favoriteTools = computed(() =>
    tools.value.filter((tool) => favorites.value.includes(tool.id)),
  )
  const recentTools = computed(() =>
    recent.value.flatMap((id) => tools.value.find((tool) => tool.id === id) ?? []),
  )

  async function listToolsAfterNativeSetup(): Promise<ToolDescriptor[]> {
    for (let attempt = 0; ; attempt++) {
      try { return await toolbox.listTools() }
      catch (error) {
        if (attempt >= 49 || !String(error).includes('state not managed')) throw error
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }
  }

  async function initialize() {
    try {
      const available = await listToolsAfterNativeSetup().catch(error => { throw new Error(`工具列表：${String(error)}`) })
      const [saved, used] = await Promise.all([
        toolbox.listFavorites().catch(error => { throw new Error(`收藏：${String(error)}`) }),
        toolbox.listRecentTools().catch(error => { throw new Error(`最近使用：${String(error)}`) }),
      ])
      allTools.value = available
      tools.value = available
      matches.value = tools.value
      favorites.value = saved
      recent.value = used
      loadError.value = ''
    } catch (error) {
      loadError.value = `无法加载本地工具：${String(error).replace(/^Error:\s*/, '')}`
    } finally {
      loading.value = false
    }
  }

  async function refresh() {
    const [available, saved, used] = await Promise.all([toolbox.listTools(), toolbox.listFavorites(), toolbox.listRecentTools()])
    allTools.value = available
    tools.value = available
    favorites.value = saved
    recent.value = used
    if (!query.value) matches.value = tools.value
    else await search(query.value)
    loadError.value = ''
  }

  async function loadRecent() {
    const request = ++recentRequest
    const result = await toolbox.listRecentTools()
    if (request === recentRequest) recent.value = result
  }

  function recordOpen(toolId: string) {
    const operation = usageQueue.catch(() => {}).then(async () => {
      await toolbox.recordToolOpen(toolId)
      await loadRecent()
    })
    usageQueue = operation
    return operation
  }

  function forgetDeletedTools(toolIds: string[]) {
    const deleted = new Set(toolIds)
    allTools.value = allTools.value.filter(tool => !deleted.has(tool.id))
    tools.value = tools.value.filter(tool => !deleted.has(tool.id))
    matches.value = matches.value.filter(tool => !deleted.has(tool.id))
    favorites.value = favorites.value.filter(id => !deleted.has(id))
    recent.value = recent.value.filter(id => !deleted.has(id))
  }

  async function clearRecent() {
    await toolbox.clearRecentTools()
    recent.value = []
  }

  async function search(value: string) {
    query.value = value
    const request = ++searchRequest
    try {
      const result = await toolbox.searchTools(value)
      if (request === searchRequest) matches.value = result
    } catch {
      if (request === searchRequest) loadError.value = '搜索暂不可用。'
    }
  }

  async function toggleFavorite(toolId: string) {
    const favorite = !favorites.value.includes(toolId)
    await toolbox.setFavorite(toolId, favorite)
    favorites.value = favorite
      ? [...favorites.value, toolId]
      : favorites.value.filter((id) => id !== toolId)
  }

  async function replaceFavorites(toolIds: string[]) {
    favorites.value = await toolbox.replaceFavorites(toolIds)
  }

  return {
    allTools,
    tools,
    matches,
    favorites,
    recent,
    favoriteTools,
    recentTools,
    query,
    loadError,
    loading,
    initialize,
    refresh,
    forgetDeletedTools,
    loadRecent,
    recordOpen,
    clearRecent,
    search,
    toggleFavorite,
    replaceFavorites,
  }
})
