import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { access, mkdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { connectWindows } from './windows-test-client.mjs'

const client = await connectWindows(), token = crypto.randomUUID().slice(0, 8)
const names = [`FireflyShortcutTest-${token}-A`, `FireflyShortcutTest-${token}-B`]
const desktop = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding; [Environment]::GetFolderPath('Desktop')"], { encoding: 'utf8', windowsHide: true }).trim()
const files = names.map(name => path.resolve(desktop, `${name}.lnk`)), created = []
const report = { checks: [], cleaned: false }
await mkdir('target-check/shortcut-reliability/windows', { recursive: true })
try {
  const tools = await client.invoke('list_tools'), tool = tools.find(t => t.id === 'json.format') || tools[0]
  assert(tool)
  assert.equal(await client.invoke('create_tool_shortcut', { toolId: tool.id, name: names[0], iconData: null }), 'created'); created.push(files[0]); await access(files[0])
  report.checks.push('real desktop link creation succeeds')
  await assert.rejects(client.invoke('create_tool_shortcut', { toolId: tool.id, name: names[0], iconData: null }), /同名快捷方式/)
  report.checks.push('same-name duplicate is rejected without replacing the desktop link')
  assert.equal(await client.invoke('create_tool_shortcut', { toolId: tool.id, name: names[1], iconData: null }), 'created'); created.push(files[1]); await access(files[1])
  report.checks.push('a differently named link to the same tool remains supported')
} finally {
  try {
    for (const file of created) {
      assert.equal(path.dirname(file), path.resolve(desktop)); assert(names.some(name => path.basename(file) === `${name}.lnk`))
      await unlink(file)
    }
    report.cleaned = true
    await writeFile('target-check/shortcut-reliability/windows/results.json', JSON.stringify(report, null, 2))
  } finally { client.close() }
}
console.log(JSON.stringify(report))
