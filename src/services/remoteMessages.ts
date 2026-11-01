import DOMPurify from 'dompurify'

export interface RemoteMessage { id: string; enabled: boolean; show_once: boolean; title: string; content: string }
export interface RemoteUpdate extends RemoteMessage { version: string; force: boolean; download_url: string }
export interface RemoteMessageFeed { configured: boolean; update: RemoteUpdate | null; notification: RemoteMessage | null }
export type MessageCard = { kind: 'update'; data: RemoteUpdate } | { kind: 'notification'; data: RemoteMessage }

// Deliberately local to this device: syncing read state could hide a notice on a
// second device before its user has seen it. Also excluded from configuration backups.
export const MESSAGE_HISTORY_KEY = 'firefly.remote-messages.read.v1'
const memoryRead = new Set<string>()
export const messageKey = (card: MessageCard) => `${card.kind}:${card.data.id}`

function readHistory(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(MESSAGE_HISTORY_KEY) || '[]')
    return Array.isArray(value) ? value.filter((key): key is string => typeof key === 'string' && key.length <= 180).slice(-200) : []
  } catch { return [] }
}
export function wasMessageRead(card: MessageCard): boolean {
  const key = messageKey(card)
  return memoryRead.has(key) || readHistory().includes(key)
}
export function markMessageRead(card: MessageCard) {
  const key = messageKey(card)
  memoryRead.add(key)
  const history = [...new Set([...readHistory(), key])].slice(-200)
  try { localStorage.setItem(MESSAGE_HISTORY_KEY, JSON.stringify(history)) } catch { /* Session memory still prevents repeats. */ }
}

export function safeMessageUrl(value: string): string | null {
  try {
    // Require an absolute address; never resolve remote HTML against the app origin.
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname !== 'localhost' && !url.hostname.endsWith('.localhost')
      && !url.username && !url.password && value.length <= 4096 ? url.href : null
  } catch { return null }
}

export function sanitizeMessageHtml(content: string): string {
  const fragment = DOMPurify.sanitize(content, {
    ALLOWED_TAGS: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'p', 'img', 'a', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'hr', 'span', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'sup', 'sub'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'colspan', 'rowspan'],
    ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false, RETURN_DOM_FRAGMENT: true,
  })
  for (const image of fragment.querySelectorAll('img')) {
    const source = safeMessageUrl(image.getAttribute('src') || '')
    if (!source) { image.remove(); continue }
    image.setAttribute('src', source)
    image.setAttribute('loading', 'lazy')
    image.setAttribute('referrerpolicy', 'no-referrer')
    image.setAttribute('decoding', 'async')
  }
  for (const link of fragment.querySelectorAll('a')) {
    const href = safeMessageUrl(link.getAttribute('href') || '')
    if (href) link.setAttribute('href', href)
    else link.removeAttribute('href')
    link.setAttribute('rel', 'noopener noreferrer')
    link.setAttribute('target', '_blank')
  }
  for (const cell of fragment.querySelectorAll('[colspan], [rowspan]')) {
    for (const name of ['colspan', 'rowspan']) {
      const value = cell.getAttribute(name)
      if (value !== null && (!/^\d{1,2}$/.test(value) || Number(value) < 1 || Number(value) > 20)) cell.removeAttribute(name)
    }
  }
  const container = document.createElement('div')
  container.append(fragment)
  return container.innerHTML
}
