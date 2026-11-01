export const IMAGE_LIMIT = 64 * 1024 * 1024
export const BASE64_TEXT_LIMIT = 96 * 1024 * 1024

export function bmi(height, weight, unit = 'kg') {
  const cm = Number(height), input = Number(weight)
  if (!String(height).trim() || !String(weight).trim() || !Number.isFinite(cm) || !Number.isFinite(input) || cm < 50 || cm > 250 || input <= 0 || input > (unit === 'jin' ? 1000 : 500)) throw new Error('请输入有效身高（50～250 cm）和体重（大于 0，最多 500 kg）。')
  if (!['kg', 'jin'].includes(unit)) throw new Error('体重单位无效。')
  const kg = unit === 'jin' ? input / 2 : input, square = (cm / 100) ** 2, value = kg / square
  const category = value < 18.5 ? '体重偏低' : value < 24 ? '正常范围' : value < 28 ? '超重' : '肥胖'
  return {value, category, kg, lower: 18.5 * square, upper: 24 * square}
}

export function phoneNumber(value) {
  const number = value.trim().replace(/[\s()-]/g, '').replace(/^(?:\+86|0086)/, '')
  if (!/^1[3-9]\d{9}$/.test(number)) throw new Error('请输入 11 位中国大陆手机号，可带 +86 或 0086 前缀。')
  return number
}

export function phoneResult(data) {
  if (data?.code !== 0 || !data.data || typeof data.data !== 'object') throw new Error('查询服务暂不可用，请稍后重试。')
  const value = key => typeof data.data[key] === 'string' ? data.data[key].trim() : ''
  const province = value('province'), city = value('city'), carrier = value('sp')
  if (!province && !city && !carrier) throw new Error('未找到该号码段的归属信息，可能是新号段或服务数据尚未更新。')
  return {province, city, carrier}
}

export function imageType(buffer) {
  const b = new Uint8Array(buffer), word = (start, end) => String.fromCharCode(...b.slice(start, end))
  if (b.length >= 24 && [137,80,78,71,13,10,26,10].every((n,i)=>b[i]===n) && word(12,16)==='IHDR') return {mime:'image/png',ext:'png'}
  if (b.length >= 4 && b[0]===255 && b[1]===216 && b[2]===255) return {mime:'image/jpeg',ext:'jpg'}
  if (b.length >= 10 && ['GIF87a','GIF89a'].includes(word(0,6))) return {mime:'image/gif',ext:'gif'}
  if (b.length >= 30 && word(0,4)==='RIFF' && word(8,12)==='WEBP') return {mime:'image/webp',ext:'webp'}
  if (b.length >= 26 && word(0,2)==='BM') return {mime:'image/bmp',ext:'bmp'}
  throw new Error('仅支持 PNG、JPEG、GIF、WebP、BMP 图片，请检查文件内容。')
}

export function decodeImageBase64(value) {
  if (value.length > BASE64_TEXT_LIMIT) throw new Error('Base64 文本超过 96 MiB 上限。')
  let content = value.trim(), declared = ''
  if (/^data:/i.test(content)) {
    const header = /^data:(image\/(?:png|jpeg|jpg|gif|webp|bmp));base64,/i.exec(content)
    if (!header) throw new Error('Data URL 格式无效，仅支持常见图片的 data:image/...;base64, 格式。')
    declared = header[1].toLowerCase().replace('image/jpg','image/jpeg'); content = content.slice(header[0].length)
  }
  content = content.replace(/[\t\n\r ]/g,'')
  if (!content || !/^[A-Za-z0-9+/]*={0,2}$/.test(content) || content.length % 4 === 1 || content.includes('=') && content.length % 4 !== 0) throw new Error('Base64 内容无效，请检查字符和末尾的 =。')
  if (!content.includes('=')) content = content.padEnd(Math.ceil(content.length/4)*4,'=')
  const length = content.length / 4 * 3 - (content.endsWith('==') ? 2 : content.endsWith('=') ? 1 : 0)
  if (length > IMAGE_LIMIT) throw new Error('还原的图片超过 64 MiB 上限。')
  const bytes = new Uint8Array(length); let offset = 0
  try { for (let start=0;start<content.length;start+=65536) {const raw=atob(content.slice(start,start+65536));for(let i=0;i<raw.length;i++)bytes[offset++]=raw.charCodeAt(i)} } catch { throw new Error('Base64 内容无法解码。') }
  const buffer = bytes.buffer, type = imageType(buffer)
  if (declared && declared !== type.mime) throw new Error('Data URL 声明的图片格式与实际内容不一致。')
  return {buffer, ...type}
}

export function encodeImageBase64(buffer) {
  if (!buffer.byteLength || buffer.byteLength > IMAGE_LIMIT) throw new Error('图片大小需大于 0，且不超过 64 MiB。')
  const type=imageType(buffer)
  const b = new Uint8Array(buffer), chunks = []
  for (let start=0; start<b.length; start+=49152) chunks.push(btoa(String.fromCharCode(...b.subarray(start,start+49152))))
  return {base64:chunks.join(''), ...type}
}
