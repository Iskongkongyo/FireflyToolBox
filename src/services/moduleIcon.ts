const MAX_SOURCE_BYTES = 1024 * 1024
const MAX_ICON_BYTES = 24 * 1024
const SVG_NS = 'http://www.w3.org/2000/svg'
const SVG_ELEMENTS = new Set([
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath',
])
const SVG_ATTRIBUTES = new Set([
  'viewBox', 'width', 'height', 'fill', 'stroke', 'stroke-width', 'stroke-linecap',
  'stroke-linejoin', 'stroke-miterlimit', 'opacity', 'fill-opacity', 'stroke-opacity',
  'fill-rule', 'clip-rule', 'transform', 'points', 'x', 'y', 'rx', 'ry', 'cx', 'cy',
  'r', 'x1', 'y1', 'x2', 'y2', 'd', 'id', 'offset', 'stop-color', 'stop-opacity',
  'gradientUnits', 'gradientTransform', 'clipPathUnits', 'clip-path', 'fx', 'fy', 'fr',
])

function sanitizedSvg(source: string): string {
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('SVG 不支持实体或文档类型声明。')
  const parsed = new DOMParser().parseFromString(source, 'image/svg+xml')
  const root = parsed.documentElement
  if (root.localName !== 'svg' || root.namespaceURI !== SVG_NS || parsed.querySelector('parsererror')) {
    throw new Error('SVG 文件格式无效。')
  }
  const clean = document.implementation.createDocument(SVG_NS, 'svg', null)
  function copy(node: Element, target: Element) {
    if (node.namespaceURI !== SVG_NS || !SVG_ELEMENTS.has(node.localName)) {
      throw new Error('SVG 包含不支持的元素；请使用基本矢量图形。')
    }
    for (const attribute of Array.from(node.attributes)) {
      if (attribute.name === 'xmlns' && attribute.value === SVG_NS) continue
      const localReference = /url\s*\(/i.test(attribute.value)
        && ['fill', 'stroke', 'clip-path'].includes(attribute.name)
        && /^url\(#[A-Za-z_][\w.-]*\)$/.test(attribute.value.trim())
      if (attribute.namespaceURI || !SVG_ATTRIBUTES.has(attribute.name)
        || (/url\s*\(/i.test(attribute.value) && !localReference)
        || /javascript\s*:|[\x00-\x1f]/i.test(attribute.value)) {
        throw new Error('SVG 包含不支持的属性或外部引用。')
      }
      target.setAttribute(attribute.name, attribute.value)
    }
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        if (['title', 'desc', 'metadata'].includes((child as Element).localName)) continue
        const element = clean.createElementNS(SVG_NS, (child as Element).localName)
        copy(child as Element, element)
        target.appendChild(element)
      } else if (child.nodeType !== Node.COMMENT_NODE && (child.nodeType !== Node.TEXT_NODE || child.textContent?.trim())) {
        throw new Error('SVG 只能包含基本矢量图形。')
      }
    }
  }
  copy(root, clean.documentElement)
  if (!clean.documentElement.hasAttribute('viewBox')
    && (!clean.documentElement.hasAttribute('width') || !clean.documentElement.hasAttribute('height'))) {
    throw new Error('SVG 需要 viewBox，或同时指定宽度和高度。')
  }
  return new XMLSerializer().serializeToString(clean)
}

function imageType(bytes: Uint8Array): string {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp'
  let source: string
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { throw new Error('请选择 SVG、PNG、JPEG 或 WebP 图标。') }
  if (/^\s*(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/i.test(source)) return 'image/svg+xml'
  throw new Error('请选择 SVG、PNG、JPEG 或 WebP 图标。')
}

async function normalizeIcon(bytes: Uint8Array, sizes: number[]): Promise<string> {
  if (!bytes.length || bytes.length > MAX_SOURCE_BYTES) throw new Error('图标文件不能超过 1 MiB。')
  const type = imageType(bytes)
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const blob = type === 'image/svg+xml'
    ? new Blob([sanitizedSvg(new TextDecoder('utf-8', { fatal: true }).decode(copy))], { type })
    : new Blob([copy], { type })
  const url = URL.createObjectURL(blob)
  try {
    const picture = new Image()
    picture.src = url
    let timeout: ReturnType<typeof setTimeout> | undefined
    try { await Promise.race([picture.decode(), new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('timeout')), 10_000) })]) }
    catch { throw new Error('图标无法解码或读取超时，请检查文件内容。') }
    finally { clearTimeout(timeout) }
    if (!picture.naturalWidth || !picture.naturalHeight
      || picture.naturalWidth > 4096 || picture.naturalHeight > 4096) {
      throw new Error('图标尺寸须在 1 到 4096 像素之间。')
    }
    for (const size of sizes) {
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const context = canvas.getContext('2d')
      if (!context) throw new Error('当前设备无法处理图标。')
      const scale = Math.min(size / picture.naturalWidth, size / picture.naturalHeight)
      const width = picture.naturalWidth * scale
      const height = picture.naturalHeight * scale
      context.drawImage(picture, (size - width) / 2, (size - height) / 2, width, height)
      const data = canvas.toDataURL('image/png')
      if ((data.length - 'data:image/png;base64,'.length) * 3 / 4 <= MAX_ICON_BYTES) return data
    }
    throw new Error('图标转换后仍超过 24 KiB，请选择更简单的图片。')
  } finally {
    URL.revokeObjectURL(url)
  }
}

export const normalizeModuleIcon = (bytes: Uint8Array) => normalizeIcon(bytes, [96, 64, 48, 32])
export const normalizeShortcutIcon = (bytes: Uint8Array) => normalizeIcon(bytes, [256, 192, 128, 96, 64, 48, 32])
