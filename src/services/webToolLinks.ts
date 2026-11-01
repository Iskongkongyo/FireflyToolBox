export function checkedWebsite(url: unknown, title: unknown, hosts: string[]) {
  if (typeof url !== 'string' || url.length > 4096) throw new Error('网页地址无效。')
  let parsed: URL
  try { parsed = new URL(url) } catch { throw new Error('请输入完整 HTTPS 网页地址。') }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password
    || !hosts.includes(parsed.origin)) throw new Error('网页地址须位于工具声明的 HTTPS 来源内。')
  return { url: parsed.href, title: typeof title === 'string' ? title.trim().slice(0,80) || parsed.hostname : parsed.hostname }
}
