<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { vMobileRipples } from './directives/mobileRipples'
import { isMobileLayout } from './services/appLayout'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { getCurrentWebview, type DragDropEvent } from '@tauri-apps/api/webview'
import { openUrl } from '@tauri-apps/plugin-opener'
import { readText as readClipboardText, writeText as writeClipboardText } from '@tauri-apps/plugin-clipboard-manager'
import { open as openFileDialog, save as saveFileDialog } from '@tauri-apps/plugin-dialog'
import { readFile, stat, writeFile } from '@tauri-apps/plugin-fs'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import drawerWallpaper from './assets/drawer_wallpaper.png'
import appIcon from '../src-tauri/icons/icon.png'
import noBookmarkingTools from '../png/no_bookmarking_tools.png'
import noAllTools from '../png/no_all_tools.png'
import noAvailableTools from '../png/no_available_tools.png'
import noTools from '../png/no_tools.png'
import noWebsite from '../png/no_website.png'
import createTool from '../png/create_tool.png'
import selectionTool from '../png/selection_tool.png'
import splashMobile from '../png/splash.jpg'
import fireflyQuotesText from './assets/firefly-quotes.txt?raw'
import toolAuthorSkill from '../skills/firefly-module-author/SKILL.md?raw'
import appManifest from '../package.json'
import { WEB_SOURCE_BYTES, TOOL_WORKSPACE_MAX_CHARS } from './services/moduleLimits'
import { coarseGroupId, coarseHomeToolOrder, homeSourceGroupIds, resolveHomeGroupId } from './services/coarseGroups'
import { useToolsStore } from './stores/tools'
import AppIcon from './components/AppIcon.vue'
import OfficialBoxOffice from './components/OfficialBoxOffice.vue'
import { boxOfficeUrl, DESKTOP_BOX_OFFICE_URL, MOBILE_BOX_OFFICE_URL } from './services/officialBoxOffice'
import InstalledToolSourceEditor from './components/InstalledToolSourceEditor.vue'
import DeviceSync from './components/DeviceSync.vue'
import WebToolBudgetSettings from './components/WebToolBudgetSettings.vue'
import ModuleImportPanel from './components/ModuleImportPanel.vue'
import ToolAuthorSkillPage from './components/ToolAuthorSkillPage.vue'
import SmartDetectionPage from './components/SmartDetectionPage.vue'
import RemoteMessages from './components/RemoteMessages.vue'
import WebToolFullscreenControls from './components/WebToolFullscreenControls.vue'
import ToolDownloadPage from './components/ToolDownloadPage.vue'
import { applyNativeToolFullscreen, createToolFullscreenController } from './services/webToolFullscreen'
import { readWebToolPresentation } from './services/webToolPresentation'
import { createModuleImportQueue } from './services/moduleImportQueue'
import ViewportSelect from './components/ViewportSelect.vue'
import StartupSplash from './components/StartupSplash.vue'
import { readWallpaper, saveWallpaper, readStartupImage, saveStartupImage, removeStartupImage, STARTUP_ENABLED_KEY, startupSplashEnabled,
  readSidebarImage, saveSidebarImage, removeSidebarImage, SIDEBAR_ENABLED_KEY, SIDEBAR_IMAGE_RATIO, SIDEBAR_IMAGE_MAX_WIDTH, sidebarArtworkEnabled } from './services/wallpaper'
import { normalizeModuleIcon, normalizeShortcutIcon } from './services/moduleIcon'
import { cancelWebToolFileOperations, clearPreviewStorage, mountWebTool, setWebToolFullscreen, stopBrowserModule } from './services/browserModule'
import { ensureWebFileActive, stoppedWebFileStatus, WebFileError, type WebFileProgress, type WebFileStatus } from './services/webToolFiles'
import { TOOL_DRAFT_KEY, copyToolContent, emptyModuleDraft, readToolWorkspace, templateContent, textInputTypes, toolKind, toolTemplates,
  type ModuleStudioDraft, type ToolContent, type ToolKind } from './services/toolDraft'
import { FAVORITE_GROUPS_KEY, FAVORITE_UNGROUPED, HOME_GROUPS_KEY, HOME_OTHER_GROUP, WEBSITE_GROUPS_KEY, WEBSITE_UNGROUPED,
  emptyFavoriteGroupSettings, emptyHomeGroupSettings, emptyWebsiteGroupSettings,
  parseFavoriteGroupSettings, parseHomeGroupSettings, parseWebsiteGroupSettings,
  DEFAULT_HOME_CATEGORIES, type FavoriteGroupSettings, type HomeGroupSettings, type WebsiteGroupSettings } from './services/groupSettings'
import { nativeWebFiles } from './services/webToolNativeFiles'
import { toolbox, type CustomTool, type DetectionAction, type DetectionResult, type ModuleDetails, type ModuleManifest, type ModuleSummary, type ToolDescriptor, type ToolError, type Website } from './services/toolbox'
import { parseBackup, restoreBackupPreferences, serializeBackup } from './services/configuration'
import { cacheReportMessage } from './services/runtimeCache'
import { resetMoreSettings } from './services/resetSettings'
import { accentPalette, hexToHsv, hsvToHex, validateAppearanceFile, validateAppearanceDimensions, appearanceImageFormat, type AppearanceImageTarget } from './services/appearance'
import { createShortcutLaunchQueue, requestShortcutCreation, suggestedShortcutName, validateShortcutName } from './services/shortcuts'
import { createClipboardDetection, validateDetectionInput } from './services/detection'

type Page = 'home' | 'allTools' | 'favorites' | 'websites' | 'editor' | 'detection' | 'customTool' | 'moduleStudio' | 'toolAuthorSkill' | 'restoreTools' | 'deviceSync' | 'groupManager' | 'toolDownloads' | 'shortcuts' | 'theme' | 'wallpaperEditor' | 'colorEditor' | 'settings' | 'about'
type ThemePreference = 'system' | 'light' | 'dark'
type StartPage = 'home' | 'favorites' | 'websites'
const THEME_KEY = 'firefly.theme.v1'
const START_PAGE_KEY = 'firefly.start-page.v1'
const ACCENT_KEY = 'firefly.accent.v1'
const WALLPAPER_ENABLED_KEY = 'firefly.wallpaper-enabled.v1'
const AUTO_HIDE_BARS_KEY = 'firefly.auto-hide-bars.v1'
const SMART_CLIPBOARD_KEY = 'firefly.smart-clipboard.v1'
const USAGE_STATS_KEY = 'firefly.usage-stats.v1'
const COMPONENT_TRANSPARENCY_KEY = 'firefly.component-transparency.v1'
const HOME_FONT_SIZE_KEY = 'firefly.home-font-size.v1'
const APP_FONT_SIZE_KEY = 'firefly.app-font-size.v1'
const CARD_GAP_KEY = 'firefly.card-gap.v1'
const LEGACY_HOME_CARD_GAP_KEY = 'firefly.home-card-gap.v1'
function readPreference(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function readNumberPreference(key: string, fallback: number, min: number, max: number): number {
  const stored = readPreference(key)
  const saved = Number(stored)
  return stored !== null && Number.isFinite(saved) ? Math.max(min, Math.min(max, saved)) : fallback
}
const savedTheme = readPreference(THEME_KEY)
const themePreference = ref<ThemePreference>(savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : 'system')
const savedStartPage = readPreference(START_PAGE_KEY)
const startPage = ref<StartPage>(savedStartPage === 'favorites' || savedStartPage === 'websites' ? savedStartPage : 'home')
const startPageOptionsOpen = ref(false)
const displayModeOpen = ref(false)
const savedAccent = readPreference(ACCENT_KEY)
const accentColor = ref(/^#[0-9a-fA-F]{6}$/.test(savedAccent ?? '') ? savedAccent!.toLowerCase() : '')
const colorWheel = ref<HTMLElement | null>(null)
const colorDraftHue = ref(0)
const colorDraftSaturation = ref(0)
const colorDraftValue = ref(1)
let colorWheelDragging = false
const wallpaperEnabled = ref(readPreference(WALLPAPER_ENABLED_KEY) === 'true')
const startupImageEnabled = ref(startupSplashEnabled())
const startupImageUrl = ref('')
const startupImageFileInput = ref<HTMLInputElement | null>(null)
const startupImageLoading = ref(true)
const startupImageResetting = ref(false)
const sidebarImageEnabled = ref(sidebarArtworkEnabled())
const sidebarImageUrl = ref('')
const sidebarImageFileInput = ref<HTMLInputElement | null>(null)
const sidebarImageLoading = ref(true)
const sidebarImageResetting = ref(false)
const sidebarKeepWholeImage = ref(true)
const imageEditingTarget = ref<AppearanceImageTarget>('wallpaper')
const appearanceImageLabel = computed(() => ({ wallpaper: '壁纸', startup: '启动图', sidebar: '侧边栏图' })[imageEditingTarget.value])
const wallpaperUrl = ref('')
const wallpaperFileInput = ref<HTMLInputElement | null>(null)
const wallpaperDraftUrl = ref('')
const wallpaperImageSize = ref({ width: 0, height: 0 })
const wallpaperStage = ref<HTMLElement | null>(null)
const wallpaperStageSize = ref({ width: 0, height: 0 })
const wallpaperCrop = ref({ x: 0, y: 0, width: 0, height: 0 })
const wallpaperSaving = ref(false)
const wallpaperLoading = ref(true)
const appearanceImageLoading = ref(false)
let appearanceSelectionRevision = 0
let cancelPendingAppearanceImage: (() => void) | null = null
let wallpaperOutputFormat: 'image/png' | 'image/jpeg' = 'image/png'
let wallpaperAspectRatio = 1
let wallpaperSourceImage: HTMLImageElement | null = null
type WallpaperDragKind = 'move' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
const wallpaperDrags = new Map<number, { kind: WallpaperDragKind; x: number; y: number }>()
const autoHideBars = ref(readPreference(AUTO_HIDE_BARS_KEY) !== 'false')
const smartClipboardEnabled = ref(readPreference(SMART_CLIPBOARD_KEY) === 'true')
const usageStatsEnabled = ref(readPreference(USAGE_STATS_KEY) === 'true')
const componentTransparency = ref(readNumberPreference(COMPONENT_TRANSPARENCY_KEY, 40, 0, 80))
const appFontSize = ref(readNumberPreference(APP_FONT_SIZE_KEY, readNumberPreference(HOME_FONT_SIZE_KEY, 100, 85, 125), 85, 125))
const cardGap = ref(readNumberPreference(CARD_GAP_KEY, readNumberPreference(LEGACY_HOME_CARD_GAP_KEY, 10, 6, 22), 6, 22))
watch(appFontSize, (value) => document.documentElement.style.setProperty('--app-font-scale', String(value / 100)), { immediate: true })
watch(componentTransparency, (value) => {
  const root = document.documentElement.style
  root.setProperty('--component-surface-opacity', String((100 - value) / 100))
  root.setProperty('--component-label-opacity', String(Math.max(0, 92 - value) / 100))
  root.setProperty('--component-topbar-opacity', String(Math.min(100, 104 - value) / 100))
}, { immediate: true })
watch([componentTransparency, appFontSize, cardGap], () => {
  try {
    localStorage.setItem(COMPONENT_TRANSPARENCY_KEY, String(componentTransparency.value))
    localStorage.setItem(APP_FONT_SIZE_KEY, String(appFontSize.value))
    localStorage.setItem(CARD_GAP_KEY, String(cardGap.value))
  } catch { /* Keep the choices for this session. */ }
})
function resetAppAppearance() {
  componentTransparency.value = 40
  appFontSize.value = 100
  cardGap.value = 10
}
const isWindowsApp = isTauri() && navigator.userAgent.includes('Windows')
const isAndroidApp = isTauri() && navigator.userAgent.includes('Android')
const officialBoxOfficeUrl = boxOfficeUrl(isAndroidApp || /Android|iPhone|iPad/i.test(navigator.userAgent))
const androidShortcutLaunch = isAndroidApp && (() => {
  try {
    return (window as Window & { FireflyShortcutLaunch?: { hasPendingLaunch: () => boolean } })
      .FireflyShortcutLaunch?.hasPendingLaunch() === true
  } catch { return false }
})()
const showMobileSplash = ref(isAndroidApp && !androidShortcutLaunch && startupImageEnabled.value)
const startupReady = ref(false)
const remoteMessages = ref<InstanceType<typeof RemoteMessages> | null>(null)
const remoteMessagesOpen = ref(false)
const checkingUpdates = ref(false)
function onRemoteMessagesOpen(open: boolean) {
  remoteMessagesOpen.value = open
  updateNativeBack()
}
const shortcutOpening = ref(false)
const supportsJsModules = isWindowsApp || isAndroidApp
const shortcutToolId = ref('')
const shortcutName = ref('')
const shortcutIconData = ref('')
const shortcutBusy = ref(false)
const shortcutImageLoading = ref(false)
const shortcutSettingsBusy = ref(false)
const shortcutError = ref('')
const shortcutNotice = ref('')
let shortcutSuggestedName = ''
const desktopCloseBehavior = ref<'tray' | 'exit'>('tray')
const desktopCloseOptionsOpen = ref(false)
const desktopAutostartEnabled = ref(false)
const desktopCloseReady = ref(false)
const desktopAutostartReady = ref(false)
const desktopCloseBusy = ref(false)
const desktopAutostartBusy = ref(false)
const settingsResetPending = ref(false)
const settingsResetBusy = ref(false)
const webToolSettingsRevision = ref(0)
let unlistenDesktopSettings: UnlistenFn | undefined
const systemDarkTheme = window.matchMedia('(prefers-color-scheme: dark)')
function applyTheme() {
  const resolved = themePreference.value === 'system'
    ? (systemDarkTheme.matches ? 'dark' : 'light') : themePreference.value
  document.documentElement.dataset.theme = resolved
  applyAccent(resolved)
  window.FireflyAppearance?.setDark(resolved === 'dark')
}
function applyAccent(mode: 'light' | 'dark') {
  const root = document.documentElement.style
  document.documentElement.dataset.customAccent = accentColor.value ? 'true' : 'false'
  if (!accentColor.value) {
    for (const name of ['--accent', '--accent-soft', '--accent-soft-rgb', '--primary-bg', '--primary-hover', '--primary-text', '--topbar-background', '--topbar-rgb']) root.removeProperty(name)
    return
  }
  const palette = accentPalette(accentColor.value, mode)
  const softRgb = [1, 3, 5].map(index => parseInt(palette.soft.slice(index, index + 2), 16)).join(', ')
  root.setProperty('--accent', palette.accent)
  root.setProperty('--accent-soft', palette.soft)
  root.setProperty('--accent-soft-rgb', softRgb)
  root.setProperty('--topbar-background', palette.soft)
  root.setProperty('--topbar-rgb', softRgb)
  root.setProperty('--primary-bg', palette.primary)
  root.setProperty('--primary-hover', palette.hover)
  root.setProperty('--primary-text', palette.text)
}
function chooseAccent(value: string) {
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) return
  accentColor.value = value.toLowerCase()
  saveAppearancePreference(ACCENT_KEY, accentColor.value)
  applyTheme()
}
function resetAccent() {
  accentColor.value = ''
  saveAppearancePreference(ACCENT_KEY, null)
  applyTheme()
}
const colorDraftHex = computed(() => hsvToHex(colorDraftHue.value, colorDraftSaturation.value, colorDraftValue.value))
const colorWheelMarkerStyle = computed(() => {
  const angle = (colorDraftHue.value - 90) * Math.PI / 180
  const radius = colorDraftSaturation.value * 50
  return { left: `${50 + Math.cos(angle) * radius}%`, top: `${50 + Math.sin(angle) * radius}%` }
})
function openColorEditor() {
  const color = hexToHsv(accentColor.value || '#276653')
  colorDraftHue.value = color.hue
  colorDraftSaturation.value = color.saturation
  colorDraftValue.value = 1
  navigate('colorEditor')
}
function updateColorFromPointer(event: PointerEvent) {
  const bounds = colorWheel.value?.getBoundingClientRect()
  if (!bounds) return
  const x = event.clientX - bounds.left - bounds.width / 2
  const y = event.clientY - bounds.top - bounds.height / 2
  colorDraftHue.value = (Math.atan2(y, x) * 180 / Math.PI + 90 + 360) % 360
  colorDraftSaturation.value = Math.min(1, Math.hypot(x, y) / (colorWheel.value!.clientWidth / 2))
}
function onColorWheelPointerDown(event: PointerEvent) {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  event.preventDefault()
  colorWheel.value?.setPointerCapture(event.pointerId)
  colorWheelDragging = true
  updateColorFromPointer(event)
}
function onColorWheelPointerMove(event: PointerEvent) {
  if (colorWheelDragging) updateColorFromPointer(event)
}
function onColorWheelPointerUp() { colorWheelDragging = false }
function onColorWheelKeydown(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
  event.preventDefault()
  if (event.key === 'ArrowLeft') colorDraftHue.value = (colorDraftHue.value + 355) % 360
  if (event.key === 'ArrowRight') colorDraftHue.value = (colorDraftHue.value + 5) % 360
  if (event.key === 'ArrowUp') colorDraftSaturation.value = Math.min(1, colorDraftSaturation.value + .05)
  if (event.key === 'ArrowDown') colorDraftSaturation.value = Math.max(0, colorDraftSaturation.value - .05)
}
function saveAccent() {
  chooseAccent(colorDraftHex.value)
  goBackStandalone()
}
function chooseTheme(value: ThemePreference) {
  themePreference.value = value
  saveAppearancePreference(THEME_KEY, value)
  applyTheme()
  displayModeOpen.value = false
}
applyTheme()
const themeOptions: { value: ThemePreference; label: string; description: string }[] = [
  { value: 'system', label: '跟随系统', description: '随设备外观自动切换' },
  { value: 'light', label: '浅色', description: '始终使用明亮外观' },
  { value: 'dark', label: '深色', description: '始终使用深色外观' },
]
const store = useToolsStore()
const fireflyQuotes = [...new Set(fireflyQuotesText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))]
const currentQuote = ref(fireflyQuotes[Math.floor(Math.random() * fireflyQuotes.length)] ?? '飞萤扑火，向死而生。')

function changeQuote() {
  const alternatives = fireflyQuotes.filter((quote) => quote !== currentQuote.value)
  if (alternatives.length) currentQuote.value = alternatives[Math.floor(Math.random() * alternatives.length)]
}

const page = ref<Page>(startPage.value)
const previousPage = ref<Exclude<Page, 'editor'>>('home')
const standaloneHistory: Exclude<Page, 'editor'>[] = []
const activeToolId = ref('json.format')
const favoriteEditing = ref(false)
type AllToolsAction = 'delete' | 'edit'
const allToolsAction = ref<AllToolsAction | null>(null)
const allToolsMenuOpen = ref(false)
const allToolsActionBusy = ref(false)
const bulkDeleteBusy = ref(false)
const selectedDeleteTools = ref<string[]>([])
const allToolsMenuRoot = ref<HTMLElement | null>(null)
const editorToolMenuOpen = ref(false)
const editorToolMenuRoot = ref<HTMLElement | null>(null)
const toolDownloadsPage = ref<InstanceType<typeof ToolDownloadPage> | null>(null)
const repositoryBusy = ref(false)
const repositoryInstalling = ref(false)
function onRepositoryBusy(busy: boolean, installing: boolean) { repositoryBusy.value = busy; repositoryInstalling.value = installing }
async function refreshRepositoryTools() { await store.refresh(); modules.value = await toolbox.listModules() }
function openRepositoryTool(id: string) { if (!openTool(id)) notify('暂时无法打开此工具，请刷新列表后重试。') }
const toolFullscreen = ref(false)
const initialFullscreenHint = ref(true)
const fullscreenControls = ref<InstanceType<typeof WebToolFullscreenControls> | null>(null)
let fullscreenScroll: { x: number; y: number; tool: string; revision: number } | null = null
let pendingToolFullscreen: { tool: string; revision: number } | null = null
const fullscreenController = createToolFullscreenController(applyNativeToolFullscreen, enabled => {
  if (enabled) fullscreenScroll = { x: window.scrollX, y: window.scrollY, tool: activeToolId.value, revision: executionRevision }
  toolFullscreen.value = enabled
  if (enabled) document.documentElement.dataset.toolFullscreen = 'true'
  else delete document.documentElement.dataset.toolFullscreen
  setWebToolFullscreen(enabled)
  updateNativeBack()
  if (!enabled && fullscreenScroll) {
    const saved = fullscreenScroll; fullscreenScroll = null
    void nextTick(() => { if (page.value === 'editor' && activeToolId.value === saved.tool && executionRevision === saved.revision) window.scrollTo({ left: saved.x, top: saved.y, behavior: 'instant' }) })
  }
}, notify)
function leaveToolFullscreen() { pendingToolFullscreen = null; webToolPresentationPending.value = false; fullscreenController.set(false) }
function syncNativeToolFullscreen() { fullscreenController.reset() }
async function revealWebTool(tool: string, revision: number) {
  await fullscreenController.settled()
  await nextTick()
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  if (!appUnmounted && page.value === 'editor' && activeToolId.value === tool && executionRevision === revision && !pendingToolFullscreen) webToolPresentationPending.value = false
}
function enterToolFullscreen() {
  if (page.value !== 'editor' || activeTool.value?.ui_kind !== 'web' || webToolStopped.value || webToolLoading.value || officialBoxOfficeOpen.value) return
  editorToolMenuOpen.value = false
  initialFullscreenHint.value = readWebToolPresentation().initialHint
  fullscreenController.set(true)
  void revealWebTool(activeToolId.value, executionRevision)
}
function maybeEnterToolFullscreen() {
  const pending = pendingToolFullscreen
  if (!pending || showMobileSplash.value || shortcutOpening.value || remoteMessagesOpen.value || document.querySelector('dialog[open]')) return
  if (page.value !== 'editor' || activeToolId.value !== pending.tool || executionRevision !== pending.revision || webToolLoading.value || webToolStopped.value) return
  pendingToolFullscreen = null; enterToolFullscreen()
}
const allToolsActionLabels: Record<AllToolsAction, string> = { delete: '删除工具', edit: '编辑工具' }
const allToolsActions: AllToolsAction[] = ['delete', 'edit']
const allToolsActionHint: Record<AllToolsAction, string> = {
  delete: '勾选要删除的工具，再点击右上角对号。应用自带工具可在“恢复工具”中找回。',
  edit: '选择工具以打开对应的编辑位置。',
}
const deletedBuiltinTools = ref<ToolDescriptor[]>([])
const selectedRestoreTools = ref<string[]>([])
const restoreLoading = ref(false)
const restoreSaving = ref(false)
const restoreError = ref('')
const deviceSyncApplying = ref(false)
let restoreRequest = 0
const selectedFavorites = ref<string[]>([])
const savingFavorites = ref(false)
watch(allToolsAction, (action) => { if (action !== 'delete') selectedDeleteTools.value = [] }, { flush: 'sync' })
const toolAction = ref('format')
const sidebarOpen = ref(false)
const searchOpen = ref(false)
const searchQuery = ref('')
type SearchHistoryItem = { kind: 'tool' | 'website'; id: string }
type SearchItem = SearchHistoryItem & { name: string; icon?: string | null; icon_data?: string | null }
const searchHistory = ref<SearchHistoryItem[]>([])
const SEARCH_HISTORY_KEY = 'firefly.search-history.v1'
let searchReturnFocus: HTMLElement | null = null
let searchOpenedFromKeyboard = false
const expanded = ref<string[]>([])
const input = ref('')
const output = ref('')
const status = ref('输入 JSON，或载入示例开始。')
const statusError = ref(false)
const running = ref(false)
let executionRevision = 0
let activeRunToken = 0
let activeModuleRequestId: string | null = null
const editorTab = ref<'input' | 'output'>('input')
const websiteDialog = ref<HTMLDialogElement | null>(null)
const websiteFileDragging = ref(false)
const moduleFileDragging = ref(false)
let unlistenFileDrop: UnlistenFn | undefined
let appUnmounted = false
const websiteActionsDialog = ref<HTMLDialogElement | null>(null)
const websiteActionSite = ref<Website | null>(null)
const toolAuthorSkillHtml = ref('')
const toolAuthorSkillLoading = ref(false)
const toolAuthorSkillError = ref('')
let toolAuthorSkillReturnScroll = 0
const cacheBusy = ref(false)
const cacheProgressVisible = ref(false)
let cacheProgressTimer: ReturnType<typeof setTimeout> | undefined
const backupDialog = ref<HTMLDialogElement | null>(null)
const groupCreateDialog = ref<HTMLDialogElement | null>(null)
const groupCreateInput = ref<HTMLInputElement | null>(null)
const confirmDialog = ref<HTMLDialogElement | null>(null)
const confirmCancelButton = ref<HTMLButtonElement | null>(null)
const confirmation = ref<{ title: string; message: string; action: string; danger: boolean } | null>(null)
let resolveConfirmation: ((confirmed: boolean) => void) | undefined
const modules = ref<ModuleSummary[]>([])
const moduleError = ref('')
const moduleBusy = ref(false)
const moduleLoading = ref(false)
const moduleImports = createModuleImportQueue({
  busy: moduleBusy,
  async inspect(path) {
    if (!isAndroidApp) {
      if (!/\.fftool$/i.test(path)) throw new Error('请选择 .fftool 工具包。')
    }
    return toolbox.inspectModuleFile(path)
  },
  install: path => toolbox.installModuleFile(path),
  async refresh() { modules.value = await toolbox.listModules(); await store.refresh() },
  errorMessage,
})
const { items: moduleImportItems, phase: moduleImportPhase, notice: moduleImportNotice, progress: moduleImportProgress } = moduleImports
type ModuleStudioTab = 'import' | 'installed' | 'create'
type StudioItem = { kind: 'builtin' | 'module'; id: string }
type ModuleMetadataDraft = {
  name: string; version: string; author: string; license: string; customLicense: string
  tools: { name: string; description: string; category: string }[]
}
const moduleStudioTab = ref<ModuleStudioTab>('import')
const moduleStudioIndicatorStyle = ref({ transform: 'translateX(0px)', width: '0px', opacity: '0' })
const moduleTabsScrolling = ref(false)
const moduleTabsSwiping = ref(false)
const moduleSwipeOffset = ref(0)
const moduleSwipeSettling = ref(false)
const moduleSwipeNeighbor = ref<ModuleStudioTab | null>(null)
const moduleSwipeViewport = ref<HTMLElement | null>(null)
const moduleTrackTransform = computed(() => {
  const index = moduleStudioTabs.findIndex((tab) => tab.id === moduleStudioTab.value)
  return `translate3d(calc(${-index * 100}% + ${moduleSwipeOffset.value - index * 18}px), 0, 0)`
})
let moduleSwipeTimer: ReturnType<typeof setTimeout> | undefined
let moduleTabScrollTimer: ReturnType<typeof setTimeout> | undefined
let observedStudioTabs: HTMLElement | null = null
let studioTabsResizeObserver: ResizeObserver | null = null
const studioLibraryGroup = ref<'builtin' | 'module'>('builtin')
const builtinToolFilter = ref('')
const moduleToolFilter = ref('')
const moduleStudioTabs: { id: ModuleStudioTab; label: string; icon: string }[] = [
  { id: 'import', label: '导入工具', icon: 'module-code' },
  { id: 'create', label: '创建工具', icon: 'module-text' },
  { id: 'installed', label: '已安装工具', icon: 'module-shapes' },
]
const selectedStudioItem = ref<StudioItem | null>(null)
const selectedModuleDetails = shallowRef<ModuleDetails | null>(null)
const moduleDetailsLoading = ref(false)
const moduleMetadataEditing = ref(false)
const moduleMetadataDraft = ref<ModuleMetadataDraft | null>(null)
const moduleSourceEditing = ref(false)
const builtInStudioTools = computed(() => store.allTools.filter((tool) => tool.builtin))
const filteredBuiltInStudioTools = computed(() => {
  const query = builtinToolFilter.value.trim().toLocaleLowerCase()
  return query ? builtInStudioTools.value.filter((tool) =>
    [tool.name, tool.description, tool.category, tool.id, tool.module_id ?? '', ...tool.tags].some((value) => value.toLocaleLowerCase().includes(query)))
    : builtInStudioTools.value
})
const filteredStudioModules = computed(() => {
  const query = moduleToolFilter.value.trim().toLocaleLowerCase()
  const imported = modules.value.filter((item) => !item.builtin)
  return query ? imported.filter((item) =>
    [item.name, item.module_id, ...item.tools, ...item.tool_ids, ...item.categories].some((value) => value.toLocaleLowerCase().includes(query)))
    : imported
})
const selectedStudioModule = computed(() => modules.value.find((item) => item.module_id === selectedStudioItem.value?.id))
let moduleDetailsRequest = 0
watch(builtinToolFilter, () => {
  if (studioLibraryGroup.value !== 'builtin') return
  const selectedId = selectedStudioItem.value?.kind === 'builtin' ? selectedStudioItem.value.id : null
  if (!selectedId) return
  if (filteredBuiltInStudioTools.value.some((tool) => tool.module_id === selectedId)) return
  moduleDetailsRequest++
  selectedStudioItem.value = null
  selectedModuleDetails.value = null
})
watch(moduleToolFilter, () => {
  if (studioLibraryGroup.value !== 'module') return
  const selectedId = selectedStudioItem.value?.kind === 'module' ? selectedStudioItem.value.id : null
  if (!selectedId || filteredStudioModules.value.some((item) => item.module_id === selectedId)) return
  moduleDetailsRequest++
  selectedStudioItem.value = null
  selectedModuleDetails.value = null
})
let moduleSwipeStart: { x: number; y: number; time: number; axis?: 'horizontal' | 'vertical' } | null = null
const savedToolWorkspace = readToolWorkspace(readPreference(TOOL_DRAFT_KEY))
const moduleDraft = ref<ModuleStudioDraft>(savedToolWorkspace?.draft ?? emptyModuleDraft())
if (!moduleDraft.value.resourceDraftId) moduleDraft.value.resourceDraftId=crypto.randomUUID()
const loadedModuleManifest = shallowRef<ModuleManifest | null>(savedToolWorkspace?.manifest ?? null)
const creatorModeContents = ref<Partial<Record<ToolKind, ToolContent>>>(savedToolWorkspace?.contents ?? {})
const moduleCreationType = computed(() => toolKind(moduleDraft.value))
const moduleAdvancedOpen = ref(false)
const moduleTemplateId = ref('')
const moduleScriptIndex = ref(0)
const moduleActiveScript = computed(() => moduleDraft.value.scripts[moduleScriptIndex.value] ?? moduleDraft.value.scripts[0])
const moduleCreationTemplates = computed(() => toolTemplates.filter(template => template.kind === moduleCreationType.value))
const moduleDraftSaveNotice = ref(savedToolWorkspace ? '已恢复本机草稿。' : '')
const moduleCreationName = computed({
  get: () => moduleDraft.value.toolName,
  set: (value: string) => {
    if (!loadedModuleManifest.value || moduleDraft.value.name === moduleDraft.value.toolName) moduleDraft.value.name = value
    moduleDraft.value.toolName = value
  },
})
let moduleDraftSaveTimer: ReturnType<typeof setTimeout> | undefined
const moduleStudioBusy = ref(false)
const moduleStudioError = ref('')
const moduleStudioNotice = ref('')
// Synchronous delivery also catches the same failure after a retry clears it.
for (const message of [moduleStudioError, moduleStudioNotice]) {
  watch(message, value => {
    if (value && page.value === 'moduleStudio') notify(value)
  }, { flush: 'sync' })
}
const modulePreviewContainer = ref<HTMLElement | null>(null)
const modulePreviewOpen = ref(false)
const modulePreviewBusy = ref(false)
const modulePreviewError = ref('')
const modulePreviewInput = ref('  流萤百宝箱  \n\n流萤百宝箱\n  你好  ')
const modulePreviewOutput = ref('')
let modulePreviewRequestId: string | null = null
let modulePreviewRevision = 0
const moduleIconMenuOpen = ref(false)
const moduleIconPicker = ref<HTMLElement | null>(null)
const moduleIconTrigger = ref<HTMLButtonElement | null>(null)
const moduleIconOptions = [
  { id: '', label: '无图标' },
  { id: 'code', label: '代码' }, { id: 'text', label: '文字' }, { id: 'spark', label: '灵感' },
  { id: 'shapes', label: '形状' }, { id: 'bolt', label: '效率' }, { id: 'hash', label: '数据' },
  { id: 'image', label: '图片' }, { id: 'file', label: '文件' }, { id: 'folder', label: '文件夹' },
  { id: 'link', label: '链接' }, { id: 'globe', label: '网络' }, { id: 'search', label: '搜索' },
  { id: 'clock', label: '时间' }, { id: 'calendar', label: '日历' }, { id: 'calculator', label: '计算' },
  { id: 'lock', label: '安全' }, { id: 'terminal', label: '终端' }, { id: 'database', label: '数据库' },
  { id: 'chart', label: '图表' }, { id: 'heart', label: '生活' },
] as const
const selectedModuleIconLabel = computed(() => moduleDraft.value.iconData ? '已导入图标'
  : moduleIconOptions.find((choice) => choice.id === moduleDraft.value.icon)?.label ?? '无图标')
const moduleLicenseOptions = [
  { id: 'UNLICENSED', label: '无证书（保留所有权利）' },
  { id: 'MIT', label: 'MIT' },
  { id: 'Apache-2.0', label: 'Apache 2.0' },
  { id: 'GPL-3.0-only', label: 'GPL 3.0' },
  { id: 'GPL-3.0-or-later', label: 'GPL 3.0 或更高版本' },
  { id: 'GPL-2.0-only', label: 'GPL 2.0' },
  { id: 'BSD-3-Clause', label: 'BSD 3-Clause' },
  { id: 'MPL-2.0', label: 'MPL 2.0' },
] as const
const backupError = ref('')
const backupBusy = ref(false)
const outputBox = ref<HTMLTextAreaElement | null>(null)
const webToolContainer = ref<HTMLElement | null>(null)
const webToolLoading = ref(false)
const webToolPresentationPending = ref(false)
const webToolOpening = computed(() => page.value === 'editor' && activeTool.value?.ui_kind === 'web' && (webToolLoading.value || webToolPresentationPending.value))
const webToolLoadingVisible = ref(false)
let webToolLoadingTimer: ReturnType<typeof setTimeout> | undefined
function setWebToolLoading(loading: boolean) {
  clearTimeout(webToolLoadingTimer)
  webToolLoadingTimer = undefined
  webToolLoading.value = loading
  webToolLoadingVisible.value = false
  if (loading) webToolLoadingTimer = setTimeout(() => {
    webToolLoadingTimer = undefined
    if (webToolLoading.value) webToolLoadingVisible.value = true
  }, 250)
}
const webToolError = ref('')
const webToolStopped = ref(false)
const webToolFileStatus = ref<WebFileStatus>({ busy: false, message: '' })
const modulePreviewFileStatus = ref<WebFileStatus>({ busy: false, message: '' })
const searchBox = ref<HTMLInputElement | null>(null)
const detectValue = ref('')
const detectResults = ref<DetectionResult[]>([])
const detectMessage = ref('')
const detecting = ref(false)
const detectionSelecting = ref(false)
const detectionPasting = ref(false)
const detectionError = ref(false)
let detectionReturnScroll = 0
let detectionReturnEditor: { id: string; input: string; output: string; action: string; status: string; statusError: boolean; tab: 'input' | 'output'; previous: Exclude<Page, 'editor'> } | null = null
let detectionRevision = 0
const detectedFromClipboard = ref(false)
let clipboardCheckTimer: ReturnType<typeof setTimeout> | undefined
const websites = ref<Website[]>([])
const customTools = ref<CustomTool[]>([])
const customForm = ref<CustomTool>({ id: '', name: '', description: '', tags: [], steps: [] })
const customFormGroup = ref(HOME_OTHER_GROUP)
const customTagsText = ref('')
const customError = ref('')
const customSaving = ref(false)
const customIconLoading = ref(false)
let customIconRevision = 0
let customToolReturnToEditor = false
let customToolReturnScroll = 0
const customIconValue = computed({ get: () => customForm.value.icon ?? '', set: (value: string) => { customForm.value.icon = value || null; customForm.value.icon_data = null } })
const officialBoxOfficeOpen = ref(false)
watch(webToolStopped, stopped => { if (stopped) officialBoxOfficeOpen.value = false })
watch([page, activeToolId], () => { if (page.value !== 'editor' || activeToolId.value !== 'boxoffice.live') officialBoxOfficeOpen.value = false })
function readHomeGroups(): HomeGroupSettings {
  try { return parseHomeGroupSettings(JSON.parse(readPreference(HOME_GROUPS_KEY) ?? 'null')) }
  catch { return emptyHomeGroupSettings() }
}
function readFavoriteGroups(): FavoriteGroupSettings {
  try { return parseFavoriteGroupSettings(JSON.parse(readPreference(FAVORITE_GROUPS_KEY) ?? 'null')) }
  catch { return emptyFavoriteGroupSettings() }
}
function readWebsiteGroups(): WebsiteGroupSettings {
  try { return parseWebsiteGroupSettings(JSON.parse(readPreference(WEBSITE_GROUPS_KEY) ?? 'null')) }
  catch { return emptyWebsiteGroupSettings() }
}
const homeGroupSettings = ref<HomeGroupSettings>(readHomeGroups())
const favoriteGroupSettings = ref<FavoriteGroupSettings>(readFavoriteGroups())
const websiteGroupSettings = ref<WebsiteGroupSettings>(readWebsiteGroups())
if (favoriteGroupSettings.value.enabled) expanded.value = [FAVORITE_UNGROUPED]
if (websiteGroupSettings.value.enabled) expanded.value = [...expanded.value, WEBSITE_UNGROUPED]
watch(homeGroupSettings, (value) => {
  try { localStorage.setItem(HOME_GROUPS_KEY, JSON.stringify(value)) } catch { /* Keep this session's groups. */ }
})
watch(favoriteGroupSettings, (value) => {
  try { localStorage.setItem(FAVORITE_GROUPS_KEY, JSON.stringify(value)) } catch { /* Keep this session's groups. */ }
})
watch(websiteGroupSettings, (value) => {
  try { localStorage.setItem(WEBSITE_GROUPS_KEY, JSON.stringify(value)) } catch { /* Keep this session's groups. */ }
})
type GroupManagerTab = 'home' | 'favorites' | 'websites'
const groupManagerTabs: { id: GroupManagerTab; label: string; icon: string }[] = [
  { id: 'home', label: '首页工具', icon: 'home' },
  { id: 'favorites', label: '收藏工具', icon: 'favorites' },
  { id: 'websites', label: '网站', icon: 'websites' },
]
const groupManagerTab = ref<GroupManagerTab>('home')
const groupManagerIndicatorStyle = ref({ transform: 'translateX(0px)', width: '0px', opacity: '0' })
const groupTabsScrolling = ref(false)
const groupTabsSwiping = ref(false)
const groupSwipeOffset = ref(0)
const groupSwipeSettling = ref(false)
const groupSwipeNeighbor = ref<GroupManagerTab | null>(null)
const groupSwipeViewport = ref<HTMLElement | null>(null)
const groupTrackTransform = computed(() => {
  const index = groupManagerTabs.findIndex((tab) => tab.id === groupManagerTab.value)
  return `translate3d(calc(${-index * 100}% + ${groupSwipeOffset.value - index * 18}px), 0, 0)`
})
let groupSwipeTimer: ReturnType<typeof setTimeout> | undefined
let groupTabScrollTimer: ReturnType<typeof setTimeout> | undefined
let observedGroupManagerTabs: HTMLElement | null = null
let groupManagerResizeObserver: ResizeObserver | null = null
const newGroupName = ref('')
const editingGroupId = ref('')
const editingGroupName = ref('')
const groupManagerError = ref('')
const groupCreateError = ref('')
const managerExpanded = ref<string[]>([])
type SortScope = 'categories' | 'homeTools' | 'favorites' | 'favoriteGroups' | 'favoriteTools' | 'websiteGroups' | 'websites'
const categoryOrder = ref<string[]>([])
const favoriteGroupOrder = ref<string[]>([])
const homeToolOrders = ref<Record<string, string[]>>({})
const favoriteOrder = ref<string[]>([])
const websiteOrder = ref<string[]>([])
const websiteGroupOrder = ref<string[]>([])
const activeSwap = ref<{ scope: SortScope; id: string; targetId: string; group?: string; targetGroup?: string } | null>(null)
let pendingSwap: { scope: SortScope; id: string; group?: string; x: number; y: number; lastX: number; lastY: number; origin: HTMLElement; source: 'touch' | 'pointer'; pointerId?: number; timer: number } | null = null
let sortAutoScrollFrame = 0
let sortAutoScrollPrevious = 0
let suppressedSwapClick = ''
let suppressClickTimer: ReturnType<typeof setTimeout> | undefined
let suppressPageSwipeUntil = 0
let pageSwipeStart: { x: number; y: number; time: number; page: Page; axis?: 'horizontal' | 'vertical' } | null = null
let pageSwipeTimer: ReturnType<typeof setTimeout> | undefined
const pageSwipeOffset = ref(0)
const pageSwipeSettling = ref(false)
const pageSwipeViewport = ref<HTMLElement | null>(null)
const barsHidden = ref(false)
const lastTabScrollTop = { home: 0, favorites: 0, websites: 0 }
let tabScrollDirection = 0
let tabScrollDistance = 0
let ignoreTabScrollUntil = 0
const websiteError = ref('')
const websiteSaving = ref(false)
const websiteForm = ref<Website>({ id: 0, name: '', url: '', description: '', tags: '', favorite: false })
const websiteFormGroup = ref(WEBSITE_UNGROUPED)
const toast = ref('')
const toastElement = ref<HTMLElement | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | undefined
const pendingDraftFeedback = ref('')
watch(moduleDraftSaveNotice, value => {
  if (value && page.value === 'moduleStudio' && moduleStudioTab.value === 'create') pendingDraftFeedback.value = value
}, { flush: 'sync' })
watch([pendingDraftFeedback, toast, page, moduleStudioTab], ([message, currentToast, currentPage, tab]) => {
  if (!message) return
  if (currentPage !== 'moduleStudio' || tab !== 'create') { pendingDraftFeedback.value = ''; return }
  // Autosave runs shortly after typing; let the current operation's result
  // remain readable before presenting the latest background save status.
  if (!currentToast) { pendingDraftFeedback.value = ''; notify(message) }
}, { flush: 'post' })

const bottomNavigation = [
  { page: 'home' as const, name: '首页', icon: 'home' },
  { page: 'favorites' as const, name: '收藏', icon: 'favorites' },
  { page: 'websites' as const, name: '网站', icon: 'websites' },
]
const sidebarNavigation = [
  { page: 'home' as const, name: '首页', icon: 'home', mobileHidden: true },
  { page: 'favorites' as const, name: '收藏', icon: 'favorites', mobileHidden: true },
  { page: 'websites' as const, name: '网站', icon: 'websites', mobileHidden: true },
  { page: 'detect' as const, name: '智能识别', icon: 'detect', mobileHidden: false },
  { page: 'allTools' as const, name: '工具管理', icon: 'allTools', mobileHidden: false },
  { page: 'groupManager' as const, name: '分组管理', icon: 'groups', mobileHidden: false },
  { page: 'toolDownloads' as const, name: '工具市场', icon: 'download', mobileHidden: false },
  { page: 'shortcuts' as const, name: '快捷方式', icon: 'shortcut', mobileHidden: false },
  { page: 'theme' as const, name: '应用主题', icon: 'theme', mobileHidden: false },
  { page: 'settings' as const, name: '更多设置', icon: 'settings', mobileHidden: false },
  { page: 'about' as const, name: '关于应用', icon: 'about', mobileHidden: false },
]
const availableSteps = computed(() => store.allTools.filter((tool) =>
  (tool.pipeline_compatible ?? (!tool.custom && !tool.module_id)) && tool.actions.length))

function ordered<T>(items: T[], order: string[], key: (item: T) => string, newFirst = false): T[] {
  const positions = new Map(order.map((id, index) => [id, index]))
  return items.map((item, index) => ({ item, index, position: positions.get(key(item)) ?? (newFirst ? -1 : Number.MAX_SAFE_INTEGER) }))
    .sort((a, b) => a.position - b.position || a.index - b.index)
    .map(({ item }) => item)
}

function sourceGroupId(category: string): string { return `source:${category}` }
function homeGroupName(id: string): string {
  if (id === HOME_OTHER_GROUP) return '未分组'
  return homeGroupSettings.value.names[id] ?? (id.startsWith('source:') ? id.slice(7)
    : homeGroupSettings.value.custom.find((group) => group.id === id)?.name ?? '新分组')
}
function homeGroupId(tool: ToolDescriptor): string {
  return resolveHomeGroupId(tool, homeGroupSettings.value)
}
const categories = computed(() => {
  const settings = homeGroupSettings.value
  const sourceIds = homeSourceGroupIds(store.tools, settings)
  const ids = [...sourceIds, ...settings.custom.map((group) => group.id)]
  const grouped = new Map<string, ToolDescriptor[]>(ids.map((id) => [id, []]))
  for (const tool of store.tools) {
    const id = homeGroupId(tool)
    if (!grouped.has(id)) grouped.set(id, [])
    grouped.get(id)!.push(tool)
  }
  return ordered(
    [...grouped.entries()].map(([id, tools]) => ({ id, name: homeGroupName(id), tools: ordered(tools, coarseHomeToolOrder(id, homeToolOrders.value, categoryOrder.value, settings), (tool) => tool.id) })),
    [...new Set([...categoryOrder.value.map(id => coarseGroupId(id, settings)), ...DEFAULT_HOME_CATEGORIES.map(sourceGroupId)])],
    (group) => group.id,
  )
})
const moduleCategoryOptions = computed(() => [...new Set([
  ...store.allTools.map((tool) => tool.category), moduleDraft.value.category,
].filter(Boolean))])
const orderedFavoriteTools = computed(() => ordered(store.favoriteTools, favoriteOrder.value, (tool) => tool.id))
function favoriteGroupId(toolId: string): string {
  const assigned = favoriteGroupSettings.value.assignments[toolId]
  return favoriteGroupSettings.value.groups.some((group) => group.id === assigned) ? assigned : FAVORITE_UNGROUPED
}
const favoriteCategories = computed(() => {
  const groups = [{ id: FAVORITE_UNGROUPED, name: '未分组' }, ...favoriteGroupSettings.value.groups]
  return ordered(groups.map((group) => ({ ...group, tools: orderedFavoriteTools.value.filter((tool) => favoriteGroupId(tool.id) === group.id) })),
    favoriteGroupOrder.value, (group) => group.id)
})
const visibleFavoriteCategories = computed(() => favoriteCategories.value.filter(group => group.id !== FAVORITE_UNGROUPED || group.tools.length > 0))
watch([() => store.loading, () => store.favorites], () => {
  if (store.loading || store.loadError) return
  const valid = new Set(store.favorites)
  const assignments = Object.fromEntries(Object.entries(favoriteGroupSettings.value.assignments)
    .filter(([toolId]) => valid.has(toolId)))
  if (Object.keys(assignments).length !== Object.keys(favoriteGroupSettings.value.assignments).length) {
    favoriteGroupSettings.value = { ...favoriteGroupSettings.value, assignments }
  }
})
function managedGroupsFor(tab: GroupManagerTab) {
  if (tab !== 'home') return favoriteCategories.value
  if (categories.value.some((group) => group.id === HOME_OTHER_GROUP)) return categories.value
  return ordered(
    [{ id: HOME_OTHER_GROUP, name: '未分组', tools: [] as ToolDescriptor[] }, ...categories.value],
    categoryOrder.value, (group) => group.id,
  )
}
function managedToolCountFor(tab: GroupManagerTab): number {
  return managedGroupsFor(tab).reduce((count, group) => count + group.tools.length, 0)
}
function managedToolSortScopeFor(tab: GroupManagerTab): 'homeTools' | 'favoriteTools' { return tab === 'home' ? 'homeTools' : 'favoriteTools' }
function availableGroupTools(groupId: string, tab: GroupManagerTab = groupManagerTab.value): ToolDescriptor[] {
  return tab === 'home'
    ? store.tools.filter((tool) => homeGroupId(tool) !== groupId)
    : orderedFavoriteTools.value.filter((tool) => favoriteGroupId(tool.id) !== groupId)
}
const orderedWebsites = computed(() => ordered(websites.value, websiteOrder.value, (site) => String(site.id), true))
function websiteGroupId(siteId: number): string {
  const assigned = websiteGroupSettings.value.assignments[String(siteId)]
  return websiteGroupSettings.value.groups.some((group) => group.id === assigned) ? assigned : WEBSITE_UNGROUPED
}
const websiteCategories = computed(() => ordered(
  [{ id: WEBSITE_UNGROUPED, name: '未分组' }, ...websiteGroupSettings.value.groups]
    .map((group) => ({ ...group, sites: orderedWebsites.value.filter((site) => websiteGroupId(site.id) === group.id) })),
  websiteGroupOrder.value, (group) => group.id,
))
const visibleWebsiteCategories = computed(() => websiteCategories.value.filter(group => group.id !== WEBSITE_UNGROUPED || group.sites.length > 0))
function websiteDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') }
  catch { return url }
}
function availableWebsiteSites(groupId: string): Website[] {
  return orderedWebsites.value.filter((site) => websiteGroupId(site.id) !== groupId)
}
const searchGroups = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase()
  if (!query) return []
  const matchingTools = store.tools.filter((tool) =>
    [tool.name, tool.description, tool.category, ...tool.tags, ...tool.aliases]
      .some((value) => value.toLocaleLowerCase().includes(query)),
  )
  const matchingSites = websites.value.filter((site) =>
    [site.name, site.url, site.description, site.tags]
      .some((value) => value.toLocaleLowerCase().includes(query)),
  )
  const asToolItem = (tool: ToolDescriptor): SearchItem => ({ kind: 'tool', id: tool.id, name: tool.name, icon: tool.icon, icon_data: tool.icon_data })
  const groups = [
    { source: '首页', items: matchingTools.filter((tool) => !store.favorites.includes(tool.id)).map(asToolItem) },
    { source: '收藏', items: matchingTools.filter((tool) => store.favorites.includes(tool.id)).map(asToolItem) },
    { source: '网站', items: matchingSites.map((site): SearchItem => ({ kind: 'website', id: String(site.id), name: site.name })) },
  ]
  return groups.filter((group) => group.items.length)
})
const recentSearchItems = computed<SearchItem[]>(() => searchHistory.value.flatMap((entry) => {
  if (entry.kind === 'tool') {
    const tool = store.tools.find((item) => item.id === entry.id)
    return tool ? [{ ...entry, name: tool.name, icon: tool.icon, icon_data: tool.icon_data }] : []
  }
  const site = websites.value.find((item) => String(item.id) === entry.id)
  return site ? [{ ...entry, name: site.name }] : []
}))
const activeTool = computed(() => store.tools.find((tool) => tool.id === activeToolId.value))
const isFavorite = computed(() => store.favorites.includes(activeToolId.value))
const canCopy = computed(() => output.value.length > 0 && !running.value)
const activeActions = computed(() => activeTool.value?.actions ?? [])
const canRunEmpty = computed(() =>
  activeActions.value.find(action => action.id === toolAction.value)?.accepts_empty_input
  ?? ((activeToolId.value === 'uuid.generate' && toolAction.value === 'generate')
  || (activeTool.value?.custom && customTools.value.find((tool) => tool.id === activeToolId.value)?.steps[0]?.tool_id === 'uuid.generate'
    && customTools.value.find((tool) => tool.id === activeToolId.value)?.steps[0]?.action === 'generate')),
)

function updateNativeBack() {
  window.FireflyNavigation?.setBackEnabled(
    remoteMessagesOpen.value || searchOpen.value || sidebarOpen.value || page.value === 'editor' || page.value === 'allTools' || isSecondaryPage.value
      || !!websiteDialog.value?.open || !!websiteActionsDialog.value?.open
      || !!backupDialog.value?.open || !!groupCreateDialog.value?.open || !!confirmDialog.value?.open,
  )
}

function onNativeBack() {
  if (remoteMessagesOpen.value) remoteMessages.value?.handleBack()
  else if (confirmDialog.value?.open) finishConfirmation(false)
  else if (toolFullscreen.value) leaveToolFullscreen()
  else if (searchOpen.value) closeSearch()
  else if (websiteActionsDialog.value?.open) closeWebsiteActions()
  else if (websiteDialog.value?.open) closeWebsiteDialog()
  else if (backupDialog.value?.open) closeBackupDialog()
  else if (groupCreateDialog.value?.open) closeGroupCreateDialog()
  else if (sidebarOpen.value) sidebarOpen.value = false
  else if (page.value === 'toolDownloads' && toolDownloadsPage.value?.handleBack()) return
  else if (page.value === 'editor') onEditorBack()
  else if (page.value === 'allTools') {
    onAllToolsBack()
  }
  else if (isSecondaryPage.value) goBackStandalone()
}

watch([searchOpen, sidebarOpen, page, favoriteEditing], updateNativeBack)

function confirmAction(message: string, title: string, action: string, danger = false): Promise<boolean> {
  if (resolveConfirmation) return Promise.resolve(false)
  return new Promise((resolve) => {
    resolveConfirmation = resolve
    confirmation.value = { title, message, action, danger }
    void nextTick().then(() => {
      if (!resolveConfirmation || !confirmDialog.value) {
        finishConfirmation(false)
        return
      }
      confirmDialog.value.showModal()
      updateNativeBack()
      confirmCancelButton.value?.focus({ preventScroll: true })
    })
  })
}

function finishConfirmation(confirmed: boolean) {
  const resolve = resolveConfirmation
  resolveConfirmation = undefined
  if (confirmDialog.value?.open) confirmDialog.value.close()
  confirmation.value = null
  updateNativeBack()
  resolve?.(confirmed)
}

function onConfirmationCancel(event: Event) {
  event.preventDefault()
  finishConfirmation(false)
}

function onConfirmationClosed() {
  if (!confirmDialog.value?.open) finishConfirmation(false)
}

function notify(message: string) {
  toast.value = message
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 3000)
  // Show after dialog updates so feedback stays above a modal's top layer.
  void nextTick(() => requestAnimationFrame(() => {
    const element = toastElement.value
    if (toast.value !== message || !element?.isConnected || typeof element.showPopover !== 'function') return
    if (element.matches(':popover-open')) element.hidePopover()
    element.showPopover()
  }))
}

const wallpaperActive = computed(() => wallpaperEnabled.value && !!wallpaperUrl.value
  && (page.value === 'home' || page.value === 'favorites' || page.value === 'websites'))
const wallpaperStyle = computed(() => ({
  ...(wallpaperActive.value ? { '--wallpaper-image': `url("${wallpaperUrl.value}")` } : {}),
  '--card-gap': `${cardGap.value}px`,
}))
const wallpaperCropStyle = computed(() => {
  const { width, height } = wallpaperImageSize.value
  const crop = wallpaperCrop.value
  if (!width || !height) return {}
  return {
    left: `${crop.x / width * 100}%`, top: `${crop.y / height * 100}%`,
    width: `${crop.width / width * 100}%`, height: `${crop.height / height * 100}%`,
  }
})

async function loadWallpaper() {
  try {
    const saved = await readWallpaper()
    if (saved) wallpaperUrl.value = URL.createObjectURL(saved)
    else wallpaperEnabled.value = false
  } catch {
    wallpaperEnabled.value = false
    notify('无法读取已保存的壁纸')
  } finally { wallpaperLoading.value = false }
}

function cancelAppearanceSelection() {
  appearanceSelectionRevision++
  cancelPendingAppearanceImage?.()
  cancelPendingAppearanceImage = null
  appearanceImageLoading.value = false
}

function saveAppearancePreference(key: string, value: string | null): boolean {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
    return true
  } catch {
    notify('外观已应用，但设置未能保存到本机，重新打开后可能恢复原设置')
    return false
  }
}

function chooseWallpaperFile() {
  wallpaperFileInput.value?.click()
}

function chooseStartupImageFile() {
  startupImageFileInput.value?.click()
}

function chooseSidebarImageFile() {
  sidebarImageFileInput.value?.click()
}

async function loadSidebarImage() {
  try {
    const saved = await readSidebarImage()
    if (saved) sidebarImageUrl.value = URL.createObjectURL(saved)
  } catch { /* Keep the bundled sidebar artwork. */ }
  finally { sidebarImageLoading.value = false }
}

function toggleSidebarImage() {
  if (sidebarImageLoading.value || sidebarImageResetting.value || appearanceImageLoading.value) return
  sidebarImageEnabled.value = !sidebarImageEnabled.value
  saveAppearancePreference(SIDEBAR_ENABLED_KEY, String(sidebarImageEnabled.value))
}

async function resetSidebarImage() {
  if (sidebarImageLoading.value || sidebarImageResetting.value || appearanceImageLoading.value) return
  sidebarImageResetting.value = true
  try {
    await removeSidebarImage()
    if (sidebarImageUrl.value) URL.revokeObjectURL(sidebarImageUrl.value)
    sidebarImageUrl.value = ''
    sidebarImageEnabled.value = true
    if (saveAppearancePreference(SIDEBAR_ENABLED_KEY, 'true')) notify('已恢复默认侧边栏图')
  } catch { notify('恢复侧边栏图失败，请重试') }
  finally { sidebarImageResetting.value = false }
}

async function loadStartupImage() {
  try {
    const saved = await readStartupImage()
    if (saved) startupImageUrl.value = URL.createObjectURL(saved)
  } catch { /* Use the default startup image when storage is unavailable. */ }
  finally { startupImageLoading.value = false }
}

function toggleStartupImage() {
  if (startupImageLoading.value || startupImageResetting.value || appearanceImageLoading.value) return
  startupImageEnabled.value = !startupImageEnabled.value
  saveAppearancePreference(STARTUP_ENABLED_KEY, String(startupImageEnabled.value))
}

async function resetStartupImage() {
  if (startupImageLoading.value || startupImageResetting.value || appearanceImageLoading.value) return
  startupImageResetting.value = true
  try {
    await removeStartupImage()
    if (startupImageUrl.value) URL.revokeObjectURL(startupImageUrl.value)
    startupImageUrl.value = ''
    startupImageEnabled.value = true
    if (saveAppearancePreference(STARTUP_ENABLED_KEY, 'true')) notify('已恢复默认启动图')
  } catch { notify('恢复启动图失败，请重试') }
  finally { startupImageResetting.value = false }
}

function toggleWallpaper() {
  if (wallpaperLoading.value || appearanceImageLoading.value) return
  if (!wallpaperUrl.value) return chooseWallpaperFile()
  wallpaperEnabled.value = !wallpaperEnabled.value
  saveAppearancePreference(WALLPAPER_ENABLED_KEY, String(wallpaperEnabled.value))
}

function wallpaperTargetRatio(): number {
  if (imageEditingTarget.value === 'sidebar') return SIDEBAR_IMAGE_RATIO
  return window.innerWidth / window.innerHeight
}

function resetWallpaperCrop() {
  const { width, height } = wallpaperImageSize.value
  if (!width || !height) return
  const ratio = wallpaperTargetRatio()
  wallpaperAspectRatio = ratio
  const coverage = imageEditingTarget.value === 'sidebar' ? 1 : .9
  let cropWidth = width * coverage
  let cropHeight = cropWidth / ratio
  if (cropHeight > height * coverage) {
    cropHeight = height * coverage
    cropWidth = cropHeight * ratio
  }
  wallpaperCrop.value = { x: (width - cropWidth) / 2, y: (height - cropHeight) / 2, width: cropWidth, height: cropHeight }
}

function setSidebarImageMode(whole: boolean) {
  wallpaperDrags.clear()
  sidebarKeepWholeImage.value = whole
  if (!whole) resetWallpaperCrop()
}

function updateWallpaperStage() {
  if (!wallpaperStage.value) return
  const { width, height } = wallpaperImageSize.value
  const stageStyle = getComputedStyle(wallpaperStage.value)
  const availableWidth = wallpaperStage.value.clientWidth - parseFloat(stageStyle.paddingLeft) - parseFloat(stageStyle.paddingRight)
  if (!width || !height || !availableWidth) return
  const displayWidth = Math.min(availableWidth, 580, window.innerHeight * .56 * width / height)
  wallpaperStageSize.value = { width: displayWidth, height: displayWidth * height / width }
}

async function onWallpaperFileSelected(event: Event) {
  await onAppearanceImageSelected(event, 'wallpaper')
}

async function onStartupImageSelected(event: Event) {
  await onAppearanceImageSelected(event, 'startup')
}

async function onSidebarImageSelected(event: Event) {
  await onAppearanceImageSelected(event, 'sidebar')
}

async function onAppearanceImageSelected(event: Event, target: AppearanceImageTarget) {
  const fileInput = event.target as HTMLInputElement
  const file = fileInput.files?.[0]
  fileInput.value = ''
  if (!file || page.value !== 'theme' || wallpaperSaving.value || startupImageResetting.value || sidebarImageResetting.value) return
  cancelAppearanceSelection()
  try { validateAppearanceFile(file) }
  catch (error) { notify(errorMessage(error)); return }
  const revision = ++appearanceSelectionRevision
  appearanceImageLoading.value = true
  const candidateUrl = URL.createObjectURL(file)
  const image = new Image()
  let adopted = false
  try {
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer)
        image.onload = image.onerror = null
        if (error) reject(error)
        else resolve()
      }
      const timer = setTimeout(() => finish(new Error('图片读取超时，请换一张图片重试')), 10_000)
      cancelPendingAppearanceImage = () => { finish(new Error('图片读取已取消')); image.src = '' }
      image.onload = () => finish()
      image.onerror = () => finish(new Error('图片读取失败'))
      image.src = candidateUrl
    })
    if (appUnmounted || revision !== appearanceSelectionRevision || page.value !== 'theme') return
    validateAppearanceDimensions(image.naturalWidth, image.naturalHeight)
    imageEditingTarget.value = target
    sidebarKeepWholeImage.value = true
    if (wallpaperDraftUrl.value) URL.revokeObjectURL(wallpaperDraftUrl.value)
    wallpaperDraftUrl.value = candidateUrl
    wallpaperSourceImage = image
    wallpaperOutputFormat = appearanceImageFormat(file, target)
    wallpaperImageSize.value = { width: image.naturalWidth, height: image.naturalHeight }
    resetWallpaperCrop()
    navigate('wallpaperEditor')
    adopted = true
    await nextTick()
    updateWallpaperStage()
  } catch (error) {
    if (!appUnmounted && revision === appearanceSelectionRevision) notify(error instanceof Error ? error.message : '无法打开这张图片，请换一张试试')
  } finally {
    image.onload = image.onerror = null
    if (!adopted) URL.revokeObjectURL(candidateUrl)
    if (revision === appearanceSelectionRevision) { appearanceImageLoading.value = false; cancelPendingAppearanceImage = null }
  }
}

function cancelWallpaperEditing() {
  wallpaperDrags.clear()
  wallpaperSourceImage = null
  if (wallpaperDraftUrl.value) URL.revokeObjectURL(wallpaperDraftUrl.value)
  wallpaperDraftUrl.value = ''
  wallpaperImageSize.value = { width: 0, height: 0 }
}

function onWallpaperPointerDown(event: PointerEvent, kind: WallpaperDragKind) {
  if (wallpaperSaving.value) return
  if (event.button !== 0 && event.pointerType === 'mouse') return
  event.preventDefault()
  event.stopPropagation()
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)
  wallpaperDrags.set(event.pointerId, { kind, x: event.clientX, y: event.clientY })
}

function onWallpaperPointerMove(event: PointerEvent) {
  const drag = wallpaperDrags.get(event.pointerId)
  const display = wallpaperStageSize.value
  const image = wallpaperImageSize.value
  if (!drag || !display.width || !display.height) return
  const dx = (event.clientX - drag.x) * image.width / display.width
  const dy = (event.clientY - drag.y) * image.height / display.height
  drag.x = event.clientX
  drag.y = event.clientY
  const crop = wallpaperCrop.value
  if (drag.kind === 'move') {
    wallpaperCrop.value = {
      ...crop,
      x: Math.max(0, Math.min(image.width - crop.width, crop.x + dx)),
      y: Math.max(0, Math.min(image.height - crop.height, crop.y + dy)),
    }
  } else {
    const ratio = wallpaperAspectRatio
    const right = drag.kind.endsWith('right')
    const bottom = drag.kind.startsWith('bottom')
    const widthFromX = dx * (right ? 1 : -1)
    const widthFromY = dy * (bottom ? 1 : -1) * ratio
    const widthChange = Math.abs(widthFromX) >= Math.abs(widthFromY) ? widthFromX : widthFromY
    const anchorX = right ? crop.x : crop.x + crop.width
    const anchorY = bottom ? crop.y : crop.y + crop.height
    const maxWidth = Math.min(right ? image.width - anchorX : anchorX, (bottom ? image.height - anchorY : anchorY) * ratio)
    const width = Math.max(Math.min(maxWidth, crop.width + widthChange), Math.min(maxWidth, image.width * .05))
    wallpaperCrop.value = {
      x: right ? anchorX : anchorX - width,
      y: bottom ? anchorY : anchorY - width / ratio,
      width, height: width / ratio,
    }
  }
}

function onWallpaperPointerUp(event: PointerEvent) { wallpaperDrags.delete(event.pointerId) }

async function saveWallpaperCrop() {
  const image = wallpaperSourceImage
  if (!image || wallpaperSaving.value) return
  const target = imageEditingTarget.value
  const label = appearanceImageLabel.value
  const outputFormat = wallpaperOutputFormat
  const sidebar = target === 'sidebar'
  const whole = sidebar && sidebarKeepWholeImage.value
  const crop = whole ? { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight } : { ...wallpaperCrop.value }
  wallpaperDrags.clear()
  wallpaperSaving.value = true
  try {
    await nextTick()
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const baseWidth = whole ? Math.max(crop.width, crop.height * SIDEBAR_IMAGE_RATIO) : crop.width
    const baseHeight = whole ? baseWidth / SIDEBAR_IMAGE_RATIO : crop.height
    const scale = sidebar ? Math.min(1, SIDEBAR_IMAGE_MAX_WIDTH / baseWidth) : Math.min(1, 1800 / Math.max(baseWidth, baseHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(baseWidth * scale))
    canvas.height = Math.max(1, Math.round(baseHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建画布')
    context.imageSmoothingQuality = 'medium'
    const drawWidth = whole ? crop.width * scale : canvas.width
    const drawHeight = whole ? crop.height * scale : canvas.height
    context.drawImage(image, crop.x, crop.y, crop.width, crop.height, (canvas.width - drawWidth) / 2, (canvas.height - drawHeight) / 2, drawWidth, drawHeight)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('无法生成图片')), outputFormat, .9))
    if (appUnmounted) return
    let preferenceSaved = true
    if (sidebar) {
      await saveSidebarImage(blob)
      if (sidebarImageUrl.value) URL.revokeObjectURL(sidebarImageUrl.value)
      sidebarImageUrl.value = URL.createObjectURL(blob)
      sidebarImageEnabled.value = true
      preferenceSaved = saveAppearancePreference(SIDEBAR_ENABLED_KEY, 'true')
    } else if (target === 'startup') {
      await saveStartupImage(blob)
      if (startupImageUrl.value) URL.revokeObjectURL(startupImageUrl.value)
      startupImageUrl.value = URL.createObjectURL(blob)
      startupImageEnabled.value = true
      preferenceSaved = saveAppearancePreference(STARTUP_ENABLED_KEY, 'true')
    } else {
      await saveWallpaper(blob)
      if (wallpaperUrl.value) URL.revokeObjectURL(wallpaperUrl.value)
      wallpaperUrl.value = URL.createObjectURL(blob)
      wallpaperEnabled.value = true
      preferenceSaved = saveAppearancePreference(WALLPAPER_ENABLED_KEY, 'true')
    }
    wallpaperSaving.value = false
    if (!appUnmounted) goBackStandalone()
    notify(preferenceSaved ? (target === 'startup' ? '启动图已保存，下次启动生效' : `${label}已保存`) : `${label}已保存，但启用状态未能保存到本机`)
  } catch {
    notify(`保存${label}失败，请重试`)
  } finally {
    wallpaperSaving.value = false
  }
}

function loadSavedOrders() {
  for (const [scope, target] of [
    ['categories', categoryOrder], ['favorites', favoriteOrder], ['favoriteGroups', favoriteGroupOrder],
    ['websiteGroups', websiteGroupOrder], ['websites', websiteOrder],
  ] as const) {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(`firefly.order.${scope}.v1`) ?? '[]')
      if (Array.isArray(saved)) {
        const ids = saved.filter((id): id is string => typeof id === 'string').slice(0, 1000)
        target.value = scope === 'categories' ? ids.map((id) => id.startsWith('source:') || id.startsWith('home:') || id.startsWith('user:') ? id : sourceGroupId(id)) : ids
      }
    } catch {
      target.value = []
    }
  }
  try {
    const saved: unknown = JSON.parse(localStorage.getItem('firefly.order.homeTools.v1') ?? '{}')
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      homeToolOrders.value = Object.fromEntries(
        Object.entries(saved)
          .filter(([group, ids]) => group.length <= 120 && Array.isArray(ids))
          .map(([group, ids]) => [group.startsWith('source:') || group.startsWith('home:') || group.startsWith('user:') ? group : sourceGroupId(group), (ids as unknown[]).filter((id): id is string => typeof id === 'string').slice(0, 1000)]),
      )
    }
  } catch {
    homeToolOrders.value = {}
  }
}

function moveDisplayedItem(scope: SortScope, from: string, to: string, group?: string) {
  if (scope === 'favoriteTools') return
  if (scope === 'homeTools' && !group) return
  const ids = scope === 'categories' ? (page.value === 'groupManager' ? managedGroupsFor('home') : categories.value).map((group) => group.id)
    : scope === 'favoriteGroups' ? favoriteCategories.value.map((group) => group.id)
    : scope === 'websiteGroups' ? websiteCategories.value.map((group) => group.id)
    : scope === 'homeTools' ? categories.value.find((category) => category.id === group)?.tools.map((tool) => tool.id) ?? []
      : scope === 'favorites' ? orderedFavoriteTools.value.map((tool) => tool.id)
        : orderedWebsites.value.map((site) => String(site.id))
  const fromIndex = ids.indexOf(from)
  const toIndex = ids.indexOf(to)
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return
  const [moved] = ids.splice(fromIndex, 1)
  ids.splice(toIndex, 0, moved)
  if (scope === 'homeTools' && group) {
    homeToolOrders.value = { ...homeToolOrders.value, [group]: ids }
  } else {
    const target = scope === 'categories' ? categoryOrder : scope === 'favoriteGroups' ? favoriteGroupOrder
      : scope === 'websiteGroups' ? websiteGroupOrder
      : scope === 'favorites' ? favoriteOrder : websiteOrder
    target.value = ids
  }
  try {
    localStorage.setItem(`firefly.order.${scope}.v1`, JSON.stringify(scope === 'homeTools' ? homeToolOrders.value : ids))
  } catch {
    // The order remains available for this session if local storage is unavailable.
  }
}

function moveHomeToolByDrop(toolId: string, targetId: string, sourceGroup?: string, targetGroup?: string) {
  if (!sourceGroup || !targetGroup) return
  if (sourceGroup !== targetGroup) {
    assignHomeTool(toolId, targetGroup)
    if (!expanded.value.includes(targetGroup)) expanded.value = [...expanded.value, targetGroup]
    if (page.value === 'groupManager' && !managerExpanded.value.includes(targetGroup)) managerExpanded.value = [...managerExpanded.value, targetGroup]
  }
  if (!targetId.startsWith('group:')) moveDisplayedItem('homeTools', toolId, targetId, targetGroup)
}

function assignFavoriteTool(toolId: string, groupId: string) {
  if (!store.favorites.includes(toolId)) return
  if (groupId !== FAVORITE_UNGROUPED && !favoriteGroupSettings.value.groups.some((group) => group.id === groupId)) return
  const assignments = { ...favoriteGroupSettings.value.assignments }
  if (groupId === FAVORITE_UNGROUPED) delete assignments[toolId]
  else assignments[toolId] = groupId
  favoriteGroupSettings.value = { ...favoriteGroupSettings.value, assignments }
}

function moveFavoriteToolByDrop(toolId: string, targetId: string, targetGroup?: string) {
  if (!targetGroup) return
  if (favoriteGroupId(toolId) !== targetGroup) {
    assignFavoriteTool(toolId, targetGroup)
    if (!expanded.value.includes(targetGroup)) expanded.value = [...expanded.value, targetGroup]
    if (page.value === 'groupManager' && !managerExpanded.value.includes(targetGroup)) managerExpanded.value = [...managerExpanded.value, targetGroup]
  }
  if (targetId.startsWith('group:')) return
  const ids = orderedFavoriteTools.value.map((tool) => tool.id)
  const fromIndex = ids.indexOf(toolId)
  const toIndex = ids.indexOf(targetId)
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return
  const [moved] = ids.splice(fromIndex, 1)
  ids.splice(toIndex, 0, moved)
  favoriteOrder.value = ids
  try { localStorage.setItem('firefly.order.favorites.v1', JSON.stringify(ids)) } catch { /* Keep the session order. */ }
}

function assignWebsite(siteId: number, groupId: string) {
  if (!websites.value.some((site) => site.id === siteId)
    || (groupId !== WEBSITE_UNGROUPED && !websiteGroupSettings.value.groups.some((group) => group.id === groupId))) return
  const assignments = { ...websiteGroupSettings.value.assignments }
  if (groupId === WEBSITE_UNGROUPED) delete assignments[String(siteId)]
  else assignments[String(siteId)] = groupId
  websiteGroupSettings.value = { ...websiteGroupSettings.value, assignments }
}

function moveWebsiteByDrop(siteId: string, targetId: string, targetGroup?: string) {
  if (targetGroup && websiteGroupSettings.value.enabled && websiteGroupId(Number(siteId)) !== targetGroup) {
    assignWebsite(Number(siteId), targetGroup)
    if (!expanded.value.includes(targetGroup)) expanded.value = [...expanded.value, targetGroup]
  }
  if (!targetId.startsWith('group:')) moveDisplayedItem('websites', siteId, targetId)
}

function cancelLongSwap() {
  if (pendingSwap) clearTimeout(pendingSwap.timer)
  if (sortAutoScrollFrame) cancelAnimationFrame(sortAutoScrollFrame)
  sortAutoScrollFrame = 0
  sortAutoScrollPrevious = 0
  pendingSwap = null
  activeSwap.value = null
}

function beginLongSwap(scope: SortScope, id: string, x: number, y: number, origin: HTMLElement, source: 'touch' | 'pointer', pointerId?: number, group?: string) {
  cancelLongSwap()
  const pending = { scope, id, group, x, y, lastX: x, lastY: y, origin, source, pointerId, timer: 0 }
  pending.timer = window.setTimeout(() => {
    if (pendingSwap !== pending) return
    activeSwap.value = { scope, id, targetId: id, group, targetGroup: group }
    startSortAutoScroll()
    navigator.vibrate?.(12)
  }, 430)
  pendingSwap = pending
}

function updateSortTarget(pending: NonNullable<typeof pendingSwap>, x: number, y: number) {
  const hit = document.elementFromPoint(x, y)
  const item = hit?.closest<HTMLElement>(`[data-swap-scope="${pending.scope}"]`)
  const groupTarget = pending.scope === 'homeTools' || pending.scope === 'favoriteTools' || pending.scope === 'websites'
    ? hit?.closest<HTMLElement>(`[data-swap-group-target="${pending.scope}"]`) : null
  const targetGroup = item?.dataset.swapGroup ?? groupTarget?.dataset.groupId
  const targetId = item?.dataset.swapId ?? (groupTarget && targetGroup ? `group:${targetGroup}` : undefined)
  activeSwap.value = { scope: pending.scope, id: pending.id, targetId: targetId ?? pending.id, group: pending.group, targetGroup }
}

function sortEdgeSpeed(y: number, top: number, bottom: number): number {
  if (y < top - 16 || y > bottom + 16) return 0
  const edge = Math.min(88, (bottom - top) / 4)
  if (edge <= 0) return 0
  const proximity = y < top + edge ? -(top + edge - y) / edge
    : y > bottom - edge ? (y - bottom + edge) / edge : 0
  return proximity ? Math.sign(proximity) * (3 + 25 * Math.min(Math.abs(proximity), 1) ** 2) : 0
}

function sortScrollTarget(origin: HTMLElement, y: number): { element: HTMLElement; speed: number; top: number; bottom: number } | null {
  for (let element = origin.parentElement; element && element !== document.body; element = element.parentElement) {
    const overflow = getComputedStyle(element).overflowY
    if (!/^(auto|scroll)$/.test(overflow) || element.scrollHeight <= element.clientHeight + 1) continue
    const rect = element.getBoundingClientRect()
    const speed = sortEdgeSpeed(y, rect.top, rect.bottom)
    if (speed && (speed < 0 ? element.scrollTop > 0 : element.scrollTop + element.clientHeight < element.scrollHeight - 1)) {
      return { element, speed, top: rect.top, bottom: rect.bottom }
    }
  }
  const element = document.scrollingElement as HTMLElement | null
  if (!element || element.scrollHeight <= element.clientHeight + 1) return null
  const viewport = window.visualViewport
  const top = viewport?.offsetTop ?? 0
  const bottom = top + (viewport?.height ?? window.innerHeight)
  const speed = sortEdgeSpeed(y, top, bottom)
  return speed && (speed < 0 ? element.scrollTop > 0 : element.scrollTop + element.clientHeight < element.scrollHeight - 1)
    ? { element, speed, top, bottom } : null
}

function startSortAutoScroll() {
  if (!sortAutoScrollFrame && activeSwap.value) sortAutoScrollFrame = requestAnimationFrame(runSortAutoScroll)
}

function runSortAutoScroll(time: number) {
  sortAutoScrollFrame = 0
  const pending = pendingSwap
  if (!pending || !activeSwap.value) return
  const target = sortScrollTarget(pending.origin, pending.lastY)
  if (!target) { sortAutoScrollPrevious = 0; return }
  const elapsed = sortAutoScrollPrevious ? Math.min((time - sortAutoScrollPrevious) / 16.7, 2) : 1
  sortAutoScrollPrevious = time
  const before = target.element.scrollTop
  target.element.scrollTop += target.speed * elapsed
  if (target.element.scrollTop !== before) {
    updateSortTarget(pending, pending.lastX, Math.max(target.top + 2, Math.min(pending.lastY, target.bottom - 2)))
    startSortAutoScroll()
  }
}

function moveLongSwap(x: number, y: number, source: 'touch' | 'pointer', pointerId?: number): boolean {
  const pending = pendingSwap
  if (!pending || pending.source !== source || (source === 'pointer' && pending.pointerId !== pointerId)) return false
  if (!activeSwap.value) {
    if (Math.hypot(x - pending.x, y - pending.y) > 10) cancelLongSwap()
    return false
  }
  pending.lastX = x
  pending.lastY = y
  updateSortTarget(pending, x, y)
  startSortAutoScroll()
  return true
}

function finishLongSwap(source: 'touch' | 'pointer', pointerId?: number): boolean {
  const pending = pendingSwap
  if (!pending || pending.source !== source || (source === 'pointer' && pending.pointerId !== pointerId)) return false
  const active = activeSwap.value
  if (active) {
    if (active.scope === 'favoriteTools') moveFavoriteToolByDrop(active.id, active.targetId, active.targetGroup)
    else if (active.scope === 'homeTools') moveHomeToolByDrop(active.id, active.targetId, active.group, active.targetGroup)
    else if (active.scope === 'websites') moveWebsiteByDrop(active.id, active.targetId, active.targetGroup)
    else moveDisplayedItem(active.scope, active.id, active.targetId, active.group)
    suppressPageSwipeUntil = performance.now() + 500
    suppressedSwapClick = `${active.scope}:${active.id}`
    clearTimeout(suppressClickTimer)
    suppressClickTimer = setTimeout(() => (suppressedSwapClick = ''), 600)
  }
  cancelLongSwap()
  return !!active
}

function ignoreSortStart(event: Event): boolean {
  return event.target instanceof Element && !!event.target.closest('.website-menu-button, .website-manager-move, .group-manager-remove-tool, .group-manager-card-actions, input, textarea, select, [contenteditable]')
}

function onSortTouchStart(event: TouchEvent, scope: SortScope, id: string, group?: string) {
  if (event.touches.length !== 1) return cancelLongSwap()
  if (ignoreSortStart(event)) return
  const touch = event.touches[0]
  beginLongSwap(scope, id, touch.clientX, touch.clientY, event.currentTarget as HTMLElement, 'touch', undefined, group)
}

function onSortTouchMove(event: TouchEvent) {
  if (event.touches.length !== 1) return cancelLongSwap()
  const touch = event.touches[0]
  if (touch && moveLongSwap(touch.clientX, touch.clientY, 'touch') && event.cancelable) event.preventDefault()
}

function onSortTouchEnd(event: TouchEvent) {
  if (event.touches.length) return cancelLongSwap()
  if (finishLongSwap('touch') && event.cancelable) event.preventDefault()
}

function onSortPointerDown(event: PointerEvent, scope: SortScope, id: string, group?: string) {
  if (event.pointerType === 'touch' || event.button !== 0 || !event.isPrimary || ignoreSortStart(event)) return
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  beginLongSwap(scope, id, event.clientX, event.clientY, event.currentTarget as HTMLElement, 'pointer', event.pointerId, group)
}

function onSortPointerMove(event: PointerEvent) {
  if (event.pointerType !== 'touch' && moveLongSwap(event.clientX, event.clientY, 'pointer', event.pointerId)) event.preventDefault()
}

function onSortPointerUp(event: PointerEvent) {
  if (event.pointerType !== 'touch' && finishLongSwap('pointer', event.pointerId)) event.preventDefault()
}

function consumeSwapClick(scope: SortScope, id: string, event: Event): boolean {
  if (suppressedSwapClick !== `${scope}:${id}`) return false
  suppressedSwapClick = ''
  event.preventDefault()
  event.stopPropagation()
  return true
}

function onCategoryClick(name: string, event: Event) {
  if (!consumeSwapClick('categories', name, event)) toggleCategory(name)
}

function onManagedGroupClick(id: string, event: Event) {
  const scope = groupManagerTab.value === 'home' ? 'categories'
    : groupManagerTab.value === 'favorites' ? 'favoriteGroups' : 'websiteGroups'
  if (!consumeSwapClick(scope, id, event)) toggleManagerGroup(id)
}

function onFavoriteGroupClick(id: string, event: Event) {
  if (!consumeSwapClick('favoriteGroups', id, event)) toggleCategory(id)
}

function onFavoriteClick(toolId: string, event: Event) {
  if (!consumeSwapClick(favoriteGroupSettings.value.enabled && favoriteCategories.value.length > 1 ? 'favoriteTools' : 'favorites', toolId, event)) openTool(toolId)
}

function onHomeToolClick(toolId: string, event: Event) {
  if (!consumeSwapClick('homeTools', toolId, event)) openTool(toolId)
}

const swipePages = ['home', 'favorites', 'websites'] as const
type TabPage = typeof swipePages[number]
const lastTabPage = ref<TabPage>(startPage.value)
const secondaryPageTitles = { detection: '智能识别', deviceSync: '设备同步', restoreTools: '恢复工具', customTool: '创建自动化工具', moduleStudio: '工具工作台', toolAuthorSkill: '工具编写指南', groupManager: '分组管理', toolDownloads: '工具市场', shortcuts: '快捷方式', theme: '应用主题', wallpaperEditor: '编辑壁纸', colorEditor: '更换主题色', settings: '更多设置', about: '关于应用' } as const
const isSecondaryPage = computed(() => page.value === 'detection' || page.value === 'deviceSync' || page.value === 'restoreTools' || page.value === 'customTool' || page.value === 'moduleStudio' || page.value === 'toolAuthorSkill' || page.value === 'groupManager' || page.value === 'toolDownloads' || page.value === 'shortcuts' || page.value === 'theme' || page.value === 'wallpaperEditor' || page.value === 'colorEditor' || page.value === 'settings' || page.value === 'about')
const secondaryPageTitle = computed(() => page.value === 'customTool' && customForm.value.id ? '编辑自动化工具' : page.value === 'wallpaperEditor' ? `编辑${appearanceImageLabel.value}` : isSecondaryPage.value ? secondaryPageTitles[page.value as keyof typeof secondaryPageTitles] : '')
const isTabPage = computed(() => swipePages.some((item) => item === page.value))
const pageTrackTransform = computed(() =>
  `translate3d(calc(${-swipePages.findIndex((item) => item === page.value) * 100}% + ${pageSwipeOffset.value}px), 0, 0)`,
)

function settlePageSwipe(destination?: typeof swipePages[number]) {
  pageSwipeSettling.value = true
  pageSwipeOffset.value = 0
  if (destination) navigate(destination)
  clearTimeout(pageSwipeTimer)
  pageSwipeTimer = setTimeout(() => { pageSwipeSettling.value = false }, 260)
}

function onPageTouchStart(event: TouchEvent) {
  if (event.touches.length !== 1 || !isMobileLayout() || searchOpen.value || sidebarOpen.value || pageSwipeSettling.value || !isTabPage.value) {
    pageSwipeStart = null
    return
  }
  const touch = event.touches[0]
  pageSwipeStart = { x: touch.clientX, y: touch.clientY, time: performance.now(), page: page.value }
}

function onPageTouchMove(event: TouchEvent) {
  const start = pageSwipeStart
  if (event.touches.length !== 1) return onPageTouchCancel()
  if (!start || start.page !== page.value || activeSwap.value || performance.now() < suppressPageSwipeUntil) return
  const touch = event.touches[0]
  const dx = touch.clientX - start.x
  const dy = touch.clientY - start.y
  if (!start.axis && Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.1) start.axis = 'horizontal'
  else if (!start.axis && Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx) * 1.1) start.axis = 'vertical'
  if (start.axis === 'vertical') {
    if (autoHideBars.value && Math.abs(dy) >= 32) setBarsHidden(dy < 0)
    return
  }
  if (start.axis !== 'horizontal') return
  const index = swipePages.findIndex((item) => item === page.value)
  const hasNeighbor = dx < 0 ? index < swipePages.length - 1 : index > 0
  pageSwipeOffset.value = hasNeighbor ? dx : Math.sign(dx) * Math.min(Math.abs(dx) * .18, 22)
  if (event.cancelable) event.preventDefault()
}

function onPageTouchEnd(event: TouchEvent) {
  const start = pageSwipeStart
  pageSwipeStart = null
  if (event.touches.length) return onPageTouchCancel()
  if (!start || start.page !== page.value) return
  const touch = event.changedTouches[0]
  if (!touch || start.axis !== 'horizontal' || performance.now() < suppressPageSwipeUntil) return
  const dx = touch.clientX - start.x
  const width = pageSwipeViewport.value?.clientWidth ?? window.innerWidth
  const shouldSwitch = Math.abs(dx) >= Math.min(width * .23, 110) || (Math.abs(dx) >= 45 && performance.now() - start.time < 280)
  const index = swipePages.findIndex((item) => item === page.value)
  const destination = swipePages[index + (dx < 0 ? 1 : -1)]
  if (event.cancelable) event.preventDefault()
  settlePageSwipe(shouldSwitch ? destination : undefined)
}

function onPageTouchCancel() {
  pageSwipeStart = null
  if (pageSwipeOffset.value) settlePageSwipe()
}

function setBarsHidden(hidden: boolean) {
  if (barsHidden.value === hidden) return
  barsHidden.value = hidden
  tabScrollDistance = 0
  ignoreTabScrollUntil = performance.now() + 280
}

function onTabScroll(event: Event, tab: TabPage) {
  const scrollTop = (event.currentTarget as HTMLElement).scrollTop
  const delta = scrollTop - lastTabScrollTop[tab]
  lastTabScrollTop[tab] = scrollTop
  if (activeSwap.value) return
  if (tab !== page.value || !autoHideBars.value || !isMobileLayout()) return
  if (scrollTop <= 2 && (delta < 0 || !barsHidden.value)) {
    setBarsHidden(false)
    tabScrollDistance = 0
    return
  }
  if (performance.now() < ignoreTabScrollUntil || pageSwipeStart?.axis === 'horizontal') return
  if (Math.abs(delta) < 1) return
  const direction = Math.sign(delta)
  if (direction !== tabScrollDirection) {
    tabScrollDirection = direction
    tabScrollDistance = 0
  }
  tabScrollDistance += Math.abs(delta)
  if (tabScrollDistance >= 24) {
    setBarsHidden(direction > 0)
    tabScrollDistance = 0
  }
}

function toggleAutoHideBars() {
  autoHideBars.value = !autoHideBars.value
  if (!autoHideBars.value) setBarsHidden(false)
  try { localStorage.setItem(AUTO_HIDE_BARS_KEY, String(autoHideBars.value)) } catch { /* Keep the choice for this session. */ }
}

function onLayoutChange() {
  pageSwipeStart = null
  groupManagerSwipeStart = null
  moduleSwipeStart = null
  pageSwipeOffset.value = 0
  groupSwipeOffset.value = 0
  moduleSwipeOffset.value = 0
  setBarsHidden(false)
  tabScrollDistance = 0
  ignoreTabScrollUntil = performance.now() + 300
}

function chooseStartPage(value: StartPage) {
  startPage.value = value
  startPageOptionsOpen.value = false
  try { localStorage.setItem(START_PAGE_KEY, value) } catch { /* Keep the choice for this session. */ }
}

function openSettingsFromTray() {
  if (searchOpen.value) closeSearch(false)
  if (websiteActionsDialog.value?.open) closeWebsiteActions()
  if (websiteDialog.value?.open) closeWebsiteDialog()
  navigate('settings')
}

async function initializeDesktopSettings() {
  if (!isWindowsApp) return
  try {
    unlistenDesktopSettings = await listen('firefly:open-settings', openSettingsFromTray)
  } catch {
    notify('无法接收系统托盘操作')
  }
  const [closeResult, autostartResult] = await Promise.allSettled([
    invoke<string>('desktop_close_behavior'),
    invoke<boolean>('desktop_autostart_enabled'),
  ])
  if (closeResult.status === 'fulfilled' && (closeResult.value === 'tray' || closeResult.value === 'exit')) {
    desktopCloseBehavior.value = closeResult.value
    desktopCloseReady.value = true
  } else notify('无法读取窗口关闭设置')
  if (autostartResult.status === 'fulfilled') {
    desktopAutostartEnabled.value = autostartResult.value
    desktopAutostartReady.value = true
  } else notify('无法读取开机自启状态')
}

async function chooseDesktopCloseBehavior(value: 'tray' | 'exit') {
  if (!desktopCloseReady.value || desktopCloseBusy.value) return
  if (desktopCloseBehavior.value === value) {
    desktopCloseOptionsOpen.value = false
    return
  }
  desktopCloseBusy.value = true
  try {
    await invoke('set_desktop_close_behavior', { behavior: value })
    desktopCloseBehavior.value = value
    desktopCloseOptionsOpen.value = false
  } catch {
    notify('保存窗口关闭设置失败')
  } finally {
    desktopCloseBusy.value = false
  }
}

async function toggleDesktopAutostart() {
  if (!desktopAutostartReady.value || desktopAutostartBusy.value) return
  desktopAutostartBusy.value = true
  const enabled = !desktopAutostartEnabled.value
  try {
    await invoke('set_desktop_autostart', { enabled })
    desktopAutostartEnabled.value = enabled
  } catch {
    notify('更新开机自启失败')
  } finally {
    desktopAutostartBusy.value = false
  }
}

function onWebsiteCardClick(site: Website, event: Event) {
  if (!consumeSwapClick('websites', String(site.id), event)) visitWebsite(site)
}

function onWebsiteGroupClick(id: string, event: Event) {
  if (!consumeSwapClick('websiteGroups', id, event)) toggleCategory(id)
}

function openWebsiteActions(site: Website) {
  websiteActionSite.value = site
  websiteActionsDialog.value?.showModal()
  updateNativeBack()
  websiteActionsDialog.value?.querySelector<HTMLButtonElement>('.dialog-heading button')?.focus({ preventScroll: true })
}

function closeWebsiteActions() {
  websiteActionsDialog.value?.close()
  websiteActionSite.value = null
  updateNativeBack()
}

function editWebsiteFromActions() {
  const site = websiteActionSite.value
  closeWebsiteActions()
  if (site) editWebsite(site)
}

async function deleteWebsiteFromActions() {
  const site = websiteActionSite.value
  closeWebsiteActions()
  if (site) await removeWebsite(site)
}

function onAppContextMenu(event: MouseEvent) {
  if (!(event.target instanceof Element) || !event.target.closest('input, textarea, [contenteditable]')) event.preventDefault()
}

function loadSearchHistory() {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) ?? '[]')
    if (Array.isArray(saved)) {
      searchHistory.value = saved.filter((item): item is SearchHistoryItem =>
        item !== null && typeof item === 'object'
          && (item.kind === 'tool' || item.kind === 'website')
          && typeof item.id === 'string',
      ).slice(0, 20)
    }
  } catch {
    searchHistory.value = []
  }
}

function rememberSearchClick(item: SearchHistoryItem) {
  searchHistory.value = [item, ...searchHistory.value.filter((entry) =>
    entry.kind !== item.kind || entry.id !== item.id,
  )].slice(0, 20)
  try {
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(searchHistory.value))
  } catch {
    // History remains available for this session if local storage is unavailable.
  }
}

function clearSearchHistory() {
  searchHistory.value = []
  try {
    localStorage.removeItem(SEARCH_HISTORY_KEY)
  } catch {
    // The in-memory history was already cleared.
  }
}

function openSearch(event?: MouseEvent) {
  if (repositoryInstalling.value) return
  leaveToolFullscreen()
  searchReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  searchOpenedFromKeyboard = !event || event.detail === 0
  sidebarOpen.value = false
  searchQuery.value = ''
  searchOpen.value = true
  nextTick(() => searchBox.value?.focus({ preventScroll: true }))
}

function closeSearch(restoreFocus = true) {
  searchOpen.value = false
  searchQuery.value = ''
  const target = searchReturnFocus, keyboard = searchOpenedFromKeyboard
  searchReturnFocus = null
  if (restoreFocus) nextTick(() => {
    if (!target?.isConnected) return
    if (keyboard) target.focus({ preventScroll: true })
    else target.blur()
  })
}

function activateSearchItem(item: SearchHistoryItem) {
  if (item.kind === 'tool') {
    if (!store.tools.some((tool) => tool.id === item.id)) return
    rememberSearchClick(item)
    closeSearch(false)
    openTool(item.id)
  } else {
    const site = websites.value.find((entry) => String(entry.id) === item.id)
    if (!site) return
    rememberSearchClick(item)
    closeSearch(false)
    visitWebsite(site)
  }
}

function onSearchInputKey(event: KeyboardEvent) {
  if (event.isComposing || event.key !== 'Enter') return
  const firstItem = searchGroups.value[0]?.items[0]
  if (firstItem) activateSearchItem(firstItem)
}

function openDetectionFromSidebar() {
  sidebarOpen.value = false
  openDetection()
}

function navigate(destination: Exclude<Page, 'editor'>, fromBack = false) {
  if (repositoryInstalling.value) return
  if (deviceSyncApplying.value || cacheBusy.value || wallpaperSaving.value || settingsResetBusy.value) return
  if (destination !== 'wallpaperEditor') cancelAppearanceSelection()
  if (page.value === 'allTools' && (bulkDeleteBusy.value || savingFavorites.value)) return
  if (page.value === 'restoreTools' && restoreSaving.value) return
  if (page.value === 'customTool' && customSaving.value) return
  if (page.value === 'customTool' && destination !== 'customTool') resetCustomToolPage()
  if (page.value === 'detection' && destination !== 'detection') resetDetection()
  if (page.value === 'restoreTools' && destination !== 'restoreTools') { restoreRequest++; selectedRestoreTools.value = [] }
  cancelActiveModule()
  const current = page.value === 'editor' ? previousPage.value : page.value
  if (!fromBack && current !== destination) {
    if (destination === 'allTools' || Object.prototype.hasOwnProperty.call(secondaryPageTitles, destination)) standaloneHistory.push(current)
    else standaloneHistory.length = 0
  }
  cancelLongSwap()
  setBarsHidden(false)
  tabScrollDistance = 0
  if (swipePages.some((item) => item === destination)) lastTabPage.value = destination as TabPage
  favoriteEditing.value = false
  allToolsAction.value = null
  allToolsMenuOpen.value = false
  editorToolMenuOpen.value = false
  moduleFileDragging.value = false
  selectedFavorites.value = []
  if (page.value === 'editor' && destination !== 'customTool' && destination !== 'detection') {
    executionRevision++
    input.value = ''
    output.value = ''
    status.value = '输入内容后选择操作。'
  }
  if (page.value === 'wallpaperEditor' && destination !== 'wallpaperEditor') cancelWallpaperEditing()
  if (destination === 'groupManager' && page.value !== 'groupManager') {
    clearTimeout(groupSwipeTimer)
    groupManagerTab.value = 'home'
    groupSwipeOffset.value = 0
    groupSwipeSettling.value = false
    groupSwipeNeighbor.value = null
    groupManagerIndicatorStyle.value = { transform: 'translateX(0px)', width: '0px', opacity: '0' }
    newGroupName.value = ''
    editingGroupId.value = ''
    groupManagerError.value = ''
  }
  page.value = destination
  sidebarOpen.value = false
}

function goBackStandalone() {
  if (repositoryInstalling.value) return
  if (deviceSyncApplying.value || cacheBusy.value || wallpaperSaving.value || (page.value === 'customTool' && customSaving.value)) return
  if (page.value === 'restoreTools') { cancelRestoreTools(); return }
  if (page.value === 'detection' && detectionReturnEditor && store.tools.some(tool => tool.id === detectionReturnEditor?.id)) {
    const saved = detectionReturnEditor
    standaloneHistory.pop()
    resetDetection()
    activeToolId.value = saved.id
    previousPage.value = saved.previous
    input.value = saved.input; output.value = saved.output; toolAction.value = saved.action
    status.value = saved.status; statusError.value = saved.statusError; editorTab.value = saved.tab
    executionRevision++
    page.value = 'editor'
    void nextTick(() => {
      window.scrollTo({ top: detectionReturnScroll, behavior: 'instant' })
      if (activeTool.value?.ui_kind === 'web') void startWebTool(activeToolId.value, executionRevision)
    })
    return
  }
  const returningFromDetection = page.value === 'detection'
  if (page.value === 'customTool' && customToolReturnToEditor && activeTool.value?.custom) {
    standaloneHistory.pop()
    resetCustomToolPage()
    page.value = 'editor'
    void nextTick(() => {
      window.scrollTo({ top: customToolReturnScroll, behavior: 'instant' })
      document.querySelector<HTMLButtonElement>('[aria-label="编辑自动化工具"]')?.focus({ preventScroll: true })
    })
    return
  }
  const returningFromCustomTool = page.value === 'customTool'
  const returningFromSkill = page.value === 'toolAuthorSkill'
  navigate(standaloneHistory.pop() ?? lastTabPage.value, true)
  if (returningFromSkill && page.value === 'moduleStudio') void nextTick(() => {
    window.scrollTo({ top: toolAuthorSkillReturnScroll, behavior: 'instant' })
    document.getElementById('open-tool-author-skill')?.focus({ preventScroll: true })
  })
  if (returningFromCustomTool) void nextTick(() => {
    window.scrollTo({ top: customToolReturnScroll, behavior: 'instant' })
    document.getElementById('open-custom-tool')?.focus({ preventScroll: true })
  })
  if (returningFromDetection) void nextTick(() => window.scrollTo({ top: detectionReturnScroll, behavior: 'instant' }))
}

function onAllToolsBack() {
  if (allToolsActionBusy.value || savingFavorites.value) return
  if (allToolsMenuOpen.value) allToolsMenuOpen.value = false
  else if (allToolsAction.value && !allToolsActionBusy.value) allToolsAction.value = null
  else if (favoriteEditing.value) cancelFavoriteEditing()
  else goBackStandalone()
}

function onEditorBack() {
  if (allToolsActionBusy.value) return
  if (editorToolMenuOpen.value) editorToolMenuOpen.value = false
  else navigate(previousPage.value)
}

const selectableAllTools = computed(() => store.tools)
const editorToolActions = computed<AllToolsAction[]>(() => activeTool.value?.custom ? ['edit'] : ['delete', 'edit'])

function chooseAllToolsAction(action: AllToolsAction) {
  allToolsMenuOpen.value = false
  selectedDeleteTools.value = []
  allToolsAction.value = action
}

function toggleSelectedDelete(toolId: string) {
  if (allToolsActionBusy.value) return
  selectedDeleteTools.value = selectedDeleteTools.value.includes(toolId)
    ? selectedDeleteTools.value.filter(id => id !== toolId) : [...selectedDeleteTools.value, toolId]
}

function invertDeleteSelection() {
  if (allToolsActionBusy.value) return
  const selected = new Set(selectedDeleteTools.value)
  selectedDeleteTools.value = selectableAllTools.value.filter(tool => !selected.has(tool.id)).map(tool => tool.id)
}

async function deleteSelectedTools() {
  if (allToolsAction.value !== 'delete' || allToolsActionBusy.value || !selectedDeleteTools.value.length) return
  const ids = [...selectedDeleteTools.value]
  const selected = new Set(ids)
  const tools = store.tools.filter(tool => selected.has(tool.id))
  if (tools.length !== ids.length) return notify('工具列表已变化，请重新选择。')
  const builtinCount = tools.filter(tool => tool.builtin).length
  const permanent = tools.filter(tool => !tool.builtin)
  const names = tools.slice(0, 6).map(tool => {
    const name = [...tool.name.replace(/\s+/g, ' ')]
    return `「${name.slice(0, 24).join('')}${name.length > 24 ? '…' : ''}」`
  }).join('、') + (tools.length > 6 ? '等' : '')
  const messages = [`删除选中的 ${tools.length} 个工具（${names}）及相关收藏和最近使用记录？`]
  if (builtinCount) messages.push(`${builtinCount} 个应用自带工具可在“恢复工具”中找回，修改的信息与源码会保留。`)
  if (permanent.length) messages.push(`${permanent.length} 个导入/创建或自动化工具将永久删除，无法撤销。删除工具包的最后一个工具时，会卸载整个工具包。`)
  allToolsActionBusy.value = true
  bulkDeleteBusy.value = true
  let deleted = false
  try {
    if (!await confirmAction(messages.join('\n\n'), '删除工具', `删除 ${tools.length} 个工具`, true)) return
    const count = await toolbox.deleteTools(ids)
    deleted = true
    store.forgetDeletedTools(ids)
    customTools.value = customTools.value.filter(tool => !selected.has(tool.id))
    const removed = new Set(permanent.map(tool => tool.id))
    homeGroupSettings.value = { ...homeGroupSettings.value, assignments: Object.fromEntries(Object.entries(homeGroupSettings.value.assignments).filter(([id]) => !removed.has(id))) }
    favoriteGroupSettings.value = { ...favoriteGroupSettings.value, assignments: Object.fromEntries(Object.entries(favoriteGroupSettings.value.assignments).filter(([id]) => !removed.has(id))) }
    const [, , installed] = await Promise.all([store.refresh(), loadCustomTools(), toolbox.listModules()])
    modules.value = installed
    ensureStudioSelection()
    allToolsAction.value = null
    notify(`已删除 ${count} 个工具`)
  } catch (error) {
    if (deleted) allToolsAction.value = null
    notify(deleted ? `工具已删除，刷新列表失败：${errorMessage(error)}` : `删除失败：${errorMessage(error)}`)
  } finally { allToolsActionBusy.value = false; bulkDeleteBusy.value = false }
}

async function deleteBuiltinTool(toolId: string, toolName: string): Promise<boolean> {
  if (allToolsActionBusy.value || moduleStudioBusy.value || moduleBusy.value) return false
  allToolsActionBusy.value = true
  moduleStudioBusy.value = true
  try {
    if (!await confirmAction(`删除「${toolName}」及相关收藏？可在“工具管理 → 恢复工具”中找回，修改的信息与源码会保留。`, '删除工具', '删除工具', true)) return false
    await toolbox.deleteBuiltinTool(toolId)
    modules.value = await toolbox.listModules()
    await store.refresh()
    ensureStudioSelection()
    notify(`已删除「${toolName}」`)
    return true
  } catch (error) { notify(errorMessage(error)); return false }
  finally { allToolsActionBusy.value = false; moduleStudioBusy.value = false }
}

async function openRestoreTools() {
  allToolsMenuOpen.value = false
  deletedBuiltinTools.value = []
  selectedRestoreTools.value = []
  restoreError.value = ''
  navigate('restoreTools')
  await loadDeletedBuiltinTools()
}

async function loadDeletedBuiltinTools() {
  const request = ++restoreRequest
  restoreLoading.value = true
  restoreError.value = ''
  try {
    const tools = await toolbox.listDeletedBuiltinTools()
    if (request !== restoreRequest || page.value !== 'restoreTools') return
    deletedBuiltinTools.value = tools
    selectedRestoreTools.value = selectedRestoreTools.value.filter((id) => tools.some((tool) => tool.id === id))
  } catch (error) {
    if (request === restoreRequest && page.value === 'restoreTools') restoreError.value = errorMessage(error)
  } finally { if (request === restoreRequest) restoreLoading.value = false }
}

function toggleRestoreTool(toolId: string) {
  if (restoreSaving.value) return
  selectedRestoreTools.value = selectedRestoreTools.value.includes(toolId)
    ? selectedRestoreTools.value.filter((id) => id !== toolId) : [...selectedRestoreTools.value, toolId]
}

function invertRestoreSelection() {
  if (restoreLoading.value || restoreSaving.value) return
  const selected = new Set(selectedRestoreTools.value)
  selectedRestoreTools.value = deletedBuiltinTools.value.filter((tool) => !selected.has(tool.id)).map((tool) => tool.id)
}

function cancelRestoreTools() {
  if (restoreSaving.value) return
  if (standaloneHistory.at(-1) === 'allTools') standaloneHistory.pop()
  navigate('allTools', true)
}

async function saveRestoredTools() {
  if (restoreSaving.value || !selectedRestoreTools.value.length) return
  const selected = [...selectedRestoreTools.value]
  restoreSaving.value = true
  restoreError.value = ''
  let restored = false
  try {
    await toolbox.restoreBuiltinTools(selected)
    await store.refresh()
    restored = true
  } catch (error) { restoreError.value = errorMessage(error) }
  finally { restoreSaving.value = false }
  if (restored) { cancelRestoreTools(); notify(`已恢复 ${selected.length} 个工具`) }
}

function onAllToolsMenuPointerDown(event: PointerEvent) {
  if (allToolsMenuOpen.value && !allToolsMenuRoot.value?.contains(event.target as Node)) allToolsMenuOpen.value = false
  if (editorToolMenuOpen.value && !editorToolMenuRoot.value?.contains(event.target as Node)) editorToolMenuOpen.value = false
}

async function applyAllToolsAction(tool: ToolDescriptor, selectedAction?: AllToolsAction) {
  const action = selectedAction ?? allToolsAction.value
  if (!action || allToolsActionBusy.value) return
  editorToolMenuOpen.value = false
  const returnFromEditor = () => {
    if (page.value === 'editor' && activeToolId.value === tool.id) navigate(previousPage.value)
    else allToolsAction.value = null
  }
  if (action === 'edit') {
    if (tool.custom) {
      if (page.value === 'allTools') allToolsAction.value = null
      editCustomTool(tool.id)
      return
    }
    if (!supportsJsModules) return notify('当前平台无法打开工具工作台。')
    allToolsActionBusy.value = true
    try {
      await openModuleStudio()
      if (moduleStudioError.value) throw new Error(moduleStudioError.value)
      builtinToolFilter.value = ''
      moduleToolFilter.value = ''
      setModuleStudioTab('installed')
      await nextTick()
      if (tool.module_id) await selectStudioItem({ kind: tool.builtin ? 'builtin' : 'module', id: tool.module_id })
      if (moduleStudioError.value) notify(moduleStudioError.value)
    } catch (error) { notify(errorMessage(error)) }
    finally { allToolsActionBusy.value = false }
    return
  }
  if (tool.custom) {
    await removeCustomTool(tool.id)
    return
  }
  if (tool.builtin) {
    if (await deleteBuiltinTool(tool.id, tool.name)) returnFromEditor()
    return
  }
  if (!tool.module_id) return
  allToolsActionBusy.value = true
  try {
    const details = await toolbox.getModuleDetails(tool.module_id)
    const lastTool = details.manifest.tools.length === 1
    const message = lastTool
      ? `删除「${tool.name}」将卸载整个工具，并清除相关收藏。此操作无法撤销，确定继续？`
      : `删除「${tool.name}」及相关收藏？此操作无法撤销。`
    if (!await confirmAction(message, '删除工具', '删除工具', true)) return
    await toolbox.deleteModuleTool(tool.module_id, tool.id)
    modules.value = await toolbox.listModules()
    await store.refresh()
    const assignments = { ...homeGroupSettings.value.assignments }
    delete assignments[tool.id]
    homeGroupSettings.value = { ...homeGroupSettings.value, assignments }
    notify(lastTool ? `已删除「${tool.name}」并卸载工具` : `已删除「${tool.name}」`)
    returnFromEditor()
  } catch (error) { notify(errorMessage(error)) }
  finally { allToolsActionBusy.value = false }
}

function onShortcutToolChange() {
  const tool = store.tools.find((tool) => tool.id === shortcutToolId.value)
  const nextName = tool ? suggestedShortcutName(tool.name, isWindowsApp) : ''
  if (!shortcutName.value.trim() || shortcutName.value === shortcutSuggestedName) shortcutName.value = nextName
  shortcutSuggestedName = nextName
  shortcutError.value = ''
  shortcutNotice.value = ''
}

async function chooseShortcutImage() {
  if (shortcutBusy.value) return
  shortcutBusy.value = true
  shortcutImageLoading.value = true
  shortcutError.value = ''
  shortcutNotice.value = ''
  try {
    const path = await openFileDialog({
      title: '选择快捷方式图片', multiple: false, directory: false,
      ...(isAndroidApp ? {} : { filters: [{ name: '图片', extensions: ['svg', 'png', 'jpg', 'jpeg', 'webp'] }] }),
    })
    if (!path) return
    const bytes = new Uint8Array(await invoke<ArrayBuffer>('read_shortcut_icon_file', { path }))
    shortcutIconData.value = await normalizeShortcutIcon(bytes)
  } catch (error) { shortcutError.value = errorMessage(error) }
  finally { shortcutBusy.value = false; shortcutImageLoading.value = false }
}

async function openShortcutSettings() {
  if (shortcutSettingsBusy.value) return
  shortcutSettingsBusy.value = true
  shortcutError.value = ''
  try { await invoke('open_shortcut_settings') }
  catch (error) { shortcutError.value = errorMessage(error) }
  finally { shortcutSettingsBusy.value = false }
}

function clearShortcutFeedback() { shortcutError.value = ''; shortcutNotice.value = '' }
function resetShortcutImage() { shortcutIconData.value = ''; clearShortcutFeedback() }

async function createShortcut() {
  if (shortcutBusy.value) return
  shortcutError.value = ''
  shortcutNotice.value = ''
  if (!store.tools.some((tool) => tool.id === shortcutToolId.value)) {
    shortcutError.value = '请先选择一个工具。'
    return
  }
  let name: string
  try { name = validateShortcutName(shortcutName.value, isWindowsApp) }
  catch (error) { shortcutError.value = errorMessage(error); return }
  shortcutBusy.value = true
  try {
    const result = await requestShortcutCreation(() => invoke<string>('create_tool_shortcut', {
      toolId: shortcutToolId.value, name, iconData: shortcutIconData.value || null,
    }), isAndroidApp)
    if (result !== 'created' && result !== 'requested') throw new Error('快捷方式服务返回了不兼容的结果，请重试。')
    shortcutNotice.value = result === 'requested'
      ? '已向桌面发起请求，请返回桌面查看目标应用是否已创建。若目标应用不存在，请打开应用授权页面并查看下是否给本应用授予相关权限！'
      : '快捷方式已创建在桌面。'
  } catch (error) { shortcutError.value = errorMessage(error) }
  finally { shortcutBusy.value = false }
}

const toolSelectionBusy = computed(() => store.loading || deviceSyncApplying.value || cacheBusy.value || wallpaperSaving.value || backupBusy.value
  || bulkDeleteBusy.value || savingFavorites.value || allToolsActionBusy.value || restoreSaving.value
  || customSaving.value || customIconLoading.value || websiteSaving.value || shortcutBusy.value
  || moduleBusy.value || moduleStudioBusy.value || repositoryInstalling.value || settingsResetPending.value || settingsResetBusy.value)
const shortcutLaunchReady = computed(() => supportsJsModules && !store.loadError && !toolSelectionBusy.value)
const shortcutLaunchQueue = createShortcutLaunchQueue({
  take: () => invoke<string>('take_shortcut_launch'),
  canOpen: () => !appUnmounted && shortcutLaunchReady.value,
  open: toolId => {
      showMobileSplash.value = false
      if (!store.tools.some((tool) => tool.id === toolId)) {
        notify('快捷方式对应的工具已删除或暂不可用。')
        return
      }
      if (searchOpen.value) closeSearch(false)
      if (page.value === 'detection') closeDetection()
      if (websiteDialog.value?.open) closeWebsiteDialog()
      if (websiteActionsDialog.value?.open) closeWebsiteActions()
      if (page.value === 'customTool') closeCustomToolPage()
      if (backupDialog.value?.open) closeBackupDialog()
      if (groupCreateDialog.value?.open) closeGroupCreateDialog()
      if (confirmDialog.value?.open) finishConfirmation(false)
      openTool(toolId)
  },
  onError: () => notify('无法打开快捷方式对应的工具。'),
})
function handleShortcutLaunch(): Promise<void> { return shortcutLaunchQueue.request() }
watch(shortcutLaunchReady, ready => { if (ready) void shortcutLaunchQueue.resume() })

async function onShortcutOpen() {
  shortcutOpening.value = true
  try {
    await handleShortcutLaunch()
    await nextTick()
  } finally { shortcutOpening.value = false }
}

function openTool(toolId: string): boolean {
  if (repositoryInstalling.value) return false
  if (deviceSyncApplying.value || cacheBusy.value || wallpaperSaving.value || bulkDeleteBusy.value || savingFavorites.value || customSaving.value) return false
  if (!store.tools.some((tool) => tool.id === toolId)) return false
  if (page.value === 'customTool') { closeCustomToolPage(); if (page.value === 'customTool') return false }
  if (page.value === 'detection') cancelDetectionRequests()
  cancelAppearanceSelection()
  cancelActiveModule()
  cancelLongSwap()
  editorToolMenuOpen.value = false
  if (page.value !== 'editor') previousPage.value = page.value
  activeToolId.value = toolId
  executionRevision++
  favoriteEditing.value = false
  selectedFavorites.value = []
  toolAction.value = store.tools.find((tool) => tool.id === toolId)?.actions[0]?.id ?? ''
  input.value = ''
  output.value = ''
  status.value = '输入内容后选择操作。'
  if (toolId === 'uuid.generate') status.value = '点击生成 UUID，或切换到校验操作。'
  statusError.value = false
  page.value = 'editor'
  sidebarOpen.value = false
  editorTab.value = 'input'
  const openingRevision = executionRevision
  void nextTick(() => {
    if (page.value === 'editor' && activeToolId.value === toolId && executionRevision === openingRevision) window.scrollTo({ top: 0, behavior: 'instant' })
  })
  if (activeTool.value?.ui_kind === 'web') void startWebTool(toolId, executionRevision)
  if (usageStatsEnabled.value) void store.recordOpen(toolId).catch(() => {})
  return true
}

async function saveWebToolFile(name: string, bytes: Uint8Array, signal: AbortSignal, progress: WebFileProgress): Promise<boolean> {
  ensureWebFileActive(signal)
  let path: string | null
  try { path = await saveFileDialog({ title: '保存网页工具生成的文件', defaultPath: name }) }
  catch (error) { ensureWebFileActive(signal); throw new WebFileError('FILE_DIALOG_FAILED', `无法打开保存对话框：${errorMessage(error)}`) }
  ensureWebFileActive(signal)
  if (!path) return false
  progress('writing')
  try { await writeFile(path, bytes) }
  catch (error) { ensureWebFileActive(signal); throw new WebFileError('FILE_WRITE_FAILED', `文件写入失败：${errorMessage(error)}`) }
  ensureWebFileActive(signal)
  return true
}

function webFileMime(bytes: Uint8Array, name: string): string {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  if (bytes.length >= 6 && new TextDecoder().decode(bytes.subarray(0, 6)).startsWith('GIF8')) return 'image/gif'
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.subarray(0, 4)) === 'RIFF'
    && new TextDecoder().decode(bytes.subarray(8, 12)) === 'WEBP') return 'image/webp'
  if (bytes.length >= 4 && new TextDecoder().decode(bytes.subarray(0, 4)) === '%PDF') return 'application/pdf'
  const extension = name.split('.').pop()?.toLowerCase()
  return ({ txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', svg: 'image/svg+xml',
    avif: 'image/avif', bmp: 'image/bmp' } as Record<string, string>)[extension ?? ''] ?? 'application/octet-stream'
}

async function openWebToolFile(extensions: string[], maxBytes: number, signal: AbortSignal, progress: WebFileProgress) {
  ensureWebFileActive(signal)
  let path: string | null
  try {
    path = await openFileDialog({
      title: '选择网页工具要读取的文件', multiple: false, directory: false,
      ...(!isAndroidApp && extensions.length ? { filters: [{ name: '可选文件', extensions }] } : {}),
    }) as string | null
  } catch (error) { ensureWebFileActive(signal); throw new WebFileError('FILE_DIALOG_FAILED', `无法打开文件选择器：${errorMessage(error)}`) }
  ensureWebFileActive(signal)
  if (!path) return null
  progress('reading')
  let selectedSize: number | null = null
  try { selectedSize = (await stat(path)).size }
  catch (error) { if (!isAndroidApp) { ensureWebFileActive(signal); throw new WebFileError('FILE_READ_FAILED', `无法读取文件信息：${errorMessage(error)}`) } }
  ensureWebFileActive(signal)
  if (selectedSize !== null && selectedSize > maxBytes) throw new WebFileError('FILE_INPUT_LIMIT', '所选文件超过工具读取大小上限。')
  let bytes: Uint8Array
  try { bytes = await readFile(path) }
  catch (error) { ensureWebFileActive(signal); throw new WebFileError('FILE_READ_FAILED', `文件读取失败：${errorMessage(error)}`) }
  ensureWebFileActive(signal)
  if (!bytes.length) throw new WebFileError('FILE_EMPTY', '所选文件为空。')
  if (bytes.length > maxBytes) throw new WebFileError('FILE_INPUT_LIMIT', '所选文件超过工具读取大小上限。')
  const rawName = path.startsWith('content:') ? '' : path.split(/[\\/]/).pop() ?? ''
  const mimeType = webFileMime(bytes, rawName)
  const fallbackExtension = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
    'application/pdf': 'pdf' } as Record<string, string>)[mimeType] ?? 'bin'
  const name = rawName.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120) || `selected-file.${fallbackExtension}`
  return { name, bytes, mimeType }
}

async function hashWebToolFile(algorithm: string, signal: AbortSignal, progress: WebFileProgress, onProgress: (value: { processed: number; total?: number | null }) => void) {
  ensureWebFileActive(signal)
  const path = await openFileDialog({ title: '选择需要校验的文件', multiple: false, directory: false })
  ensureWebFileActive(signal)
  if (!path) return null
  const requestId = crypto.randomUUID()
  const cancel = () => { void toolbox.cancelHashFile(requestId).catch(() => {}) }
  const unlisten = await listen<{ request_id: string; processed: number; total?: number | null }>('firefly:hash-progress', ({ payload }) => {
    if (payload.request_id === requestId && !signal.aborted) onProgress(payload)
  })
  signal.addEventListener('abort', cancel, { once: true })
  try {
    ensureWebFileActive(signal)
    progress('processing')
    const result = await toolbox.hashSelectedFile(path, algorithm, requestId)
    ensureWebFileActive(signal)
    return result
  } catch (error) { ensureWebFileActive(signal); throw new WebFileError('HASH_FAILED', errorMessage(error)) }
  finally { signal.removeEventListener('abort', cancel); unlisten() }
}

async function startWebTool(toolId: string, revision: number) {
  leaveToolFullscreen()
  const moduleId = activeTool.value?.module_id
  if (!moduleId) return
  setWebToolLoading(true)
  webToolPresentationPending.value = true
  webToolError.value = ''
  webToolStopped.value = false
  webToolFileStatus.value = { busy: false, message: '' }
  try {
    const details = await toolbox.getModuleDetails(moduleId)
    if (executionRevision !== revision || page.value !== 'editor' || activeToolId.value !== toolId) return
    officialBoxOfficeOpen.value = toolId === 'boxoffice.live' && !details.modified
    await nextTick()
    if (executionRevision !== revision || page.value !== 'editor' || activeToolId.value !== toolId) return
    const tool = details.manifest.tools.find((item) => item.id === toolId)
    const html = tool && details.scripts[tool.entry]
    const css = tool?.ui.style && details.scripts[tool.ui.style]
    const script = tool?.ui.script && details.scripts[tool.ui.script]
    if (!tool || tool.ui.kind !== 'web' || typeof html !== 'string' || typeof css !== 'string'
      || typeof script !== 'string' || !webToolContainer.value) throw new Error('网页工具资源不完整。')
    await mountWebTool(webToolContainer.value, {
      moduleId: `tool.${toolId}`, scriptName: tool.ui.script,
      resourceModuleId: details.manifest.module_id, resources: details.manifest.resources, files: nativeWebFiles,
      html, css, script, networkHosts: details.manifest.network.hosts,
      timeoutMs: details.manifest.limits.timeout_ms, inputBytes: details.manifest.limits.input_bytes,
      outputBytes: details.manifest.limits.output_bytes, openFile: openWebToolFile,
      saveFile: saveWebToolFile,
      hashFile: hashWebToolFile, copyText: writeClipboardText, openWebsite: openToolWebsite,
      onPresentation: action => {
        if (executionRevision !== revision || page.value !== 'editor' || activeToolId.value !== toolId || !toolFullscreen.value) return
        if (action === 'exit') leaveToolFullscreen()
        else fullscreenControls.value?.reveal()
      },
      onFileStatus: (value) => {
        if (executionRevision === revision && page.value === 'editor' && activeToolId.value === toolId) webToolFileStatus.value = value
      },
      onStopped: () => {
        if (executionRevision === revision && activeToolId.value === toolId) { leaveToolFullscreen(); webToolStopped.value = true; webToolFileStatus.value = stoppedWebFileStatus(webToolFileStatus.value) }
      },
      onError: (message) => {
        if (executionRevision === revision && page.value === 'editor' && activeToolId.value === toolId) { if (message) leaveToolFullscreen(); webToolError.value = message }
      },
    })
    if (executionRevision !== revision || page.value !== 'editor' || activeToolId.value !== toolId) return
    if (!officialBoxOfficeOpen.value && (tool.ui.fullscreen === true || readWebToolPresentation().defaultFullscreen)) pendingToolFullscreen = { tool: toolId, revision }
  } catch (error) {
    if (executionRevision === revision && page.value === 'editor' && activeToolId.value === toolId) webToolError.value = errorMessage(error)
  } finally {
    if (executionRevision === revision && activeToolId.value === toolId) {
      setWebToolLoading(false)
      if (pendingToolFullscreen) maybeEnterToolFullscreen()
      else void revealWebTool(toolId, revision)
    }
  }
}
watch([remoteMessagesOpen, showMobileSplash, shortcutOpening], maybeEnterToolFullscreen)

function beginFavoriteEditing() {
  if (allToolsActionBusy.value || savingFavorites.value) return
  selectedFavorites.value = store.favorites.filter((id) => store.tools.some((tool) => tool.id === id))
  favoriteEditing.value = true
}

function cancelFavoriteEditing() {
  if (savingFavorites.value) return
  favoriteEditing.value = false
  selectedFavorites.value = []
}

function toggleSelectedFavorite(toolId: string) {
  if (savingFavorites.value) return
  selectedFavorites.value = selectedFavorites.value.includes(toolId)
    ? selectedFavorites.value.filter((id) => id !== toolId)
    : [...selectedFavorites.value, toolId]
}

function invertFavoriteSelection() {
  if (savingFavorites.value) return
  const selected = new Set(selectedFavorites.value)
  selectedFavorites.value = store.tools.filter(tool => !selected.has(tool.id)).map(tool => tool.id)
}

async function saveFavorites() {
  if (savingFavorites.value || allToolsActionBusy.value) return
  savingFavorites.value = true
  let saved = false
  try {
    await store.replaceFavorites([...selectedFavorites.value])
    saved = true
  } catch (error) {
    notify(errorMessage(error))
  } finally {
    savingFavorites.value = false
  }
  if (saved) { cancelFavoriteEditing(); notify('收藏已保存') }
}

function toggleCategory(name: string) {
  expanded.value = expanded.value.includes(name)
    ? expanded.value.filter((item) => item !== name)
    : [...expanded.value, name]
}

function toggleManagerGroup(id: string) {
  managerExpanded.value = managerExpanded.value.includes(id)
    ? managerExpanded.value.filter((item) => item !== id) : [...managerExpanded.value, id]
}

function groupNameTaken(name: string, exceptId = ''): boolean {
  if (groupManagerTab.value === 'home' && name === '未分组' && exceptId !== HOME_OTHER_GROUP) return true
  if (groupManagerTab.value === 'favorites' && name === '未分组' && exceptId !== FAVORITE_UNGROUPED) return true
  if (groupManagerTab.value === 'websites' && name === '未分组' && exceptId !== WEBSITE_UNGROUPED) return true
  const groups = groupManagerTab.value === 'home' ? categories.value
    : groupManagerTab.value === 'favorites' ? favoriteCategories.value : websiteCategories.value
  return groups.some((group) => group.id !== exceptId && group.name.toLocaleLowerCase() === name.toLocaleLowerCase())
}

function createManagedGroup() {
  const name = newGroupName.value.trim()
  if (!name || name.length > 40) return
  if (groupNameTaken(name)) { groupCreateError.value = '已有同名分组，请换一个名称。'; return }
  const id = `${groupManagerTab.value === 'websites' ? 'website' : 'user'}:${crypto.randomUUID()}`
  if (groupManagerTab.value === 'home') {
    homeGroupSettings.value = { ...homeGroupSettings.value, custom: [...homeGroupSettings.value.custom, { id, name }] }
  } else if (groupManagerTab.value === 'favorites') {
    favoriteGroupSettings.value = { ...favoriteGroupSettings.value, enabled: true,
      groups: [...favoriteGroupSettings.value.groups, { id, name }] }
    expanded.value = [...new Set([...expanded.value, FAVORITE_UNGROUPED, id])]
  } else {
    websiteGroupSettings.value = { ...websiteGroupSettings.value, enabled: true,
      groups: [...websiteGroupSettings.value.groups, { id, name }] }
    expanded.value = [...new Set([...expanded.value, WEBSITE_UNGROUPED, id])]
  }
  managerExpanded.value = [...managerExpanded.value, id]
  newGroupName.value = ''
  groupManagerError.value = ''
  closeGroupCreateDialog()
}

function openGroupCreateDialog() {
  newGroupName.value = ''
  groupCreateError.value = ''
  groupCreateDialog.value?.showModal()
  updateNativeBack()
  groupCreateInput.value?.focus({ preventScroll: true })
}

function closeGroupCreateDialog() {
  if (groupCreateDialog.value?.open) groupCreateDialog.value.close()
  newGroupName.value = ''
  groupCreateError.value = ''
  updateNativeBack()
}

function beginGroupRename(id: string, name: string) {
  editingGroupId.value = id
  editingGroupName.value = name
  groupManagerError.value = ''
  if (!managerExpanded.value.includes(id)) managerExpanded.value = [...managerExpanded.value, id]
}

function saveGroupRename() {
  const id = editingGroupId.value
  const name = editingGroupName.value.trim()
  if (!id || !name || name.length > 40) return
  if (groupNameTaken(name, id)) { groupManagerError.value = '已有同名分组，请换一个名称。'; return }
  if (groupManagerTab.value === 'home') {
    homeGroupSettings.value = { ...homeGroupSettings.value,
      names: { ...homeGroupSettings.value.names, [id]: name },
      custom: homeGroupSettings.value.custom.map((group) => group.id === id ? { ...group, name } : group) }
  } else if (groupManagerTab.value === 'favorites') {
    favoriteGroupSettings.value = { ...favoriteGroupSettings.value,
      groups: favoriteGroupSettings.value.groups.map((group) => group.id === id ? { ...group, name } : group) }
  } else {
    websiteGroupSettings.value = { ...websiteGroupSettings.value,
      groups: websiteGroupSettings.value.groups.map((group) => group.id === id ? { ...group, name } : group) }
  }
  editingGroupId.value = ''
  editingGroupName.value = ''
  groupManagerError.value = ''
}

function assignHomeTool(toolId: string, groupId: string) {
  if (!store.tools.some((tool) => tool.id === toolId)
    || (groupId !== HOME_OTHER_GROUP && !categories.value.some((group) => group.id === groupId))) return
  homeGroupSettings.value = { ...homeGroupSettings.value,
    assignments: { ...homeGroupSettings.value.assignments, [toolId]: groupId } }
}

function addToolToManagedGroup(toolId: string, groupId: string) {
  if (!toolId) return
  if (groupManagerTab.value === 'home') assignHomeTool(toolId, groupId)
  else if (groupManagerTab.value === 'favorites') assignFavoriteTool(toolId, groupId)
}

function addWebsiteToManagedGroup(value: string, groupId: string) {
  const siteId = Number(value)
  if (siteId) assignWebsite(siteId, groupId)
}

function moveHomeToolToOther(toolId: string) {
  homeGroupSettings.value = { ...homeGroupSettings.value, otherCreated: true,
    assignments: { ...homeGroupSettings.value.assignments, [toolId]: HOME_OTHER_GROUP } }
}

async function deleteManagedGroup(id: string, name: string) {
  if (groupManagerTab.value === 'websites') {
    const count = websites.value.filter((site) => websiteGroupId(site.id) === id).length
    const message = count
      ? `删除「${name}」？其中 ${count} 个网站会移到「未分组」，书签本身不会删除。`
      : `删除空分组「${name}」？`
    if (!await confirmAction(message, '删除网站分组', '删除分组', true)) return
    const assignments = { ...websiteGroupSettings.value.assignments }
    for (const [siteId, groupId] of Object.entries(assignments)) if (groupId === id) delete assignments[siteId]
    websiteGroupSettings.value = { ...websiteGroupSettings.value,
      groups: websiteGroupSettings.value.groups.filter((group) => group.id !== id), assignments }
    websiteGroupOrder.value = websiteGroupOrder.value.filter((entry) => entry !== id)
    try { localStorage.setItem('firefly.order.websiteGroups.v1', JSON.stringify(websiteGroupOrder.value)) } catch { /* Keep this session's order. */ }
    expanded.value = expanded.value.filter((entry) => entry !== id)
    managerExpanded.value = managerExpanded.value.filter((entry) => entry !== id)
    if (editingGroupId.value === id) editingGroupId.value = ''
    groupManagerError.value = ''
    return
  }
  const favorite = groupManagerTab.value === 'favorites'
  const count = favorite
    ? store.favorites.filter((toolId) => favoriteGroupId(toolId) === id).length
    : store.allTools.filter((tool) => homeGroupId(tool) === id).length
  const destination = '未分组'
  const message = count
    ? `删除「${name}」？其中 ${count} 个工具会移到「${destination}」，工具本身不会删除。`
    : `删除空分组「${name}」？`
  if (!await confirmAction(message, '删除分组', '删除分组', true)) return
  if (favorite) {
    const assignments = { ...favoriteGroupSettings.value.assignments }
    for (const [toolId, groupId] of Object.entries(assignments)) if (groupId === id) delete assignments[toolId]
    favoriteGroupSettings.value = { ...favoriteGroupSettings.value,
      groups: favoriteGroupSettings.value.groups.filter((group) => group.id !== id), assignments }
    favoriteGroupOrder.value = favoriteGroupOrder.value.filter((entry) => entry !== id)
    try { localStorage.setItem('firefly.order.favoriteGroups.v1', JSON.stringify(favoriteGroupOrder.value)) } catch { /* Keep the session order. */ }
  } else {
    const assignments = { ...homeGroupSettings.value.assignments }
    for (const tool of store.allTools) if (homeGroupId(tool) === id) assignments[tool.id] = HOME_OTHER_GROUP
    const names = { ...homeGroupSettings.value.names }
    delete names[id]
    homeGroupSettings.value = { ...homeGroupSettings.value, names, assignments,
      custom: homeGroupSettings.value.custom.filter((group) => group.id !== id),
      deleted: id.startsWith('source:') ? [...homeGroupSettings.value.deleted, id] : homeGroupSettings.value.deleted,
      otherCreated: homeGroupSettings.value.otherCreated || count > 0 }
    categoryOrder.value = categoryOrder.value.filter((entry) => entry !== id)
    try { localStorage.setItem('firefly.order.categories.v1', JSON.stringify(categoryOrder.value)) } catch { /* Keep the session order. */ }
  }
  managerExpanded.value = managerExpanded.value.filter((entry) => entry !== id)
  if (editingGroupId.value === id) editingGroupId.value = ''
  groupManagerError.value = ''
}

function inputChanged() {
  cancelActiveModule()
  executionRevision++
  output.value = ''
  status.value = '输入已更新，请重新处理。'
  statusError.value = false
}

function chooseToolAction(actionId: string) {
  cancelActiveModule()
  executionRevision++
  toolAction.value = actionId
  output.value = ''
  status.value = '输入内容后选择操作。'
  statusError.value = false
  editorTab.value = 'input'
}

function loadSample() {
  input.value = '{"name":"流萤百宝箱","message":"飞萤扑火，向死而生。","local":true}'
  inputChanged()
}

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = String((error as ToolError).message)
    return page.value === 'moduleStudio' ? message.replaceAll('模块', '工具') : message
  }
  const message = typeof error === 'string' ? error : '操作失败，请重试。'
  return page.value === 'moduleStudio' ? message.replaceAll('模块', '工具') : message
}

async function format() {
  if ((!input.value && !canRunEmpty.value) || running.value) return
  const submitted = input.value
  const submittedToolId = activeToolId.value
  const submittedAction = toolAction.value
  const submittedRevision = executionRevision
  const runToken = ++activeRunToken
  const requestId = activeTool.value?.module_id || activeTool.value?.custom ? crypto.randomUUID() : undefined
  activeModuleRequestId = requestId ?? null
  running.value = true
  status.value = '正在处理…'
  statusError.value = false
  try {
    const result = await toolbox.runTool(submittedToolId, submittedAction, submitted, false, requestId)
    if (executionRevision !== submittedRevision || input.value !== submitted || activeToolId.value !== submittedToolId || toolAction.value !== submittedAction) return
    output.value = result
    status.value = '处理完成。'
    editorTab.value = 'output'
    if (usageStatsEnabled.value) void store.loadRecent().catch(() => {})
  } catch (error) {
    if (executionRevision !== submittedRevision || input.value !== submitted || activeToolId.value !== submittedToolId || toolAction.value !== submittedAction) return
    output.value = ''
    status.value = errorMessage(error)
    statusError.value = true
    editorTab.value = 'input'
  } finally {
    if (activeRunToken === runToken) {
      running.value = false
      activeModuleRequestId = null
    }
  }
}

function cancelActiveModule() {
  leaveToolFullscreen()
  if (modulePreviewOpen.value) closeModulePreview()
  stopBrowserModule()
  setWebToolLoading(false)
  if (!activeModuleRequestId) return
  const requestId = activeModuleRequestId
  activeModuleRequestId = null
  activeRunToken++
  executionRevision++
  running.value = false
  status.value = '工具执行已取消。'
  statusError.value = false
  void toolbox.cancelModuleRun(requestId).catch(() => {})
}

async function copyOutput() {
  if (!output.value) return
  try {
    await navigator.clipboard.writeText(output.value)
    notify('已复制结果')
  } catch {
    editorTab.value = 'output'
    await nextTick()
    outputBox.value?.focus()
    outputBox.value?.select()
    status.value = '复制权限不可用，结果已选中，请手动复制。'
  }
}

async function toggleFavorite(toolId = activeToolId.value) {
  try {
    await store.toggleFavorite(toolId)
    notify(store.favorites.includes(toolId) ? '已加入收藏' : '已取消收藏')
  } catch {
    notify('收藏更新失败，请重试。')
  }
}

function showDetection(value = '', results: DetectionResult[] = [], fromClipboard = false) {
  const origin = page.value
  if (origin === 'detection') return
  const savedEditor = origin === 'editor' ? { id: activeToolId.value, input: input.value, output: output.value, action: toolAction.value, status: running.value ? '工具执行已取消，请重新运行。' : status.value, statusError: statusError.value, tab: editorTab.value, previous: previousPage.value } : null
  const scroll = window.scrollY
  navigate('detection')
  if (page.value !== 'detection') { if (!fromClipboard) notify('当前操作尚未完成，请稍后再打开智能识别。'); return }
  detectionReturnEditor = savedEditor
  detectionReturnScroll = scroll
  onDetectionInput()
  detectValue.value = value
  detectResults.value = results
  detectMessage.value = results.length ? '发现可用的本地处理工具。' : ''
  detectedFromClipboard.value = fromClipboard
  void nextTick(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
    // Opening the page must not summon the phone keyboard before an input tap.
    document.getElementById('main-content')?.focus({ preventScroll: true })
    if (fromClipboard && results.length) revealDetectionResults()
  })
}

function openDetection() {
  if (page.value === 'detection') return
  showDetection()
}

function closeDetection() {
  if (page.value === 'detection') goBackStandalone()
}

function resetDetection() {
  detectValue.value = ''
  detectionReturnEditor = null
  onDetectionInput()
}

function cancelDetectionRequests() {
  detectionRevision++
  detecting.value = false
  detectionSelecting.value = false
  detectionPasting.value = false
  cancelClipboardCheck()
}

function onDetectionInput() {
  cancelDetectionRequests()
  detectResults.value = []
  detectMessage.value = ''
  detectionError.value = false
  detectedFromClipboard.value = false
}

function setDetectionValue(value: string) {
  onDetectionInput()
  detectValue.value = value
}

function revealDetectionResults() {
  const revision = detectionRevision
  void nextTick(() => {
    if (page.value !== 'detection' || revision !== detectionRevision) return
    const heading = document.getElementById('detection-results-title')
    heading?.focus({ preventScroll: true })
    if (window.matchMedia('(max-width: 900px)').matches) heading?.scrollIntoView({ block: 'start', behavior: 'instant' })
  })
}

async function pasteDetection() {
  if (detectionPasting.value || page.value !== 'detection') return
  cancelDetectionRequests()
  detectionPasting.value = true
  const revision = detectionRevision
  try {
    const value = isTauri() ? await readClipboardText() : await navigator.clipboard.readText()
    if (revision !== detectionRevision || page.value !== 'detection') return
    try { validateDetectionInput(value) }
    catch { notify('剪贴板文字超过 1 MiB，请精简内容后再试。'); return }
    if (!value.trim()) { notify('剪贴板里没有可识别的文字。'); return }
    setDetectionValue(value)
    detectedFromClipboard.value = true
    void detect()
  } catch {
    if (revision === detectionRevision && page.value === 'detection') notify('无法粘贴文字，请检查剪贴板权限及内容大小，或手动粘贴。')
  } finally { if (revision === detectionRevision) detectionPasting.value = false }
}

function clipboardDetectionAllowed() {
  return !appUnmounted && smartClipboardEnabled.value && !store.loadError && !toolSelectionBusy.value
    && startupReady.value && !showMobileSplash.value && !shortcutOpening.value && !appearanceImageLoading.value && !toolFullscreen.value && !repositoryBusy.value
    && document.visibilityState === 'visible' && document.hasFocus()
    && page.value !== 'detection' && !(page.value === 'editor' && previousPage.value === 'detection')
    && !searchOpen.value && !sidebarOpen.value && !document.querySelector('dialog[open]')
}
const clipboardDetection = createClipboardDetection({
  read: readClipboardText, detect: toolbox.detectText, canCheck: clipboardDetectionAllowed,
  show: (value, results) => showDetection(value, results, true),
})
function cancelClipboardCheck() {
  clearTimeout(clipboardCheckTimer)
  clipboardDetection.cancel()
}

function scheduleClipboardCheck() {
  cancelClipboardCheck()
  if (!store.loading && smartClipboardEnabled.value && document.visibilityState === 'visible' && document.hasFocus()) {
    clipboardCheckTimer = setTimeout(() => { void clipboardDetection.check() }, 250)
  }
}

watch(showMobileSplash, showing => { if (!showing) scheduleClipboardCheck() })
watch(() => JSON.stringify(store.tools.map(tool => [tool.id, tool.name, tool.ui_kind, tool.actions])), () => clipboardDetection.cancel(true))

function toggleSmartClipboard() {
  smartClipboardEnabled.value = !smartClipboardEnabled.value
  cancelClipboardCheck()
  clipboardDetection.cancel(true)
  try { localStorage.setItem(SMART_CLIPBOARD_KEY, String(smartClipboardEnabled.value)) }
  catch { notify('智能识别开关已应用，但设置未能保存到本机。') }
  if (smartClipboardEnabled.value) scheduleClipboardCheck()
}

function toggleUsageStats() {
  usageStatsEnabled.value = !usageStatsEnabled.value
  try { localStorage.setItem(USAGE_STATS_KEY, String(usageStatsEnabled.value)) } catch { /* Keep this session's choice. */ }
}

function refreshMoreSettings() {
  const saved = readPreference(START_PAGE_KEY)
  startPage.value = saved === 'favorites' || saved === 'websites' ? saved : 'home'
  autoHideBars.value = readPreference(AUTO_HIDE_BARS_KEY) !== 'false'
  smartClipboardEnabled.value = readPreference(SMART_CLIPBOARD_KEY) === 'true'
  usageStatsEnabled.value = readPreference(USAGE_STATS_KEY) === 'true'
  componentTransparency.value = readNumberPreference(COMPONENT_TRANSPARENCY_KEY, 40, 0, 80)
  appFontSize.value = readNumberPreference(APP_FONT_SIZE_KEY, readNumberPreference(HOME_FONT_SIZE_KEY, 100, 85, 125), 85, 125)
  cardGap.value = readNumberPreference(CARD_GAP_KEY, readNumberPreference(LEGACY_HOME_CARD_GAP_KEY, 10, 6, 22), 6, 22)
  startPageOptionsOpen.value = false
  desktopCloseOptionsOpen.value = false
  setBarsHidden(false)
  tabScrollDistance = 0
  cancelClipboardCheck()
  clipboardDetection.cancel(true)
  webToolSettingsRevision.value++
}

async function resetSettings() {
  if (toolSelectionBusy.value || desktopCloseBusy.value || desktopAutostartBusy.value) return
  settingsResetPending.value = true
  try {
    const message = '将“更多设置”中的基础设置、外观设置和网页工具设置恢复为初始值。'
      + (isWindowsApp ? '关闭应用时恢复为最小化到托盘，并关闭开机自启。' : '')
      + '\n\n缓存、最近使用记录，以及工具、收藏、网站、分组、主题和图片设置都会保留。'
    if (!await confirmAction(message, '重置设置', '确认重置', true)) return
    settingsResetBusy.value = true
    await resetMoreSettings(isWindowsApp ? {
      read: async () => {
        const [closeBehavior, autostart] = await Promise.all([
          invoke<'tray' | 'exit'>('desktop_close_behavior'), invoke<boolean>('desktop_autostart_enabled'),
        ])
        if (closeBehavior !== 'tray' && closeBehavior !== 'exit' || typeof autostart !== 'boolean') throw new Error('无法读取 Windows 设置，请稍后重试。')
        return { closeBehavior, autostart }
      },
      setCloseBehavior: behavior => invoke<void>('set_desktop_close_behavior', { behavior }),
      setAutostart: enabled => invoke<void>('set_desktop_autostart', { enabled }),
    } : undefined)
    refreshMoreSettings()
    if (isWindowsApp) { desktopCloseBehavior.value = 'tray'; desktopAutostartEnabled.value = false; desktopCloseReady.value = true; desktopAutostartReady.value = true }
    notify('“更多设置”已恢复初始状态。')
  } catch (error) {
    refreshMoreSettings()
    if (isWindowsApp) {
      const [close, autostart] = await Promise.allSettled([invoke<'tray' | 'exit'>('desktop_close_behavior'), invoke<boolean>('desktop_autostart_enabled')])
      if (close.status === 'fulfilled') desktopCloseBehavior.value = close.value
      if (autostart.status === 'fulfilled') desktopAutostartEnabled.value = autostart.value
    }
    notify(`重置设置失败：${errorMessage(error)}`)
  } finally { settingsResetPending.value = false; settingsResetBusy.value = false }
}

async function clearRecentTools() {
  try {
    await store.clearRecent()
    notify('最近使用已清空')
  } catch {
    notify('无法清空最近使用。')
  }
}

function stopActiveWebTool() {
  leaveToolFullscreen()
  executionRevision++
  stopBrowserModule()
  setWebToolLoading(false)
  webToolStopped.value = true
  webToolFileStatus.value = webToolFileStatus.value.busy ? stoppedWebFileStatus(webToolFileStatus.value)
    : { busy: false, message: '网页工具已停止。' }
}

function restartActiveWebTool() {
  executionRevision++
  stopBrowserModule()
  void startWebTool(activeToolId.value, executionRevision)
}

function cancelWebToolFiles() { cancelWebToolFileOperations() }

function openToolAuthorSkill() {
  const origin = page.value
  if (origin === 'toolAuthorSkill') return
  toolAuthorSkillReturnScroll = window.scrollY
  navigate('toolAuthorSkill')
  if (page.value !== 'toolAuthorSkill') return
  void nextTick(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
    document.getElementById('main-content')?.focus({ preventScroll: true })
  })
  void loadToolAuthorSkill()
}

async function loadToolAuthorSkill() {
  if (toolAuthorSkillHtml.value || toolAuthorSkillLoading.value) return
  toolAuthorSkillLoading.value = true
  toolAuthorSkillError.value = ''
  try {
    const { default: MarkdownIt } = await import('markdown-it')
    const previewSource = toolAuthorSkill.replace(/\r\n/g, '\n')
      .replace(/^---\n([\s\S]*?)\n---\n/, (_block, metadata: string) => '```yaml\n' + metadata + '\n```\n')
    toolAuthorSkillHtml.value = new MarkdownIt({ html: false, linkify: false }).render(previewSource)
  } catch { toolAuthorSkillError.value = '无法加载工具编写指南，请稍后重试。' }
  finally { toolAuthorSkillLoading.value = false }
}

async function copyToolAuthorSkill() {
  try {
    if (isTauri()) await writeClipboardText(toolAuthorSkill)
    else await navigator.clipboard.writeText(toolAuthorSkill)
  } catch {
    try { await navigator.clipboard.writeText(toolAuthorSkill) }
    catch {
      notify('复制失败，请稍后重试。')
      return
    }
  }
  notify('已复制 SKILL 全文。')
}

async function openModuleStudio() {
  if (!supportsJsModules) return
  clearTimeout(moduleSwipeTimer)
  moduleStudioTab.value = 'import'
  moduleSwipeOffset.value = 0
  moduleSwipeSettling.value = false
  moduleSwipeNeighbor.value = null
  moduleStudioIndicatorStyle.value = { transform: 'translateX(0px)', width: '0px', opacity: '0' }
  moduleIconMenuOpen.value = false
  moduleDetailsRequest++
  selectedStudioItem.value = null
  selectedModuleDetails.value = null
  moduleMetadataEditing.value = false
  moduleSourceEditing.value = false
  moduleStudioError.value = ''
  moduleStudioNotice.value = ''
  moduleError.value = ''
  moduleImports.clear()
  moduleLoading.value = true
  navigate('moduleStudio')
  try {
    modules.value = await toolbox.listModules()
    ensureStudioSelection()
  }
  catch (error) { moduleStudioError.value = errorMessage(error) }
  finally { moduleLoading.value = false }
}

function setModuleStudioTab(tab: ModuleStudioTab) {
  if (moduleStudioTab.value === tab) return
  moduleFileDragging.value = false
  if (moduleStudioTab.value === 'create') closeModulePreview()
  moduleTabsSwiping.value = false
  moduleSwipeNeighbor.value = moduleStudioTab.value
  moduleSwipeSettling.value = true
  moduleSwipeOffset.value = 0
  moduleIconMenuOpen.value = false
  moduleStudioTab.value = tab
  if (tab === 'create' && moduleDraftSaveNotice.value === '已恢复本机草稿。') notify(moduleDraftSaveNotice.value)
  clearTimeout(moduleSwipeTimer)
  moduleSwipeTimer = setTimeout(() => { moduleSwipeSettling.value = false; moduleSwipeNeighbor.value = null }, 260)
  moduleStudioError.value = ''
  window.scrollTo({ top: 0, behavior: 'auto' })
  nextTick(() => {
    const button = document.querySelector<HTMLElement>(`[data-studio-tab="${tab}"]`)
    const tabs = button?.closest<HTMLElement>('.module-studio-tab-scroll')
    if (!button || !tabs) return
    const buttonBounds = button.getBoundingClientRect()
    const tabBounds = tabs.getBoundingClientRect()
    tabs.scrollBy({ left: buttonBounds.left - tabBounds.left - (tabBounds.width - buttonBounds.width) / 2, behavior: 'smooth' })
  })
}

function updateModuleStudioIndicator() {
  if (page.value !== 'moduleStudio') return
  const tabs = document.querySelector<HTMLElement>('.module-studio-tabs')
  if (!tabs) return
  if (observedStudioTabs !== tabs) {
    studioTabsResizeObserver?.disconnect()
    observedStudioTabs = tabs
    studioTabsResizeObserver = new ResizeObserver(updateModuleStudioIndicator)
    studioTabsResizeObserver.observe(tabs)
    tabs.querySelectorAll('button[data-studio-tab]').forEach((button) => studioTabsResizeObserver?.observe(button))
  }
  const button = tabs.querySelector<HTMLElement>(`[data-studio-tab="${moduleStudioTab.value}"]`)
  if (!button) return
  const buttonBounds = button.getBoundingClientRect()
  const tabBounds = tabs.getBoundingClientRect()
  moduleStudioIndicatorStyle.value = {
    transform: `translateX(${buttonBounds.left - tabBounds.left + 12}px)`,
    width: `${Math.max(0, buttonBounds.width - 24)}px`,
    opacity: '1',
  }
}

function onModuleStudioTabsScroll() {
  moduleTabsScrolling.value = true
  updateModuleStudioIndicator()
  clearTimeout(moduleTabScrollTimer)
  moduleTabScrollTimer = setTimeout(() => { moduleTabsScrolling.value = false }, 100)
}

watch([page, moduleStudioTab], async () => {
  if (page.value !== 'moduleStudio') {
    studioTabsResizeObserver?.disconnect()
    observedStudioTabs = null
    return
  }
  await nextTick()
  updateModuleStudioIndicator()
}, { flush: 'post' })

function setGroupManagerTab(tab: GroupManagerTab) {
  if (groupManagerTab.value === tab) return
  groupTabsSwiping.value = false
  cancelLongSwap()
  groupSwipeNeighbor.value = groupManagerTab.value
  groupSwipeSettling.value = true
  groupSwipeOffset.value = 0
  groupManagerTab.value = tab
  clearTimeout(groupSwipeTimer)
  groupSwipeTimer = setTimeout(() => { groupSwipeSettling.value = false; groupSwipeNeighbor.value = null }, 260)
  newGroupName.value = ''
  editingGroupId.value = ''
  groupManagerError.value = ''
  window.scrollTo({ top: 0, behavior: 'auto' })
  nextTick(() => {
    const button = document.querySelector<HTMLElement>(`[data-group-tab="${tab}"]`)
    const tabs = button?.closest<HTMLElement>('.module-studio-tab-scroll')
    if (!button || !tabs) return
    const buttonBounds = button.getBoundingClientRect()
    const tabBounds = tabs.getBoundingClientRect()
    tabs.scrollBy({ left: buttonBounds.left - tabBounds.left - (tabBounds.width - buttonBounds.width) / 2, behavior: 'smooth' })
  })
}

function updateGroupManagerIndicator() {
  if (page.value !== 'groupManager') return
  const tabs = document.querySelector<HTMLElement>('.group-manager-tabs')
  if (!tabs) return
  if (observedGroupManagerTabs !== tabs) {
    groupManagerResizeObserver?.disconnect()
    observedGroupManagerTabs = tabs
    groupManagerResizeObserver = new ResizeObserver(updateGroupManagerIndicator)
    groupManagerResizeObserver.observe(tabs)
    tabs.querySelectorAll('button[data-group-tab]').forEach((button) => groupManagerResizeObserver?.observe(button))
  }
  const button = tabs.querySelector<HTMLElement>(`[data-group-tab="${groupManagerTab.value}"]`)
  if (!button) return
  const buttonBounds = button.getBoundingClientRect()
  const tabBounds = tabs.getBoundingClientRect()
  groupManagerIndicatorStyle.value = {
    transform: `translateX(${buttonBounds.left - tabBounds.left + 12}px)`,
    width: `${Math.max(0, buttonBounds.width - 24)}px`, opacity: '1',
  }
}

function onGroupManagerTabsScroll() {
  groupTabsScrolling.value = true
  updateGroupManagerIndicator()
  clearTimeout(groupTabScrollTimer)
  groupTabScrollTimer = setTimeout(() => { groupTabsScrolling.value = false }, 100)
}

watch([page, groupManagerTab], async () => {
  if (page.value !== 'groupManager') {
    groupManagerResizeObserver?.disconnect()
    observedGroupManagerTabs = null
    return
  }
  await nextTick()
  updateGroupManagerIndicator()
}, { flush: 'post' })

function onGroupManagerTabKeydown(event: KeyboardEvent, index: number) {
  const nextIndex = event.key === 'ArrowRight' ? Math.min(index + 1, groupManagerTabs.length - 1)
    : event.key === 'ArrowLeft' ? Math.max(index - 1, 0)
      : event.key === 'Home' ? 0 : event.key === 'End' ? groupManagerTabs.length - 1 : -1
  if (nextIndex < 0) return
  event.preventDefault()
  const tab = groupManagerTabs[nextIndex]!
  setGroupManagerTab(tab.id)
  nextTick(() => document.querySelector<HTMLElement>(`[data-group-tab="${tab.id}"]`)?.focus())
}

function swipeIndicatorStyle(container: string, attribute: string, currentId: string, nextId: string, progress: number) {
  const tabs = document.querySelector<HTMLElement>(container)
  const current = tabs?.querySelector<HTMLElement>(`[${attribute}="${currentId}"]`)
  const next = tabs?.querySelector<HTMLElement>(`[${attribute}="${nextId}"]`)
  if (!tabs || !current || !next) return null
  const tabsBounds = tabs.getBoundingClientRect()
  const currentBounds = current.getBoundingClientRect()
  const nextBounds = next.getBoundingClientRect()
  const start = currentBounds.left - tabsBounds.left + 12
  const end = nextBounds.left - tabsBounds.left + 12
  const startWidth = Math.max(0, currentBounds.width - 24)
  const endWidth = Math.max(0, nextBounds.width - 24)
  return {
    transform: `translateX(${start + (end - start) * progress}px)`,
    width: `${startWidth + (endWidth - startWidth) * progress}px`,
    opacity: '1',
  }
}

function swipePanelBetween<T extends string>(tabs: { id: T }[], current: T, neighbor: T | null, id: T): boolean {
  if (!neighbor) return false
  const currentIndex = tabs.findIndex((tab) => tab.id === current)
  const neighborIndex = tabs.findIndex((tab) => tab.id === neighbor)
  const index = tabs.findIndex((tab) => tab.id === id)
  return index >= Math.min(currentIndex, neighborIndex) && index <= Math.max(currentIndex, neighborIndex)
}

let groupManagerSwipeStart: { x: number; y: number; time: number; axis?: 'horizontal' | 'vertical' } | null = null
function onGroupManagerTouchStart(event: TouchEvent) {
  const target = event.target as Element | null
  if (event.touches.length !== 1 || !isMobileLayout() || groupSwipeSettling.value || target?.closest('input, textarea, select, a, [contenteditable], .module-studio-tabs')) {
    groupManagerSwipeStart = null
    return
  }
  const touch = event.touches[0]
  groupManagerSwipeStart = touch ? { x: touch.clientX, y: touch.clientY, time: performance.now() } : null
}
function onGroupManagerTouchMove(event: TouchEvent) {
  const start = groupManagerSwipeStart
  if (event.touches.length !== 1) return onGroupManagerTouchCancel()
  const touch = event.touches[0]
  if (!start || !touch) return
  if (activeSwap.value || performance.now() < suppressPageSwipeUntil) {
    onGroupManagerTouchCancel()
    return
  }
  const dx = touch.clientX - start.x
  const dy = touch.clientY - start.y
  if (!start.axis && Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.1) start.axis = 'horizontal'
  else if (!start.axis && Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx) * 1.1) start.axis = 'vertical'
  if (start.axis !== 'horizontal') return
  const index = groupManagerTabs.findIndex((tab) => tab.id === groupManagerTab.value)
  const next = groupManagerTabs[index + (dx < 0 ? 1 : -1)]
  groupSwipeNeighbor.value = next?.id ?? null
  groupSwipeOffset.value = next ? dx : Math.sign(dx) * Math.min(Math.abs(dx) * .18, 22)
  if (next) {
    const width = groupSwipeViewport.value?.clientWidth ?? window.innerWidth
    const style = swipeIndicatorStyle('.group-manager-tabs', 'data-group-tab', groupManagerTab.value, next.id, Math.min(1, Math.abs(dx) / width))
    if (style) { groupTabsSwiping.value = true; groupManagerIndicatorStyle.value = style }
  }
  if (event.cancelable) event.preventDefault()
}
function onGroupManagerTouchEnd(event: TouchEvent) {
  if (event.touches.length) return onGroupManagerTouchCancel()
  const start = groupManagerSwipeStart
  groupManagerSwipeStart = null
  const touch = event.changedTouches[0]
  if (!start || !touch || start.axis !== 'horizontal') return
  const dx = touch.clientX - start.x
  groupTabsSwiping.value = false
  if (performance.now() < suppressPageSwipeUntil || activeSwap.value) return onGroupManagerTouchCancel()
  const width = groupSwipeViewport.value?.clientWidth ?? window.innerWidth
  const shouldSwitch = Math.abs(dx) >= Math.min(width * .23, 110) || (Math.abs(dx) >= 45 && performance.now() - start.time < 280)
  const index = groupManagerTabs.findIndex((tab) => tab.id === groupManagerTab.value)
  const next = groupManagerTabs[index + (dx < 0 ? 1 : -1)]
  if (event.cancelable) event.preventDefault()
  if (shouldSwitch && next) setGroupManagerTab(next.id)
  else onGroupManagerTouchCancel()
}

function onGroupManagerTouchCancel() {
  groupManagerSwipeStart = null
  groupTabsSwiping.value = false
  if (groupSwipeOffset.value) {
    groupSwipeSettling.value = true
    groupSwipeOffset.value = 0
    clearTimeout(groupSwipeTimer)
    groupSwipeTimer = setTimeout(() => { groupSwipeSettling.value = false; groupSwipeNeighbor.value = null }, 260)
  }
  updateGroupManagerIndicator()
}

function onModuleStudioTabKeydown(event: KeyboardEvent, index: number) {
  const nextIndex = event.key === 'ArrowRight' ? Math.min(index + 1, moduleStudioTabs.length - 1)
    : event.key === 'ArrowLeft' ? Math.max(index - 1, 0)
      : event.key === 'Home' ? 0 : event.key === 'End' ? moduleStudioTabs.length - 1 : -1
  if (nextIndex < 0) return
  event.preventDefault()
  const nextTab = moduleStudioTabs[nextIndex]!
  setModuleStudioTab(nextTab.id)
  nextTick(() => document.querySelector<HTMLElement>(`[data-studio-tab="${nextTab.id}"]`)?.focus())
}

function onModuleStudioTouchStart(event: TouchEvent) {
  const target = event.target as Element | null
  if (event.touches.length !== 1 || !isMobileLayout() || moduleSwipeSettling.value || target?.closest('input, textarea, select, a, [contenteditable], pre, .module-studio-tabs')) {
    moduleSwipeStart = null
    return
  }
  const touch = event.touches[0]
  moduleSwipeStart = touch ? { x: touch.clientX, y: touch.clientY, time: performance.now() } : null
}

function onModuleStudioTouchMove(event: TouchEvent) {
  const start = moduleSwipeStart
  if (event.touches.length !== 1) return onModuleStudioTouchCancel()
  const touch = event.touches[0]
  if (!start || !touch) return
  const dx = touch.clientX - start.x
  const dy = touch.clientY - start.y
  if (!start.axis && Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.1) start.axis = 'horizontal'
  else if (!start.axis && Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx) * 1.1) start.axis = 'vertical'
  if (start.axis !== 'horizontal') return
  const index = moduleStudioTabs.findIndex((tab) => tab.id === moduleStudioTab.value)
  const next = moduleStudioTabs[index + (dx < 0 ? 1 : -1)]
  moduleSwipeNeighbor.value = next?.id ?? null
  moduleSwipeOffset.value = next ? dx : Math.sign(dx) * Math.min(Math.abs(dx) * .18, 22)
  if (next) {
    const width = moduleSwipeViewport.value?.clientWidth ?? window.innerWidth
    const style = swipeIndicatorStyle('.module-studio-tabs', 'data-studio-tab', moduleStudioTab.value, next.id, Math.min(1, Math.abs(dx) / width))
    if (style) { moduleTabsSwiping.value = true; moduleStudioIndicatorStyle.value = style }
  }
  if (event.cancelable) event.preventDefault()
}

function onModuleStudioTouchEnd(event: TouchEvent) {
  if (event.touches.length) return onModuleStudioTouchCancel()
  const start = moduleSwipeStart
  moduleSwipeStart = null
  const touch = event.changedTouches[0]
  if (!start || !touch || start.axis !== 'horizontal') return
  const dx = touch.clientX - start.x
  moduleTabsSwiping.value = false
  const width = moduleSwipeViewport.value?.clientWidth ?? window.innerWidth
  const shouldSwitch = Math.abs(dx) >= Math.min(width * .23, 110) || (Math.abs(dx) >= 45 && performance.now() - start.time < 280)
  const index = moduleStudioTabs.findIndex((tab) => tab.id === moduleStudioTab.value)
  const next = moduleStudioTabs[index + (dx < 0 ? 1 : -1)]
  if (event.cancelable) event.preventDefault()
  if (shouldSwitch && next) setModuleStudioTab(next.id)
  else onModuleStudioTouchCancel()
}

function onModuleStudioTouchCancel() {
  moduleSwipeStart = null
  moduleTabsSwiping.value = false
  if (moduleSwipeOffset.value) {
    moduleSwipeSettling.value = true
    moduleSwipeOffset.value = 0
    clearTimeout(moduleSwipeTimer)
    moduleSwipeTimer = setTimeout(() => { moduleSwipeSettling.value = false; moduleSwipeNeighbor.value = null }, 260)
  }
  updateModuleStudioIndicator()
}

function onStudioTouchStart(event: TouchEvent) {
  if (page.value === 'groupManager') onGroupManagerTouchStart(event)
  else if (page.value === 'moduleStudio') onModuleStudioTouchStart(event)
}

function onStudioTouchMove(event: TouchEvent) {
  if (page.value === 'groupManager') onGroupManagerTouchMove(event)
  else if (page.value === 'moduleStudio') onModuleStudioTouchMove(event)
}

function onStudioTouchEnd(event: TouchEvent) {
  if (page.value === 'groupManager') onGroupManagerTouchEnd(event)
  else if (page.value === 'moduleStudio') onModuleStudioTouchEnd(event)
}

function onStudioTouchCancel() {
  if (page.value === 'groupManager') onGroupManagerTouchCancel()
  else if (page.value === 'moduleStudio') onModuleStudioTouchCancel()
}

function revealStudioDetail() {
  if (moduleStudioTab.value !== 'installed' || window.innerWidth > 900) return
  nextTick(() => document.querySelector<HTMLElement>('.module-studio-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
}

function ensureStudioSelection() {
  const selected = selectedStudioItem.value
  if (!selected) return
  const stillAvailable = selected.kind === 'module'
    ? modules.value.some((item) => item.module_id === selected.id)
    : filteredBuiltInStudioTools.value.some((tool) => tool.module_id === selected.id)
  if (stillAvailable) return
  moduleDetailsRequest++
  selectedStudioItem.value = null
  selectedModuleDetails.value = null
}

function setStudioLibraryGroup(group: 'builtin' | 'module') {
  if (studioLibraryGroup.value === group) return
  moduleDetailsRequest++
  studioLibraryGroup.value = group
  selectedStudioItem.value = null
  selectedModuleDetails.value = null
  moduleDetailsLoading.value = false
  moduleMetadataEditing.value = false
  moduleSourceEditing.value = false
  moduleStudioError.value = ''
  moduleStudioNotice.value = ''
}

async function selectStudioItem(item: StudioItem) {
  const request = ++moduleDetailsRequest
  studioLibraryGroup.value = item.kind
  selectedStudioItem.value = item
  selectedModuleDetails.value = null
  moduleDetailsLoading.value = false
  moduleMetadataEditing.value = false
  moduleMetadataDraft.value = null
  moduleSourceEditing.value = false
  moduleStudioError.value = ''
  moduleStudioNotice.value = ''
  revealStudioDetail()
  moduleDetailsLoading.value = true
  try {
    const details = await toolbox.getModuleDetails(item.id)
    if (request === moduleDetailsRequest) selectedModuleDetails.value = details
  } catch (error) {
    if (request === moduleDetailsRequest) moduleStudioError.value = errorMessage(error)
  } finally {
    if (request === moduleDetailsRequest) moduleDetailsLoading.value = false
  }
}

async function refreshSelectedModule(moduleId: string): Promise<boolean> {
  const request = moduleDetailsRequest
  if (selectedStudioItem.value?.id !== moduleId) return false
  const details = await toolbox.getModuleDetails(moduleId)
  if (request !== moduleDetailsRequest || selectedStudioItem.value?.id !== moduleId) return false
  selectedModuleDetails.value = details
  return true
}

function beginModuleMetadataEdit() {
  const details = selectedModuleDetails.value
  if (!details) return
  const manifest = details.manifest
  const knownLicense = moduleLicenseOptions.some((option) => option.id === manifest.license)
  moduleMetadataDraft.value = {
    name: moduleDisplayName(manifest.name), version: manifest.version, author: manifest.author,
    license: knownLicense ? manifest.license : 'custom', customLicense: knownLicense ? '' : manifest.license,
    tools: manifest.tools.map((tool) => ({
      name: moduleDisplayName(tool.name), description: moduleDisplayName(tool.description), category: tool.category,
    })),
  }
  moduleMetadataEditing.value = true
}

async function saveModuleMetadata() {
  const details = selectedModuleDetails.value
  const draft = moduleMetadataDraft.value
  if (!details || !draft || moduleStudioBusy.value) return
  moduleStudioBusy.value = true
  moduleStudioError.value = ''
  moduleStudioNotice.value = ''
  try {
    const manifest = structuredClone(details.manifest)
    manifest.name['zh-CN'] = draft.name.trim()
    manifest.version = draft.version.trim()
    manifest.author = draft.author.trim()
    manifest.license = draft.license === 'custom' ? draft.customLicense.trim() : draft.license
    for (const [index, tool] of manifest.tools.entries()) {
      const changed = draft.tools[index]!
      tool.name['zh-CN'] = changed.name.trim()
      tool.description['zh-CN'] = changed.description.trim()
      tool.category = changed.category.trim()
    }
    const installed = await toolbox.installModuleDraft(manifest, details.scripts, details.manifest.module_id)
    modules.value = await toolbox.listModules()
    await store.refresh()
    const stillSelected = await refreshSelectedModule(installed.module_id)
    if (loadedModuleManifest.value?.module_id === manifest.module_id) {
      loadedModuleManifest.value = manifest
      moduleDraft.value.name = draft.name.trim()
      moduleDraft.value.version = draft.version.trim()
      moduleDraft.value.author = draft.author.trim()
      moduleDraft.value.license = draft.license
      moduleDraft.value.customLicense = draft.customLicense
      if (draft.tools[0]) {
        moduleDraft.value.toolName = draft.tools[0].name.trim()
        moduleDraft.value.description = draft.tools[0].description.trim()
        moduleDraft.value.category = draft.tools[0].category.trim()
      }
    }
    if (stillSelected) moduleMetadataEditing.value = false
    moduleStudioNotice.value = `已保存「${installed.name}」的信息。`
  } catch (error) { moduleStudioError.value = errorMessage(error) }
  finally { moduleStudioBusy.value = false }
}

async function onModuleSourceSaved(installed: ModuleSummary) {
  try {
    modules.value = await toolbox.listModules()
    await store.refresh()
    if (await refreshSelectedModule(installed.module_id)) {
      moduleSourceEditing.value = false
    }
    if (loadedModuleManifest.value?.module_id === installed.module_id) resetModuleDraft()
    notify(`已保存「${installed.name}」的源码`)
  } catch (error) { notify(errorMessage(error)) }
}

async function restoreBuiltinModule(item: ModuleSummary) {
  if (!item.builtin || moduleStudioBusy.value || moduleBusy.value) return
  if (!await confirmAction(`恢复「${item.name}」的默认信息与源码？当前修改会被替换，已有收藏会保留。`, '恢复默认', '恢复默认', true)) return
  moduleStudioBusy.value = true
  moduleStudioError.value = ''
  try {
    await toolbox.resetBuiltinModule(item.module_id)
    modules.value = await toolbox.listModules()
    await store.refresh()
    if (await refreshSelectedModule(item.module_id)) {
      moduleMetadataEditing.value = false
      moduleSourceEditing.value = false
    }
    notify('已恢复工具的默认信息与源码')
  } catch (error) { moduleStudioError.value = errorMessage(error) }
  finally { moduleStudioBusy.value = false }
}

async function deleteInstalledTool(moduleId: string, toolId: string, toolName: string) {
  if (moduleStudioBusy.value || moduleBusy.value) return
  const current = modules.value.find((item) => item.module_id === moduleId)
  const details = selectedModuleDetails.value
  if (!current || current.builtin || details?.manifest.module_id !== moduleId
    || !details.manifest.tools.some((tool) => tool.id === toolId)) return
  const lastTool = details.manifest.tools.length === 1
  const message = lastTool
    ? `删除「${toolName}」会卸载整个「${current.name}」工具，并清除相关收藏。此操作无法撤销，确定继续？`
    : `从「${current.name}」中删除「${toolName}」？该工具及相关收藏会从本机移除。此操作无法撤销。`
  if (!await confirmAction(message, '删除工具', '删除工具', true)) return
  moduleStudioBusy.value = true
  moduleStudioError.value = ''
  moduleStudioNotice.value = ''
  try {
    await toolbox.deleteModuleTool(moduleId, toolId)
    modules.value = await toolbox.listModules()
    await store.refresh()
    if (loadedModuleManifest.value?.module_id === moduleId) resetModuleDraft()
    if (lastTool) ensureStudioSelection()
    else await selectStudioItem({ kind: 'module', id: moduleId })
    moduleStudioNotice.value = lastTool ? `已删除「${toolName}」并卸载工具。` : `已从工具中删除「${toolName}」。`
  } catch (error) { moduleStudioError.value = errorMessage(error) }
  finally { moduleStudioBusy.value = false }
}

function resetModuleDraft() {
  closeModulePreview()
  if (moduleDraft.value.resourceDraftId) void toolbox.discardModuleResources(moduleDraft.value.resourceDraftId).catch(()=>{})
  moduleDraft.value = {...emptyModuleDraft(),resourceDraftId:crypto.randomUUID()}
  creatorModeContents.value = {}
  moduleTemplateId.value = ''
  moduleScriptIndex.value = 0
  moduleAdvancedOpen.value = false
  moduleIconMenuOpen.value = false
  loadedModuleManifest.value = null
  moduleStudioError.value = ''
  moduleStudioNotice.value = ''
}

async function newModuleDraft() {
  if ((moduleDraft.value.toolName || loadedModuleManifest.value
    || moduleDraft.value.scripts.some((file, index) => file.source !== templateContent('text-blank').scripts[index]?.source))
    && !await confirmAction('新建工具会替换当前草稿，确定继续？', '新建工具', '新建工具')) return
  resetModuleDraft()
}

function setModuleCreationType(kind: ToolKind) {
  if (moduleStudioBusy.value || moduleCreationType.value === kind) return
  closeModulePreview()
  creatorModeContents.value[moduleCreationType.value] = copyToolContent(moduleDraft.value)
  const content = creatorModeContents.value[kind] ?? templateContent(kind === 'web' ? 'web-blank' : 'text-blank')
  Object.assign(moduleDraft.value, copyToolContent(content))
  if (!moduleDraft.value.toolName && ['文本处理', '自定义工具'].includes(moduleDraft.value.category)) {
    moduleDraft.value.category = kind === 'web' ? '自定义工具' : '文本处理'
  }
  moduleTemplateId.value = ''
  moduleScriptIndex.value = 0
  moduleStudioError.value = ''
}

async function applyModuleTemplate() {
  const template = moduleCreationTemplates.value.find(template => template.id === moduleTemplateId.value)
  if (!template || moduleStudioBusy.value) return
  const blank = templateContent(moduleCreationType.value === 'web' ? 'web-blank' : 'text-blank')
  const changed = loadedModuleManifest.value
    || moduleDraft.value.entry !== blank.entry || moduleDraft.value.scripts.length !== blank.scripts.length
    || moduleDraft.value.scripts.some((file, index) => file.path !== blank.scripts[index]?.path || file.source !== blank.scripts[index]?.source)
  if (changed && !await confirmAction(`使用「${template.name}」会替换当前类型的源码，工具名称和其他类型的草稿会保留。`, '使用模板', '使用模板')) return
  closeModulePreview()
  const { timeoutSeconds, networkHosts } = moduleDraft.value
  Object.assign(moduleDraft.value, templateContent(template.id))
  moduleDraft.value.timeoutSeconds = timeoutSeconds
  moduleDraft.value.networkHosts = networkHosts
  moduleScriptIndex.value = 0
  if (!moduleDraft.value.toolName) moduleCreationName.value = template.name
  if (!moduleDraft.value.description) moduleDraft.value.description = template.description
  moduleStudioNotice.value = `已应用「${template.name}」，可以修改代码后预览。`
}

function moduleScriptLabel(path: string): string {
  if (path.endsWith('.html')) return 'HTML'
  if (path.endsWith('.css')) return 'CSS'
  return moduleDraft.value.scripts.filter(file => file.path.endsWith('.js')).length > 1 ? path || 'JavaScript' : 'JavaScript'
}

function persistModuleDraft() {
  clearTimeout(moduleDraftSaveTimer)
  try {
    const contents = { ...creatorModeContents.value, [moduleCreationType.value]: copyToolContent(moduleDraft.value) }
    const json = JSON.stringify({ schema_version: 1, draft: moduleDraft.value, contents, manifest: loadedModuleManifest.value })
    if (json.length > TOOL_WORKSPACE_MAX_CHARS) throw new Error('草稿过大')
    localStorage.setItem(TOOL_DRAFT_KEY, json)
    moduleDraftSaveNotice.value = '草稿已保存在本机。'
  } catch { moduleDraftSaveNotice.value = '草稿暂未保存到本机，请及时导出工具包。' }
}

function moduleDisplayName(values: Record<string, string>): string {
  return values['zh-CN'] ?? values.en ?? Object.values(values)[0] ?? ''
}

async function loadModuleForEditing(moduleId: string) {
  if (moduleStudioBusy.value) return
  if (moduleDraft.value.toolName && !await confirmAction('载入此工具会替换当前创建草稿，确定继续？', '编辑工具', '载入工具')) return
  moduleStudioBusy.value = true
  moduleStudioError.value = ''
  moduleStudioNotice.value = ''
  try {
    const details = await toolbox.getModuleDetails(moduleId)
    const manifest = details.manifest
    const tool = manifest.tools[0]
    if (manifest.tools.length !== 1 || !tool || tool.actions.length !== 1
      || manifest.platforms.some((platform) => platform !== 'windows' && platform !== 'android')) {
      throw new Error('界面编辑器目前支持单工具、单操作且仅面向 Windows/Android 的工具；这个工具仍可原样导出。')
    }
    moduleDraft.value = {
      moduleId: manifest.module_id, version: manifest.version, name: moduleDisplayName(manifest.name),
      author: manifest.author,
      license: moduleLicenseOptions.some((option) => option.id === manifest.license) ? manifest.license : 'custom',
      customLicense: moduleLicenseOptions.some((option) => option.id === manifest.license) ? '' : manifest.license,
      toolSuffix: tool.id.slice(manifest.module_id.length + 1), toolName: moduleDisplayName(tool.name),
      description: moduleDisplayName(tool.description), category: tool.category, icon: tool.icon ?? '', iconData: tool.icon_data ?? '',
      tags: tool.tags.join(', '), aliases: tool.aliases.join(', '),
      actionId: tool.actions[0]!.id, actionLabel: moduleDisplayName(tool.actions[0]!.label),
      entry: tool.entry, windows: manifest.platforms.includes('windows'), android: manifest.platforms.includes('android'),
      runtime: tool.ui.kind === 'web' ? 'web' : 'quickjs',
      fullscreen: tool.ui.fullscreen === true,
      timeoutSeconds: manifest.limits.timeout_ms / 1000, networkHosts: manifest.network.hosts.join('\n'),
      scripts: Object.entries(details.scripts).map(([path, source]) => ({ path, source })),
      inputTypes: tool.actions[0]?.input_types ?? (tool.ui.kind === 'text' ? ['text'] : []),
    }
    loadedModuleManifest.value = manifest
    creatorModeContents.value = {}
    moduleTemplateId.value = ''
    moduleScriptIndex.value = 0
    moduleStudioNotice.value = `已载入「${moduleDisplayName(manifest.name)}」，修改后可重新安装或导出。`
    setModuleStudioTab('create')
  } catch (error) { moduleStudioError.value = errorMessage(error) }
  finally { moduleStudioBusy.value = false }
}

function splitModuleWords(value: string): string[] {
  return value.split(/[,，\s]+/).map((word) => word.trim()).filter(Boolean)
}

function closeModulePreview() {
  modulePreviewRevision++
  if (modulePreviewRequestId) {
    void toolbox.cancelModuleRun(modulePreviewRequestId).catch(() => {})
    modulePreviewRequestId = null
  }
  if (modulePreviewOpen.value) stopBrowserModule()
  modulePreviewOpen.value = false
  modulePreviewBusy.value = false
  modulePreviewError.value = ''
  modulePreviewOutput.value = ''
  modulePreviewFileStatus.value = { busy: false, message: '' }
}

function cancelModulePreviewRun() {
  const open = modulePreviewOpen.value
  closeModulePreview()
  modulePreviewOpen.value = open
}

watch([moduleDraft, creatorModeContents, loadedModuleManifest], () => {
  if (modulePreviewOpen.value) closeModulePreview()
  clearTimeout(moduleDraftSaveTimer)
  moduleDraftSaveTimer = setTimeout(persistModuleDraft, 250)
}, { deep: true })

async function previewModuleDraft() {
  if (moduleStudioBusy.value || modulePreviewBusy.value) return
  closeModulePreview()
  const revision = modulePreviewRevision
  modulePreviewOpen.value = true
  modulePreviewBusy.value = true
  try {
    const draft = moduleDraft.value
    const { manifest, scripts } = composeModuleDraft(true)
    const bytes = draft.runtime === 'web' ? null : await toolbox.createModulePackage(manifest, scripts)
    if (draft.runtime === 'web') await toolbox.validateModuleDraft(manifest, scripts, loadedModuleManifest.value?.module_id,moduleDraft.value.resourceDraftId)
    if (revision !== modulePreviewRevision || page.value !== 'moduleStudio' || moduleStudioTab.value !== 'create') return
    if (draft.runtime === 'quickjs') {
      const requestId = crypto.randomUUID()
      modulePreviewRequestId = requestId
      const result = await toolbox.previewToolPackage(bytes!, modulePreviewInput.value, draft.actionId, requestId)
      if (revision === modulePreviewRevision) modulePreviewOutput.value = result
      return
    }
    const sources = new Map(draft.scripts.map(({ path, source }) => [path.trim(), source]))
    const entry = draft.entry.trim()
    const scriptPath = [...sources.keys()].find((path) => path.endsWith('.js'))
    const stylePath = [...sources.keys()].find((path) => path.endsWith('.css'))
    if (draft.scripts.length !== 3 || sources.size !== 3 || !entry.endsWith('.html')
      || !scriptPath || !stylePath || !sources.has(entry)
      || [...sources].some(([path, source]) => !path || !source.trim()
        || new TextEncoder().encode(source).byteLength > WEB_SOURCE_BYTES)) {
      throw new Error('预览需要各一个非空的 HTML、CSS、JS 文件，单个文件不超过 8 MiB。')
    }
    const networkHosts = manifest.network.hosts
    const timeoutMs = Math.round(draft.timeoutSeconds * 1000)
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 15000) {
      throw new Error('页面加载超时须在 0.001 至 15 秒之间。')
    }
    await nextTick()
    if (revision !== modulePreviewRevision || page.value !== 'moduleStudio' || moduleStudioTab.value !== 'create') return
    if (!modulePreviewContainer.value) throw new Error('预览区域不可用。')
    await mountWebTool(modulePreviewContainer.value, {
      moduleId: `preview.${draft.moduleId}`, scriptName: scriptPath,
      resourceModuleId: loadedModuleManifest.value?.module_id ?? manifest.module_id, resourceDraftId: moduleDraft.value.resourceDraftId, resources: manifest.resources, files: nativeWebFiles,
      html: sources.get(entry)!, css: sources.get(stylePath)!, script: sources.get(scriptPath)!,
      networkHosts, timeoutMs, inputBytes: manifest.limits.input_bytes, outputBytes: manifest.limits.output_bytes,
      openFile: openWebToolFile, saveFile: saveWebToolFile, hashFile: hashWebToolFile, copyText: writeClipboardText, openWebsite: openToolWebsite,
      onFileStatus: (value) => {
        if (revision === modulePreviewRevision) modulePreviewFileStatus.value = value
      },
      onStopped: () => {
        if (revision === modulePreviewRevision) modulePreviewFileStatus.value = stoppedWebFileStatus(modulePreviewFileStatus.value)
      },
      onError: (message) => {
        if (revision === modulePreviewRevision) modulePreviewError.value = message
      },
    })
  } catch (error) {
    if (revision === modulePreviewRevision) modulePreviewError.value = errorMessage(error)
  } finally {
    if (revision === modulePreviewRevision) { modulePreviewBusy.value = false; modulePreviewRequestId = null }
  }
}

function selectPresetModuleIcon(icon: string) {
  moduleDraft.value.icon = icon
  moduleDraft.value.iconData = ''
  moduleIconMenuOpen.value = false
  moduleIconTrigger.value?.focus({ preventScroll: true })
}

function onModuleIconPickerPointerDown(event: PointerEvent) {
  if (moduleIconMenuOpen.value && !moduleIconPicker.value?.contains(event.target as Node)) moduleIconMenuOpen.value = false
}

async function importModuleIcon() {
  if (moduleStudioBusy.value) return
  moduleIconMenuOpen.value = false
  moduleStudioBusy.value = true
  moduleStudioError.value = ''
  moduleStudioNotice.value = ''
  try {
    const path = await openFileDialog({
      title: '选择 SVG 或图片图标', multiple: false, directory: false,
      ...(isAndroidApp ? {} : { filters: [{ name: '图标', extensions: ['svg', 'png', 'jpg', 'jpeg', 'webp'] }] }),
    })
    if (!path) return
    if (!isAndroidApp && (await stat(path)).size > 1024 * 1024) throw new Error('图标文件不能超过 1 MiB。')
    const data = await normalizeModuleIcon(await readFile(path))
    moduleDraft.value.iconData = data
    moduleStudioNotice.value = '图标已导入，可预览并随工具一起导出。'
  } catch (error) { moduleStudioError.value = errorMessage(error) }
  finally { moduleStudioBusy.value = false }
}

function composeModuleDraft(preview = false): { manifest: ModuleManifest; scripts: Record<string, string> } {
  const current = moduleDraft.value
  const name = current.toolName.trim() || (preview ? '工具预览' : '')
  const draft = { ...current, name: current.name.trim() || name, toolName: name,
    description: current.description.trim() || '自定义工具', author: current.author.trim() || '本机用户' }
  const moduleId = draft.moduleId.trim()
  const entry = draft.entry.trim()
  const paths = draft.scripts.map((script) => script.path.trim())
  const license = draft.license === 'custom' ? draft.customLicense.trim() : draft.license
  if (!moduleId || !draft.name.trim() || !draft.toolName.trim() || !draft.description.trim()
    || !draft.author.trim() || !license || !draft.version.trim()
    || !draft.category.trim() || !draft.toolSuffix.trim()
    || !draft.actionId.trim() || !draft.actionLabel.trim()) {
    throw new Error('请填写工具名称、分组和高级设置中的必填信息。')
  }
  const validId = (id: string) => id.length <= 100 && id.split('.').length >= 2
    && id.split('.').every((part) => /^[a-z][a-z0-9_]{0,39}$/.test(part))
  if (!validId(moduleId) || moduleId.startsWith('custom.')
    || !validId(`${moduleId}.${draft.toolSuffix.trim()}`)) {
    throw new Error('工具包 ID 和工具 ID 只能用小写字母、数字、下划线及英文句点分段，且不能以 custom. 开头。')
  }
  if (!draft.windows && !draft.android) throw new Error('请至少选择一个运行平台。')
  if (!draft.scripts.length || paths.some((path) => !path) || new Set(paths).size !== paths.length
    || !paths.includes(entry) || draft.scripts.some((script) => !script.source.trim())) {
    throw new Error('请填写不重复的资源路径与内容，并让入口指向其中一个文件。')
  }
  const networkHosts = draft.networkHosts.split(/\s+/).map((host) => host.trim()).filter(Boolean)
  const webScript = draft.runtime === 'web' ? paths.find((path) => path.endsWith('.js')) : undefined
  const webStyle = draft.runtime === 'web' ? paths.find((path) => path.endsWith('.css')) : undefined
  if (draft.runtime === 'web' && (!entry.endsWith('.html') || !webScript || !webStyle || paths.length !== 3)) {
    throw new Error('网页工具需要一个 HTML 入口、一个 CSS 文件和一个 JS 文件。')
  }
  if (draft.runtime === 'quickjs' && networkHosts.length) throw new Error('网页工具才支持声明联网来源。')
  if (networkHosts.length > 64) throw new Error('允许联网的 HTTPS 来源最多 64 个。')
  if (networkHosts.some((host) => {
    try {
      const url = new URL(host)
      return url.protocol !== 'https:' || !url.hostname || url.origin !== host || url.username !== ''
        || url.password !== '' || url.pathname !== '/' || url.search !== '' || url.hash !== ''
    } catch { return true }
  })) throw new Error('联网来源须为完整的 HTTPS 来源，例如 https://api.example.com。')
  const timeoutMs = Math.round(draft.timeoutSeconds * 1000)
  if (!Number.isFinite(draft.timeoutSeconds) || timeoutMs < 1
    || draft.timeoutSeconds > (draft.runtime === 'quickjs' ? 3 : 15)) throw new Error('执行超时秒数不在当前运行环境允许的范围内。')
  const manifest: ModuleManifest = loadedModuleManifest.value
    ? structuredClone(loadedModuleManifest.value)
    : {
        schema_version: 1, module_id: moduleId, version: draft.version.trim(), api_version: '1',
        min_app_version: appManifest.version, name: {}, author: '', license: '', platforms: [],
        permissions: [], network: { hosts: [] },
        limits: { input_bytes: 1048576, output_bytes: 4194304, timeout_ms: 3000, heap_bytes: 67108864 },
        tools: [{ id: '', name: {}, description: {}, category: '', tags: [], aliases: [],
          entry: 'main.js', input_schema: {}, output_schema: {},
          ui: { kind: 'text', input_field: 'text', output_field: 'text' }, actions: [{ id: '', label: {} }] }],
      }
  manifest.module_id = moduleId
  manifest.schema_version = draft.runtime === 'web' ? 7 : 6
  manifest.min_app_version = appManifest.version
  manifest.version = draft.version.trim()
  manifest.name['zh-CN'] = draft.name.trim()
  manifest.author = draft.author.trim()
  manifest.license = license
  manifest.platforms = [...(draft.windows ? ['windows'] : []), ...(draft.android ? ['android'] : [])]
  manifest.permissions = networkHosts.length ? ['network'] : []
  manifest.network.hosts = networkHosts
  manifest.limits.input_bytes = draft.runtime === 'web' ? 2 * 1024 * 1024 * 1024 : 1024 * 1024
  manifest.limits.output_bytes = draft.runtime === 'web' ? 2 * 1024 * 1024 * 1024 : 4 * 1024 * 1024
  manifest.resources = draft.runtime === 'web' ? (draft.resources ?? manifest.resources ?? []) : undefined
  manifest.limits.timeout_ms = timeoutMs
  const tool = manifest.tools[0]!
  tool.id = `${moduleId}.${draft.toolSuffix.trim()}`
  tool.name['zh-CN'] = draft.toolName.trim()
  tool.description['zh-CN'] = draft.description.trim()
  tool.category = draft.category.trim()
  tool.icon = draft.iconData || !draft.icon ? undefined : draft.icon
  tool.icon_data = draft.iconData || undefined
  tool.tags = splitModuleWords(draft.tags)
  tool.aliases = splitModuleWords(draft.aliases)
  tool.entry = entry
  tool.runtime = draft.runtime === 'quickjs' ? undefined : 'browser'
  const textSchema = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false }
  tool.input_schema = draft.runtime === 'web' ? null : textSchema
  tool.output_schema = draft.runtime === 'web' ? null : structuredClone(textSchema)
  tool.ui = draft.runtime === 'web'
    ? { kind: 'web', script: webScript, style: webStyle, ...(draft.fullscreen ? { fullscreen: true } : {}) }
    : { kind: 'text', input_field: 'text', output_field: 'text' }
  tool.actions[0]!.id = draft.runtime === 'web' ? 'open' : draft.actionId.trim()
  tool.actions[0]!.label['zh-CN'] = draft.runtime === 'web' ? '打开' : draft.actionLabel.trim()
  tool.actions[0]!.input_types = draft.runtime === 'web' ? undefined : [...new Set(draft.inputTypes)]
  const previous = loadedModuleManifest.value
  if (draft.runtime !== 'web' && previous && previous.schema_version < 4 && previous.tools[0]?.ui.kind === 'text'
    && previous.tools[0]?.actions[0]?.input_types === undefined && draft.inputTypes.length === 1 && draft.inputTypes[0] === 'text') {
    manifest.schema_version = Math.max(previous.schema_version, draft.iconData ? 2 : 1)
    tool.actions[0]!.input_types = undefined
    manifest.min_app_version = previous.min_app_version
  }
  return { manifest, scripts: Object.fromEntries(draft.scripts.map((script) => [script.path.trim(), script.source])) }
}

async function moduleExportPath(moduleId: string, version: string): Promise<string | null> {
  const path = await saveFileDialog({ title: '导出 .fftool 工具包', defaultPath: `${moduleId}-${version}.fftool`,
    ...(isAndroidApp ? {} : { filters: [{ name: '流萤工具包', extensions: ['fftool'] }] }) })
  if (!path) return null
  return !isAndroidApp && !path.toLowerCase().endsWith('.fftool') ? `${path}.fftool` : path
}

async function importModuleResource() {
  if(moduleStudioBusy.value||moduleCreationType.value!=='web')return
  const resourceDraftId=moduleDraft.value.resourceDraftId ?? (moduleDraft.value.resourceDraftId=crypto.randomUUID())
  moduleStudioBusy.value=true;moduleStudioError.value=''
  try {
    const path=await openFileDialog({title:'导入工具资源',multiple:false,directory:false}) as string|null
    if(!path)return
    const resource=await toolbox.stageModuleResource(path,resourceDraftId)
    if(resourceDraftId!==moduleDraft.value.resourceDraftId){await toolbox.discardModuleResources(resourceDraftId);return}
    const existing=moduleDraft.value.resources ?? loadedModuleManifest.value?.resources ?? []
    moduleDraft.value.resources=[...existing.filter(item=>item.path!==resource.path),resource]
    persistModuleDraft()
  } catch(error){moduleStudioError.value=errorMessage(error)}finally{moduleStudioBusy.value=false}
}
async function removeModuleResource(path:string) {
  if(moduleStudioBusy.value)return
  closeModulePreview()
  moduleDraft.value.resources=(moduleDraft.value.resources ?? loadedModuleManifest.value?.resources ?? []).filter(item=>item.path!==path)
  if(moduleDraft.value.resourceDraftId)await toolbox.discardModuleResources(moduleDraft.value.resourceDraftId,path).catch(error=>{moduleStudioError.value=errorMessage(error)})
  persistModuleDraft()
}

async function exportModuleDraft() {
  if (moduleStudioBusy.value) return
  moduleStudioBusy.value = true
  moduleStudioError.value = ''
  moduleStudioNotice.value = ''
  try {
    const { manifest, scripts } = composeModuleDraft()
    const path = await moduleExportPath(manifest.module_id, manifest.version)
    if (path) {
      await toolbox.exportModuleDraftFile(manifest, scripts, path, loadedModuleManifest.value?.module_id,moduleDraft.value.resourceDraftId)
      moduleStudioNotice.value = '工具包已导出，可在本机或其他设备导入。'
    }
  } catch (error) { moduleStudioError.value = errorMessage(error) }
  finally { moduleStudioBusy.value = false }
}

async function installModuleDraft() {
  if (moduleStudioBusy.value || moduleBusy.value) return
  moduleStudioBusy.value = true
  moduleStudioError.value = ''
  moduleStudioNotice.value = ''
  try {
    const { manifest, scripts } = composeModuleDraft()
    const installed = await toolbox.installModuleDraft(manifest, scripts, loadedModuleManifest.value?.module_id,moduleDraft.value.resourceDraftId)
    modules.value = await toolbox.listModules()
    await store.refresh()
    loadedModuleManifest.value = manifest
    moduleStudioNotice.value = `已安装「${installed.name}」，现在可以在工具管理中运行。`
  } catch (error) { moduleStudioError.value = errorMessage(error) }
  finally { moduleStudioBusy.value = false }
}

async function exportInstalledModule(item: ModuleSummary) {
  if (moduleStudioBusy.value) return
  moduleStudioBusy.value = true
  moduleStudioError.value = ''
  moduleStudioNotice.value = ''
  try {
    const path = await moduleExportPath(item.module_id, item.version)
    if (path) {
      await toolbox.exportModuleFile(item.module_id, path)
      moduleStudioNotice.value = `已导出「${item.name}」。`
    }
  } catch (error) { moduleStudioError.value = errorMessage(error) }
  finally { moduleStudioBusy.value = false }
}

function addModuleScript() {
  if (moduleDraft.value.scripts.length < 16) moduleDraft.value.scripts.push({ path: '', source: '' })
}

async function selectModulePackage(droppedPaths?: string[]) {
  if (moduleBusy.value || moduleStudioBusy.value) return
  moduleError.value = ''
  if (page.value === 'moduleStudio') moduleStudioError.value = ''
  moduleStudioNotice.value = ''
  try {
    let paths = droppedPaths
    if (!paths) {
      moduleBusy.value = true
      try {
        const selected = await openFileDialog({
          title: '选择 .fftool 工具包', multiple: true, directory: false,
          ...(isAndroidApp ? {} : { filters: [{ name: '流萤工具包', extensions: ['fftool'] }] }),
        })
        paths = selected ? (Array.isArray(selected) ? selected : [selected]) : []
      } finally { moduleBusy.value = false }
    }
    if (paths.length) await moduleImports.add(paths)
  } catch (error) { moduleError.value = `导入失败：${errorMessage(error)}` }
}

async function installSelectedModule(id?: number) {
  if (!moduleStudioBusy.value) await moduleImports.install(id)
}

async function removeModule(moduleId: string) {
  if (moduleBusy.value) return
  const current = modules.value.find((item) => item.module_id === moduleId)
  if (!current || current.builtin || !await confirmAction(`卸载「${current.name}」及其 ${current.tools.length} 个工具？相关收藏也会删除。`, '卸载工具', '卸载工具', true)) return
  moduleBusy.value = true
  moduleError.value = ''
  moduleStudioError.value = ''
  moduleStudioNotice.value = ''
  try {
    await toolbox.deleteModule(moduleId)
    modules.value = await toolbox.listModules()
    await store.refresh()
    if (loadedModuleManifest.value?.module_id === moduleId) resetModuleDraft()
    ensureStudioSelection()
    moduleStudioNotice.value = `已卸载「${current.name}」`
  } catch (error) { moduleStudioError.value = errorMessage(error) }
  finally { moduleBusy.value = false }
}

function openBackupDialog() {
  backupError.value = ''
  backupDialog.value?.showModal()
  updateNativeBack()
}

function closeBackupDialog() {
  if (backupBusy.value) return
  backupDialog.value?.close()
  backupError.value = ''
  updateNativeBack()
}

async function exportBackup() {
  if (backupBusy.value) return
  backupBusy.value = true
  backupError.value = ''
  try {
    const contents = serializeBackup(await toolbox.exportConfiguration())
    const date = new Date()
    const dateLabel = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    const path = await saveFileDialog({
      title: '导出配置',
      defaultPath: `firefly-config-${dateLabel}.json`,
      filters: [{ name: 'JSON 配置文件', extensions: ['json'] }],
    })
    if (!path) return
    await toolbox.writeConfigurationFile(path, contents)
    notify('配置已导出')
  } catch (error) {
    backupError.value = errorMessage(error)
  } finally {
    backupBusy.value = false
  }
}

async function importBackup() {
  if (backupBusy.value) return
  backupError.value = ''
  backupBusy.value = true
  try {
    const path = await openFileDialog({
      title: '导入配置',
      multiple: false,
      directory: false,
      filters: [{ name: 'JSON 配置文件', extensions: ['json'] }],
    })
    if (!path) return
    const contents = await toolbox.readConfigurationFile(path)
    let backup: ReturnType<typeof parseBackup>
    try {
      backup = parseBackup(contents)
    } catch {
      backupError.value = '所选 JSON 不是有效的流萤百宝箱配置文件，未导入。'
      return
    }
    if (!await confirmAction(`此配置包含 ${backup.database.favorites.length} 个内置工具收藏、${backup.database.websites.length} 个网站书签，将替换本机对应内容及界面设置，并清空最近使用记录。自动化工具和 JS 工具及其收藏会保留。`, '确认导入配置', '导入并覆盖', true)) return
    await toolbox.importConfiguration(backup.database)
    try {
      restoreBackupPreferences(backup.preferences)
    } catch (error) {
      backupError.value = `收藏和书签已导入，但界面设置保存失败，已尝试恢复原设置：${errorMessage(error)}。请检查存储空间后重试。`
      await Promise.all([store.refresh(), loadCustomTools(), loadWebsites()])
      return
    }
    window.location.reload()
  } catch (error) {
    backupError.value = errorMessage(error)
  } finally {
    backupBusy.value = false
  }
}

async function detect() {
  if (page.value !== 'detection' || !detectValue.value.trim() || detecting.value || detectionSelecting.value) return
  const value = detectValue.value
  const revision = ++detectionRevision
  try { validateDetectionInput(value) }
  catch (error) { detectResults.value = []; detectionError.value = true; detectMessage.value = errorMessage(error); revealDetectionResults(); return }
  detecting.value = true
  detectResults.value = []
  detectMessage.value = ''
  detectionError.value = false
  try {
    const results = await toolbox.detectText(value)
    if (revision !== detectionRevision || page.value !== 'detection' || value !== detectValue.value) return
    detectResults.value = results
    detectMessage.value = detectResults.value.length
      ? '发现可用的本地处理工具。'
      : '暂未找到可推荐的工具；可尝试 JSON、JWT、UUID、时间戳、Base64 或 URL 编码，或检查对应工具是否已删除。'
  } catch (error) {
    if (revision === detectionRevision && page.value === 'detection') { detectionError.value = true; detectMessage.value = `识别失败：${errorMessage(error)}` }
  } finally {
    if (revision === detectionRevision) { detecting.value = false; revealDetectionResults() }
  }
}

async function useDetection(result: DetectionResult, action: DetectionAction) {
  if (detecting.value || detectionSelecting.value) return
  if (toolSelectionBusy.value || store.loadError) { detectionError.value = true; detectMessage.value = '当前操作尚未完成或工具暂不可用，请稍后再打开。'; return }
  const text = detectValue.value
  const revision = detectionRevision
  detectionSelecting.value = true
  try {
    await store.refresh()
    if (revision !== detectionRevision || page.value !== 'detection' || text !== detectValue.value) return
    const tool = store.tools.find(item => item.id === action.tool_id)
    const current = tool?.actions.find(item => item.id === action.id)
    if (!current || tool?.ui_kind === 'web' || current.consumes_input === false || !current.input_types?.includes(result.type_id)) {
      detectionError.value = true
      detectMessage.value = '工具或操作已变化，请重新识别；待识别内容已保留。'
      detectResults.value = []
      return
    }
    if (toolSelectionBusy.value || !openTool(action.tool_id)) { detectionError.value = true; detectMessage.value = '当前操作尚未完成，请稍后再打开；待识别内容已保留。'; return }
    toolAction.value = action.id
    input.value = text
    inputChanged()
  } catch (error) {
    if (revision === detectionRevision && page.value === 'detection') { detectionError.value = true; detectMessage.value = `无法打开推荐工具：${errorMessage(error)}` }
  } finally { if (revision === detectionRevision) detectionSelecting.value = false }
}

async function loadCustomTools() {
  try {
    customTools.value = await toolbox.listCustomTools()
  } catch {
    notify('无法读取自动化工具。')
  }
}

function toggleActiveWebTool() {
  editorToolMenuOpen.value = false
  if (webToolStopped.value) restartActiveWebTool()
  else stopActiveWebTool()
}

async function refreshSyncedData() {
  try { await Promise.all([store.refresh(), loadCustomTools(), loadWebsites()]); modules.value = await toolbox.listModules() }
  catch (error) { notify(`同步已完成，刷新列表失败：${errorMessage(error)}`) }
}

function finishDeviceSync(reload: boolean) {
  if (reload) window.location.reload()
  else { if (standaloneHistory.at(-1) === 'settings') standaloneHistory.pop(); navigate('settings', true); notify('设备同步已完成') }
}

async function clearRuntimeCache() {
  if (cacheBusy.value) return
  cacheBusy.value = true
  cacheProgressVisible.value = false
  cacheProgressTimer = setTimeout(() => { cacheProgressVisible.value = true }, 500)
  try {
    cancelActiveModule()
    closeModulePreview()
    let previewEntries = 0
    let previewError = ''
    try { previewEntries = await clearPreviewStorage() }
    catch (error) { previewError = `预览临时数据清理失败：${errorMessage(error)}` }
    const report = await toolbox.clearRuntimeCache()
    if (previewError) report.warnings.push(previewError)
    notify(cacheReportMessage(report, previewEntries))
  } catch (error) { notify(`缓存清理未完成：${errorMessage(error)}`) }
  finally {
    clearTimeout(cacheProgressTimer)
    cacheProgressVisible.value = false
    cacheBusy.value = false
  }
}

function newCustomStep() {
  const tool = availableSteps.value[0]
  return { tool_id: tool?.id ?? '', action: tool?.actions[0]?.id ?? '' }
}

function createCustomTool() {
  customIconRevision++; customIconLoading.value = false
  customForm.value = { id: '', name: '', description: '', tags: [], steps: [newCustomStep()] }
  customFormGroup.value = HOME_OTHER_GROUP
  customTagsText.value = ''
  customError.value = ''
  openCustomToolPage()
}

function editCustomTool(id: string) {
  customIconRevision++; customIconLoading.value = false
  const tool = customTools.value.find((item) => item.id === id)
  if (!tool) return notify('无法找到自动化工具。')
  customForm.value = { ...tool, tags: [...tool.tags], steps: tool.steps.map((step) => ({ ...step })) }
  const descriptor = store.allTools.find((item) => item.id === id)
  customFormGroup.value = descriptor ? homeGroupId(descriptor) : HOME_OTHER_GROUP
  customTagsText.value = tool.tags.join(', ')
  customError.value = ''
  openCustomToolPage()
}

function openCustomToolPage() {
  const origin = page.value
  if (origin === 'customTool') return
  customToolReturnScroll = window.scrollY
  navigate('customTool')
  if (page.value !== 'customTool') return
  customToolReturnToEditor = origin === 'editor'
  void nextTick(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
    document.getElementById('main-content')?.focus({ preventScroll: true })
  })
}

function resetCustomToolPage() {
  customIconRevision++; customIconLoading.value = false
  customError.value = ''
  customToolReturnToEditor = false
}

function closeCustomToolPage() {
  if (page.value === 'customTool') goBackStandalone()
}

function changeCustomStepTool(index: number) {
  const step = customForm.value.steps[index]
  const tool = availableSteps.value.find((item) => item.id === step?.tool_id)
  if (step) step.action = tool?.actions[0]?.id ?? ''
}

function moveCustomStep(index: number, direction: -1 | 1) {
  const target = index + direction
  if (target < 0 || target >= customForm.value.steps.length) return
  const steps = [...customForm.value.steps]
  ;[steps[index], steps[target]] = [steps[target]!, steps[index]!]
  customForm.value.steps = steps
}

async function saveCustomTool() {
  if (customSaving.value || customIconLoading.value) return
  customSaving.value = true
  customError.value = ''
  try {
    const tags = [...new Set(customTagsText.value.split(/[,，\n]+/).map((tag) => tag.trim()).filter(Boolean))]
    const saved = await toolbox.saveCustomTool({ ...customForm.value, tags })
    await Promise.all([store.refresh(), loadCustomTools()])
    assignHomeTool(saved.id, customFormGroup.value)
    if (activeToolId.value === saved.id) inputChanged()
    customSaving.value = false
    closeCustomToolPage()
    notify(customForm.value.id ? '自动化工具已更新' : '自动化工具已创建')
    if (!customForm.value.id) openTool(saved.id)
  } catch (error) {
    customError.value = errorMessage(error)
  } finally {
    customSaving.value = false
  }
}

async function importCustomIcon() {
  if (customSaving.value || customIconLoading.value) return
  const revision = ++customIconRevision
  customIconLoading.value = true; customError.value = ''
  try {
    const path = await openFileDialog({ title: '选择自动化工具图标', multiple: false, directory: false,
      ...(isAndroidApp ? {} : { filters: [{ name: '图标', extensions: ['svg', 'png', 'jpg', 'jpeg', 'webp'] }] }) })
    if (!path) return
    if (!isAndroidApp && (await stat(path)).size > 1024 * 1024) throw new Error('图标文件不能超过 1 MiB。')
    const icon = await normalizeModuleIcon(await readFile(path))
    if (revision === customIconRevision && page.value === 'customTool') { customForm.value.icon_data = icon; customForm.value.icon = null }
  } catch (error) { if (revision === customIconRevision) customError.value = errorMessage(error) }
  finally { if (revision === customIconRevision) customIconLoading.value = false }
}

async function removeCustomTool(id: string) {
  if (allToolsActionBusy.value) return
  const tool = customTools.value.find((item) => item.id === id)
    ?? store.allTools.find((item) => item.custom && item.id === id)
  if (!tool) return
  allToolsActionBusy.value = true
  try {
    if (!await confirmAction(`删除「${tool.name}」及其相关收藏？此操作无法撤销。`, '删除自动化工具', '删除工具', true)) return
    await toolbox.deleteCustomTool(id)
    await Promise.all([store.refresh(), loadCustomTools()])
    const assignments = { ...homeGroupSettings.value.assignments }
    delete assignments[id]
    homeGroupSettings.value = { ...homeGroupSettings.value, assignments }
    const favoriteAssignments = { ...favoriteGroupSettings.value.assignments }
    delete favoriteAssignments[id]
    favoriteGroupSettings.value = { ...favoriteGroupSettings.value, assignments: favoriteAssignments }
    allToolsAction.value = null
    navigate('allTools')
    notify('自动化工具已删除')
  } catch (error) {
    notify(errorMessage(error))
  } finally {
    allToolsActionBusy.value = false
  }
}

async function loadWebsites() {
  try {
    websites.value = await toolbox.listWebsites()
    const valid = new Set(websites.value.map((site) => String(site.id)))
    const assignments = Object.fromEntries(Object.entries(websiteGroupSettings.value.assignments)
      .filter(([siteId]) => valid.has(siteId)))
    if (Object.keys(assignments).length !== Object.keys(websiteGroupSettings.value.assignments).length) {
      websiteGroupSettings.value = { ...websiteGroupSettings.value, assignments }
    }
    websiteError.value = ''
  } catch {
    websiteError.value = '网站列表暂不可用。'
  }
}

function editWebsite(site?: Website) {
  websiteForm.value = site
    ? { ...site }
    : { id: 0, name: '', url: '', description: '', tags: '', favorite: false }
  websiteFormGroup.value = site ? websiteGroupId(site.id) : WEBSITE_UNGROUPED
  websiteError.value = ''
  websiteDialog.value?.showModal()
  updateNativeBack()
  websiteDialog.value?.querySelector<HTMLButtonElement>('.dialog-heading button')?.focus({ preventScroll: true })
}

async function importWebsiteShortcut(path: string) {
  try {
    const shortcut = await invoke<{ name: string; url: string }>('read_website_shortcut', { path })
    if (page.value !== 'websites') return
    editWebsite()
    websiteForm.value.name = shortcut.name
    websiteForm.value.url = shortcut.url
  } catch (error) {
    notify(errorMessage(error))
  }
}

function onWebsiteFileDrag(payload: DragDropEvent) {
  if (page.value !== 'websites' || websiteDialog.value?.open) {
    websiteFileDragging.value = false
    return
  }
  if (payload.type === 'leave') websiteFileDragging.value = false
  else if (payload.type === 'enter') {
    websiteFileDragging.value = payload.paths.length === 1 && /\.url$/i.test(payload.paths[0] ?? '')
  } else if (payload.type === 'drop') {
    websiteFileDragging.value = false
    if (payload.paths.length === 1 && /\.url$/i.test(payload.paths[0] ?? '')) {
      void importWebsiteShortcut(payload.paths[0])
    } else if (payload.paths.some((path) => /\.url$/i.test(path))) {
      notify('请一次拖入一个 .url 网站快捷方式。')
    }
  }
}

function onAppFileDrag(payload: DragDropEvent) {
  if (page.value !== 'moduleStudio' || moduleStudioTab.value !== 'import') {
    moduleFileDragging.value = false
    onWebsiteFileDrag(payload)
    return
  }
  websiteFileDragging.value = false
  if (payload.type === 'leave') moduleFileDragging.value = false
  else if (payload.type === 'enter') {
    moduleFileDragging.value = !moduleBusy.value && !moduleStudioBusy.value
      && payload.paths.some(path => /\.fftool$/i.test(path))
  } else if (payload.type === 'drop') {
    moduleFileDragging.value = false
    if (moduleBusy.value || moduleStudioBusy.value) return
    if (payload.paths.length) void selectModulePackage(payload.paths)
  }
}

function closeWebsiteDialog() {
  websiteDialog.value?.close()
  websiteError.value = ''
  updateNativeBack()
}

function onWebsiteDialogClosed() {
  websiteError.value = ''
  updateNativeBack()
}

async function saveWebsite() {
  if (websiteSaving.value) return
  const value = { ...websiteForm.value, name: websiteForm.value.name.trim(), url: websiteForm.value.url.trim() }
  try {
    const parsed = new URL(value.url)
    if (!['https:', 'http:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) throw new Error()
  } catch {
    websiteError.value = '请输入有效的 HTTP 或 HTTPS 网站地址。'
    return
  }
  websiteSaving.value = true
  try {
    const saved = await toolbox.saveWebsite(value)
    websites.value = saved.websites
    assignWebsite(saved.id, websiteGroupSettings.value.groups.length ? websiteFormGroup.value : WEBSITE_UNGROUPED)
    closeWebsiteDialog()
    notify('网站已保存')
  } catch (error) {
    websiteError.value = errorMessage(error)
  } finally {
    websiteSaving.value = false
  }
}

async function removeWebsite(site: Website) {
  if (!await confirmAction(`删除「${site.name}」？此操作无法撤销。`, '删除网站', '删除网站', true)) return
  try {
    websites.value = await toolbox.deleteWebsite(site.id)
    const assignments = { ...websiteGroupSettings.value.assignments }
    delete assignments[String(site.id)]
    websiteGroupSettings.value = { ...websiteGroupSettings.value, assignments }
    websiteOrder.value = websiteOrder.value.filter((id) => id !== String(site.id))
    try { localStorage.setItem('firefly.order.websites.v1', JSON.stringify(websiteOrder.value)) } catch { /* Keep this session's order. */ }
    notify('网站已删除')
  } catch {
    notify('删除网站失败，请重试。')
  }
}

async function openToolWebsite(url: string, title: string) {
  if (page.value === 'editor' && activeToolId.value === 'boxoffice.live' && [DESKTOP_BOX_OFFICE_URL, MOBILE_BOX_OFFICE_URL].includes(url)) { officialBoxOfficeOpen.value = true; return }
  if (!await openWebPage(url,title,'tool')) throw new Error('无法打开网页，请稍后重试。')
}
async function openWebPage(urlString: string, title: string, windowKey: string) {
  try {
    const url = new URL(urlString)
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error('网址无效')
    if (window.FireflyWebsites) {
      await window.FireflyWebsites.open(urlString)
    } else {
      const webview = new WebviewWindow(`website-${windowKey}-${Date.now()}`, { url: urlString, title, width: 1080, height: 760, dragDropEnabled: false })
      await new Promise<void>((resolve, reject) => {
        webview.once('tauri://created', () => resolve()).catch(reject)
        webview.once('tauri://error', (event) => reject(event.payload)).catch(reject)
      })
      if (isWindowsApp) await invoke('initialize_website_progress', { label: webview.label })
    }
    return true
  } catch {
    notify('无法打开网站，请检查网址。')
    return false
  }
}

function visitWebsite(site: Website) {
  return openWebPage(site.url, site.name, String(site.id))
}

async function openProjectPage(page: 'website' | 'source') {
  const projectUrl = 'https://github.com/Iskongkongyo/FireflyToolBox'
  const url = page === 'website' ? 'https://firefly.202132.xyz' : projectUrl
  try {
    if (isTauri()) await openUrl(url)
    else window.open(url, '_blank', 'noopener,noreferrer')
  } catch {
    notify('无法使用默认浏览器打开链接。')
  }
}

function onGlobalKey(event: KeyboardEvent) {
  if (remoteMessagesOpen.value) return
  if (toolFullscreen.value && event.key === 'Escape' && !document.querySelector('dialog[open]')) {
    event.preventDefault(); leaveToolFullscreen(); return
  }
  if (event.key === 'Escape') {
    if (editorToolMenuOpen.value) editorToolMenuOpen.value = false
    else if (allToolsMenuOpen.value) allToolsMenuOpen.value = false
    else if (searchOpen.value) closeSearch()
    else if (allToolsAction.value && !allToolsActionBusy.value) allToolsAction.value = null
    else if (favoriteEditing.value) cancelFavoriteEditing()
    else if (moduleIconMenuOpen.value) {
      moduleIconMenuOpen.value = false
      moduleIconTrigger.value?.focus({ preventScroll: true })
    }
    else if (page.value === 'restoreTools') cancelRestoreTools()
    else if (page.value === 'detection' && !document.querySelector('dialog[open]')) closeDetection()
    else sidebarOpen.value = false
  }
  if (event.isComposing) return
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    if (page.value === 'detection' || websiteDialog.value?.open) return
    event.preventDefault()
    if (!searchOpen.value) openSearch()
    else searchBox.value?.focus({ preventScroll: true })
  }
}

onMounted(() => {
  fullscreenController.reset()
  window.addEventListener('firefly:foreground', syncNativeToolFullscreen)
  window.addEventListener('focus', syncNativeToolFullscreen)
  if (isWindowsApp) {
    void getCurrentWebview().onDragDropEvent((event) => onAppFileDrag(event.payload))
      .then((unlisten) => { if (appUnmounted) unlisten(); else unlistenFileDrop = unlisten })
      .catch(() => { /* File drops remain unavailable if the native listener fails. */ })
  }
  void store.initialize().then(async () => {
    if (!store.loadError) {
      await Promise.all([loadCustomTools(), loadWebsites()])
      void initializeDesktopSettings()
    }
    await handleShortcutLaunch()
  }).finally(() => {
    startupReady.value = true
    if (!store.loadError) scheduleClipboardCheck()
  })
  loadSearchHistory()
  loadSavedOrders()
  loadWallpaper()
  void loadStartupImage()
  void loadSidebarImage()
  window.addEventListener('keydown', onGlobalKey)
  document.addEventListener('pointerdown', onModuleIconPickerPointerDown)
  document.addEventListener('pointerdown', onAllToolsMenuPointerDown)
  window.addEventListener('firefly:native-back', onNativeBack)
  window.addEventListener('firefly:layout-change', onLayoutChange)
  window.addEventListener('blur', cancelLongSwap)
  window.addEventListener('blur', cancelClipboardCheck)
  window.addEventListener('focus', scheduleClipboardCheck)
  window.addEventListener('firefly:foreground', scheduleClipboardCheck)
  window.addEventListener('firefly:foreground', handleShortcutLaunch)
  window.addEventListener('firefly:shortcut-open', onShortcutOpen)
  document.addEventListener('visibilitychange', scheduleClipboardCheck)
  systemDarkTheme.addEventListener('change', applyTheme)
  window.addEventListener('resize', updateWallpaperStage)
  updateNativeBack()
})
onBeforeUnmount(() => {
  appUnmounted = true
  fullscreenController.dispose()
  window.removeEventListener('firefly:foreground', syncNativeToolFullscreen)
  window.removeEventListener('focus', syncNativeToolFullscreen)
  cancelClipboardCheck()
  detectionRevision++
  cancelAppearanceSelection()
  clearTimeout(cacheProgressTimer)
  clearTimeout(webToolLoadingTimer)
  persistModuleDraft()
  closeModulePreview()
  unlistenFileDrop?.()
  websiteFileDragging.value = false
  moduleFileDragging.value = false
  finishConfirmation(false)
  stopBrowserModule()
  cancelLongSwap()
  clearTimeout(suppressClickTimer)
  clearTimeout(moduleTabScrollTimer)
  clearTimeout(groupTabScrollTimer)
  clearTimeout(pageSwipeTimer)
  clearTimeout(groupSwipeTimer)
  clearTimeout(moduleSwipeTimer)
  clearTimeout(clipboardCheckTimer)
  window.removeEventListener('keydown', onGlobalKey)
  document.removeEventListener('pointerdown', onModuleIconPickerPointerDown)
  document.removeEventListener('pointerdown', onAllToolsMenuPointerDown)
  studioTabsResizeObserver?.disconnect()
  groupManagerResizeObserver?.disconnect()
  window.removeEventListener('firefly:native-back', onNativeBack)
  window.removeEventListener('firefly:layout-change', onLayoutChange)
  window.removeEventListener('blur', cancelLongSwap)
  window.removeEventListener('blur', cancelClipboardCheck)
  window.removeEventListener('focus', scheduleClipboardCheck)
  window.removeEventListener('firefly:foreground', scheduleClipboardCheck)
  window.removeEventListener('firefly:foreground', handleShortcutLaunch)
  window.removeEventListener('firefly:shortcut-open', onShortcutOpen)
  document.removeEventListener('visibilitychange', scheduleClipboardCheck)
  systemDarkTheme.removeEventListener('change', applyTheme)
  window.removeEventListener('resize', updateWallpaperStage)
  cancelWallpaperEditing()
  unlistenDesktopSettings?.()
  if (wallpaperUrl.value) URL.revokeObjectURL(wallpaperUrl.value)
  if (startupImageUrl.value) URL.revokeObjectURL(startupImageUrl.value)
  if (sidebarImageUrl.value) URL.revokeObjectURL(sidebarImageUrl.value)
  window.FireflyNavigation?.setBackEnabled(false)
  clearTimeout(toastTimer)
})
</script>

<template>
  <div v-mobile-ripples v-show="startupReady && !shortcutOpening" class="app-shell" :class="{ 'web-tool-opening': webToolOpening, 'editor-open': page === 'editor', 'tab-shell': isTabPage, 'page-home': page === 'home', 'page-all-tools': page === 'allTools', 'studio-shell': page === 'moduleStudio' || page === 'groupManager', 'skill-page-open': page === 'toolAuthorSkill', 'detection-page-open': page === 'detection', 'custom-tool-page-open': page === 'customTool', 'bars-hidden': isTabPage && barsHidden, 'has-wallpaper': wallpaperActive }" :style="wallpaperStyle" :inert="searchOpen || showMobileSplash || webToolOpening" @contextmenu="onAppContextMenu">
    <a class="skip-link" href="#main-content">跳到主要内容</a>
    <div v-if="websiteFileDragging || moduleFileDragging" class="file-drop-hint" role="status">{{ moduleFileDragging ? '松开以导入 .fftool 工具包' : '松开以添加网站快捷方式' }}</div>
    <button v-if="sidebarOpen" class="sidebar-backdrop" aria-label="关闭侧边栏" @click="sidebarOpen = false"></button>

    <aside class="sidebar" :class="{ 'sidebar-visible': sidebarOpen, 'sidebar-image-disabled': !sidebarImageEnabled }" :inert="!sidebarOpen" :aria-hidden="!sidebarOpen" aria-label="流萤百宝箱侧边栏">
      <img v-if="sidebarImageEnabled" class="drawer-art" :class="{ 'drawer-art-custom': sidebarImageUrl }" :src="sidebarImageUrl || drawerWallpaper" alt="" />
      <nav aria-label="主导航" class="side-nav">
        <button v-for="item in sidebarNavigation" :key="item.page" class="nav-button" :class="{ active: page === item.page || (item.page === 'detect' && page === 'detection'), 'mobile-hidden-nav': item.mobileHidden }" :aria-current="page === item.page || (item.page === 'detect' && page === 'detection') ? 'page' : undefined" @click="item.page === 'detect' ? openDetectionFromSidebar() : navigate(item.page)">
          <AppIcon class="nav-icon" :name="item.icon" />{{ item.name }}
        </button>
      </nav>
    </aside>

    <div class="workspace">
      <header class="topbar">
        <div class="top-title">
          <button class="menu-button desktop-menu-button" type="button" :aria-expanded="sidebarOpen" :aria-label="sidebarOpen ? '关闭侧边栏' : '打开侧边栏'" @click="sidebarOpen = !sidebarOpen"><AppIcon name="menu" /></button>
          <template v-if="page === 'editor'">
            <button class="top-icon-button" type="button" :aria-label="`返回${previousPage === 'detection' ? '智能识别' : previousPage === 'allTools' ? '工具管理' : previousPage === 'moduleStudio' ? '工具工作台' : previousPage === 'home' ? '首页' : previousPage === 'favorites' ? '收藏' : '网站'}`" @click="onEditorBack"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg></button>
            <span class="tool-title">{{ activeTool?.name ?? '工具' }}</span>
          </template>
          <template v-else-if="page === 'allTools'">
            <button class="top-icon-button" type="button" :aria-label="allToolsAction || favoriteEditing ? '取消选择' : '返回上一页'" :disabled="allToolsActionBusy || savingFavorites" @click="onAllToolsBack"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg></button>
            <span class="tool-title">{{ allToolsAction ? allToolsActionLabels[allToolsAction] : favoriteEditing ? '添加收藏' : '工具管理' }}</span>
          </template>
          <template v-else-if="isSecondaryPage">
            <button class="top-icon-button" type="button" :aria-label="page === 'restoreTools' ? '返回工具管理' : '返回上一页'" :disabled="repositoryInstalling || (page === 'restoreTools' && restoreSaving) || (page === 'customTool' && customSaving)" @click="goBackStandalone"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg></button>
            <span class="tool-title">{{ secondaryPageTitle }}</span>
          </template>
          <template v-else>
            <button class="menu-button mobile-menu-button" type="button" :aria-expanded="sidebarOpen" :aria-label="sidebarOpen ? '关闭侧边栏' : '打开侧边栏'" @click="sidebarOpen = !sidebarOpen"><AppIcon name="menu" /></button>
            <span class="top-brand">流萤百宝箱<button class="brand-quote" type="button" :title="currentQuote" :aria-label="`当前语句：${currentQuote}。点击更换语句`" @click="changeQuote"><span>{{ currentQuote }}</span></button></span>
          </template>
        </div>
        <div class="top-actions">
          <button v-if="page === 'toolAuthorSkill'" class="text-button top-text-button" type="button" @click="copyToolAuthorSkill">复制全文</button>
          <button v-if="page === 'editor'" class="top-icon-button" type="button" :aria-label="isFavorite ? `取消收藏${activeTool?.name}` : `收藏${activeTool?.name}`" :aria-pressed="isFavorite" @click="toggleFavorite()"><AppIcon name="favorites" :filled="isFavorite" /></button>
          <template v-if="page === 'editor' && activeTool?.custom">
            <button class="top-icon-button" type="button" aria-label="编辑自动化工具" @click="editCustomTool(activeToolId)"><AppIcon name="edit" /></button>
            <button class="top-icon-button delete-top-button" type="button" aria-label="删除自动化工具" @click="removeCustomTool(activeToolId)"><AppIcon name="trash" /></button>
          </template>
          <div v-if="page === 'editor' && activeTool && !activeTool.custom" ref="editorToolMenuRoot" class="all-tools-menu-root">
            <button class="top-icon-button" type="button" aria-label="更多工具操作" aria-haspopup="menu" :aria-expanded="editorToolMenuOpen" :disabled="allToolsActionBusy" @click="editorToolMenuOpen = !editorToolMenuOpen"><AppIcon name="more-vertical" /></button>
            <div v-if="editorToolMenuOpen" class="all-tools-action-menu" role="menu" :aria-label="`${activeTool.name}的操作`">
              <button v-if="activeTool.ui_kind === 'web'" type="button" role="menuitem" @click="toggleActiveWebTool">{{ webToolStopped ? '运行工具' : '停止工具' }}</button>
              <button v-if="activeTool.ui_kind === 'web' && !officialBoxOfficeOpen" type="button" role="menuitem" :disabled="webToolStopped || webToolLoading" @click="enterToolFullscreen">全屏显示</button>
              <button v-for="action in editorToolActions" :key="action" type="button" role="menuitem" @click="applyAllToolsAction(activeTool, action)">{{ allToolsActionLabels[action] }}</button>
            </div>
          </div>
          <template v-else-if="page === 'allTools'">
            <template v-if="favoriteEditing">
              <button class="top-icon-button" type="button" aria-label="反选工具" title="反选工具" :disabled="savingFavorites || !store.tools.length" @click="invertFavoriteSelection"><AppIcon name="invert-selection" /></button>
              <button class="top-icon-button" type="button" aria-label="保存收藏" :disabled="savingFavorites" @click="saveFavorites"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 12 5 5L20 6" /></svg></button>
              <button class="top-icon-button" type="button" aria-label="取消添加收藏" :disabled="savingFavorites" @click="cancelFavoriteEditing"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5 19 19M19 5 5 19" /></svg></button>
            </template>
            <template v-else-if="!allToolsAction">
              <button id="open-custom-tool" class="top-icon-button" type="button" aria-label="创建自动化工具" title="创建自动化工具" @click="createCustomTool"><AppIcon name="automation" /></button>
              <button v-if="supportsJsModules" class="top-icon-button" type="button" aria-label="打开工具工作台" title="工具工作台" @click="openModuleStudio"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5-6 7 6 7M16 5l6 7-6 7M14 3l-4 18" /></svg></button>
              <button class="top-icon-button" type="button" aria-label="添加收藏" @click="beginFavoriteEditing"><AppIcon name="favorites" /></button>
              <div ref="allToolsMenuRoot" class="all-tools-menu-root">
                <button class="top-icon-button" type="button" aria-label="更多工具操作" aria-haspopup="menu" :aria-expanded="allToolsMenuOpen" @click="allToolsMenuOpen = !allToolsMenuOpen"><AppIcon name="more-vertical" /></button>
                <div v-if="allToolsMenuOpen" class="all-tools-action-menu" role="menu" aria-label="工具操作">
                  <template v-for="action in allToolsActions" :key="action"><button type="button" role="menuitem" @click="chooseAllToolsAction(action)">{{ allToolsActionLabels[action] }}</button><button v-if="action === 'delete'" type="button" role="menuitem" @click="openRestoreTools">恢复工具</button></template>
                </div>
              </div>
            </template>
            <template v-else-if="allToolsAction === 'delete'">
              <button class="top-icon-button" type="button" aria-label="反选工具" title="反选工具" :disabled="allToolsActionBusy || !selectableAllTools.length" @click="invertDeleteSelection"><AppIcon name="invert-selection" /></button>
              <button class="top-icon-button" type="button" aria-label="删除所选工具" :disabled="allToolsActionBusy || !selectedDeleteTools.length" @click="deleteSelectedTools"><AppIcon name="check" /></button>
              <button class="top-icon-button" type="button" aria-label="取消删除" :disabled="allToolsActionBusy" @click="allToolsAction = null"><AppIcon name="close" /></button>
            </template>
            <template v-else>
              <button class="top-icon-button" type="button" aria-label="取消选择" :disabled="allToolsActionBusy" @click="allToolsAction = null"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5 19 19M19 5 5 19" /></svg></button>
            </template>
          </template>
          <template v-if="page === 'restoreTools'">
            <button class="top-icon-button" type="button" aria-label="反选工具" title="反选工具" :disabled="restoreLoading || restoreSaving || !deletedBuiltinTools.length" @click="invertRestoreSelection"><AppIcon name="invert-selection" /></button>
            <button class="top-icon-button" type="button" aria-label="恢复所选工具" :disabled="restoreLoading || restoreSaving || !selectedRestoreTools.length" @click="saveRestoredTools"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 12 5 5L20 6" /></svg></button>
            <button class="top-icon-button" type="button" aria-label="取消恢复" :disabled="restoreSaving" @click="cancelRestoreTools"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5 19 19M19 5 5 19" /></svg></button>
          </template>
          <button v-if="page === 'groupManager'" class="top-icon-button add-button" type="button" :aria-label="`新建${groupManagerTab === 'home' ? '首页工具' : groupManagerTab === 'favorites' ? '收藏工具' : '网站'}分组`" title="新建分组" @click="openGroupCreateDialog">＋</button>
          <button v-else-if="page === 'websites'" class="top-icon-button add-button" type="button" aria-label="添加网站" @click="editWebsite()">＋</button>
          <button v-if="isTabPage" class="top-icon-button search-trigger" type="button" aria-label="搜索" @click="openSearch"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></svg></button>
        </div>
      </header>

      <main id="main-content" class="main-content" :class="{ 'tab-main': isTabPage, 'module-studio-main': page === 'moduleStudio' || page === 'groupManager', 'tool-author-skill-main': page === 'toolAuthorSkill' }" tabindex="-1" @touchstart.passive="onStudioTouchStart" @touchmove="onStudioTouchMove" @touchend="onStudioTouchEnd" @touchcancel="onStudioTouchCancel">
        <div v-if="store.loading" class="empty-state" role="status">正在加载本地工具…</div>
        <div v-else-if="store.loadError" class="empty-state error-state" role="alert">{{ store.loadError }}</div>

        <div v-else-if="isTabPage" ref="pageSwipeViewport" class="tab-viewport" @touchstart.passive="onPageTouchStart" @touchmove="onPageTouchMove" @touchend="onPageTouchEnd" @touchcancel="onPageTouchCancel">
          <div class="tab-track" :class="{ 'tab-track-settling': pageSwipeSettling }" :style="{ transform: pageTrackTransform }">
          <section class="tab-panel" :class="{ 'tab-panel-active': page === 'home' }" :inert="page !== 'home' || undefined" :aria-hidden="page !== 'home'" @scroll.passive="onTabScroll($event, 'home')">
          <section class="content-section home-categories">
            <div v-if="usageStatsEnabled && store.recentTools.length" class="recent-tools"><h2>最近使用</h2><div class="recent-tool-list"><button v-for="tool in store.recentTools.slice(0, 6)" :key="tool.id" class="secondary-button" type="button" @click="openTool(tool.id)">{{ tool.name }}</button></div></div>
            <div v-if="!store.tools.length" class="empty-state empty-illustrated"><img class="empty-state-illustration" :src="noTools" alt="" /><h3>还没有保存的工具</h3><p>在工具工作台中可手动导入或者自行创建工具</p><button v-if="supportsJsModules" class="primary-button" type="button" @click="openModuleStudio">添加工具</button></div>
            <div v-for="category in categories" v-else :key="category.id" class="category" data-swap-scope="categories" :data-swap-id="category.id" data-swap-group-target="homeTools" :data-group-id="category.id" :class="{ 'ungrouped-flat': categories.length === 1 && category.id === HOME_OTHER_GROUP, 'swap-origin': activeSwap?.scope === 'categories' && activeSwap.id === category.id, 'swap-target': activeSwap?.scope === 'categories' && activeSwap.targetId === category.id && activeSwap.id !== category.id, 'tool-group-target': activeSwap?.scope === 'homeTools' && activeSwap.targetGroup === category.id && activeSwap.group !== category.id }">
              <button class="category-header" :aria-expanded="expanded.includes(category.id)" :aria-controls="`category-${category.id}`" @click="onCategoryClick(category.id, $event)" @touchstart.passive="onSortTouchStart($event, 'categories', category.id)" @touchmove="onSortTouchMove" @touchend="onSortTouchEnd" @touchcancel="cancelLongSwap" @pointerdown="onSortPointerDown($event, 'categories', category.id)" @pointermove="onSortPointerMove" @pointerup="onSortPointerUp" @pointercancel="cancelLongSwap">
                <span class="category-stripe"></span><span class="category-label category-label-count"><strong>{{ category.name }}</strong><span class="category-count">{{ category.tools.length }} 个工具</span></span><span class="chevron" :class="{ open: expanded.includes(category.id) }" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7" /></svg></span>
              </button>
              <div v-show="expanded.includes(category.id) || (categories.length === 1 && category.id === HOME_OTHER_GROUP)" :id="`category-${category.id}`" class="category-tools">
                <span v-if="!category.tools.length" class="group-empty-drop">暂无工具，可手动添加或长按拖动其他卡片里的工具到这里</span>
                <button v-for="tool in category.tools" :key="tool.id" class="tool-pill" data-swap-scope="homeTools" :data-swap-group="category.id" :data-swap-id="tool.id" :class="{ 'swap-origin': activeSwap?.scope === 'homeTools' && activeSwap.id === tool.id, 'swap-target': activeSwap?.scope === 'homeTools' && activeSwap.targetId === tool.id && activeSwap.id !== tool.id }" @click="onHomeToolClick(tool.id, $event)" @touchstart.passive="onSortTouchStart($event, 'homeTools', tool.id, category.id)" @touchmove="onSortTouchMove" @touchend="onSortTouchEnd" @touchcancel="cancelLongSwap" @pointerdown="onSortPointerDown($event, 'homeTools', tool.id, category.id)" @pointermove="onSortPointerMove" @pointerup="onSortPointerUp" @pointercancel="cancelLongSwap"><span v-if="tool.icon_data || tool.icon" aria-hidden="true"><img v-if="tool.icon_data" :src="tool.icon_data" alt="" /><AppIcon v-else-if="tool.icon" :name="`module-${tool.icon}`" /></span>{{ tool.name }}<AppIcon v-if="store.favorites.includes(tool.id)" class="favorite-mark" name="favorites" filled /><span v-if="store.favorites.includes(tool.id)" class="sr-only">已收藏</span></button>
              </div>
            </div>
          </section>
          </section>

          <section class="tab-panel" :class="{ 'tab-panel-active': page === 'favorites' }" :inert="page !== 'favorites' || undefined" :aria-hidden="page !== 'favorites'" @scroll.passive="onTabScroll($event, 'favorites')">
          <section class="content-section first-section">
            <div v-if="!store.favoriteTools.length && (!favoriteGroupSettings.enabled || favoriteCategories.length === 1)" class="empty-state empty-illustrated"><img class="empty-state-illustration" :src="noBookmarkingTools" alt="" /><h3>还没有收藏的工具</h3><p>在工具管理中选择想收藏的工具。</p><button class="primary-button" @click="navigate('allTools')">工具管理</button></div>
            <div v-else-if="!favoriteGroupSettings.enabled || favoriteCategories.length === 1" class="tool-grid"><button v-for="tool in orderedFavoriteTools" :key="tool.id" class="favorite-card" data-swap-scope="favorites" :data-swap-id="tool.id" :class="{ 'swap-origin': activeSwap?.scope === 'favorites' && activeSwap.id === tool.id, 'swap-target': activeSwap?.scope === 'favorites' && activeSwap.targetId === tool.id && activeSwap.id !== tool.id }" @click="onFavoriteClick(tool.id, $event)" @touchstart.passive="onSortTouchStart($event, 'favorites', tool.id)" @touchmove="onSortTouchMove" @touchend="onSortTouchEnd" @touchcancel="cancelLongSwap" @pointerdown="onSortPointerDown($event, 'favorites', tool.id)" @pointermove="onSortPointerMove" @pointerup="onSortPointerUp" @pointercancel="cancelLongSwap"><span v-if="tool.icon_data || tool.icon" class="tool-glyph" aria-hidden="true"><img v-if="tool.icon_data" :src="tool.icon_data" alt="" /><AppIcon v-else-if="tool.icon" :name="`module-${tool.icon}`" /></span><strong>{{ tool.name }}</strong></button></div>
            <div v-else class="favorite-categories">
              <div v-for="group in visibleFavoriteCategories" :key="group.id" class="category" data-swap-scope="favoriteGroups" :data-swap-id="group.id" data-swap-group-target="favoriteTools" :data-group-id="group.id" :class="{ 'swap-origin': activeSwap?.scope === 'favoriteGroups' && activeSwap.id === group.id, 'swap-target': activeSwap?.scope === 'favoriteGroups' && activeSwap.targetId === group.id && activeSwap.id !== group.id, 'tool-group-target': activeSwap?.scope === 'favoriteTools' && activeSwap.targetGroup === group.id && activeSwap.group !== group.id }">
                <button class="category-header" type="button" :aria-expanded="expanded.includes(group.id)" :aria-controls="`favorite-category-${group.id}`" @click="onFavoriteGroupClick(group.id, $event)" @touchstart.passive="onSortTouchStart($event, 'favoriteGroups', group.id)" @touchmove="onSortTouchMove" @touchend="onSortTouchEnd" @touchcancel="cancelLongSwap" @pointerdown="onSortPointerDown($event, 'favoriteGroups', group.id)" @pointermove="onSortPointerMove" @pointerup="onSortPointerUp" @pointercancel="cancelLongSwap"><span class="category-stripe"></span><span class="category-label category-label-count"><strong>{{ group.name }}</strong><span class="category-count">{{ group.tools.length }} 个工具</span></span><span class="chevron" :class="{ open: expanded.includes(group.id) }" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7" /></svg></span></button>
                <div v-show="expanded.includes(group.id)" :id="`favorite-category-${group.id}`" class="category-tools">
                  <span v-if="!group.tools.length" class="group-empty-drop">暂无工具，可手动添加或长按拖动其他卡片里的工具到这里</span>
                  <button v-for="tool in group.tools" :key="tool.id" class="tool-pill" type="button" data-swap-scope="favoriteTools" :data-swap-group="group.id" :data-swap-id="tool.id" :class="{ 'swap-origin': activeSwap?.scope === 'favoriteTools' && activeSwap.id === tool.id, 'swap-target': activeSwap?.scope === 'favoriteTools' && activeSwap.targetId === tool.id && activeSwap.id !== tool.id }" @click="onFavoriteClick(tool.id, $event)" @touchstart.passive="onSortTouchStart($event, 'favoriteTools', tool.id, group.id)" @touchmove="onSortTouchMove" @touchend="onSortTouchEnd" @touchcancel="cancelLongSwap" @pointerdown="onSortPointerDown($event, 'favoriteTools', tool.id, group.id)" @pointermove="onSortPointerMove" @pointerup="onSortPointerUp" @pointercancel="cancelLongSwap"><span v-if="tool.icon_data || tool.icon" aria-hidden="true"><img v-if="tool.icon_data" :src="tool.icon_data" alt="" /><AppIcon v-else-if="tool.icon" :name="`module-${tool.icon}`" /></span>{{ tool.name }}</button>
                </div>
              </div>
            </div>
          </section>
          </section>

          <section class="tab-panel" :class="{ 'tab-panel-active': page === 'websites' }" :inert="page !== 'websites' || undefined" :aria-hidden="page !== 'websites'" @scroll.passive="onTabScroll($event, 'websites')">
          <section class="content-section first-section">
            <p v-if="websiteError && !websiteDialog?.open" class="error-text" role="alert">{{ websiteError }}</p>
            <div v-if="!websites.length && (!websiteGroupSettings.enabled || websiteCategories.length === 1)" class="empty-state empty-illustrated"><img class="empty-state-illustration" :src="noWebsite" alt="" /><h3>还没有保存的网站</h3><p>自行添加常用的在线网站，点击后在应用内打开。</p><button class="primary-button" type="button" @click="editWebsite()">添加网站</button></div>
            <template v-else>
              <div v-if="!websiteGroupSettings.enabled || websiteCategories.length === 1" class="website-grid">
                <article v-for="site in orderedWebsites" :key="site.id" class="website-row" data-swap-scope="websites" :data-swap-id="String(site.id)" :class="{ 'swap-origin': activeSwap?.scope === 'websites' && activeSwap.id === String(site.id), 'swap-target': activeSwap?.scope === 'websites' && activeSwap.targetId === String(site.id) && activeSwap.id !== String(site.id) }" @click="onWebsiteCardClick(site, $event)" @touchstart.passive="onSortTouchStart($event, 'websites', String(site.id))" @touchmove="onSortTouchMove" @touchend="onSortTouchEnd" @touchcancel="cancelLongSwap" @pointerdown="onSortPointerDown($event, 'websites', String(site.id))" @pointermove="onSortPointerMove" @pointerup="onSortPointerUp" @pointercancel="cancelLongSwap">
                  <button class="website-open" type="button" :aria-label="`打开${site.name}`"><span class="website-avatar" aria-hidden="true">{{ site.name.slice(0, 1) }}</span><span class="website-text"><strong>{{ site.name }}</strong><small class="website-domain">{{ websiteDomain(site.url) }}</small><span v-if="site.description" class="website-description">{{ site.description }}</span><small v-else class="website-url-fallback">{{ site.url }}</small></span></button>
                  <button class="website-menu-button" type="button" :aria-label="`${site.name}的更多操作`" @click.stop="openWebsiteActions(site)">···</button>
                </article>
              </div>
              <div v-else class="website-categories">
                <div v-for="group in visibleWebsiteCategories" :key="group.id" class="category website-group" data-swap-scope="websiteGroups" :data-swap-id="group.id" data-swap-group-target="websites" :data-group-id="group.id" :class="{ 'swap-origin': activeSwap?.scope === 'websiteGroups' && activeSwap.id === group.id, 'swap-target': activeSwap?.scope === 'websiteGroups' && activeSwap.targetId === group.id && activeSwap.id !== group.id, 'tool-group-target': activeSwap?.scope === 'websites' && activeSwap.targetGroup === group.id && activeSwap.group !== group.id }">
                  <button class="category-header" type="button" :aria-expanded="expanded.includes(group.id)" :aria-controls="`website-category-${group.id}`" @click="onWebsiteGroupClick(group.id, $event)" @touchstart.passive="onSortTouchStart($event, 'websiteGroups', group.id)" @touchmove="onSortTouchMove" @touchend="onSortTouchEnd" @touchcancel="cancelLongSwap" @pointerdown="onSortPointerDown($event, 'websiteGroups', group.id)" @pointermove="onSortPointerMove" @pointerup="onSortPointerUp" @pointercancel="cancelLongSwap"><span class="category-stripe"></span><span class="category-label category-label-count"><strong>{{ group.name }}</strong><span class="category-count">{{ group.sites.length }} 个网站</span></span><span class="chevron" :class="{ open: expanded.includes(group.id) }" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7" /></svg></span></button>
                  <div v-show="expanded.includes(group.id)" :id="`website-category-${group.id}`" class="website-grid website-group-list">
                    <span v-if="!group.sites.length" class="group-empty-drop">暂无网站，可手动添加或长按拖动其他卡片里的网站到这里</span>
                    <article v-for="site in group.sites" :key="site.id" class="website-row" data-swap-scope="websites" :data-swap-id="String(site.id)" :data-swap-group="group.id" :class="{ 'swap-origin': activeSwap?.scope === 'websites' && activeSwap.id === String(site.id), 'swap-target': activeSwap?.scope === 'websites' && activeSwap.targetId === String(site.id) && activeSwap.id !== String(site.id) }" @click="onWebsiteCardClick(site, $event)" @touchstart.passive="onSortTouchStart($event, 'websites', String(site.id), group.id)" @touchmove="onSortTouchMove" @touchend="onSortTouchEnd" @touchcancel="cancelLongSwap" @pointerdown="onSortPointerDown($event, 'websites', String(site.id), group.id)" @pointermove="onSortPointerMove" @pointerup="onSortPointerUp" @pointercancel="cancelLongSwap">
                      <button class="website-open" type="button" :aria-label="`打开${site.name}`"><span class="website-avatar" aria-hidden="true">{{ site.name.slice(0, 1) }}</span><span class="website-text"><strong>{{ site.name }}</strong><small class="website-domain">{{ websiteDomain(site.url) }}</small><span v-if="site.description" class="website-description">{{ site.description }}</span><small v-else class="website-url-fallback">{{ site.url }}</small></span></button>
                      <button class="website-menu-button" type="button" :aria-label="`${site.name}的更多操作`" @click.stop="openWebsiteActions(site)">···</button>
                    </article>
                  </div>
                </div>
              </div>
            </template>
          </section>
          </section>
          </div>
        </div>

        <template v-else-if="page === 'allTools'">
          <section class="content-section first-section" :class="{ 'all-tools-grid': store.tools.length && !allToolsAction, 'all-tools-action-grid': !!allToolsAction }" :aria-label="allToolsAction ? allToolsActionLabels[allToolsAction] : favoriteEditing ? '选择收藏的工具' : '工具管理'">
            <p v-if="allToolsAction" class="all-tools-action-hint">{{ allToolsActionHint[allToolsAction] }}{{ allToolsAction === 'delete' && selectedDeleteTools.length ? `已选择 ${selectedDeleteTools.length} 个。` : '' }}</p>
            <div v-if="allToolsAction && !selectableAllTools.length" class="all-tools-action-empty empty-state empty-illustrated">
              <img class="empty-state-illustration" :src="noAvailableTools" alt="" />
              <h3>{{ allToolsAction === 'delete' ? '没有可删除的工具' : '没有可编辑的工具' }}</h3>
              <p>已安装的工具会显示在这里。</p>
            </div>
            <div v-else-if="!store.tools.length" class="empty-state empty-illustrated"><img class="empty-state-illustration" :src="noAllTools" alt="" /><h3>还没有保存的工具</h3><p>可手动导入或者自行创建工具。</p><button v-if="supportsJsModules" class="primary-button" type="button" @click="openModuleStudio">添加工具</button></div>
            <button v-for="tool in (allToolsAction ? selectableAllTools : store.tools)" :key="tool.id" class="all-tool-item" type="button" :disabled="allToolsActionBusy || savingFavorites" :aria-pressed="allToolsAction === 'delete' ? selectedDeleteTools.includes(tool.id) : favoriteEditing ? selectedFavorites.includes(tool.id) : undefined" @click="allToolsAction === 'delete' ? toggleSelectedDelete(tool.id) : allToolsAction ? applyAllToolsAction(tool) : favoriteEditing ? toggleSelectedFavorite(tool.id) : openTool(tool.id)">
              <span v-if="tool.icon_data || tool.icon" class="all-tool-glyph" aria-hidden="true"><img v-if="tool.icon_data" :src="tool.icon_data" alt="" /><AppIcon v-else-if="tool.icon" :name="`module-${tool.icon}`" /></span><span class="all-tool-name">{{ tool.name }}</span><small class="all-tool-source">{{ tool.custom ? '自动化' : tool.builtin ? '应用自带' : '导入/创建工具' }}</small>
              <span v-if="favoriteEditing || allToolsAction === 'delete'" class="selection-box" :class="{ selected: allToolsAction === 'delete' ? selectedDeleteTools.includes(tool.id) : selectedFavorites.includes(tool.id) }" aria-hidden="true"><svg v-if="allToolsAction === 'delete' ? selectedDeleteTools.includes(tool.id) : selectedFavorites.includes(tool.id)" viewBox="0 0 24 24"><path d="m4 12 5 5L20 6" /></svg></span>
            </button>
          </section>
        </template>

        <section v-else-if="page === 'restoreTools'" class="content-section first-section restore-tools-page" aria-label="恢复应用自带工具">
          <p class="restore-tools-notice">选择要恢复的应用自带工具，再点击右上角的对号。{{ selectedRestoreTools.length ? `已选择 ${selectedRestoreTools.length} 个` : '' }}</p>
          <p v-if="restoreLoading" role="status">正在读取已删除工具…</p>
          <div v-else-if="restoreError" class="restore-tools-error"><p class="error-text" role="alert">{{ restoreError }}</p><button class="secondary-button" type="button" :disabled="restoreSaving" @click="loadDeletedBuiltinTools">重新读取</button></div>
          <div v-if="!restoreLoading && deletedBuiltinTools.length" class="restore-tool-grid">
            <button v-for="tool in deletedBuiltinTools" :key="tool.id" class="restore-tool-card" :class="{ selected: selectedRestoreTools.includes(tool.id) }" type="button" :disabled="restoreSaving" :aria-pressed="selectedRestoreTools.includes(tool.id)" @click="toggleRestoreTool(tool.id)">
              <span class="restore-tool-copy"><strong>{{ tool.name }}</strong><small>{{ tool.category }}</small><span>{{ tool.description }}</span></span><span class="selection-box" :class="{ selected: selectedRestoreTools.includes(tool.id) }" aria-hidden="true"><svg v-if="selectedRestoreTools.includes(tool.id)" viewBox="0 0 24 24"><path d="m4 12 5 5L20 6" /></svg></span>
            </button>
          </div>
          <div v-else-if="!restoreLoading && !restoreError" class="empty-state empty-illustrated"><img class="empty-state-illustration" :src="noAvailableTools" alt="" /><h3>没有可恢复的工具</h3><p>已删除的应用自带工具会显示在这里。</p></div>
        </section>

        <section v-else-if="page === 'shortcuts'" class="content-section first-section shortcut-page" aria-label="快捷方式">
          <div v-if="isAndroidApp" class="module-panel shortcut-permission-card">
            <h2>移动端授权提示</h2>
            <p>需要在应用权限中允许“创建桌面快捷方式”。点击下方按钮打开本应用的系统设置页，找到该权限后开启。</p>
            <button class="secondary-button" type="button" :disabled="shortcutSettingsBusy" @click="openShortcutSettings">打开应用授权页面</button>
          </div>
          <div class="module-panel shortcut-create-card">
            <h2>创建桌面快捷方式</h2>
            <p>选择图片、名称和工具，点击桌面图标即可直接打开对应工具。</p>
            <form class="shortcut-form" :aria-busy="shortcutBusy" @submit.prevent="createShortcut">
              <div class="shortcut-image-row"><img :src="shortcutIconData || appIcon" alt="快捷方式图片预览" /><div><strong>快捷方式图片</strong><small>支持 SVG、PNG、JPEG、WebP，最大 1 MiB；留空使用应用图标。</small><div class="shortcut-image-actions"><button class="secondary-button" type="button" :disabled="shortcutBusy" @click="chooseShortcutImage">{{ shortcutImageLoading ? '正在读取图片…' : '选择图片' }}</button><button v-if="shortcutIconData" class="text-button" type="button" :disabled="shortcutBusy" @click="resetShortcutImage">恢复应用图标</button></div></div></div>
              <label for="shortcut-name">快捷方式名字<input id="shortcut-name" v-model="shortcutName" :disabled="shortcutBusy" required maxlength="40" placeholder="例如：图片亮度处理" @input="clearShortcutFeedback" /></label>
              <label for="shortcut-tool">对应工具<ViewportSelect id="shortcut-tool" :model-value="shortcutToolId" :disabled="shortcutBusy" :options="store.tools.map((tool) => ({ value: tool.id, label: tool.name }))" ariaLabel="对应工具" placeholder="请选择工具" required @update:modelValue="(value) => { shortcutToolId = value; onShortcutToolChange() }" /></label>
              <p v-if="isWindowsApp" class="module-hint">Windows 快捷方式会指向当前应用程序；移动应用程序文件后，需重新创建。</p>
              <p v-if="shortcutError" class="error-text" role="alert">{{ shortcutError }}</p>
              <p v-if="shortcutNotice" class="module-studio-notice" role="status">{{ shortcutNotice }}</p>
              <button class="primary-button" type="submit" :disabled="shortcutBusy || !store.tools.length">{{ shortcutImageLoading ? '正在读取图片…' : shortcutBusy ? '创建中…' : '创建快捷方式' }}</button>
            </form>
          </div>
        </section>

        <ToolDownloadPage v-else-if="page === 'toolDownloads'" ref="toolDownloadsPage" :refresh-tools="refreshRepositoryTools" :can-present="!searchOpen && !sidebarOpen && !remoteMessagesOpen && !showMobileSplash" @busy-change="onRepositoryBusy" @open="openRepositoryTool" @notify="notify" />
        <section v-else-if="page === 'groupManager'" class="content-section first-section module-studio group-manager" aria-label="分组管理">
          <nav class="module-studio-tabs group-manager-tabs" :class="{ 'tabs-scrolling': groupTabsScrolling, 'tabs-swiping': groupTabsSwiping }" role="tablist" aria-label="分组管理页面">
            <div class="module-studio-tab-scroll" @scroll.passive="onGroupManagerTabsScroll">
              <button v-for="(tab, index) in groupManagerTabs" :key="tab.id" :id="`group-tab-${tab.id}`" :data-group-tab="tab.id" type="button" role="tab" :aria-selected="groupManagerTab === tab.id" :aria-controls="`group-panel-${tab.id}`" :tabindex="groupManagerTab === tab.id ? 0 : -1" :class="{ active: groupManagerTab === tab.id }" @click="setGroupManagerTab(tab.id)" @keydown="onGroupManagerTabKeydown($event, index)"><AppIcon :name="tab.icon" /><span>{{ tab.label }}</span></button>
            </div>
            <span class="module-studio-tab-indicator" :style="groupManagerIndicatorStyle" aria-hidden="true"></span>
          </nav>
          <div class="module-studio-content group-manager-content">
            <p v-if="groupManagerError" class="error-text module-page-error" role="alert">{{ groupManagerError }}</p>
            <div ref="groupSwipeViewport" class="module-studio-panel-viewport">
            <div class="module-studio-panel-stage" :class="{ 'panel-stage-settling': groupSwipeSettling }" :style="{ transform: groupTrackTransform }">
            <template v-for="tab in groupManagerTabs" :key="tab.id">
              <section v-if="tab.id !== 'websites'" :id="`group-panel-${tab.id}`" class="module-studio-tab-panel" :class="{ 'panel-active': groupManagerTab === tab.id, 'panel-neighbor': swipePanelBetween(groupManagerTabs, groupManagerTab, groupSwipeNeighbor, tab.id) }" :inert="groupManagerTab !== tab.id || undefined" :aria-hidden="groupManagerTab !== tab.id" role="tabpanel" :aria-labelledby="`group-tab-${tab.id}`">
                <div class="group-manager-hero"><p>分组卡片长按可排序，分组卡片内工具可长按在分组内或不同分组间排序。</p></div>
                <div class="group-manager-list-heading"><h3>{{ tab.id === 'home' ? '首页工具分组' : '收藏工具分组' }}</h3><span>{{ managedGroupsFor(tab.id).length }} 个分组 · {{ managedToolCountFor(tab.id) }} 个工具</span></div>
                <div v-for="group in managedGroupsFor(tab.id)" :key="group.id" class="category group-manager-card" :data-swap-scope="tab.id === 'home' ? 'categories' : 'favoriteGroups'" :data-swap-id="group.id" :data-swap-group-target="managedToolSortScopeFor(tab.id)" :data-group-id="group.id" :class="{ 'swap-origin': activeSwap?.scope === (tab.id === 'home' ? 'categories' : 'favoriteGroups') && activeSwap.id === group.id, 'swap-target': activeSwap?.scope === (tab.id === 'home' ? 'categories' : 'favoriteGroups') && activeSwap.targetId === group.id && activeSwap.id !== group.id, 'tool-group-target': activeSwap?.scope === managedToolSortScopeFor(tab.id) && activeSwap.targetGroup === group.id && activeSwap.group !== group.id }">
                  <div class="category-header group-manager-card-header" @click="onManagedGroupClick(group.id, $event)" @touchstart.passive="onSortTouchStart($event, tab.id === 'home' ? 'categories' : 'favoriteGroups', group.id)" @touchmove="onSortTouchMove" @touchend="onSortTouchEnd" @touchcancel="cancelLongSwap" @pointerdown="onSortPointerDown($event, tab.id === 'home' ? 'categories' : 'favoriteGroups', group.id)" @pointermove="onSortPointerMove" @pointerup="onSortPointerUp" @pointercancel="cancelLongSwap">
                    <button class="group-manager-card-toggle" type="button" :aria-expanded="managerExpanded.includes(group.id)" :aria-controls="`managed-group-${group.id}`"><span class="category-stripe"></span><span class="category-label"><strong>{{ group.name }}</strong><small>{{ group.tools.length }} 个工具</small></span></button>
                    <div v-if="group.id !== HOME_OTHER_GROUP && group.id !== FAVORITE_UNGROUPED" class="group-manager-card-actions"><button class="text-button" type="button" @click.stop="beginGroupRename(group.id, group.name)">重命名</button><button class="text-button delete-action" type="button" @click.stop="deleteManagedGroup(group.id, group.name)">删除</button></div>
                    <button class="group-manager-chevron-button" type="button" :aria-label="managerExpanded.includes(group.id) ? `收起${group.name}` : `展开${group.name}`" :aria-expanded="managerExpanded.includes(group.id)" :aria-controls="`managed-group-${group.id}`"><span class="chevron" :class="{ open: managerExpanded.includes(group.id) }" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7" /></svg></span></button>
                  </div>
                  <div v-show="managerExpanded.includes(group.id)" :id="`managed-group-${group.id}`" class="group-manager-card-body">
                    <form v-if="editingGroupId === group.id" class="group-manager-rename" @submit.prevent="saveGroupRename"><label :for="`rename-${group.id}`">分组名称</label><div><input :id="`rename-${group.id}`" v-model="editingGroupName" required maxlength="40" /><button class="primary-button" type="submit">保存</button><button class="secondary-button" type="button" @click="editingGroupId = ''">取消</button></div></form>
                    <div class="category-tools group-manager-tool-list"><span v-if="!group.tools.length" class="group-empty-drop">暂无工具，可手动添加或长按拖动其他卡片里的工具到这里</span><span v-for="tool in group.tools" :key="tool.id" class="tool-pill group-manager-tool-pill" :data-swap-scope="managedToolSortScopeFor(tab.id)" :data-swap-id="tool.id" :data-swap-group="group.id" :class="{ 'no-remove-action': group.id === HOME_OTHER_GROUP || group.id === FAVORITE_UNGROUPED, 'swap-origin': activeSwap?.scope === managedToolSortScopeFor(tab.id) && activeSwap.id === tool.id, 'swap-target': activeSwap?.scope === managedToolSortScopeFor(tab.id) && activeSwap.targetId === tool.id && activeSwap.id !== tool.id }" @touchstart.passive="onSortTouchStart($event, managedToolSortScopeFor(tab.id), tool.id, group.id)" @touchmove="onSortTouchMove" @touchend="onSortTouchEnd" @touchcancel="cancelLongSwap" @pointerdown="onSortPointerDown($event, managedToolSortScopeFor(tab.id), tool.id, group.id)" @pointermove="onSortPointerMove" @pointerup="onSortPointerUp" @pointercancel="cancelLongSwap"><span v-if="tool.icon_data || tool.icon" aria-hidden="true"><img v-if="tool.icon_data" :src="tool.icon_data" alt="" /><AppIcon v-else-if="tool.icon" :name="`module-${tool.icon}`" /></span>{{ tool.name }}<button v-if="group.id !== HOME_OTHER_GROUP && group.id !== FAVORITE_UNGROUPED" class="group-manager-remove-tool" type="button" :aria-label="`将${tool.name}移到未分组`" title="移到未分组" @click.stop="tab.id === 'home' ? moveHomeToolToOther(tool.id) : assignFavoriteTool(tool.id, FAVORITE_UNGROUPED)">×</button></span></div>
                    <label class="group-manager-add-tool"><span>加入工具</span><ViewportSelect :model-value="''" :disabled="!availableGroupTools(group.id, tab.id).length" :ariaLabel="`选择工具加入${group.name}`" :placeholder="availableGroupTools(group.id, tab.id).length ? '选择现有工具…' : '没有可加入的工具'" :options="availableGroupTools(group.id, tab.id).map((tool) => ({ value: tool.id, label: tool.name + (tab.id === 'home' ? ` · ${homeGroupName(homeGroupId(tool))}` : '') }))" @update:modelValue="addToolToManagedGroup($event, group.id)" /></label>
                  </div>
                </div>
              </section>
              <section v-else id="group-panel-websites" class="module-studio-tab-panel" :class="{ 'panel-active': groupManagerTab === tab.id, 'panel-neighbor': swipePanelBetween(groupManagerTabs, groupManagerTab, groupSwipeNeighbor, tab.id) }" :inert="groupManagerTab !== tab.id || undefined" :aria-hidden="groupManagerTab !== tab.id" role="tabpanel" aria-labelledby="group-tab-websites">
                <div class="group-manager-hero"><p>分组卡片长按可排序，分组卡片内网站可长按在分组内或不同分组间排序。</p></div>
                <div class="group-manager-list-heading"><h3>网站分组</h3><span>{{ websiteCategories.length }} 个分组 · {{ websites.length }} 个网站</span></div>
                <div v-for="group in websiteCategories" :key="group.id" class="category group-manager-card" data-swap-scope="websiteGroups" :data-swap-id="group.id" data-swap-group-target="websites" :data-group-id="group.id" :class="{ 'swap-origin': activeSwap?.scope === 'websiteGroups' && activeSwap.id === group.id, 'swap-target': activeSwap?.scope === 'websiteGroups' && activeSwap.targetId === group.id && activeSwap.id !== group.id, 'tool-group-target': activeSwap?.scope === 'websites' && activeSwap.targetGroup === group.id && activeSwap.group !== group.id }">
                  <div class="category-header group-manager-card-header" @click="onManagedGroupClick(group.id, $event)" @touchstart.passive="onSortTouchStart($event, 'websiteGroups', group.id)" @touchmove="onSortTouchMove" @touchend="onSortTouchEnd" @touchcancel="cancelLongSwap" @pointerdown="onSortPointerDown($event, 'websiteGroups', group.id)" @pointermove="onSortPointerMove" @pointerup="onSortPointerUp" @pointercancel="cancelLongSwap">
                    <button class="group-manager-card-toggle" type="button" :aria-expanded="managerExpanded.includes(group.id)" :aria-controls="`managed-website-group-${group.id}`"><span class="category-stripe"></span><span class="category-label"><strong>{{ group.name }}</strong><small>{{ group.sites.length }} 个网站</small></span></button>
                    <div v-if="group.id !== WEBSITE_UNGROUPED" class="group-manager-card-actions"><button class="text-button" type="button" @click.stop="beginGroupRename(group.id, group.name)">重命名</button><button class="text-button delete-action" type="button" @click.stop="deleteManagedGroup(group.id, group.name)">删除</button></div>
                    <button class="group-manager-chevron-button" type="button" :aria-label="managerExpanded.includes(group.id) ? `收起${group.name}` : `展开${group.name}`" :aria-expanded="managerExpanded.includes(group.id)" :aria-controls="`managed-website-group-${group.id}`"><span class="chevron" :class="{ open: managerExpanded.includes(group.id) }" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7" /></svg></span></button>
                  </div>
                  <div v-show="managerExpanded.includes(group.id)" :id="`managed-website-group-${group.id}`" class="group-manager-card-body">
                    <form v-if="editingGroupId === group.id" class="group-manager-rename" @submit.prevent="saveGroupRename"><label :for="`rename-${group.id}`">分组名称</label><div><input :id="`rename-${group.id}`" v-model="editingGroupName" required maxlength="40" /><button class="primary-button" type="submit">保存</button><button class="secondary-button" type="button" @click="editingGroupId = ''">取消</button></div></form>
                    <div class="website-grid website-group-list website-manager-list">
                      <span v-if="!group.sites.length" class="group-empty-drop">暂无网站，可手动添加或长按拖动其他卡片里的网站到这里</span>
                      <article v-for="site in group.sites" :key="site.id" class="website-row" data-swap-scope="websites" :data-swap-id="String(site.id)" :data-swap-group="group.id" :title="`长按拖动${site.name}`" :class="{ 'swap-origin': activeSwap?.scope === 'websites' && activeSwap.id === String(site.id), 'swap-target': activeSwap?.scope === 'websites' && activeSwap.targetId === String(site.id) && activeSwap.id !== String(site.id) }" @touchstart.passive="onSortTouchStart($event, 'websites', String(site.id), group.id)" @touchmove="onSortTouchMove" @touchend="onSortTouchEnd" @touchcancel="cancelLongSwap" @pointerdown="onSortPointerDown($event, 'websites', String(site.id), group.id)" @pointermove="onSortPointerMove" @pointerup="onSortPointerUp" @pointercancel="cancelLongSwap">
                        <div class="website-open"><span class="website-avatar" aria-hidden="true">{{ site.name.slice(0, 1) }}</span><span class="website-text"><strong>{{ site.name }}</strong><small class="website-domain">{{ websiteDomain(site.url) }}</small><span v-if="site.description" class="website-description">{{ site.description }}</span><small v-else class="website-url-fallback">{{ site.url }}</small></span></div>
                        <button v-if="group.id !== WEBSITE_UNGROUPED" class="website-manager-move" type="button" :aria-label="`将${site.name}移到未分组`" @click.stop="assignWebsite(site.id, WEBSITE_UNGROUPED)">移出</button>
                      </article>
                    </div>
                    <label class="group-manager-add-tool"><span>加入网站</span><ViewportSelect :model-value="''" :disabled="!availableWebsiteSites(group.id).length" :ariaLabel="`选择网站加入${group.name}`" :placeholder="availableWebsiteSites(group.id).length ? '选择现有网站…' : '没有可加入的网站'" :options="availableWebsiteSites(group.id).map((site) => ({ value: String(site.id), label: `${site.name} · ${websiteDomain(site.url)}` }))" @update:modelValue="addWebsiteToManagedGroup($event, group.id)" /></label>
                  </div>
                </div>
              </section>
            </template>
            </div>
            </div>
          </div>
        </section>

        <section v-else-if="page === 'moduleStudio'" class="content-section first-section module-studio" aria-label="工具工作台">
          <nav class="module-studio-tabs" :class="{ 'tabs-scrolling': moduleTabsScrolling, 'tabs-swiping': moduleTabsSwiping }" role="tablist" aria-label="工具工作台页面">
            <div class="module-studio-tab-scroll" @scroll.passive="onModuleStudioTabsScroll">
              <button v-for="(tab, index) in moduleStudioTabs" :key="tab.id" :id="`studio-tab-${tab.id}`" :data-studio-tab="tab.id" type="button" role="tab" :aria-selected="moduleStudioTab === tab.id" :aria-controls="`studio-panel-${tab.id}`" :tabindex="moduleStudioTab === tab.id ? 0 : -1" :class="{ active: moduleStudioTab === tab.id }" @click="setModuleStudioTab(tab.id)" @keydown="onModuleStudioTabKeydown($event, index)"><AppIcon :name="tab.icon" /><span>{{ tab.label }}</span></button>
            </div>
            <span class="module-studio-tab-indicator" :style="moduleStudioIndicatorStyle" aria-hidden="true"></span>
          </nav>
          <div class="module-studio-content">
            <div ref="moduleSwipeViewport" class="module-studio-panel-viewport">
            <div class="module-studio-panel-stage" :class="{ 'panel-stage-settling': moduleSwipeSettling }" :style="{ transform: moduleTrackTransform }">
            <section id="studio-panel-import" class="module-studio-tab-panel module-studio-import" :class="{ 'panel-active': moduleStudioTab === 'import', 'panel-neighbor': swipePanelBetween(moduleStudioTabs, moduleStudioTab, moduleSwipeNeighbor, 'import') }" :inert="moduleStudioTab !== 'import' || undefined" :aria-hidden="moduleStudioTab !== 'import'" role="tabpanel" aria-labelledby="studio-tab-import">
              <ModuleImportPanel :items="moduleImportItems" :busy="moduleBusy || moduleStudioBusy" :phase="moduleImportPhase" :progress="moduleImportProgress" :notice="moduleImportNotice" :error="moduleError" :dragging="moduleFileDragging" :can-drop="isWindowsApp" :illustration="createTool" @pick="selectModulePackage()" @install="installSelectedModule" @retry="moduleImports.retryCheck" @remove="moduleImports.remove" @clear="moduleImports.clear" />
            </section>
            <section id="studio-panel-installed" class="module-studio-tab-panel module-studio-installed" :class="{ 'panel-active': moduleStudioTab === 'installed', 'panel-neighbor': swipePanelBetween(moduleStudioTabs, moduleStudioTab, moduleSwipeNeighbor, 'installed') }" :inert="moduleStudioTab !== 'installed' || undefined" :aria-hidden="moduleStudioTab !== 'installed'" role="tabpanel" aria-labelledby="studio-tab-installed">
              <div class="module-studio-installed-layout">
                <div class="module-panel module-studio-library" aria-label="工具列表">
                  <div class="module-studio-library-switch" role="tablist" aria-label="工具来源">
                    <button id="studio-library-builtin" type="button" role="tab" :aria-selected="studioLibraryGroup === 'builtin'" aria-controls="studio-library-builtin-list" :class="{ active: studioLibraryGroup === 'builtin' }" @click="setStudioLibraryGroup('builtin')">应用自带</button>
                    <button id="studio-library-module" type="button" role="tab" :aria-selected="studioLibraryGroup === 'module'" aria-controls="studio-library-module-list" :class="{ active: studioLibraryGroup === 'module' }" @click="setStudioLibraryGroup('module')">导入/创建工具</button>
                  </div>
                  <div v-if="studioLibraryGroup === 'builtin'" id="studio-library-builtin-list" role="tabpanel" aria-labelledby="studio-library-builtin">
                    <label class="module-studio-library-search"><span class="sr-only">筛选应用自带工具</span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></svg><input v-model="builtinToolFilter" type="search" placeholder="筛选名称、工具 ID 或分组…" autocomplete="off" /></label>
                    <div v-if="!builtInStudioTools.length" class="module-studio-list-empty">暂无可用的应用自带工具，可在“工具管理 → 恢复工具”中找回。</div>
                    <div v-else-if="!filteredBuiltInStudioTools.length" class="module-studio-list-empty">没有匹配的工具</div>
                    <button v-for="tool in filteredBuiltInStudioTools" :key="tool.id" class="module-studio-list-item" :class="{ selected: selectedStudioItem?.kind === 'builtin' && selectedStudioItem.id === tool.module_id }" type="button" :aria-pressed="selectedStudioItem?.kind === 'builtin' && selectedStudioItem.id === tool.module_id" @click="selectStudioItem({ kind: 'builtin', id: tool.module_id! })"><span class="module-studio-list-copy"><strong>{{ tool.name }}</strong></span><span class="module-studio-group-tag" :title="tool.category">{{ tool.category }}</span><span class="module-studio-list-arrow" aria-hidden="true">›</span></button>
                  </div>
                  <div v-else id="studio-library-module-list" role="tabpanel" aria-labelledby="studio-library-module">
                    <label class="module-studio-library-search module-studio-module-search"><span class="sr-only">筛选导入或创建的工具</span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></svg><input v-model="moduleToolFilter" type="search" placeholder="筛选名称、工具 ID 或分组…" autocomplete="off" /></label>
                    <div v-if="moduleLoading" class="module-studio-list-empty" role="status">正在读取工具…</div>
                    <div v-else-if="!modules.some((item) => !item.builtin)" class="module-studio-list-empty">还没有工具。可在上方“导入工具”或“手动创建工具”中添加。</div>
                    <div v-else-if="!filteredStudioModules.length" class="module-studio-list-empty">没有匹配的工具</div>
                    <button v-for="item in filteredStudioModules" :key="item.module_id" class="module-studio-list-item" :class="{ selected: selectedStudioItem?.kind === 'module' && selectedStudioItem.id === item.module_id }" type="button" :aria-pressed="selectedStudioItem?.kind === 'module' && selectedStudioItem.id === item.module_id" @click="selectStudioItem({ kind: 'module', id: item.module_id })"><span class="module-studio-list-copy"><strong>{{ item.name }}</strong></span><span class="module-studio-group-tag" :title="item.categories.join(' · ')">{{ item.categories.join(' · ') }}</span><span class="module-studio-list-arrow" aria-hidden="true">›</span></button>
                  </div>
                </div>
                <div class="module-panel module-studio-detail" aria-live="polite">
                  <div v-if="moduleDetailsLoading" class="module-empty" role="status">正在读取工具详情…</div>
                  <template v-else-if="selectedStudioModule && selectedModuleDetails">
                    <div class="module-studio-detail-header"><div class="module-studio-detail-glyph"><AppIcon name="module-code" /></div><div class="module-studio-detail-copy"><span class="module-studio-origin">{{ selectedStudioModule.builtin ? (selectedStudioModule.modified ? '应用自带 · 已修改' : '应用自带 · 默认') : '已安装 · .fftool 工具' }}</span><h2>{{ selectedStudioModule.name }}</h2><p>{{ selectedStudioModule.module_id }}</p></div><span class="module-studio-version">v{{ selectedStudioModule.version }}</span></div>
                    <InstalledToolSourceEditor v-if="moduleSourceEditing" :key="selectedStudioModule.module_id" :details="selectedModuleDetails" :active="moduleStudioTab === 'installed'" :open-file="openWebToolFile" :save-file="saveWebToolFile" :hash-file="hashWebToolFile" :copy-text="writeClipboardText" @close="moduleSourceEditing = false" @saved="onModuleSourceSaved" @notify="notify" />
                    <template v-else-if="moduleMetadataEditing && moduleMetadataDraft">
                      <form class="module-studio-metadata-form" @submit.prevent="saveModuleMetadata">
                        <div class="module-studio-fields"><label>工具名称<input v-model="moduleMetadataDraft.name" required maxlength="80" /></label><label>版本<input v-model="moduleMetadataDraft.version" required maxlength="40" spellcheck="false" /></label><label>作者<input v-model="moduleMetadataDraft.author" required maxlength="100" /></label><label>许可证<select v-model="moduleMetadataDraft.license"><option v-for="option in moduleLicenseOptions" :key="option.id" :value="option.id">{{ option.label }}</option><option value="custom">其他（手动填写）</option></select></label><label v-if="moduleMetadataDraft.license === 'custom'">许可证标识<input v-model="moduleMetadataDraft.customLicense" required maxlength="100" /></label></div>
                        <div v-for="(tool, index) in moduleMetadataDraft.tools" :key="index" class="module-studio-metadata-tool"><h3>工具 {{ index + 1 }}</h3><div class="module-studio-fields"><label>工具名称<input v-model="tool.name" required maxlength="80" /></label><label>所属功能分组<input v-model="tool.category" required maxlength="40" /></label><label class="studio-field-wide">工具说明<textarea v-model="tool.description" required maxlength="500" rows="2"></textarea></label></div></div>
                        <div class="module-studio-detail-actions"><button class="secondary-button" type="button" :disabled="moduleStudioBusy" @click="moduleMetadataEditing = false">取消</button><button class="primary-button" type="submit" :disabled="moduleStudioBusy">{{ moduleStudioBusy ? '保存中…' : '保存修改' }}</button></div>
                      </form>
                    </template>
                    <template v-else>
                      <div class="module-studio-detail-grid"><div><span>作者</span><strong>{{ selectedModuleDetails.manifest.author }}</strong></div><div><span>许可证</span><strong>{{ selectedModuleDetails.manifest.license === 'UNLICENSED' ? '无证书' : selectedModuleDetails.manifest.license }}</strong></div><div><span>运行平台</span><strong>{{ selectedModuleDetails.manifest.platforms.join(' · ') }}</strong></div><div><span>清单版本</span><strong>Manifest v{{ selectedModuleDetails.manifest.schema_version }}</strong></div><div><span>工具类型</span><strong>{{ selectedModuleDetails.manifest.tools.some((tool) => tool.runtime === 'browser') ? '网页工具' : '文本处理' }}</strong></div><div><span>联网来源</span><strong>{{ selectedModuleDetails.manifest.network.hosts.map(host => host === 'https://*' ? '任意 HTTPS 来源' : host).join(' · ') || '无' }}</strong></div></div>
                      <h3 class="module-studio-detail-subtitle">包含的工具</h3>
                      <div v-for="tool in selectedModuleDetails.manifest.tools" :key="tool.id" class="module-studio-detail-tool"><span v-if="tool.icon_data || tool.icon" class="module-studio-tool-icon"><img v-if="tool.icon_data" :src="tool.icon_data" alt="" /><AppIcon v-else-if="tool.icon" :name="`module-${tool.icon}`" /></span><div><strong>{{ moduleDisplayName(tool.name) }}</strong><small>{{ tool.category }} · {{ tool.id }}</small><p>{{ moduleDisplayName(tool.description) }}</p></div><div class="module-studio-tool-actions"><button v-if="store.tools.some((entry) => entry.id === tool.id)" class="secondary-button" type="button" @click="openTool(tool.id)">打开工具</button><button v-if="selectedStudioModule.builtin" class="secondary-button delete-action" type="button" :disabled="moduleStudioBusy || allToolsActionBusy" @click="deleteBuiltinTool(tool.id, moduleDisplayName(tool.name))">删除工具</button><button v-if="!selectedStudioModule.builtin" class="secondary-button delete-action" type="button" :disabled="moduleStudioBusy" @click="deleteInstalledTool(selectedStudioModule.module_id, tool.id, moduleDisplayName(tool.name))">删除工具</button></div></div>
                      <div class="module-studio-detail-actions"><button class="primary-button" type="button" :disabled="moduleStudioBusy || moduleBusy" @click="beginModuleMetadataEdit">修改信息</button><button class="secondary-button" type="button" :disabled="moduleStudioBusy || moduleBusy" @click="moduleSourceEditing = true">编辑源码</button><button v-if="!selectedStudioModule.builtin && selectedModuleDetails.manifest.tools.length === 1 && selectedModuleDetails.manifest.tools[0]?.actions.length === 1 && selectedModuleDetails.manifest.platforms.every((platform) => platform === 'windows' || platform === 'android')" class="secondary-button" type="button" :disabled="moduleStudioBusy || moduleBusy" @click="loadModuleForEditing(selectedStudioModule.module_id)">编辑完整工具</button><button class="secondary-button" type="button" :disabled="moduleStudioBusy || moduleBusy" @click="exportInstalledModule(selectedStudioModule)">导出 .fftool</button><button v-if="selectedStudioModule.builtin" class="secondary-button" type="button" :disabled="moduleStudioBusy || moduleBusy || !selectedStudioModule.modified" @click="restoreBuiltinModule(selectedStudioModule)">恢复默认</button><button v-else-if="selectedModuleDetails.manifest.tools.length > 1" class="secondary-button delete-action" type="button" :disabled="moduleStudioBusy || moduleBusy" @click="removeModule(selectedStudioModule.module_id)">卸载工具</button></div>
                    </template>
                  </template>
                  <div v-else class="module-empty"><img class="module-studio-illustration" :src="selectionTool" alt="" /><strong>选择左侧的工具</strong><p>查看详细信息并进行管理。</p></div>
                </div>
              </div>
            </section>
            <form id="studio-panel-create" class="module-panel module-studio-form module-studio-tab-panel" :class="{ 'panel-active': moduleStudioTab === 'create', 'panel-neighbor': swipePanelBetween(moduleStudioTabs, moduleStudioTab, moduleSwipeNeighbor, 'create') }" :inert="moduleStudioTab !== 'create' || undefined" :aria-hidden="moduleStudioTab !== 'create'" role="tabpanel" aria-labelledby="studio-tab-create" @submit.prevent="installModuleDraft">
              <div class="module-panel-heading"><div class="module-create-title-row"><h2 id="studio-create-title">{{ loadedModuleManifest ? '编辑工具' : '创建工具' }}</h2><div class="module-studio-heading-actions"><button id="open-tool-author-skill" class="text-button" type="button" @click="openToolAuthorSkill">查看SKILL</button><button class="text-button" type="button" :disabled="moduleStudioBusy" @click="newModuleDraft">新建工具</button></div></div><p>选类型和模板，修改代码，预览后保存。</p></div>
              <div class="tool-creation-kinds" role="group" aria-label="工具类型">
                <button type="button" data-tool-kind="text" :class="{ selected: moduleCreationType === 'text' }" :aria-pressed="moduleCreationType === 'text'" :disabled="moduleStudioBusy" @click="setModuleCreationType('text')"><AppIcon name="module-text" /><span><strong>文本处理</strong><small>输入文字，运行后得到结果</small></span></button>
                <button type="button" data-tool-kind="web" :class="{ selected: moduleCreationType === 'web' }" :aria-pressed="moduleCreationType === 'web'" :disabled="moduleStudioBusy" @click="setModuleCreationType('web')"><AppIcon name="module-globe" /><span><strong>网页工具</strong><small>自定义页面、联网、存储与文件处理</small></span></button>
              </div>
              <div class="tool-template-picker"><label for="tool-template">从模板开始（可选）</label><select id="tool-template" v-model="moduleTemplateId"><option value="">选择一个模板</option><option v-for="template in moduleCreationTemplates" :key="template.id" :value="template.id">{{ template.name }}</option></select><button class="secondary-button" type="button" :disabled="!moduleTemplateId || moduleStudioBusy" @click="applyModuleTemplate">使用模板</button></div>
              <p class="tool-draft-notice">两种类型分别保留草稿，修改会自动保存在本机。</p>
              <div class="module-studio-fields">
                <label>工具名称<input id="tool-creation-name" v-model="moduleCreationName" required maxlength="80" placeholder="给你的工具起个名字" /></label>
                <label>所属功能分组<ViewportSelect v-model="moduleDraft.category" :options="moduleCategoryOptions.map((name) => ({ value: name, label: name }))" ariaLabel="所属功能分组" required /></label>
                <label class="studio-field-wide">工具说明（可选）<textarea v-model="moduleDraft.description" maxlength="500" rows="2" placeholder="说明这个工具能做什么"></textarea></label>
                <label v-if="moduleCreationType === 'web'" class="studio-field-wide">允许联网的 HTTPS 来源（可选）<textarea id="tool-network-hosts" v-model="moduleDraft.networkHosts" rows="2" spellcheck="false" placeholder="每行一个，例如 https://api.example.com"></textarea><small>最多 64 个来源，填写协议、域名及可选端口，不含路径；留空时禁止联网。宿主 request() 支持 GET/POST、自定义头与正文、流式响应，免浏览器 CORS；默认 15 秒/4 MiB，可设至 60 秒/16 MiB，请求体最多 16 MiB。普通 fetch 仍受浏览器跨域规则限制。</small></label>
              </div>
              <details class="tool-optional-icon"><summary>显示图标（可选）</summary>
              <fieldset class="module-studio-icon-picker"><legend>显示图标（可选）</legend>
                <div ref="moduleIconPicker" class="module-studio-icon-select">
                  <button id="module-icon-trigger" ref="moduleIconTrigger" class="module-studio-icon-trigger" type="button" :aria-expanded="moduleIconMenuOpen" aria-controls="module-icon-options" :disabled="moduleStudioBusy" @click="moduleIconMenuOpen = !moduleIconMenuOpen">
                    <span class="module-studio-icon-preview"><img v-if="moduleDraft.iconData" :src="moduleDraft.iconData" alt="" /><AppIcon v-else-if="moduleDraft.icon" :name="`module-${moduleDraft.icon}`" /></span>
                    <span><strong>{{ selectedModuleIconLabel }}</strong><small>应用自带图标 · 点击选择</small></span>
                    <svg class="module-studio-icon-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                  </button>
                  <div v-if="moduleIconMenuOpen" id="module-icon-options" class="module-studio-icon-options" role="group" aria-label="应用自带图标">
                    <button v-for="choice in moduleIconOptions" :key="choice.id" class="module-studio-icon-option" :class="{ selected: !moduleDraft.iconData && moduleDraft.icon === choice.id }" type="button" :aria-pressed="!moduleDraft.iconData && moduleDraft.icon === choice.id" @click="selectPresetModuleIcon(choice.id)"><AppIcon v-if="choice.id" :name="`module-${choice.id}`" /><span v-else class="module-studio-icon-option-empty" aria-hidden="true">—</span><span>{{ choice.label }}</span></button>
                  </div>
                </div>
                <div class="module-studio-icon-actions"><button class="secondary-button" type="button" :disabled="moduleStudioBusy" @click="importModuleIcon">{{ moduleDraft.iconData ? '更换图标' : '导入 SVG 或图片' }}</button><small>支持 SVG、PNG、JPEG、WebP；导入时会缩放为内嵌 PNG。</small></div>
              </fieldset>
              </details>
              <section v-if="moduleCreationType === 'web' && !moduleDraft.moduleId.startsWith('builtin.')" class="tool-resource-panel">
                <div class="tool-resource-heading"><h3>独立资源</h3><button class="secondary-button" type="button" :disabled="moduleStudioBusy" @click="importModuleResource">导入资源</button></div>
                <p class="module-hint">可导入 WASM、图片、字体、媒体和 Worker 脚本；单资源最多 96 MiB、最多 128 项，源码与资源共同占用每包 128 MiB 额度。资源随草稿保存在本机，并随工具包导出；同名文件会替换草稿中的资源。</p>
                <ul v-if="(moduleDraft.resources ?? loadedModuleManifest?.resources)?.length" class="tool-resource-list"><li v-for="resource in (moduleDraft.resources ?? loadedModuleManifest?.resources ?? [])" :key="resource.path"><span><code>{{ resource.path }}</code><small>{{ (resource.size / 1048576).toFixed(2) }} MiB</small></span><button class="text-button" type="button" :disabled="moduleStudioBusy" @click="removeModuleResource(resource.path)">移除</button></li></ul>
              </section>
              <details class="tool-advanced-settings" :open="moduleAdvancedOpen" @toggle="moduleAdvancedOpen = ($event.target as HTMLDetailsElement).open"><summary>高级设置</summary>
                <p class="module-hint">已准备好默认值。修改已安装工具时，标识保持不变。</p>
                <div class="module-studio-fields">
                  <label>工具包名称<input v-model="moduleDraft.name" maxlength="80" placeholder="默认与工具名称一致" /></label>
                  <label>工具包 ID<input v-model="moduleDraft.moduleId" :readonly="!!loadedModuleManifest" maxlength="100" spellcheck="false" /><small>用于识别同一工具，默认自动生成。</small></label>
                  <label>工具 ID 后缀<input v-model="moduleDraft.toolSuffix" :readonly="!!loadedModuleManifest" maxlength="40" spellcheck="false" /></label>
                  <label>版本<input v-model="moduleDraft.version" maxlength="40" spellcheck="false" /></label>
                  <label>作者<input v-model="moduleDraft.author" maxlength="100" /></label>
                  <label>许可证<select v-model="moduleDraft.license"><option v-for="option in moduleLicenseOptions" :key="option.id" :value="option.id">{{ option.label }}</option><option value="custom">其他（手动填写）</option></select></label>
                  <label v-if="moduleDraft.license === 'custom'">许可证标识<input v-model="moduleDraft.customLicense" maxlength="100" placeholder="例如：LGPL-3.0-only" /></label>
                  <label>搜索标签<input v-model="moduleDraft.tags" placeholder="逗号分隔，最多 8 个" /></label>
                  <label>搜索别名<input v-model="moduleDraft.aliases" placeholder="逗号分隔，最多 8 个" /></label>
                  <label>{{ moduleDraft.runtime === 'web' ? '页面加载超时（秒）' : '执行超时（秒）' }}<input v-model.number="moduleDraft.timeoutSeconds" type="number" min="0.001" :max="moduleDraft.runtime === 'quickjs' ? 3 : 15" step="0.001" /><small>{{ moduleDraft.runtime === 'quickjs' ? '文本处理最多 3 秒。' : '最多等待 15 秒；页面加载后可持续交互。' }}</small></label>
                  <label v-if="moduleDraft.runtime === 'web'">默认显示方式<select v-model="moduleDraft.fullscreen"><option :value="false">普通显示</option><option :value="true">全屏显示</option></select><small>打开后自动全屏；退出全屏会保留工具内容。</small></label>
                  <label v-if="moduleDraft.runtime !== 'web'">操作 ID<input v-model="moduleDraft.actionId" maxlength="40" spellcheck="false" /><small>供 JS 的 action 参数识别操作；创建后尽量保持不变，例如 run。</small></label>
                  <label v-if="moduleDraft.runtime !== 'web'">按钮文字<input v-model="moduleDraft.actionLabel" maxlength="40" /></label>
                  <label>入口文件<input v-model="moduleDraft.entry" maxlength="120" spellcheck="false" /></label>
                  <label v-for="(script, index) in moduleDraft.scripts" :key="index">文件 {{ index + 1 }} 路径<input v-model="script.path" maxlength="120" spellcheck="false" :placeholder="script.path.endsWith('.html') ? '如：index.html' : script.path.endsWith('.css') ? '如：style.css、css/style.css' : '如：main.js、js/main.js'" /><small>{{ script.path.endsWith('.html') ? '如：index.html' : script.path.endsWith('.css') ? '如：style.css、css/style.css' : '如：main.js、js/main.js' }}</small><button v-if="moduleDraft.runtime === 'quickjs' && moduleDraft.scripts.length > 1" class="text-button delete-action" type="button" @click="moduleDraft.scripts.splice(index, 1); moduleScriptIndex = 0">移除文件</button></label>
                </div>
                <fieldset class="module-studio-platforms"><legend>运行平台</legend><label><input v-model="moduleDraft.windows" type="checkbox" />Windows</label><label><input v-model="moduleDraft.android" type="checkbox" />Android</label></fieldset>
                <fieldset v-if="moduleDraft.runtime !== 'web'" class="tool-input-types"><legend>适用内容（智能识别推荐）</legend><p class="module-hint">根据工具实际处理的内容选择；不勾选时不参与推荐。纯文本工具会自动加入自动化步骤。</p><label v-for="choice in textInputTypes" :key="choice.id"><input v-model="moduleDraft.inputTypes" type="checkbox" :value="choice.id" />{{ choice.label }}</label></fieldset>
                <button v-if="moduleDraft.runtime === 'quickjs'" class="text-button" type="button" :disabled="moduleDraft.scripts.length >= 16 || moduleStudioBusy" @click="addModuleScript">添加 JS 文件</button>
              </details>
              <div class="module-studio-section-title"><h3>代码</h3></div>
              <p v-if="moduleDraft.runtime === 'web'" class="module-hint">网页源码按 UTF-8 字节计数：单文件最多 8 MiB，合计 32 MiB，最多 128 个文件。</p>
              <div class="tool-code-tabs" role="group" aria-label="代码文件"><button v-for="(script, index) in moduleDraft.scripts" :key="index" type="button" :class="{ selected: moduleScriptIndex === index }" :aria-pressed="moduleScriptIndex === index" @click="moduleScriptIndex = index">{{ moduleScriptLabel(script.path) }}</button></div>
              <div v-if="moduleActiveScript" class="module-studio-script tool-code-editor"><label>{{ moduleScriptLabel(moduleActiveScript.path) }}<textarea id="tool-source-editor" v-model="moduleActiveScript.source" spellcheck="false" rows="12" :aria-label="`${moduleScriptLabel(moduleActiveScript.path)} 源码`"></textarea></label></div>
              <p v-if="moduleDraft.runtime === 'web'" class="module-hint">HTML 写页面，CSS 写样式，JS 导出 <code>mount(context)</code>。支持 DOM、WebAssembly；任务与 Worker 默认各并发 4 个，可分别配置至 8 个，等待队列各最多 128 项。<code>tasks.run()</code> 的回调仍在主线程，较长计算实际放到 Worker。持久与会话存储各最多 1 MiB，重要保存等待 <code>storage.flush()</code>。整文件读取和保存各最多 32 MiB，仍受清单中较小的输入/输出额度限制；文件句柄分块处理最多 2 GiB，一次最多选 64 个文件，活动句柄最多 128 个。长任务默认 30 分钟、最高 2 小时，可取消。独立资源使用 resources 接口读取。</p>
              <p v-else class="module-hint">JS 导出 <code>run(input, action)</code>，输入和结果均为 <code>{ text: string }</code>。文本处理在本地运行；联网或交互页面可使用网页工具模板。</p>
              <div class="module-studio-actions"><button class="secondary-button" type="button" :disabled="moduleStudioBusy || modulePreviewBusy" @click="previewModuleDraft">{{ modulePreviewBusy ? '正在运行…' : moduleDraft.runtime === 'web' ? '预览网页工具' : '试运行' }}</button><button class="secondary-button" type="button" :disabled="moduleStudioBusy" @click="exportModuleDraft">导出 .fftool</button><button class="primary-button" type="submit" :disabled="moduleStudioBusy || moduleBusy">{{ moduleStudioBusy ? '检查中…' : '保存工具' }}</button></div>
              <section v-if="modulePreviewOpen" class="module-studio-preview" aria-label="工具预览">
                <div class="module-studio-preview-heading"><h3>{{ moduleDraft.runtime === 'web' ? '网页预览' : '文本试运行' }}</h3><button class="text-button" type="button" @click="closeModulePreview">关闭预览</button></div>
                <p>预览不安装工具，不记录最近使用；修改代码会关闭预览。</p>
                <div v-if="moduleDraft.runtime === 'web' && modulePreviewFileStatus.message" class="web-tool-controls"><p class="web-file-status" :class="{ error: modulePreviewFileStatus.code && modulePreviewFileStatus.code !== 'FILE_CANCELED' }" role="status">{{ modulePreviewFileStatus.message }}</p><button v-if="modulePreviewFileStatus.busy" class="secondary-button" type="button" @click="cancelWebToolFiles">取消当前操作</button></div>
                <div v-if="moduleDraft.runtime !== 'web'" class="tool-text-preview"><label>输入<textarea v-model="modulePreviewInput" rows="4" @input="cancelModulePreviewRun"></textarea></label><div class="tool-preview-actions"><button class="secondary-button" type="button" :disabled="modulePreviewBusy" @click="previewModuleDraft">运行</button><button v-if="modulePreviewBusy" class="text-button" type="button" @click="cancelModulePreviewRun">取消运行</button></div><label>结果<textarea :value="modulePreviewOutput" rows="4" readonly></textarea></label></div>
                <div v-if="moduleDraft.runtime === 'web'" ref="modulePreviewContainer" class="web-tool-container" :aria-busy="modulePreviewBusy" aria-label="工具预览页面"></div>
                <p v-if="modulePreviewBusy" class="editor-status" role="status">正在运行预览…</p>
                <p v-if="modulePreviewError" class="editor-status error" role="alert">{{ modulePreviewError }}</p>
              </section>
            </form>
            </div>
            </div>
          </div>
        </section>

        <section v-else-if="page === 'theme'" class="content-section first-section preference-page" aria-label="应用主题">
          <p class="preference-intro">选择你喜欢的外观，设置会保存在当前设备。</p>
          <p v-if="appearanceImageLoading" class="preference-intro" role="status">正在读取图片…</p>
          <div class="preference-list" role="group" aria-label="主题选项">
            <div class="preference-card">
              <button class="preference-option preference-card-trigger" type="button" :aria-expanded="displayModeOpen" aria-controls="display-mode-options" @click="displayModeOpen = !displayModeOpen">
                <span><strong>显示模式</strong><small>{{ themeOptions.find((option) => option.value === themePreference)?.label }}</small></span>
                <svg class="preference-chevron" :class="{ open: displayModeOpen }" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
              </button>
              <div v-if="displayModeOpen" id="display-mode-options" class="display-mode-options" role="group" aria-label="显示模式">
                <button v-for="option in themeOptions" :key="option.value" class="display-mode-option" type="button" :aria-pressed="themePreference === option.value" @click="chooseTheme(option.value)">
                  <span><strong>{{ option.label }}</strong><small>{{ option.description }}</small></span>
                  <svg v-if="themePreference === option.value" viewBox="0 0 24 24" aria-hidden="true"><path d="m4 12 5 5L20 6" /></svg>
                </button>
              </div>
            </div>
            <div class="preference-option color-preference">
              <span><strong>更换主题色</strong><small>{{ accentColor ? accentColor.toUpperCase() : '默认浅绿色' }}</small></span>
              <div class="preference-actions">
                <button v-if="accentColor" class="text-button" type="button" @click="resetAccent">恢复默认</button>
                <button class="color-custom-button" type="button" aria-label="打开色盘选择主题色" @click="openColorEditor"><span class="color-swatch" :style="{ backgroundColor: accentColor || '#276653' }" aria-hidden="true"></span>自定义</button>
              </div>
            </div>
            <div class="preference-option wallpaper-preference">
              <span><strong>自定义壁纸</strong><small>{{ wallpaperEnabled ? '已启用，仅在首页、收藏和网站显示' : wallpaperUrl ? '已保存图片，点击开关即可启用' : '选择图片并裁剪，应用于三个主页面' }}</small></span>
              <div class="preference-actions">
                <button v-if="wallpaperUrl" class="text-button wallpaper-replace-button" type="button" :disabled="wallpaperLoading || appearanceImageLoading" @click="chooseWallpaperFile">更换图片</button>
                <button class="wallpaper-toggle" type="button" role="switch" :disabled="wallpaperLoading || appearanceImageLoading" :aria-checked="wallpaperEnabled" :aria-label="wallpaperEnabled ? '关闭自定义壁纸' : '启用自定义壁纸'" @click="toggleWallpaper"><span class="setting-switch" :class="{ enabled: wallpaperEnabled }" aria-hidden="true"></span></button>
              </div>
            </div>
            <div class="preference-option startup-image-preference">
              <span><strong>自定义启动图</strong><small>{{ startupImageEnabled ? startupImageUrl ? '使用自定义图片，下次启动生效' : '使用默认启动图' : '已关闭，启动时直接进入应用' }}</small></span>
              <div class="preference-actions">
                <button class="text-button wallpaper-replace-button" type="button" :disabled="startupImageLoading || startupImageResetting || appearanceImageLoading" @click="resetStartupImage">恢复默认</button>
                <button class="text-button wallpaper-replace-button" type="button" :disabled="startupImageLoading || startupImageResetting || appearanceImageLoading" @click="chooseStartupImageFile">更换图片</button>
                <button class="wallpaper-toggle" type="button" role="switch" :disabled="startupImageLoading || startupImageResetting || appearanceImageLoading" :aria-checked="startupImageEnabled" :aria-label="startupImageEnabled ? '关闭启动图' : '启用启动图'" @click="toggleStartupImage"><span class="setting-switch" :class="{ enabled: startupImageEnabled }" aria-hidden="true"></span></button>
              </div>
            </div>
            <div class="preference-option startup-image-preference sidebar-image-preference">
              <span><strong>自定义侧边栏图</strong><small>{{ sidebarImageEnabled ? sidebarImageUrl ? '已启用自定义图片' : '使用默认侧边栏图' : '已关闭侧边栏图片' }}</small></span>
              <div class="preference-actions">
                <button class="text-button wallpaper-replace-button" type="button" :disabled="sidebarImageLoading || sidebarImageResetting || appearanceImageLoading" @click="resetSidebarImage">恢复默认</button>
                <button class="text-button wallpaper-replace-button" type="button" :disabled="sidebarImageLoading || sidebarImageResetting || appearanceImageLoading" @click="chooseSidebarImageFile">更换图片</button>
                <button class="wallpaper-toggle" type="button" role="switch" :disabled="sidebarImageLoading || sidebarImageResetting || appearanceImageLoading" :aria-checked="sidebarImageEnabled" :aria-label="sidebarImageEnabled ? '关闭侧边栏图' : '启用侧边栏图'" @click="toggleSidebarImage"><span class="setting-switch" :class="{ enabled: sidebarImageEnabled }" aria-hidden="true"></span></button>
              </div>
              <p class="sidebar-image-advice">建议 896 × 544 像素，无背景的透明 PNG 效果更好；支持保留整图或裁剪，最大 32 MiB。</p>
            </div>
          </div>
          <input ref="wallpaperFileInput" class="sr-only" type="file" accept="image/*" tabindex="-1" aria-label="选择壁纸图片" @change="onWallpaperFileSelected" />
          <input ref="startupImageFileInput" class="sr-only" type="file" accept="image/*" tabindex="-1" aria-label="选择启动图图片" @change="onStartupImageSelected" />
          <input ref="sidebarImageFileInput" class="sr-only" type="file" accept="image/*" tabindex="-1" aria-label="选择侧边栏图片" @change="onSidebarImageSelected" />
        </section>

        <section v-else-if="page === 'wallpaperEditor'" class="content-section first-section preference-page wallpaper-editor" :aria-label="`编辑${appearanceImageLabel}`">
          <template v-if="imageEditingTarget === 'sidebar'">
            <p class="preference-intro">建议 896 × 544 像素，无背景的透明 PNG 效果更好。保留整图可完整显示人物或图案，裁剪区域按侧边栏比例输出；两种方式均保留透明背景。</p>
            <div class="sidebar-image-modes" role="group" aria-label="侧边栏图片适配方式"><button type="button" :aria-pressed="sidebarKeepWholeImage" :disabled="wallpaperSaving" @click="setSidebarImageMode(true)">保留整图</button><button type="button" :aria-pressed="!sidebarKeepWholeImage" :disabled="wallpaperSaving" @click="setSidebarImageMode(false)">裁剪区域</button></div>
            <p v-if="!sidebarKeepWholeImage" class="preference-intro">拖动方框移动选区，拖动四角调整大小。</p>
          </template>
          <p v-else class="preference-intro">拖动方框选择显示区域，四个角均可调整大小，也可同时拖动两个角。编辑期间保持固定比例，支持最大 32 MiB、2400 万像素的图片，透明背景会保留。</p>
          <div ref="wallpaperStage" class="wallpaper-stage">
            <div class="wallpaper-image" :class="{ 'sidebar-image-preview': imageEditingTarget === 'sidebar' }" :style="{ width: `${wallpaperStageSize.width}px`, height: `${wallpaperStageSize.height}px` }">
              <img :src="wallpaperDraftUrl" :alt="`待编辑的${appearanceImageLabel}`" />
              <div v-if="imageEditingTarget !== 'sidebar' || !sidebarKeepWholeImage" class="wallpaper-crop" :style="wallpaperCropStyle" role="img" :aria-label="`${appearanceImageLabel}裁剪方框，可以拖动`">
                <div class="wallpaper-crop-move" @pointerdown="onWallpaperPointerDown($event, 'move')" @pointermove="onWallpaperPointerMove" @pointerup="onWallpaperPointerUp" @pointercancel="onWallpaperPointerUp"></div>
                <div v-for="corner in [{ kind: 'top-left', label: '左上角' }, { kind: 'top-right', label: '右上角' }, { kind: 'bottom-left', label: '左下角' }, { kind: 'bottom-right', label: '右下角' }] as const" :key="corner.kind" class="wallpaper-crop-handle" :class="`wallpaper-crop-handle-${corner.kind}`" :aria-label="`从${corner.label}调整裁剪方框大小`" @pointerdown="onWallpaperPointerDown($event, corner.kind)" @pointermove="onWallpaperPointerMove" @pointerup="onWallpaperPointerUp" @pointercancel="onWallpaperPointerUp"></div>
              </div>
            </div>
          </div>
          <div class="wallpaper-editor-actions"><button class="secondary-button" type="button" :disabled="wallpaperSaving" @click="goBackStandalone">取消</button><button class="primary-button" type="button" :disabled="wallpaperSaving" @click="saveWallpaperCrop">{{ wallpaperSaving ? '保存中…' : '保存并启用' }}</button></div>
        </section>

        <section v-else-if="page === 'colorEditor'" class="content-section first-section preference-page color-editor" aria-label="更换主题色">
          <p class="preference-intro">在色盘上拖动选择颜色，再调整明度。</p>
          <div class="color-editor-card">
            <div ref="colorWheel" class="color-wheel" role="slider" tabindex="0" aria-label="色盘：左右方向键调整色相，上下方向键调整饱和度" aria-valuemin="0" aria-valuemax="359" :aria-valuenow="Math.round(colorDraftHue)" :aria-valuetext="`色相 ${Math.round(colorDraftHue)} 度，饱和度 ${Math.round(colorDraftSaturation * 100)}%`" @pointerdown="onColorWheelPointerDown" @pointermove="onColorWheelPointerMove" @pointerup="onColorWheelPointerUp" @pointercancel="onColorWheelPointerUp" @keydown="onColorWheelKeydown">
              <span class="color-wheel-marker" :style="{ ...colorWheelMarkerStyle, backgroundColor: hsvToHex(colorDraftHue, colorDraftSaturation, 1) }" aria-hidden="true"></span>
            </div>
            <div class="color-brightness"><label for="color-brightness">明度</label><input id="color-brightness" v-model.number="colorDraftValue" type="range" min="0" max="1" step="0.01" :style="{ '--brightness-color': hsvToHex(colorDraftHue, colorDraftSaturation, 1) }" /><span>{{ Math.round(colorDraftValue * 100) }}%</span></div>
            <div class="color-preview"><span class="color-preview-swatch" :style="{ backgroundColor: colorDraftHex }" aria-hidden="true"></span><strong>{{ colorDraftHex.toUpperCase() }}</strong></div>
          </div>
          <div class="wallpaper-editor-actions"><button class="secondary-button" type="button" @click="goBackStandalone">取消</button><button class="primary-button" type="button" @click="saveAccent">应用主题色</button></div>
        </section>

        <section v-else-if="page === 'customTool'" class="content-section first-section custom-tool-page" aria-label="自动化工具编辑">
          <form id="custom-tool-form" class="module-panel custom-tool-form" @submit.prevent="saveCustomTool">
            <fieldset class="custom-tool-fields" :disabled="customSaving">
              <p class="muted">按顺序运行内置或创建的纯文本工具，最多 8 步。新安装的文本工具会自动出现在列表中；网页工具和依赖浏览器界面的工具不参与串联。定义保存在本机，输入与结果不会保存。</p>
              <label for="custom-name">名称</label><input id="custom-name" v-model="customForm.name" required maxlength="80" placeholder="例如：解码后格式化 JSON" />
              <label for="custom-description">描述（可选）</label><input id="custom-description" v-model="customForm.description" maxlength="500" />
              <fieldset class="automation-icon-field"><legend>工具图标</legend><div class="automation-icon-row"><span class="automation-icon-preview"><img v-if="customForm.icon_data" :src="customForm.icon_data" alt="图标预览" /><AppIcon v-else :name="customForm.icon ? `module-${customForm.icon}` : 'automation'" /></span><div><ViewportSelect id="custom-icon" v-model="customIconValue" :disabled="customSaving || customIconLoading" :options="moduleIconOptions.map(choice => ({ value: choice.id, label: choice.id ? choice.label : (customForm.icon_data ? '已导入图片' : '默认自动化图标') }))" ariaLabel="选择内置图标" /><div class="automation-icon-actions"><button class="secondary-button" type="button" :disabled="customSaving || customIconLoading" @click="importCustomIcon">{{ customIconLoading ? '正在导入…' : customForm.icon_data ? '更换图片' : '导入 SVG 或图片' }}</button><button v-if="customForm.icon_data" class="text-button" type="button" :disabled="customSaving || customIconLoading" @click="customForm.icon_data = null">移除图片</button></div></div></div><p class="module-hint">可使用内置图标，或导入 SVG、PNG、JPEG、WebP（最多 1 MiB）；图标随自动化保存在本机，并可通过设备同步传递。</p></fieldset>
              <template v-if="managedGroupsFor('home').some((group) => group.id !== HOME_OTHER_GROUP)"><label for="custom-group">工具所属分组</label><ViewportSelect id="custom-group" v-model="customFormGroup" :options="[{ value: HOME_OTHER_GROUP, label: '未分组' }, ...managedGroupsFor('home').filter((group) => group.id !== HOME_OTHER_GROUP).map((group) => ({ value: group.id, label: group.name }))]" ariaLabel="工具所属分组" /></template>
              <label for="custom-tags">标签（可选，逗号分隔）</label><input id="custom-tags" v-model="customTagsText" placeholder="编码, JSON" />
              <div class="custom-steps-heading"><strong>处理步骤</strong><button class="text-button" type="button" :disabled="customForm.steps.length >= 8" @click="customForm.steps.push(newCustomStep())">添加步骤</button></div>
              <div v-for="(step, index) in customForm.steps" :key="index" class="custom-step"><span class="custom-step-number">{{ index + 1 }}</span><ViewportSelect :model-value="step.tool_id" :options="availableSteps.map((tool) => ({ value: tool.id, label: tool.name }))" :ariaLabel="`第 ${index + 1} 步工具`" @update:modelValue="(value) => { step.tool_id = value; changeCustomStepTool(index) }" /><select v-model="step.action" :aria-label="`第 ${index + 1} 步操作`"><option v-for="action in availableSteps.find((tool) => tool.id === step.tool_id)?.actions ?? []" :key="action.id" :value="action.id">{{ action.label }}</option></select><button type="button" :disabled="index === 0" :aria-label="`上移第 ${index + 1} 步`" @click="moveCustomStep(index, -1)">↑</button><button type="button" :disabled="index === customForm.steps.length - 1" :aria-label="`下移第 ${index + 1} 步`" @click="moveCustomStep(index, 1)">↓</button><button type="button" :disabled="customForm.steps.length === 1" :aria-label="`删除第 ${index + 1} 步`" @click="customForm.steps.splice(index, 1)">×</button></div>
              <p v-if="customError" class="error-text" role="alert">{{ customError }}</p>
            </fieldset>
            <div class="custom-tool-actions"><button class="secondary-button" type="button" @click="closeCustomToolPage" :disabled="customSaving">取消</button><button class="primary-button" type="submit" :disabled="customSaving || customIconLoading">{{ customSaving ? '保存中…' : '保存工具' }}</button></div>
          </form>
        </section>

        <SmartDetectionPage v-else-if="page === 'detection'" :value="detectValue" :results="detectResults" :message="detectMessage" :error="detectionError" :detecting="detecting" :selecting="detectionSelecting" :pasting="detectionPasting" :from-clipboard="detectedFromClipboard" @input="setDetectionValue" @detect="detect" @clear="setDetectionValue('')" @paste="pasteDetection" @select="useDetection" />
        <ToolAuthorSkillPage v-else-if="page === 'toolAuthorSkill'" :html="toolAuthorSkillHtml" :loading="toolAuthorSkillLoading" :error="toolAuthorSkillError" @retry="loadToolAuthorSkill" />
        <section v-else-if="page === 'deviceSync'" class="content-section first-section" aria-label="设备同步"><DeviceSync @applying="deviceSyncApplying = $event" @applied="refreshSyncedData" @finished="finishDeviceSync" /></section>

        <section v-else-if="page === 'settings'" class="content-section first-section preference-page settings-page" :inert="settingsResetBusy" :aria-busy="settingsResetBusy" aria-label="更多设置">
          <section class="settings-group" aria-labelledby="settings-basic-title">
            <div class="settings-group-heading"><span class="settings-group-icon"><AppIcon name="settings" /></span><div><h2 id="settings-basic-title">基础设置</h2><p>调整启动方式与日常使用习惯</p></div></div>
            <div class="preference-list">
            <div class="preference-card start-page-preference">
              <button class="preference-option preference-card-trigger" type="button" :aria-expanded="startPageOptionsOpen" aria-controls="start-page-options" @click="startPageOptionsOpen = !startPageOptionsOpen">
                <span><strong>启动时默认打开</strong><small>{{ bottomNavigation.find((item) => item.page === startPage)?.name ?? '首页' }}</small></span>
                <svg class="preference-chevron" :class="{ open: startPageOptionsOpen }" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
              </button>
              <div v-if="startPageOptionsOpen" id="start-page-options" class="display-mode-options" role="group" aria-label="启动时默认打开的页面">
                <button v-for="item in bottomNavigation" :key="item.page" class="display-mode-option" type="button" :aria-pressed="startPage === item.page" @click="chooseStartPage(item.page)">
                  <span><strong>{{ item.name }}</strong><small>{{ item.page === 'home' ? '打开工具首页，浏览全部分组' : item.page === 'favorites' ? '直接打开已收藏的工具' : '直接打开已保存的网站' }}</small></span>
                  <svg v-if="startPage === item.page" viewBox="0 0 24 24" aria-hidden="true"><path d="m4 12 5 5L20 6" /></svg>
                </button>
              </div>
            </div>
            <div v-if="isWindowsApp" class="preference-card">
              <button class="preference-option preference-card-trigger" type="button" :disabled="!desktopCloseReady || desktopCloseBusy" :aria-expanded="desktopCloseOptionsOpen" aria-controls="desktop-close-options" @click="desktopCloseOptionsOpen = !desktopCloseOptionsOpen">
                <span><strong>关闭应用主界面时</strong><small>{{ desktopCloseBehavior === 'tray' ? '最小化到系统托盘' : '退出流萤百宝箱程序' }}</small></span>
                <svg class="preference-chevron" :class="{ open: desktopCloseOptionsOpen }" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
              </button>
              <div v-if="desktopCloseOptionsOpen" id="desktop-close-options" class="display-mode-options" role="group" aria-label="关闭应用主界面时">
                <button v-for="option in [{ value: 'tray', label: '最小化到系统托盘' }, { value: 'exit', label: '退出流萤百宝箱程序' }] as const" :key="option.value" class="display-mode-option" type="button" :disabled="desktopCloseBusy" :aria-pressed="desktopCloseBehavior === option.value" @click="chooseDesktopCloseBehavior(option.value)">
                  <span><strong>{{ option.label }}</strong></span><svg v-if="desktopCloseBehavior === option.value" viewBox="0 0 24 24" aria-hidden="true"><path d="m4 12 5 5L20 6" /></svg>
                </button>
              </div>
            </div>
            <button v-if="isWindowsApp" class="preference-option" type="button" role="switch" :aria-checked="desktopAutostartEnabled" :disabled="!desktopAutostartReady || desktopAutostartBusy" @click="toggleDesktopAutostart">
              <span><strong>开机自动启动</strong><small>登录 Windows 后自动打开流萤百宝箱。</small></span><span class="setting-switch" :class="{ enabled: desktopAutostartEnabled }" aria-hidden="true"></span>
            </button>
            <button v-if="!isWindowsApp" class="preference-option mobile-navigation-preference" type="button" role="switch" :aria-checked="autoHideBars" @click="toggleAutoHideBars">
              <span><strong>自动隐藏导航栏</strong><small>浏览首页、收藏和网站时，随上下滑动收起或显示应用顶栏与底栏；关闭后始终显示。</small></span><span class="setting-switch" :class="{ enabled: autoHideBars }" aria-hidden="true"></span>
            </button>
            <button class="preference-option" type="button" role="switch" :aria-checked="smartClipboardEnabled" @click="toggleSmartClipboard">
              <span><strong>智能识别剪切板内容</strong><small>应用进入前台时读取文字剪切板；发现可处理内容后自动打开智能识别。</small></span><span class="setting-switch" :class="{ enabled: smartClipboardEnabled }" aria-hidden="true"></span>
            </button>
            <button class="preference-option" type="button" role="switch" :aria-checked="usageStatsEnabled" @click="toggleUsageStats"><span><strong>记录最近使用</strong><small>只保存工具 ID、使用时间和次数，不保存输入与结果。</small></span><span class="setting-switch" :class="{ enabled: usageStatsEnabled }" aria-hidden="true"></span></button>
            </div>
          </section>
          <section class="settings-group settings-group-appearance" aria-labelledby="settings-appearance-title">
            <div class="settings-group-heading"><span class="settings-group-icon"><AppIcon name="theme" /></span><div><h2 id="settings-appearance-title">外观设置</h2><p>让界面更符合你的喜好</p></div></div>
            <div class="home-appearance-settings">
            <div class="home-appearance-heading"><p>文字大小应用于整个应用；组件透明度和卡片间距仅应用于首页、收藏和网站。</p><button class="text-button" type="button" @click="resetAppAppearance">恢复默认</button></div>
            <div class="home-appearance-preview" :style="{ backgroundImage: wallpaperUrl ? `url(${wallpaperUrl})` : undefined }" aria-label="卡片间距预览">
              <div class="home-appearance-preview-card"><strong>工具分类</strong><span>示例工具</span></div>
              <div class="home-appearance-preview-card"><strong>实用工具</strong><span>文本处理</span></div>
            </div>
            <div class="home-appearance-controls">
              <label class="home-appearance-control" for="component-transparency"><span><strong>组件透明度</strong><small>仅调整首页、收藏、网站的卡片、标签和导航栏</small></span><output for="component-transparency">{{ componentTransparency }}%</output><input id="component-transparency" v-model.number="componentTransparency" type="range" min="0" max="80" step="5" /></label>
              <label class="home-appearance-control" for="app-font-size"><span><strong>文字大小</strong><small>调整整个应用的文字</small></span><output for="app-font-size">{{ appFontSize }}%</output><input id="app-font-size" v-model.number="appFontSize" type="range" min="85" max="125" step="5" /></label>
              <label class="home-appearance-control" for="card-gap"><span><strong>卡片间距</strong><small>调整首页、收藏和网站卡片之间的距离</small></span><output for="card-gap">{{ cardGap }}px</output><input id="card-gap" v-model.number="cardGap" type="range" min="6" max="22" step="2" /></label>
            </div>
            </div>
          </section>
          <section class="settings-group" aria-labelledby="settings-web-tool-title">
            <div class="settings-group-heading"><span class="settings-group-icon"><AppIcon name="module-code" /></span><div><h2 id="settings-web-tool-title">网页工具设置</h2><p>调整工具运行时限、默认全屏和退出提示</p></div></div>
            <WebToolBudgetSettings :key="webToolSettingsRevision" @error="notify" />
          </section>
          <section class="settings-group" aria-labelledby="settings-other-title">
            <div class="settings-group-heading"><span class="settings-group-icon"><AppIcon name="module-folder" /></span><div><h2 id="settings-other-title">其他</h2><p>管理本机记录与配置文件</p></div></div>
            <div class="preference-list">
              <button class="preference-option" type="button" :disabled="!store.recent.length" @click="clearRecentTools"><span><strong>清空最近使用</strong><small>删除本机的工具使用记录。</small></span></button>
              <button class="preference-option" type="button" :disabled="cacheBusy" :aria-busy="cacheBusy" @click="clearRuntimeCache"><span><strong>清理缓存</strong><small>清理网页运行缓存、引擎内存缓存和预览临时数据，保留收藏、设置、工具源码与已保存的内容。</small></span><span v-if="cacheProgressVisible" class="cache-progress" role="status">正在清理…</span></button>
              <button class="preference-option" type="button" :disabled="toolSelectionBusy || desktopCloseBusy || desktopAutostartBusy" @click="resetSettings"><span><strong>{{ settingsResetBusy ? '正在重置设置…' : '重置设置' }}</strong><small>将“更多设置”中的设置恢复为初始值，保留缓存和最近使用记录。</small></span></button>
              <button class="preference-option" type="button" @click="openBackupDialog"><span><strong>配置管理</strong><small>备份内置工具收藏、网站、界面与网页工具设置；不含自动化工具、JS 工具、输入或壁纸图片。</small></span></button>
              <button v-if="supportsJsModules" class="preference-option" type="button" @click="navigate('deviceSync')"><span><strong>设备同步</strong><small>通过局域网在 PC 和手机间同步工具，可选择收藏、网站和其他设置。</small></span><span class="device-sync-chevron" aria-hidden="true"><AppIcon name="chevron-right" /></span></button>
            </div>
          </section>
        </section>

        <section v-else-if="page === 'about'" class="content-section first-section preference-page" aria-label="关于应用">
          <div class="about-card">
            <img class="about-app-icon" :src="appIcon" alt="" />
            <h1>流萤百宝箱</h1>
            <p>你的跨端实用工具箱：文本、图片、音视频与文档处理，搭配自定义工具和网站书签。</p>
            <div class="about-disclaimer"><p>本项目为个人开源项目，与米哈游（HoYoverse）无关。所以涉及的游戏角色名称及图标设计版权归米哈游所有。</p></div>
            <div class="about-links">
              <button class="about-link" type="button" :disabled="checkingUpdates" @click="remoteMessages?.checkUpdates()"><AppIcon name="about" /><span>版本 {{ appManifest.version }}</span><span class="about-link-action">{{ checkingUpdates ? '检查中…' : '检查更新' }} <span aria-hidden="true">→</span></span></button>
              <button class="about-link" type="button" @click="openProjectPage('source')"><AppIcon name="module-code" /><span>项目源码</span><span class="about-link-action">GitHub <span aria-hidden="true">→</span></span></button>
              <button class="about-link" type="button" @click="openProjectPage('website')"><AppIcon name="module-globe" /><span>官方网站</span><span class="about-link-action">访问网站 <span aria-hidden="true">→</span></span></button>
            </div>
          </div>
        </section>

        <template v-else>
          <section v-if="activeTool?.ui_kind === 'web'" class="web-tool-page">
            <p class="tool-intro">{{ activeTool.description }}</p>
            <div v-if="webToolFileStatus.message || webToolFileStatus.busy" class="web-tool-controls"><p v-if="webToolFileStatus.message" class="web-file-status" :class="{ error: webToolFileStatus.code && webToolFileStatus.code !== 'FILE_CANCELED' }" role="status">{{ webToolFileStatus.message }}</p><button v-if="webToolFileStatus.busy" class="secondary-button" type="button" @click="cancelWebToolFiles">取消当前操作</button></div>
            <p v-if="webToolStopped" class="editor-status">可从右上角菜单中选择“运行工具”。</p>
            <div ref="webToolContainer" class="web-tool-container" :aria-busy="webToolLoading" aria-label="网页工具"></div>
            <OfficialBoxOffice v-if="officialBoxOfficeOpen && activeToolId === 'boxoffice.live'" :src="officialBoxOfficeUrl" @external="openWebPage(officialBoxOfficeUrl, '猫眼实时票房', 'boxoffice')" />
            <p v-if="webToolLoadingVisible" class="editor-status" role="status">正在打开网页工具…</p>
            <p v-if="webToolError" class="editor-status error" role="alert">{{ webToolError }}</p>
          </section>
          <template v-else>
            <p v-if="!activeTool?.custom" class="tool-intro">{{ activeTool?.description }}</p>
          <div v-if="activeActions.length > 1" class="tool-action-tabs" role="group" aria-label="工具操作"><button v-for="action in activeActions" :key="action.id" class="secondary-button" :class="{ selected: toolAction === action.id }" :aria-pressed="toolAction === action.id" @click="chooseToolAction(action.id)">{{ action.label }}</button></div>
          <div class="editor-tabs" role="tablist" aria-label="编辑区域"><button role="tab" :aria-selected="editorTab === 'input'" :class="{ active: editorTab === 'input' }" @click="editorTab = 'input'">输入</button><button role="tab" :aria-selected="editorTab === 'output'" :class="{ active: editorTab === 'output' }" @click="editorTab = 'output'">结果</button></div>
          <div class="editor-grid"><section class="editor-pane" :class="{ 'mobile-hidden': editorTab !== 'input' }"><div class="pane-header"><label for="tool-input">输入内容</label><div><button v-if="activeToolId === 'json.format'" class="text-button" @click="loadSample">载入示例</button><button class="text-button" @click="input = ''; inputChanged()">清空</button></div></div><textarea id="tool-input" v-model="input" spellcheck="false" :placeholder="activeToolId === 'json.format' ? '例如：{&quot;hello&quot;:&quot;流萤百宝箱&quot;}' : '输入要处理的文本'" @input="inputChanged"></textarea></section><section class="editor-pane" :class="{ 'mobile-hidden': editorTab !== 'output' }"><div class="pane-header"><label for="tool-output">处理结果</label></div><textarea id="tool-output" ref="outputBox" :value="output" readonly spellcheck="false" placeholder="处理后的结果会出现在这里"></textarea></section></div>
          <p class="editor-status" :class="{ error: statusError }" role="status">{{ status }}</p><div class="editor-actions"><button class="primary-button" :disabled="(!input && !canRunEmpty) || running" @click="format">{{ running ? '处理中…' : (activeActions.find((action) => action.id === toolAction)?.label ?? '处理') }}</button><button v-if="running && (activeTool?.module_id || activeTool?.custom)" class="secondary-button" type="button" @click="cancelActiveModule">取消运行</button><button class="secondary-button" :disabled="!canCopy" @click="copyOutput">复制结果</button></div>
          </template>
        </template>
      </main>
    </div>

    <nav v-if="isTabPage" class="bottom-nav" aria-label="底部导航"><button v-for="item in bottomNavigation" :key="item.page" :class="{ active: page === item.page }" :aria-current="page === item.page ? 'page' : undefined" @click="navigate(item.page)"><AppIcon class="bottom-nav-icon" :name="item.icon" :filled="item.page === 'favorites' && page === 'favorites'" />{{ item.name }}</button></nav>

    <dialog ref="websiteActionsDialog" class="detect-dialog website-actions-dialog" @close="websiteActionSite = null; updateNativeBack()">
      <template v-if="websiteActionSite"><div class="dialog-heading"><h2>{{ websiteActionSite.name }}</h2><button class="icon-button" type="button" aria-label="关闭网站操作" @click="closeWebsiteActions">×</button></div><p class="website-actions-url">{{ websiteActionSite.url }}</p><p v-if="websiteActionSite.description" class="website-actions-description">{{ websiteActionSite.description }}</p><div v-if="websiteActionSite.tags" class="website-tags"><span v-for="tag in websiteActionSite.tags.split(/[,，\s]+/).filter(Boolean)" :key="tag">#{{ tag }}</span></div><div class="website-actions-list"><button class="primary-button" type="button" @click="visitWebsite(websiteActionSite); closeWebsiteActions()">打开网站</button><button class="secondary-button" type="button" @click="editWebsiteFromActions">编辑信息</button><button class="secondary-button delete-action" type="button" @click="deleteWebsiteFromActions">删除网站</button></div></template>
    </dialog>
    <dialog ref="websiteDialog" class="detect-dialog website-dialog" @close="onWebsiteDialogClosed"><form @submit.prevent="saveWebsite"><div class="dialog-heading"><h2>{{ websiteForm.id ? '编辑网站' : '添加网站' }}</h2><button class="icon-button" type="button" aria-label="关闭网站编辑窗口" @click="closeWebsiteDialog">×</button></div><label for="website-name">名称</label><input id="website-name" v-model="websiteForm.name" required maxlength="120" placeholder="例如：开发文档" /><label for="website-url">网址</label><input id="website-url" v-model="websiteForm.url" required type="url" placeholder="https://example.com" /><p v-if="websiteForm.url.trim().toLowerCase().startsWith('http://')" class="warning-text">HTTP 连接未加密，请确认这是你要保存的网站。</p><label for="website-description">描述（可选）</label><input id="website-description" v-model="websiteForm.description" maxlength="1000" /><template v-if="websiteGroupSettings.groups.length"><label for="website-group">所属分组</label><ViewportSelect id="website-group" v-model="websiteFormGroup" :options="[{ value: WEBSITE_UNGROUPED, label: '未分组' }, ...websiteCategories.filter((group) => group.id !== WEBSITE_UNGROUPED).map((group) => ({ value: group.id, label: group.name }))]" ariaLabel="所属分组" /></template><label for="website-tags">标签（可选，逗号分隔）</label><input id="website-tags" v-model="websiteForm.tags" maxlength="500" placeholder="开发, 文档" /><p v-if="websiteError" class="error-text" role="alert">{{ websiteError }}</p><div class="dialog-actions"><button class="secondary-button" type="button" @click="closeWebsiteDialog">取消</button><button class="primary-button" :disabled="websiteSaving" type="submit">{{ websiteSaving ? '保存中…' : '保存网站' }}</button></div></form></dialog>
    <dialog ref="backupDialog" class="detect-dialog backup-dialog" @cancel.prevent="closeBackupDialog" @close="updateNativeBack">
      <div class="dialog-heading"><h2>导入或导出配置</h2><button class="icon-button" type="button" :disabled="backupBusy" aria-label="关闭配置管理窗口" @click="closeBackupDialog">×</button></div>
      <p class="muted">导出会让你选择 JSON 文件的保存位置。导入会替换内置工具收藏、网站、界面与网页工具设置（运行时限、默认全屏和退出提示），最近使用会清空；本机的无代码工具、JS 工具及其收藏会保留。</p>
      <p v-if="backupError" class="error-text" role="alert">{{ backupError }}</p>
      <div class="dialog-actions backup-actions">
        <button class="secondary-button" type="button" :disabled="backupBusy" @click="exportBackup">导出</button>
        <button class="primary-button" type="button" :disabled="backupBusy" @click="importBackup">{{ backupBusy ? '正在处理…' : '导入并覆盖' }}</button>
      </div>
    </dialog>
    <dialog ref="groupCreateDialog" class="detect-dialog group-create-dialog" aria-labelledby="group-create-title" @close="closeGroupCreateDialog">
      <form @submit.prevent="createManagedGroup">
        <div class="dialog-heading"><h2 id="group-create-title">新建{{ groupManagerTab === 'home' ? '首页工具' : groupManagerTab === 'favorites' ? '收藏工具' : '网站' }}分组</h2><button class="icon-button" type="button" aria-label="关闭新建分组窗口" @click="closeGroupCreateDialog">×</button></div>
        <p class="muted">创建后可在分组卡片中加入内容，也可以拖动已有内容调整分组。</p>
        <label for="new-managed-group">分组名称</label>
        <input id="new-managed-group" ref="groupCreateInput" v-model="newGroupName" maxlength="40" required placeholder="例如：工作、设计、学习" @input="groupCreateError = ''" />
        <p v-if="groupCreateError" class="error-text" role="alert">{{ groupCreateError }}</p>
        <div class="dialog-actions"><button class="secondary-button" type="button" @click="closeGroupCreateDialog">取消</button><button class="primary-button" type="submit">创建分组</button></div>
      </form>
    </dialog>
    <dialog ref="confirmDialog" class="detect-dialog confirm-dialog" aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-message" @cancel="onConfirmationCancel" @close="onConfirmationClosed">
      <span class="confirm-dialog-icon" :class="{ 'confirm-dialog-icon-danger': confirmation?.danger }" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7v6m0 4h.01" /></svg></span>
      <h2 id="confirm-dialog-title">{{ confirmation?.title }}</h2>
      <p id="confirm-dialog-message">{{ confirmation?.message }}</p>
      <div class="dialog-actions confirm-dialog-actions"><button ref="confirmCancelButton" class="secondary-button" type="button" @click="finishConfirmation(false)">取消</button><button class="primary-button" :class="{ 'confirm-danger': confirmation?.danger }" type="button" @click="finishConfirmation(true)">{{ confirmation?.action }}</button></div>
    </dialog>
    <Transition name="toast-pop"><div v-if="toast" ref="toastElement" class="toast" role="status" popover="manual">{{ toast }}</div></Transition>
  </div>
  <Teleport to="body">
    <div v-if="webToolOpening && startupReady && !shortcutOpening && !showMobileSplash" class="web-tool-opening-cover" role="status" aria-label="正在打开网页工具" aria-busy="true"><span v-if="webToolLoadingVisible">正在打开网页工具…</span></div>
    <WebToolFullscreenControls ref="fullscreenControls" :active="toolFullscreen && !webToolOpening" :mobile="!isWindowsApp && isMobileLayout()" :initial-hint="initialFullscreenHint" @exit="leaveToolFullscreen" />
    <button v-if="searchOpen" type="button" class="search-backdrop" aria-label="关闭搜索" @click="closeSearch()"></button>
    <Transition name="search-slide">
      <section v-if="searchOpen" class="search-page" role="dialog" aria-modal="true" aria-label="搜索工具和网站" @contextmenu="onAppContextMenu">
        <header class="search-page-header">
          <button class="top-icon-button" type="button" aria-label="返回" @click="closeSearch()"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg></button>
          <label class="search-page-field"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></svg><input ref="searchBox" v-model="searchQuery" type="search" enterkeyhint="search" autocomplete="off" aria-label="搜索工具和网站" placeholder="搜索工具和网站" @keydown="onSearchInputKey" /></label>
        </header>
        <div class="search-page-content">
          <section v-if="!searchQuery.trim()" class="search-section" aria-labelledby="history-title">
            <div class="search-section-heading"><h2 id="history-title">历史点击</h2><button type="button" :disabled="!searchHistory.length" @click="clearSearchHistory">清除</button></div>
            <div v-if="recentSearchItems.length" class="search-pills"><button v-for="item in recentSearchItems" :key="`${item.kind}:${item.id}`" class="search-pill" type="button" @click="activateSearchItem(item)"><span v-if="item.kind !== 'tool' || item.icon_data || item.icon" aria-hidden="true"><img v-if="item.icon_data" :src="item.icon_data" alt="" /><AppIcon v-else-if="item.icon" :name="`module-${item.icon}`" /><template v-else>◎</template></span>{{ item.name }}</button></div>
            <p v-else class="search-empty">暂无历史点击</p>
          </section>
          <section v-if="searchQuery.trim()" class="search-section search-results" aria-label="搜索结果">
            <template v-if="searchGroups.length">
              <div v-for="group in searchGroups" :key="group.source" class="search-result-group"><h2>{{ group.source }}</h2><div class="search-pills"><button v-for="item in group.items" :key="`${item.kind}:${item.id}`" class="search-pill" type="button" @click="activateSearchItem(item)"><span v-if="item.kind !== 'tool' || item.icon_data || item.icon" aria-hidden="true"><img v-if="item.icon_data" :src="item.icon_data" alt="" /><AppIcon v-else-if="item.icon" :name="`module-${item.icon}`" /><template v-else>◎</template></span>{{ item.name }}</button></div></div>
            </template>
            <div v-else class="empty-state empty-illustrated" role="status"><img class="empty-state-illustration" :src="noAvailableTools" alt="" /><h3>没有找到匹配的工具或网站</h3><p>换个关键词再试试。</p></div>
          </section>
        </div>
      </section>
    </Transition>
  </Teleport>
  <Teleport to="body">
    <RemoteMessages ref="remoteMessages" :ready="startupReady && !showMobileSplash && !shortcutOpening && !searchOpen && !sidebarOpen" :current-version="appManifest.version" @notify="notify" @open-change="onRemoteMessagesOpen" @checking-change="checkingUpdates = $event" />
    <StartupSplash v-if="showMobileSplash && !startupImageLoading" :image-src="startupImageUrl || splashMobile" @done="showMobileSplash = false" />
  </Teleport>
</template>
