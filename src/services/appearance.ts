export type AppearanceImageTarget = 'wallpaper' | 'startup' | 'sidebar'
export const APPEARANCE_IMAGE_MAX_BYTES = 32 * 1024 * 1024
export const APPEARANCE_IMAGE_MAX_PIXELS = 24_000_000

export function validateAppearanceFile(file: Pick<File, 'type' | 'size' | 'name'>) {
  if (!file.type.startsWith('image/') && !((!file.type || file.type === 'application/octet-stream') && /\.(png|jpe?g|webp|avif|gif|bmp|svg|ico|heic|heif|tiff?)$/i.test(file.name))) throw new Error('请选择图片文件')
  if (file.size > APPEARANCE_IMAGE_MAX_BYTES) throw new Error('图片最多支持 32 MiB，请缩小后重试')
}

export function validateAppearanceDimensions(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('图片尺寸无效')
  if (width * height > APPEARANCE_IMAGE_MAX_PIXELS) throw new Error('图片最多支持 2400 万像素，请缩小后重试')
}

export function appearanceImageFormat(file: Pick<File, 'type' | 'name'>, target: AppearanceImageTarget): 'image/png' | 'image/jpeg' {
  // JPEG has no alpha; keep PNG output for every potentially transparent input.
  return target !== 'sidebar' && (file.type === 'image/jpeg' || (!file.type && /\.jpe?g$/i.test(file.name))) ? 'image/jpeg' : 'image/png'
}

export function mixColor(hex: string, base: string, amount: number): string {
  const component = (value: string, index: number) => parseInt(value.slice(index, index + 2), 16)
  return `#${[1, 3, 5].map(index => Math.round(component(hex, index) * amount + component(base, index) * (1 - amount)).toString(16).padStart(2, '0')).join('')}`
}

function luminance(hex: string) {
  return [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0)
}

export function colorContrast(a: string, b: string) {
  const left = luminance(a), right = luminance(b)
  return (Math.max(left, right) + .05) / (Math.min(left, right) + .05)
}

export function accentPalette(hex: string, mode: 'light' | 'dark') {
  const surface = mode === 'dark' ? '#1c2826' : '#ffffff'
  const background = mode === 'dark' ? '#131c1b' : '#f7f8f5'
  const soft = mixColor(hex, surface, mode === 'dark' ? .22 : .13)
  const readable = (color: string) => [surface, background, soft].every(base => colorContrast(color, base) >= 4.5)
  let accent = hex
  if (!readable(accent)) {
    const target = mode === 'dark' ? '#ffffff' : '#000000'
    for (let step = 1; step <= 100; step++) {
      accent = mixColor(hex, target, 1 - step / 100)
      if (readable(accent)) break
    }
  }
  const text = colorContrast(hex, '#ffffff') >= colorContrast(hex, '#000000') ? '#ffffff' : '#000000'
  let hover = hex
  for (const amount of [.82, .9, .96, 1]) {
    hover = mixColor(hex, mode === 'dark' ? '#ffffff' : '#000000', amount)
    if (colorContrast(hover, text) >= 4.5) break
  }
  return { accent, soft, primary: hex, hover, text }
}

export function hexToHsv(hex: string) {
  const [red, green, blue] = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
  const max = Math.max(red, green, blue), min = Math.min(red, green, blue), delta = max - min
  let hue = 0
  if (delta) {
    if (max === red) hue = ((green - blue) / delta) % 6
    else if (max === green) hue = (blue - red) / delta + 2
    else hue = (red - green) / delta + 4
    hue = (hue * 60 + 360) % 360
  }
  return { hue, saturation: max ? delta / max : 0, value: max }
}

export function hsvToHex(hue: number, saturation: number, value: number): string {
  const chroma = value * saturation
  const secondary = chroma * (1 - Math.abs((hue / 60) % 2 - 1))
  const match = hue < 60 ? [chroma, secondary, 0] : hue < 120 ? [secondary, chroma, 0]
    : hue < 180 ? [0, chroma, secondary] : hue < 240 ? [0, secondary, chroma]
      : hue < 300 ? [secondary, 0, chroma] : [chroma, 0, secondary]
  return `#${match.map(channel => Math.round((channel + value - chroma) * 255).toString(16).padStart(2, '0')).join('')}`
}
