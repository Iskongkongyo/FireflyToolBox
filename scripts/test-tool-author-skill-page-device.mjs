import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { connectWindows } from './windows-test-client.mjs'
import { connectAndroid } from './android-device-client.mjs'

const windows = process.argv.includes('--windows'), client = await (windows ? connectWindows() : connectAndroid())
const directory = path.resolve('target-check/skill-page', windows ? 'windows' : client.device('get-serialno'))
await mkdir(directory, { recursive: true })
const report = { platform: windows ? 'windows' : 'android', checks: [], draftRestored: false }
const draftKey = 'firefly.tool-creator.draft.v1'
async function wait(fn, ...args) {
  for (let attempt = 0; attempt < 150; attempt++) { if (await client.evaluate(fn, ...args)) return; await new Promise(resolve => setTimeout(resolve, 100)) }
  throw new Error(`Timed out: ${fn}`)
}
async function check(name, run) { await run(); report.checks.push(name); console.log('PASS:', name) }
async function capture(name) {
  const shot = await client.call('Page.captureScreenshot', { format: 'png' })
  await writeFile(path.join(directory, name), Buffer.from(shot.data, 'base64'))
}
async function open() {
  await client.evaluate(() => document.getElementById('open-tool-author-skill').click())
  await wait(() => !!document.querySelector('.tool-author-skill-content h1'))
}
async function creator() { await wait(() => document.getElementById('studio-tab-create')?.getAttribute('aria-selected') === 'true' && !!document.getElementById('tool-source-editor')) }
try {
  await wait(() => { const app = document.querySelector('.app-shell'); return document.visibilityState === 'visible' && app && !app.inert && getComputedStyle(app).display !== 'none' })
  await client.call('Page.reload')
  await wait(() => { const app = document.querySelector('.app-shell'); return document.visibilityState === 'visible' && app && !app.inert && getComputedStyle(app).display !== 'none' })
  await client.evaluate(key => { window.skillPageTest = { savedDraft: localStorage.getItem(key) } }, draftKey)
  await client.evaluate(() => [...document.querySelectorAll('.nav-button')].find(button => button.textContent.trim() === '工具管理').click())
  await wait(() => !!document.querySelector('[aria-label="打开工具工作台"]'))
  await client.evaluate(() => document.querySelector('[aria-label="打开工具工作台"]').click())
  await wait(() => !!document.getElementById('studio-tab-create'))
  await client.evaluate(() => document.getElementById('studio-tab-create').click())
  await creator(); await wait(() => !document.querySelector('.module-studio-panel-stage.panel-stage-settling'))
  await wait(() => { const row = document.querySelector('.module-create-title-row')?.getBoundingClientRect(); return row && row.left >= 0 && row.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth })
  await check('creator title and both actions share one row with the actions at the right edge', async () => {
    const layout = await client.evaluate(() => {
      const row = document.querySelector('.module-create-title-row').getBoundingClientRect(), title = document.getElementById('studio-create-title').getBoundingClientRect()
      const buttons = [...document.querySelectorAll('.module-studio-heading-actions button')].map(button => ({ text: button.textContent, rect: button.getBoundingClientRect().toJSON() }))
      window.skillPageTest.form = JSON.stringify([...document.querySelectorAll('#studio-panel-create input, #studio-panel-create textarea, #studio-panel-create select')].map(node => [node.value, node.checked]))
      return { row: row.toJSON(), title: title.toJSON(), buttons, overflow: document.documentElement.scrollWidth > innerWidth }
    })
    assert.equal(layout.buttons[0].text, '查看SKILL'); assert.equal(layout.buttons[1].text, '新建工具')
    for (const button of layout.buttons) assert(Math.abs(button.rect.y + button.rect.height / 2 - layout.title.y - layout.title.height / 2) < 3)
    assert(Math.abs(layout.buttons[1].rect.right - layout.row.right) < 2)
    assert.equal(layout.overflow, false)
    await capture('creator.png')
  })
  await check('SKILL uses an independent page with normal document scrolling and visible return/copy controls', async () => {
    await open()
    assert.deepEqual(await client.evaluate(() => ({ creator: !!document.getElementById('studio-panel-create'), modal: !!document.querySelector('dialog[open]') })), { creator: false, modal: false })
    await client.evaluate(() => window.scrollTo(0, 1500))
    const state = await client.evaluate(() => {
      const back = document.querySelector('.top-title .top-icon-button').getBoundingClientRect(), copy = document.querySelector('.top-actions .top-text-button').getBoundingClientRect(), bar = document.querySelector('.topbar').getBoundingClientRect()
      return { pageScroll: window.scrollY, innerScroll: document.querySelector('.tool-author-skill-content').scrollTop, overflow: document.documentElement.scrollWidth > innerWidth, backVisible: back.top >= 0 && back.bottom < innerHeight, copyVisible: copy.top >= bar.top && copy.bottom <= bar.bottom && copy.right > bar.right - 65, introScrolledAway: document.querySelector('.tool-author-skill-intro').getBoundingClientRect().bottom < 0 }
    })
    assert(state.pageScroll > 100); assert.equal(state.innerScroll, 0); assert.equal(state.overflow, false)
    assert(state.backVisible); assert(state.copyVisible); assert(state.introScrolledAway)
    await capture('guide.png')
  })
  await check('the page return button restores the creator tab and every existing draft field', async () => {
    await client.evaluate(() => document.querySelector('.top-title .top-icon-button').click())
    await creator()
    assert.equal(await client.evaluate(() => window.skillPageTest.form === JSON.stringify([...document.querySelectorAll('#studio-panel-create input, #studio-panel-create textarea, #studio-panel-create select')].map(node => [node.value, node.checked]))), true)
  })
  await check(windows ? 'the native-back dispatcher returns to the same draft after reopening' : 'Android system Back returns to the same draft after reopening', async () => {
    await open()
    if (windows) await client.evaluate(() => window.dispatchEvent(new Event('firefly:native-back')))
    else client.device('shell', 'input', 'keyevent', '4')
    await creator()
    assert.equal(await client.evaluate(() => window.skillPageTest.form === JSON.stringify([...document.querySelectorAll('#studio-panel-create input, #studio-panel-create textarea, #studio-panel-create select')].map(node => [node.value, node.checked]))), true)
  })
} catch (error) {
  await writeFile(path.join(directory, 'error.txt'), String(error.stack || error))
  try {
    const layout = await client.evaluate(() => ({ width: innerWidth, doc: document.documentElement.scrollWidth, body: document.body.getBoundingClientRect().toJSON(), x: scrollX, selected: document.querySelector('[data-studio-tab][aria-selected=true]')?.id, row: document.querySelector('.module-create-title-row')?.getBoundingClientRect().toJSON(), stage: document.querySelector('.module-studio-panel-stage')?.style.transform, computed: document.querySelector('.module-studio-panel-stage') && getComputedStyle(document.querySelector('.module-studio-panel-stage')).transform, wide: [...document.querySelectorAll('body *')].filter(node => node.getBoundingClientRect().right > innerWidth + 1 && !node.closest('[inert]')).slice(0, 10).map(node => ({ tag: node.tagName, id: node.id, cls: String(node.className), rect: node.getBoundingClientRect().toJSON() })) }))
    await writeFile(path.join(directory, 'layout-error.json'), JSON.stringify(layout, null, 2))
    await capture('error.png')
  } catch { /* Keep the original test failure. */ }
  throw error
}
finally {
  try {
    await client.evaluate(key => {
      if (window.skillPageTest) {
        if (window.skillPageTest.savedDraft === null) localStorage.removeItem(key)
        else localStorage.setItem(key, window.skillPageTest.savedDraft)
        delete window.skillPageTest
      }
    }, draftKey)
    await client.call('Page.reload')
    report.draftRestored = true
    await writeFile(path.join(directory, 'results.json'), JSON.stringify(report, null, 2))
  } finally { client.close() }
}
