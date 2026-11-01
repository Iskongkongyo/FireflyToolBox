const ascii = (bytes, offset, length) => new TextDecoder().decode(bytes.subarray(offset, offset + length))

export async function wavInfo(file) {
  const header = await file.read(0, 12)
  if (header.length !== 12 || ascii(header, 0, 4) !== 'RIFF' || ascii(header, 8, 4) !== 'WAVE') throw new Error('请选择 RIFF PCM WAV 文件。')
  let offset = 12, format
  for (let index = 0; index < 256; index++) {
    const chunk = await file.read(offset, 8)
    if (chunk.length !== 8) break
    const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength)
    const size = view.getUint32(4, true), kind = ascii(chunk, 0, 4)
    if (kind === 'fmt ') {
      if (size < 16) throw new Error('WAV 格式区不完整。')
      const data = await file.read(offset + 8, 16)
      if (data.length !== 16) throw new Error('WAV 格式区不完整。')
      const fmt = new DataView(data.buffer, data.byteOffset, data.byteLength)
      format = { encoding: fmt.getUint16(0, true), channels: fmt.getUint16(2, true), rate: fmt.getUint32(4, true),
        byteRate: fmt.getUint32(8, true), blockAlign: fmt.getUint16(12, true), bits: fmt.getUint16(14, true) }
      if (format.encoding !== 1 || format.channels < 1 || format.channels > 8 || ![8,16,24,32].includes(format.bits)
        || format.rate < 1 || format.rate > 384000 || format.blockAlign !== format.channels * format.bits / 8
        || format.byteRate !== format.rate * format.blockAlign) throw new Error('此示例支持标准 PCM WAV；压缩或扩展 WAV 需专用解码器。')
    } else if (kind === 'data') {
      if (!format || !size || size % format.blockAlign || (file.size && offset + 8 + size > file.size)) throw new Error('WAV 音频数据不完整。')
      return { ...format, offset: offset + 8, size, seconds: size / format.byteRate }
    }
    offset += 8 + size + (size % 2)
    if (offset > 2147483648 || (file.size && offset >= file.size)) break
  }
  throw new Error('未找到有效 WAV 音频数据。')
}

export function wavClipHeader(info, startSeconds, endSeconds) {
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || startSeconds < 0 || endSeconds <= startSeconds || endSeconds > info.seconds) throw new Error('截取区间须在音频时长内，且结束时间大于开始时间。')
  const start = Math.floor(startSeconds * info.rate) * info.blockAlign
  const end = Math.min(info.size, Math.floor(endSeconds * info.rate) * info.blockAlign)
  const size = end - start
  if (size <= 0) throw new Error('截取区间不足一个采样帧。')
  const header = new Uint8Array(44), view = new DataView(header.buffer)
  const padding = size % 2
  header.set(new TextEncoder().encode('RIFF'),0); view.setUint32(4,36+size+padding,true)
  header.set(new TextEncoder().encode('WAVEfmt '),8); view.setUint32(16,16,true)
  view.setUint16(20,1,true);view.setUint16(22,info.channels,true);view.setUint32(24,info.rate,true)
  view.setUint32(28,info.byteRate,true);view.setUint16(32,info.blockAlign,true);view.setUint16(34,info.bits,true)
  header.set(new TextEncoder().encode('data'),36);view.setUint32(40,size,true)
  return { header, offset: info.offset+start, size, padding }
}
