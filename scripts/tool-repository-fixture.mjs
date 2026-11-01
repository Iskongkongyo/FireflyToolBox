import { createHash } from 'node:crypto'
import { zipSync, strToU8 } from 'fflate'
import { fullscreenFixture } from './web-tool-fullscreen-fixture.mjs'

export const repositoryCommit = '0123456789abcdef0123456789abcdef01234567'
export function repositoryFixture(token = 'review') {
  return ['normal', 'network', 'future', 'corrupt'].map((kind, index) => {
    const detail = fullscreenFixture(`test.repo_${kind}_${token}`, false)
    const title = `${['本地小工具', '联网小工具', '新版工具', '校验测试'][index]} ${token}`
    detail.manifest.name['zh-CN'] = title; detail.manifest.tools[0].name['zh-CN'] = title
    if (kind === 'network') { detail.manifest.permissions = ['network']; detail.manifest.network.hosts = ['https://example.com'] }
    if (kind === 'future') detail.manifest.min_app_version = '99.0.0'
    const files = Object.fromEntries(Object.entries(detail.scripts).map(([name, text]) => [name, strToU8(text)]))
    files['manifest.json'] = strToU8(JSON.stringify(detail.manifest))
    const bytes = Buffer.from(zipSync(files)), sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
    const file_name = `${detail.manifest.module_id}-1.0.0.fftool`, path = `${index % 2 ? '生活与查询' : '效率工具'}/${file_name}`
    const entry = { id: `${sha}:${path}`, path, file_name, category: index % 2 ? '生活与查询' : '效率工具', size: bytes.length, sha, title: file_name, description: '', updated_at: '', metadata_loaded: false, module_id_hint: detail.manifest.module_id, version_hint: '1.0.0' }
    const summary = { module_id: detail.manifest.module_id, version: '1.0.0', name: title, author: 'Firefly test', tools: [title], tool_ids: [detail.manifest.tools[0].id], categories: ['效率工具'], network_hosts: detail.manifest.network.hosts, builtin: false, modified: false }
    const prepared = { token: `token-${kind}`, entry_id: entry.id, file_name, bytes: bytes.length, source: 'GH-Proxy', commit: repositoryCommit, cached: false, summary: kind === 'future' ? null : summary, license: 'MIT', description: '可输入内容并切换显示颜色的测试工具。', platforms: ['windows', 'android'], compatible: kind !== 'future', inspection_error: kind === 'future' ? '此工具需要更新版本的客户端。' : null, installed_version: null }
    return { kind, title, detail, bytes, entry, summary, prepared }
  })
}
export function fixtureCatalog(items = repositoryFixture(), cached = false) {
  return { repository_url: 'https://github.com/Iskongkongyo/FFTools', commit: repositoryCommit, fetched_at: Math.floor(Date.now() / 1000), source: 'GH-Proxy', entries: items.map(item => structuredClone(item.entry)), skipped_entries: [], from_cache: cached }
}
