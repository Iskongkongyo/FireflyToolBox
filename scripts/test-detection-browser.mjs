// Production UI with isolated browser state and controlled native responses.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { chromium } from 'playwright-core'

const dist = path.resolve('dist')
const screenshots = path.resolve('target-check/detection-page/browser')
await mkdir(screenshots, { recursive: true })
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname
  const file = pathname === '/' ? path.join(dist, 'index.html') : path.resolve(dist, '.' + pathname)
  if (!file.startsWith(dist + path.sep)) { response.writeHead(404); response.end(); return }
  try {
    response.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' })[path.extname(file)] ?? 'application/octet-stream')
    response.end(await readFile(file))
  } catch { response.writeHead(404); response.end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const browser = await chromium.launch({ executablePath: process.env.FIREFLY_TEST_BROWSER || (existsSync(chrome) ? chrome : 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'), headless: true })

async function withApp(work, width = 1280) {
  const context = await browser.newContext({ viewport: { width, height: 900 } })
  context.setDefaultTimeout(8000)
  try {
    const page = await context.newPage()
    await page.addInitScript(() => {
      window.isTauri = true; window.calls = []; window.detections = []; window.clipboardReads = 0; window.clipboardText = ''; window.launchHint = ''
      window.tools = [['json.format', 'JSON 格式化', 'format', 'json'], ['url.convert', 'URL 编解码', 'encode', 'text']].map(([id, name, action, type]) => ({ id, name, description: name, category: '开发与文本', tags: [], aliases: [], custom: false, builtin: true, ui_kind: 'text', actions: [{ id: action, label: '处理', input_types: [type], consumes_input: true }] }))
      window.result = (label = 'JSON') => [{ type_id: 'json', label, confidence: 1, actions: [{ tool_id: 'json.format', id: 'format', label: 'JSON 格式化 · 处理' }] }]
      window.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
        transformCallback: () => 1, unregisterCallback() {},
        async invoke(command, args) {
          window.calls.push({ command, args })
          if (command === 'list_tools') { if (window.failNextList) { window.failNextList = false; throw new Error('temporary catalog failure') }; return structuredClone(window.tools) }
          if (['list_favorites', 'list_recent_tools', 'list_custom_tools', 'list_websites', 'list_modules'].includes(command)) return []
          if (command === 'desktop_close_behavior') return 'tray'
          if (command === 'desktop_autostart_enabled') return false
          if (command === 'take_shortcut_launch') { const value = window.launchHint; window.launchHint = ''; return value }
          if (command === 'plugin:clipboard-manager|read_text') {
            window.clipboardReads++
            if (window.clipboardDenied) throw new Error('Permission denied')
            if (window.deferClipboard) return new Promise(resolve => window.clipboardDone = resolve)
            return window.clipboardText
          }
          if (command === 'run_text_tool') return 'cached result'
          if (command === 'detect_text') {
            const request = { input: args.input }; window.detections.push(request)
            if (window.failNextDetection) { window.failNextDetection = false; throw new Error('temporary detection failure') }
            if (window.deferDetections) return new Promise((resolve, reject) => { request.resolve = resolve; request.reject = reject })
            return window.result()
          }
          if (command === 'clear_runtime_cache') return new Promise(resolve => { window.cacheDone = resolve })
          return null
        },
      }
    })
    await page.goto(origin); await page.bringToFront()
    await page.waitForFunction(() => { const app = document.querySelector('.app-shell'); return app && getComputedStyle(app).display !== 'none' })
    await work(page)
  } finally { await context.close() }
}
async function manual(page, value) {
  await page.locator('.nav-button').filter({ hasText: '智能识别' }).evaluate(button => button.click())
  await page.getByRole('region', { name: '智能识别', exact: true }).waitFor()
  if (value !== undefined) await page.locator('#detect-input').fill(value)
}
async function settings(page) {
  await page.locator('.nav-button').filter({ hasText: '更多设置' }).evaluate(button => button.click())
}
async function enableClipboard(page) {
  await settings(page)
  await page.getByRole('switch', { name: /^智能识别剪切板内容/ }).click()
}
async function foreground(page) { await page.evaluate(() => window.dispatchEvent(new Event('firefly:foreground'))) }
async function detect(page) { await page.getByRole('button', { name: '识别内容', exact: true }).click() }

try {
  await test('editing input discards an old response and lets a newer request complete independently', () => withApp(async page => {
    await manual(page, '{"A":1}'); await page.evaluate(() => { window.deferDetections = true }); await detect(page)
    await page.waitForFunction(() => window.detections.length === 1)
    await page.locator('#detect-input').fill('{"B":2}'); await detect(page)
    await page.waitForFunction(() => window.detections.length === 2)
    await page.evaluate(() => window.detections[0].resolve(window.result('旧结果')))
    assert.equal(await page.locator('.result-action').count(), 0)
    assert.equal(await page.getByRole('button', { name: '识别中…', exact: true }).isDisabled(), true)
    await page.evaluate(() => window.detections[1].resolve(window.result('新结果')))
    await page.locator('.detection-result-card').filter({ hasText: '新结果' }).waitFor()
    assert.equal(await page.locator('#detect-input').inputValue(), '{"B":2}')
  }))

  await test('closing and immediately reopening preserves new input and ignores the old request and close event', () => withApp(async page => {
    await manual(page, '{"old":1}'); await page.evaluate(() => { window.deferDetections = true }); await detect(page)
    await page.waitForFunction(() => window.detections.length === 1)
    await page.evaluate(() => {
      document.querySelector('.top-title .top-icon-button').click()
      ;[...document.querySelectorAll('.nav-button')].find(button => button.textContent.trim() === '智能识别').click()
      const input = document.getElementById('detect-input'); input.value = 'new input'; input.dispatchEvent(new Event('input', { bubbles: true }))
      window.detections[0].resolve(window.result('迟到结果'))
    })
    assert.equal(await page.locator('#detect-input').inputValue(), 'new input')
    assert.equal(await page.locator('.result-action').count(), 0)
    assert.equal(await page.getByRole('button', { name: '识别内容', exact: true }).isDisabled(), false)
  }))

  await test('multibyte oversize input is rejected before native detection', () => withApp(async page => {
    await manual(page)
    await page.locator('#detect-input').evaluate(node => { node.value = '中'.repeat(350000); node.dispatchEvent(new Event('input', { bubbles: true })) })
    await detect(page); await page.getByText('待识别内容不能超过 1 MiB。', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.detections.length), 0)
  }))

  await test('choosing a recommendation refreshes metadata, preserves whitespace and never executes a tool automatically', () => withApp(async page => {
    const input = '  \n{"hello":"流萤"}\n  '
    await manual(page, input); await detect(page); await page.locator('.result-action').click()
    await page.locator('.editor-open .tool-title').filter({ hasText: 'JSON 格式化' }).waitFor()
    assert.equal(await page.locator('#tool-input').inputValue(), input)
    assert.equal(await page.getByRole('region', { name: '智能识别', exact: true }).isVisible(), false)
    assert.equal(await page.evaluate(() => window.calls.some(call => call.command === 'run_text_tool')), false)
  }))

  await test('a removed tool or changed action keeps recognition input instead of silently closing', () => withApp(async page => {
    await manual(page, '{"keep":1}'); await detect(page); await page.locator('.result-action').waitFor()
    await page.evaluate(() => { window.tools = window.tools.filter(tool => tool.id !== 'json.format') })
    await page.locator('.result-action').click(); await page.getByText(/工具或操作已变化/).waitFor()
    assert.equal(await page.locator('#detect-input').inputValue(), '{"keep":1}')
    assert.equal(await page.getByRole('region', { name: '智能识别', exact: true }).isVisible(), true)
  }))

  await test('a failed metadata refresh keeps the input and allows retrying the recommendation', () => withApp(async page => {
    await manual(page, '{"keep":2}'); await detect(page); await page.locator('.result-action').waitFor()
    await page.evaluate(() => { window.failNextList = true }); await page.locator('.result-action').click()
    await page.getByText(/无法打开推荐工具/).waitFor()
    assert.equal(await page.locator('#detect-input').inputValue(), '{"keep":2}')
    await page.locator('.result-action').click(); await page.locator('.editor-open .tool-title').filter({ hasText: 'JSON 格式化' }).waitFor()
    assert.equal(await page.locator('#tool-input').inputValue(), '{"keep":2}')
  }))

  await test('busy navigation keeps cache cleanup visible before recognition can open', () => withApp(async page => {
    await settings(page); await page.getByRole('button', { name: /^清理缓存/ }).click(); await page.waitForFunction(() => !!window.cacheDone)
    await page.locator('.nav-button').filter({ hasText: '智能识别' }).evaluate(button => button.click())
    await page.locator('.toast').filter({ hasText: /当前操作尚未完成/ }).waitFor()
    assert.equal(await page.locator('.detection-page').count(), 0)
    await page.evaluate(() => window.cacheDone({ disk_cache_cleared: true, temporary_files: 0, temporary_bytes: 0, memory_bytes: 0, skipped_files: 0, warnings: [] }))
    await page.waitForFunction(() => !document.querySelector('.settings-page [aria-busy="true"]'))
    await manual(page, '{"wait":1}'); await detect(page)
    await page.locator('.result-action').click(); await page.locator('.editor-open .tool-title').filter({ hasText: 'JSON 格式化' }).waitFor()
    assert.equal(await page.locator('#tool-input').inputValue(), '{"wait":1}')
  }))

  await test('clipboard reading stays disabled until opted in and failed detection retries the same content', () => withApp(async page => {
    await foreground(page); await page.waitForTimeout(350); assert.equal(await page.evaluate(() => window.clipboardReads), 0)
    await page.evaluate(() => { window.clipboardText = '{"retry":1}'; window.failNextDetection = true })
    await enableClipboard(page); await page.waitForFunction(() => window.detections.length === 1)
    await foreground(page); await page.getByRole('region', { name: '智能识别', exact: true }).waitFor()
    assert.equal(await page.locator('#detect-input').inputValue(), '{"retry":1}')
    assert.equal(await page.evaluate(() => window.detections.length), 2)
  }))

  await test('automatic detection never covers an open configuration dialog', () => withApp(async page => {
    await enableClipboard(page); await page.waitForFunction(() => window.clipboardReads >= 1)
    await page.getByRole('button', { name: /^配置管理/ }).click()
    const reads = await page.evaluate(() => window.clipboardReads)
    await page.evaluate(() => { window.clipboardText = '{"modal":1}' }); await foreground(page); await page.waitForTimeout(350)
    assert.equal(await page.evaluate(() => window.clipboardReads), reads)
    assert.equal(await page.locator('.detection-page').count(), 0)
    await page.getByLabel('关闭配置管理窗口').click(); await foreground(page)
    await page.getByRole('region', { name: '智能识别', exact: true }).waitFor()
  }))

  await test('a later foreground event coalesces a pending recognition and opens only the latest clipboard text', () => withApp(async page => {
    await page.evaluate(() => { window.clipboardText = '{"old":1}'; window.deferDetections = true })
    await enableClipboard(page); await page.waitForFunction(() => window.detections.length === 1)
    await page.evaluate(() => { window.clipboardText = '{"new":2}' }); await foreground(page)
    await page.waitForTimeout(300)
    await page.evaluate(() => window.detections[0].resolve(window.result()))
    await page.waitForFunction(() => window.detections.length === 2)
    await page.evaluate(() => window.detections[1].resolve(window.result()))
    await page.getByRole('region', { name: '智能识别', exact: true }).waitFor()
    assert.equal(await page.locator('#detect-input').inputValue(), '{"new":2}')
  }))

  await test('disabling automatic recognition discards an outstanding response', () => withApp(async page => {
    await page.evaluate(() => { window.clipboardText = '{"old":3}'; window.deferDetections = true })
    await enableClipboard(page); await page.waitForFunction(() => window.detections.length === 1)
    await page.getByRole('switch', { name: /^智能识别剪切板内容/ }).click()
    await page.evaluate(() => window.detections[0].resolve(window.result()))
    assert.equal(await page.locator('.detection-page').count(), 0)
  }))

  await test('manually opened recognition is not overwritten by an automatic response', () => withApp(async page => {
    await page.evaluate(() => { window.clipboardText = '{"clipboard":1}'; window.deferDetections = true })
    await enableClipboard(page); await page.waitForFunction(() => window.detections.length === 1)
    await manual(page, 'my manual input')
    await page.evaluate(() => window.detections[0].resolve(window.result()))
    assert.equal(await page.locator('#detect-input').inputValue(), 'my manual input')
    assert.equal(await page.locator('.result-action').count(), 0)
  }))

  await test('paste-and-recognize preserves the clipboard verbatim without enabling automatic reading', () => withApp(async page => {
    const value = '  \n{"clipboard":true}\n '
    await manual(page)
    assert.equal(await page.locator('#detect-input').evaluate(node => document.activeElement === node), false)
    await page.evaluate(value => window.clipboardText = value, value)
    await page.getByRole('button', { name: '粘贴并识别', exact: true }).click()
    await page.locator('.detection-result-card').waitFor()
    assert.equal(await page.locator('#detect-input').inputValue(), value)
    assert.equal(await page.evaluate(() => localStorage.getItem('firefly.smart-clipboard.v1')), null)
    assert.equal(await page.evaluate(() => window.clipboardReads), 1)
    await page.locator('.result-action').click()
    await page.locator('#tool-input').waitFor()
    assert.equal(await page.locator('#tool-input').inputValue(), value)
    await page.getByRole('button', { name: '返回智能识别', exact: true }).click()
    await page.locator('#detect-input').waitFor()
    assert.equal(await page.locator('#detect-input').inputValue(), value)
    assert.equal(await page.locator('.result-action').count(), 1)
    await page.locator('.top-title .top-icon-button').click()
    await manual(page)
    assert.equal(await page.locator('#detect-input').inputValue(), '')
  }))

  await test('empty, denied and oversized clipboard reads keep existing input available', () => withApp(async page => {
    await manual(page, '{"keep":true}'); await detect(page)
    await page.evaluate(() => window.clipboardText = '')
    await page.getByRole('button', { name: '粘贴并识别', exact: true }).click()
    await page.locator('.toast').filter({ hasText: '没有可识别的文字' }).waitFor()
    await page.evaluate(() => window.clipboardDenied = true)
    await page.getByRole('button', { name: '粘贴并识别', exact: true }).click()
    await page.locator('.toast').filter({ hasText: '无法粘贴文字' }).waitFor()
    await page.evaluate(() => { window.clipboardDenied = false; window.clipboardText = '中'.repeat(350000) })
    await page.getByRole('button', { name: '粘贴并识别', exact: true }).click()
    await page.locator('.toast').filter({ hasText: '超过 1 MiB' }).waitFor()
    assert.equal(await page.locator('#detect-input').inputValue(), '{"keep":true}')
    assert.equal(await page.locator('.result-action').count(), 1)
  }))

  await test('typing, clearing and returning discard late clipboard responses', () => withApp(async page => {
    await manual(page); await page.evaluate(() => window.deferClipboard = true)
    await page.getByRole('button', { name: '粘贴并识别', exact: true }).click()
    await page.waitForFunction(() => !!window.clipboardDone)
    await page.locator('#detect-input').fill('manual input')
    await page.evaluate(() => window.clipboardDone('{"late":1}'))
    assert.equal(await page.locator('#detect-input').inputValue(), 'manual input')
    await page.getByRole('button', { name: '粘贴并识别', exact: true }).click()
    await page.getByRole('button', { name: '清空', exact: true }).click()
    await page.evaluate(() => window.clipboardDone('{"late":2}'))
    assert.equal(await page.locator('#detect-input').inputValue(), '')
    await page.getByRole('button', { name: '粘贴并识别', exact: true }).click()
    await page.locator('.top-title .top-icon-button').click()
    await page.evaluate(() => window.clipboardDone('{"late":3}'))
    assert.equal(await page.locator('.detection-page').count(), 0)
  }))

  await test('clear and Ctrl+Enter support the complete standalone-page flow', () => withApp(async page => {
    await manual(page, '{"hello":"流萤百宝箱"}')
    await detect(page)
    await page.locator('.result-action').waitFor()
    assert.match(await page.locator('#detect-input').inputValue(), /hello/)
    await page.getByRole('button', { name: '清空', exact: true }).click()
    assert.equal(await page.locator('.result-action').count(), 0)
    await page.locator('#detect-input').fill('{"keyboard":1}')
    await page.locator('#detect-input').press('Control+Enter')
    await page.locator('.result-action').waitFor()
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('.detection-page').count(), 0)
  }))

  await test('returning through a recommended tool restores the original editor input and result', () => withApp(async page => {
    await page.locator('.nav-button').filter({ hasText: '工具管理' }).evaluate(button => button.click())
    await page.locator('.all-tool-item').filter({ hasText: 'URL 编解码' }).click()
    await page.locator('#tool-input').fill('original editor input')
    await page.locator('.editor-actions .primary-button').click()
    await page.waitForFunction(() => document.getElementById('tool-output')?.value === 'cached result')
    await manual(page, '{"new":1}'); await detect(page); await page.locator('.result-action').click()
    await page.getByRole('button', { name: '返回智能识别', exact: true }).click()
    await page.locator('.top-title .top-icon-button').click()
    await page.locator('#tool-input').waitFor()
    assert.equal(await page.locator('.editor-open .tool-title').textContent(), 'URL 编解码')
    assert.equal(await page.locator('#tool-input').inputValue(), 'original editor input')
    assert.equal(await page.locator('#tool-output').inputValue(), 'cached result')
  }))

  await test('result count includes every selectable operation within and across content types', () => withApp(async page => {
    await manual(page, 'ordinary words')
    await page.evaluate(() => {
      window.result = () => [{ type_id: 'text', label: '普通文本', confidence: .2, actions: [{ tool_id: 'url.convert', id: 'encode', label: 'URL 编码' }, { tool_id: 'url.convert', id: 'decode', label: 'URL 解码' }] }]
    })
    await detect(page); await page.locator('.result-action').first().waitFor()
    assert.equal(await page.locator('.detection-result-card').count(), 1)
    assert.equal(await page.locator('.detection-count').textContent(), '2 项操作')
    await page.evaluate(() => {
      const previous = window.result
      window.result = () => [...previous(), { type_id: 'json', label: 'JSON', confidence: 1, actions: [{ tool_id: 'json.format', id: 'format', label: '格式化 JSON' }] }]
    })
    await detect(page)
    await page.waitForFunction(() => document.querySelectorAll('.result-action').length === 3)
    assert.equal(await page.locator('.detection-result-card').count(), 2)
    assert.equal(await page.locator('.detection-count').textContent(), '3 项操作')
  }))

  await test('recognition fits narrow viewports at larger text sizes', () => withApp(async page => {
    await manual(page, '{"mobile":1}'); await detect(page); await page.locator('.result-action').waitFor()
    await page.evaluate(() => document.documentElement.style.setProperty('--app-font-scale', '1.25'))
    for (const width of [320, 390, 640, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      assert.equal(await page.locator('dialog[open]').count(), 0)
      await page.waitForTimeout(250)
      await page.screenshot({ path: path.join(screenshots, `${width}.png`) })
    }
  }, 390))
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
