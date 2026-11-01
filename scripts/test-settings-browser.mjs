// Real UI regression with mocked native commands and isolated browser contexts.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { mockAndroidShell } from './android-shell-fixture.mjs'

const dist = path.resolve('dist')
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname
  const file = pathname === '/' ? path.join(dist, 'index.html') : path.resolve(dist, '.' + pathname)
  if (!file.startsWith(dist + path.sep)) { response.writeHead(404); response.end(); return }
  try {
    const bytes = await readFile(file)
    response.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' })[path.extname(file)] ?? 'application/octet-stream')
    response.end(bytes)
  } catch { response.writeHead(404); response.end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const browser = await chromium.launch({ executablePath: process.env.FIREFLY_TEST_BROWSER || (existsSync(chrome) ? chrome : 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'), headless: true })

async function pageFor(width = 1280, { windows = false, android = false, preferences = {} } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, ...(windows ? { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36' } : android ? { userAgent: 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) })
  context.setDefaultTimeout(8000)
  const page = await context.newPage()
  if (android) await page.addInitScript(mockAndroidShell)
  await page.addInitScript(({ preferences }) => {
    if (!sessionStorage.getItem('settings-seeded')) {
      for (const [key, value] of Object.entries(preferences)) localStorage.setItem(key, value)
      sessionStorage.setItem('settings-seeded', 'yes')
    }
    window.desktopSettings = JSON.parse(sessionStorage.getItem('desktop-settings') || '{"closeBehavior":"exit","autostart":true}')
    window.isTauri = true
    window.calls = []
    window.configContents = JSON.stringify({ format: 'firefly-config-v1', database: { schema_version: 3, favorites: ['json.format'], websites: [] }, preferences: { 'firefly.theme.v1': 'dark' } })
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: () => 1, unregisterCallback() {},
      async invoke(command, args) {
        window.calls.push({ command, args })
        if (['list_tools', 'list_favorites', 'list_recent_tools', 'list_custom_tools', 'list_websites', 'list_modules'].includes(command)) return []
        if (command === 'desktop_close_behavior') return window.desktopSettings.closeBehavior
        if (command === 'desktop_autostart_enabled') return window.desktopSettings.autostart
        if (command === 'set_desktop_close_behavior') {
          if (window.holdReset && args.behavior === 'tray') await new Promise(resolve => { window.resetDone = resolve })
          window.desktopSettings.closeBehavior = args.behavior; sessionStorage.setItem('desktop-settings', JSON.stringify(window.desktopSettings)); return
        }
        if (command === 'set_desktop_autostart') {
          window.desktopSettings.autostart = args.enabled; sessionStorage.setItem('desktop-settings', JSON.stringify(window.desktopSettings))
          if (window.failDisableAutostart && !args.enabled) { window.failDisableAutostart = false; throw Error('native write failed') }; return
        }
        if (command === 'clear_runtime_cache') return new Promise(resolve => { window.cacheDone = resolve })
        if (command === 'export_configuration') return { schema_version: 3, favorites: ['json.format'], websites: [] }
        if (command === 'plugin:dialog|open') return 'C:/fixture/config.json'
        if (command === 'plugin:dialog|save') return 'C:/fixture/backup.json'
        if (command === 'read_configuration_file') return window.configContents
        if (command === 'write_configuration_file') { window.exported = args.contents; return }
        if (command === 'import_configuration') { sessionStorage.setItem('imported', 'yes'); return }
        if (command === 'sync_receive') return new Promise(resolve => { window.receiveDone = resolve })
        if (command === 'sync_close' && window.deferClose) return new Promise(resolve => { window.closeDone = resolve })
        return null
      },
    }
  }, { preferences })
  await page.goto(origin)
  await page.locator('.nav-button').filter({ hasText: '更多设置' }).evaluate(button => button.click())
  await page.getByRole('region', { name: '更多设置', exact: true }).waitFor()
  return { context, page }
}

try {
  const customSettings = {
    'firefly.start-page.v1': 'websites', 'firefly.auto-hide-bars.v1': 'false', 'firefly.smart-clipboard.v1': 'true', 'firefly.usage-stats.v1': 'true',
    'firefly.component-transparency.v1': '80', 'firefly.app-font-size.v1': '125', 'firefly.card-gap.v1': '22', 'firefly.home-font-size.v1': '120', 'firefly.home-card-gap.v1': '20',
    'firefly.web-tool-initialization-ms.v1': '60000', 'firefly.web-tool-interaction-ms.v1': '0', 'firefly.web-tool-default-fullscreen.v1': 'true', 'firefly.web-tool-fullscreen-initial-hint.v1': 'false',
  }
  const protectedSettings = { 'firefly.theme.v1': 'dark', 'firefly.accent.v1': '#123456', 'firefly.startup-splash-enabled.v1': 'false', 'firefly.groups.favorites.v1': '{"enabled":true,"groups":[],"assignments":{}}', 'firefly.browser-module.tool.test.private': 'keep me', 'firefly.remote-messages.read.v1': '["test-history"]' }
  const snapshot = page => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])))
  const resetButton = page => page.getByRole('button', { name: /^重置设置/ })
  for (const [width, windows] of [[1280, true], [390, false]]) {
    await test(`reset settings requires confirmation, preserves content and restores every More Settings control at ${width}px`, async () => {
      const { context, page } = await pageFor(width, { windows, android: !windows, preferences: { ...customSettings, ...protectedSettings } })
      try {
        const before = await snapshot(page)
        await resetButton(page).click(); await page.locator('.confirm-dialog[open]').waitFor()
        assert.deepEqual(await snapshot(page), before)
        await page.locator('.confirm-dialog').getByRole('button', { name: '取消', exact: true }).click()
        assert.deepEqual(await snapshot(page), before)
        await resetButton(page).click(); await page.locator('.confirm-dialog').getByRole('button', { name: '确认重置', exact: true }).click()
        await page.locator('.toast').filter({ hasText: '已恢复初始状态' }).waitFor()
        const verify = async () => {
          assert.match(await page.locator('.start-page-preference').innerText(), /首页/)
          assert.deepEqual(await page.locator('.home-appearance-controls input').evaluateAll(nodes => nodes.map(n => n.value)), ['40', '100', '10'])
          assert.equal(await page.getByRole('switch', { name: /^智能识别剪切板内容/ }).getAttribute('aria-checked'), 'false')
          assert.equal(await page.getByRole('switch', { name: /^记录最近使用/ }).getAttribute('aria-checked'), 'false')
          assert.match(await page.getByRole('button', { name: '初始化预算', exact: true }).textContent(), /5 秒（默认）/)
          assert.match(await page.getByRole('button', { name: '挂载后交互预算', exact: true }).textContent(), /10 秒（默认）/)
          assert.equal(await page.getByRole('switch', { name: /^网页工具默认全屏显示/ }).getAttribute('aria-checked'), 'false')
          assert.equal(await page.getByRole('switch', { name: /^退出全屏的初次提示/ }).getAttribute('aria-checked'), 'true')
          if (windows) {
            assert.deepEqual(await page.evaluate(() => window.desktopSettings), { closeBehavior: 'tray', autostart: false })
            assert.equal(await page.getByRole('switch', { name: /^开机自动启动/ }).getAttribute('aria-checked'), 'false')
          } else assert.equal(await page.getByRole('switch', { name: /^自动隐藏导航栏/ }).getAttribute('aria-checked'), 'true')
          for (const [k, v] of Object.entries(protectedSettings)) assert.equal(await page.evaluate(k => localStorage.getItem(k), k), v)
        }
        await verify(); await page.reload(); await page.locator('.nav-button').filter({ hasText: '更多设置' }).evaluate(n => n.click()); await verify()
        assert.equal(await page.evaluate(() => window.calls.some(c => ['clear_runtime_cache', 'clear_recent_tools', 'import_configuration', 'sync_apply', 'delete_tools'].includes(c.command))), false)
      } finally { await context.close() }
    })
  }
  await test('failed reset rolls back Windows changes and keeps prior local preferences', async () => {
    const { context, page } = await pageFor(1280, { windows: true, preferences: customSettings })
    try {
      const before = await snapshot(page)
      await page.evaluate(() => { window.failDisableAutostart = true })
      await resetButton(page).click(); await page.locator('.confirm-dialog').getByRole('button', { name: '确认重置', exact: true }).click()
      await page.locator('.toast').filter({ hasText: '重置设置失败' }).waitFor()
      assert.deepEqual(await snapshot(page), before)
      assert.deepEqual(await page.evaluate(() => window.desktopSettings), { closeBehavior: 'exit', autostart: true })
      assert.equal(await resetButton(page).isEnabled(), true)
    } finally { await context.close() }
  })
  await test('reset blocks concurrent navigation and waits for native settings to finish', async () => {
    const { context, page } = await pageFor(1280, { windows: true, preferences: customSettings })
    try {
      await page.evaluate(() => { window.holdReset = true })
      await resetButton(page).click(); await page.locator('.confirm-dialog').getByRole('button', { name: '确认重置', exact: true }).click()
      await page.waitForFunction(() => !!window.resetDone)
      assert.equal(await page.locator('.settings-page').getAttribute('aria-busy'), 'true')
      await page.locator('.nav-button').filter({ hasText: '首页' }).evaluate(n => n.click())
      assert.equal(await page.locator('.settings-page').count(), 1)
      await page.evaluate(() => window.resetDone())
      await page.locator('.toast').filter({ hasText: '已恢复初始状态' }).waitFor()
      assert.equal(await page.locator('.settings-page').getAttribute('aria-busy'), 'false')
    } finally { await context.close() }
  })
  for (const width of [1280, 390]) {
    await test(`web tool budgets persist independently and restore defaults at ${width}px`, async () => {
      const { context, page } = await pageFor(width)
      try {
        const init = page.getByRole('button', { name: '初始化预算', exact: true })
        const interaction = page.getByRole('button', { name: '挂载后交互预算', exact: true })
        assert.match(await init.textContent(), /5 秒（默认）/)
        assert.match(await interaction.textContent(), /10 秒（默认）/)
        await init.click(); await page.getByRole('option', { name: '30 秒', exact: true }).click()
        await interaction.click(); await page.getByRole('option', { name: '不限制', exact: true }).click()
        assert.deepEqual(await page.evaluate(() => [localStorage.getItem('firefly.web-tool-initialization-ms.v1'), localStorage.getItem('firefly.web-tool-interaction-ms.v1')]), ['30000', '0'])
        await page.reload()
        await page.locator('.nav-button').filter({ hasText: '更多设置' }).evaluate(button => button.click())
        assert.match(await init.textContent(), /30 秒/); assert.match(await interaction.textContent(), /不限制/)
        await page.locator('.web-tool-budget-settings').getByRole('button', { name: '恢复默认', exact: true }).click()
        assert.match(await init.textContent(), /5 秒（默认）/); assert.match(await interaction.textContent(), /10 秒（默认）/)
        assert.deepEqual(await page.evaluate(() => [localStorage.getItem('firefly.web-tool-initialization-ms.v1'), localStorage.getItem('firefly.web-tool-interaction-ms.v1')]), [null, null])
      } finally { await context.close() }
    })
  }

  await test('invalid saved budgets fall back and a failed write retains the previous selection', async () => {
    const { context, page } = await pageFor()
    try {
      await page.evaluate(() => localStorage.setItem('firefly.web-tool-initialization-ms.v1', 'NaN'))
      await page.reload()
      await page.locator('.nav-button').filter({ hasText: '更多设置' }).evaluate(button => button.click())
      const init = page.getByRole('button', { name: '初始化预算', exact: true })
      assert.match(await init.textContent(), /5 秒（默认）/)
      await init.click(); await page.getByRole('option', { name: '30 秒', exact: true }).click()
      await page.evaluate(() => {
        const set = Storage.prototype.setItem; let fail = true
        Storage.prototype.setItem = function(key, value) {
          if (key === 'firefly.web-tool-initialization-ms.v1' && fail) { fail = false; throw new DOMException('Full', 'QuotaExceededError') }
          return set.call(this, key, value)
        }
      })
      await init.click(); await page.getByRole('option', { name: '60 秒', exact: true }).click()
      await page.locator('.toast').filter({ hasText: '运行预算未能保存' }).waitFor()
      assert.match(await init.textContent(), /30 秒/)
      assert.equal(await page.evaluate(() => localStorage.getItem('firefly.web-tool-initialization-ms.v1')), '30000')
      assert.equal(await page.locator('.web-tool-budget-settings [role="status"]').count(), 0)
    } finally { await context.close() }
  })

  await test('cache cleanup preserves saved tool data, blocks new work and reports partial cleanup', async () => {
    const { context, page } = await pageFor()
    try {
      await page.evaluate(() => {
        localStorage.setItem('firefly.browser-module.preview.test.note', 'temporary')
        localStorage.setItem('firefly.browser-module.tool.test.note', 'saved')
      })
      const button = page.getByRole('button', { name: /^清理缓存/ })
      await button.click()
      await page.waitForFunction(() => !!window.cacheDone)
      assert.equal(await button.isDisabled(), true)
      await page.locator('.nav-button').filter({ hasText: '关于应用' }).evaluate(button => button.click())
      assert.equal(await page.getByRole('region', { name: '更多设置', exact: true }).count(), 1)
      await page.evaluate(() => window.cacheDone({ disk_cache_cleared: true, temporary_files: 1, temporary_bytes: 12, memory_bytes: 1048576, skipped_files: 2, warnings: [] }))
      await page.locator('.toast').filter({ hasText: '部分清理' }).waitFor()
      assert.equal(await page.locator('.settings-page [role="status"]').count(), 0)
      assert.equal(await page.evaluate(() => localStorage.getItem('firefly.browser-module.preview.test.note')), null)
      assert.equal(await page.evaluate(() => localStorage.getItem('firefly.browser-module.tool.test.note')), 'saved')
    } finally { await context.close() }
  })

  await test('backup export includes all sort orders and import requires confirmation before changing data', async () => {
    const { context, page } = await pageFor()
    try {
      await page.evaluate(() => localStorage.setItem('firefly.order.categories.v1', '["source:效率工具"]'))
      await page.getByRole('switch', { name: /^网页工具默认全屏显示/ }).click()
      await page.getByRole('switch', { name: /^退出全屏的初次提示/ }).click()
      await page.getByRole('button', { name: /^配置管理/ }).click()
      const dialog = page.locator('.backup-dialog')
      await dialog.getByRole('button', { name: '导出', exact: true }).click()
      await page.waitForFunction(() => !!window.exported)
      assert.equal(await page.evaluate(() => JSON.parse(window.exported).preferences['firefly.order.categories.v1']), '["source:效率工具"]')
      assert.deepEqual(await page.evaluate(() => ['firefly.web-tool-default-fullscreen.v1', 'firefly.web-tool-fullscreen-initial-hint.v1'].map(key => JSON.parse(window.exported).preferences[key])), ['true', 'false'])
      await page.evaluate(() => { const data = JSON.parse(window.exported); data.preferences['firefly.theme.v1'] = 'dark'; window.configContents = JSON.stringify(data) })
      await dialog.getByRole('button', { name: '导入并覆盖', exact: true }).click()
      const confirmation = page.locator('.confirm-dialog')
      await confirmation.waitFor({ state: 'visible' })
      assert.equal(await page.evaluate(() => sessionStorage.getItem('imported')), null)
      await confirmation.getByRole('button', { name: '取消', exact: true }).click()
      assert.equal(await page.evaluate(() => sessionStorage.getItem('imported')), null)
      await dialog.getByRole('button', { name: '导入并覆盖', exact: true }).click()
      await confirmation.waitFor({ state: 'visible' })
      await Promise.all([page.waitForEvent('load'), confirmation.getByRole('button', { name: '导入并覆盖', exact: true }).click()])
      assert.equal(await page.evaluate(() => sessionStorage.getItem('imported')), 'yes')
      assert.equal(await page.evaluate(() => localStorage.getItem('firefly.theme.v1')), 'dark')
      await page.locator('.nav-button').filter({ hasText: '更多设置' }).evaluate(button => button.click())
      assert.equal(await page.getByRole('switch', { name: /^网页工具默认全屏显示/ }).getAttribute('aria-checked'), 'true')
      assert.equal(await page.getByRole('switch', { name: /^退出全屏的初次提示/ }).getAttribute('aria-checked'), 'false')
    } finally { await context.close() }
  })

  await test('invalid configuration never reaches the native database import command', async () => {
    const { context, page } = await pageFor()
    try {
      await page.evaluate(() => { const data = JSON.parse(window.configContents); data.preferences['firefly.order.favorites.v1'] = 'invalid'; window.configContents = JSON.stringify(data) })
      await page.getByRole('button', { name: /^配置管理/ }).click()
      await page.locator('.backup-dialog').getByRole('button', { name: '导入并覆盖', exact: true }).click()
      await page.locator('.backup-dialog .error-text').waitFor()
      assert.equal(await page.evaluate(() => window.calls.some(call => call.command === 'import_configuration')), false)
    } finally { await context.close() }
  })

  await test('sync network origins stay collapsed and expanding them never changes selection', async () => {
    for (const width of [320, 390, 1280]) {
      const { context, page } = await pageFor(width)
      try {
        await page.evaluate(() => document.documentElement.style.setProperty('--app-font-scale', '1.25'))
        await page.getByRole('button', { name: /^设备同步/ }).click()
        await page.getByRole('button', { name: '从其他设备接收', exact: true }).click()
        await page.getByPlaceholder('如：192.168.1.8:12345').fill('127.0.0.1:12345')
        await page.getByPlaceholder('填写发送端显示的配对码').fill('12345678')
        await page.getByRole('button', { name: '连接并预览', exact: true }).click()
        await page.waitForFunction(() => !!window.receiveDone)
        const hosts = Array.from({ length: 12 }, (_, i) => `https://host${i}.${'long'.repeat(10)}.example.com`)
        await page.evaluate(hosts => window.receiveDone({ app_version: '0.1.69', platform: 'windows', bytes: 4096, preferences: {}, storage_ids: [], web_data_count: 0, options: { modules: true, automations: false, builtins: false, favorites: false, websites: false, layout: false, preferences: false, web_data: false }, items: [{ key: 'module:network', kind: 'modules', name: '网络工具', status: 'new', reason: '', network_hosts: hosts }, { key: 'module:offline', kind: 'modules', name: '离线工具', status: 'new', reason: '', network_hosts: [] }] }), hosts)
        const item = page.locator('.sync-item').first(), details = item.locator('.sync-network'), choice = item.getByRole('checkbox')
        await details.waitFor()
        const aligned = await item.evaluate(node => Math.abs(node.querySelector('input').getBoundingClientRect().left - node.querySelector('.sync-summary-chevron').getBoundingClientRect().left) <= 1)
        assert.equal(aligned, true, 'Network disclosure starts in the checkbox column')
        assert.equal(await details.evaluate(node => node.open), false)
        assert.equal(await details.locator('li').first().isVisible(), false)
        assert.equal(await page.locator('.sync-item .sync-network').count(), 1)
        assert.equal(await choice.isChecked(), true)
        await details.locator('summary').click()
        assert.equal(await choice.isChecked(), true)
        assert.deepEqual(await details.locator('li').allTextContents(), hosts)
        assert.equal(await details.locator('li').first().isVisible(), true)
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
        await details.locator('summary').press('Space')
        assert.equal(await details.evaluate(node => node.open), false)
        await item.locator('.sync-item-choice').click()
        assert.equal(await choice.isChecked(), false)
        await details.locator('summary').click()
        assert.equal(await choice.isChecked(), false)
      } finally { await context.close() }
    }
  })

  await test('sync cancellation waits for native close and ignores a late preview', async () => {
    const { context, page } = await pageFor()
    try {
      await page.getByRole('button', { name: /^设备同步/ }).click()
      await page.getByRole('button', { name: '从其他设备接收', exact: true }).click()
      await page.getByPlaceholder('如：192.168.1.8:12345').fill('127.0.0.1:12345')
      await page.getByPlaceholder('填写发送端显示的配对码').fill('12345678')
      await page.getByRole('button', { name: '连接并预览', exact: true }).click()
      await page.waitForFunction(() => !!window.receiveDone)
      await page.evaluate(() => { window.deferClose = true })
      await page.getByRole('button', { name: '取消连接', exact: true }).click()
      await page.waitForFunction(() => !!window.closeDone)
      assert.equal(await page.getByRole('button', { name: '正在连接并读取…', exact: true }).isDisabled(), true)
      await page.evaluate(() => { window.closeDone(); window.receiveDone({ preferences: {}, items: [], options: {}, app_version: '0.1.49', platform: 'windows', bytes: 0 }) })
      await page.getByRole('button', { name: '连接并预览', exact: true }).waitFor()
      assert.equal(await page.getByRole('heading', { name: '选择接收的内容' }).count(), 0)
    } finally { await context.close() }
  })

  for (const width of [320, 390, 1280]) await test(`sync version hints distinguish updates and edited content while preserving overwrite confirmation at ${width}px`, async () => {
    const { context, page } = await pageFor(width)
    try {
      await page.getByRole('button', { name: /^设备同步/ }).click()
      await page.getByRole('button', { name: '从其他设备接收', exact: true }).click()
      await page.getByPlaceholder('如：192.168.1.8:12345').fill('127.0.0.1:12345')
      await page.getByPlaceholder('填写发送端显示的配对码').fill('12345678')
      await page.getByRole('button', { name: '连接并预览', exact: true }).click()
      await page.waitForFunction(() => !!window.receiveDone)
      await page.evaluate(() => window.receiveDone({ app_version: '0.1.69', platform: 'windows', bytes: 4096, preferences: {}, storage_ids: [], web_data_count: 0, options: { modules: true, automations: false, builtins: false, favorites: false, websites: false, layout: false, preferences: false, web_data: false }, items: [
        { key: 'module:update', kind: 'modules', name: '升级工具', status: 'conflict', status_label: '可更新', reason: '发送端版本较新；勾选覆盖后可更新本机工具。', versions: { local: '1.9.0', incoming: '1.10.0' }, network_hosts: [] },
        { key: 'module:edited', kind: 'modules', name: '修改工具', status: 'conflict', status_label: '内容不同', reason: '版本相同，内容不同；勾选覆盖后使用发送端内容。', versions: { local: '1.0.0', incoming: '1.0.0' }, network_hosts: [] },
        { key: 'module:older', kind: 'modules', name: '旧版工具', status: 'blocked', reason: '发送端版本较旧，请保留本机工具。', versions: { local: '2.0.0', incoming: '1.0.0' }, network_hosts: [] },
        { key: 'module:same', kind: 'modules', name: '相同工具', status: 'same', reason: '内容相同，无需重复同步。', versions: { local: '1.0.0', incoming: '1.0.0' }, network_hosts: [] },
        { key: 'module:new', kind: 'modules', name: '新增工具', status: 'new', reason: '', versions: { local: null, incoming: '1.0.0' }, network_hosts: [] },
      ] }))
      const update = page.locator('.sync-item').filter({ hasText: '升级工具' }), edited = page.locator('.sync-item').filter({ hasText: '修改工具' })
      await update.waitFor()
      assert.equal(await update.locator('.sync-item-status').textContent(), '可更新')
      assert.equal(await update.locator('.sync-item-versions').textContent(), '本机 1.9.0 → 发送端 1.10.0')
      assert.match(await edited.textContent(), /版本相同，内容不同/)
      assert.equal(await edited.locator('.sync-item-status').textContent(), '内容不同')
      assert.equal(await update.getByRole('checkbox').isDisabled(), true)
      assert.equal(await update.getByRole('checkbox').isChecked(), false)
      assert.equal(await page.locator('.sync-item').filter({ hasText: '新增工具' }).getByRole('checkbox').isChecked(), true)
      const overwrite = page.locator('.sync-replace input')
      await overwrite.check()
      assert.equal(await update.getByRole('checkbox').isDisabled(), false)
      assert.equal(await edited.getByRole('checkbox').isDisabled(), false)
      assert.equal(await update.getByRole('checkbox').isChecked(), false)
      for (const name of ['旧版工具', '相同工具']) assert.equal(await page.locator('.sync-item').filter({ hasText: name }).getByRole('checkbox').isDisabled(), true)
      await update.getByRole('checkbox').check(); await overwrite.uncheck()
      assert.equal(await update.getByRole('checkbox').isChecked(), false)
      assert.equal(await update.getByRole('checkbox').isDisabled(), true)
      await page.evaluate(() => document.documentElement.style.setProperty('--app-font-scale', '1.25'))
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    } finally { await context.close() }
  })

  await test('settings fit narrow mobile widths without horizontal overflow', async () => {
    const { context, page } = await pageFor(390)
    try {
      for (const width of [320, 360, 390, 430]) {
        await page.setViewportSize({ width, height: 900 })
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width}px`)
      }
    } finally { await context.close() }
  })
} finally {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
}
