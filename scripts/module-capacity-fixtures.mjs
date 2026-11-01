import { mkdir, readFile, writeFile, open } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

export const MiB = 1024 * 1024
export async function capacityFixture(directory, { htmlBytes = 128, entries = 1, resources = [], moduleId = 'dev.example.capacity_review' } = {}) {
  await mkdir(directory, { recursive: true })
  const guide = (await readFile('skills/firefly-module-author/SKILL.md', 'utf8')).replace(/\r\n?/g, '\n')
  const web = guide.split('## 网页工具模板')[1]
  const manifest = JSON.parse(web.match(/```json\n([\s\S]*?)\n```/)[1])
  manifest.module_id = moduleId
  const original = manifest.tools[0]
  manifest.tools = []
  for (let index = 0; index < entries; index++) {
    const tool = structuredClone(original)
    tool.id = `${moduleId}.tool_${index}`
    tool.entry = `page-${index}.html`
    tool.ui.script = `main-${index}.js`
    tool.ui.style = `style-${index}.css`
    manifest.tools.push(tool)
    await writeFile(path.join(directory, tool.entry), '<main>Capacity</main>'.padEnd(htmlBytes, ' '))
    await writeFile(path.join(directory, tool.ui.style), 'main{padding:12px}')
    await writeFile(path.join(directory, tool.ui.script), 'export function mount(){document.querySelector("main").textContent="Capacity ready"}')
  }
  manifest.resources = []
  if (resources.length) await mkdir(path.join(directory, 'assets'), { recursive: true })
  for (const [index, size] of resources.entries()) {
    const relative = `assets/model-${index}.bin`, file = await open(path.join(directory, relative), 'w')
    const hash = createHash('sha256'), chunk = Buffer.alloc(Math.min(MiB, size), index + 42)
    try {
      for (let offset = 0; offset < size; offset += chunk.length) {
        const bytes = chunk.subarray(0, Math.min(chunk.length, size - offset))
        await file.writeFile(bytes); hash.update(bytes)
      }
    } finally { await file.close() }
    manifest.resources.push({ path: relative, size, sha256: hash.digest('hex') })
  }
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest))
  return manifest
}
