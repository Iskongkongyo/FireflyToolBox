export function mount({ openFile, saveFile }) {
  const choose = document.querySelector('#choose')
  const save = document.querySelector('#save')
  const brightness = document.querySelector('#brightness')
  const brightnessValue = document.querySelector('#brightness-value')
  const grayscale = document.querySelector('#grayscale')
  const canvas = document.querySelector('#preview')
  const status = document.querySelector('#status')
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!choose || !save || !brightness || !brightnessValue || !grayscale || !context || !status) {
    throw new Error('图片处理页面不完整。')
  }

  let originalPixels = null
  let renderPending = false

  function render() {
    if (!originalPixels) return
    const pixels = new ImageData(new Uint8ClampedArray(originalPixels.data), canvas.width, canvas.height)
    const amount = Number(brightness.value) / 100
    for (let index = 0; index < pixels.data.length; index += 4) {
      let red = Math.min(255, pixels.data[index] * amount)
      let green = Math.min(255, pixels.data[index + 1] * amount)
      let blue = Math.min(255, pixels.data[index + 2] * amount)
      if (grayscale.checked) red = green = blue = Math.round(.299 * red + .587 * green + .114 * blue)
      pixels.data[index] = red
      pixels.data[index + 1] = green
      pixels.data[index + 2] = blue
    }
    context.putImageData(pixels, 0, 0)
    brightnessValue.textContent = `${brightness.value}%`
  }

  function scheduleRender() {
    if (renderPending) return
    renderPending = true
    requestAnimationFrame(() => { renderPending = false; render() })
  }

  function decodeImage(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob)
      const image = new Image()
      image.onload = () => { URL.revokeObjectURL(url); resolve(image) }
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('无法读取这张图片。')) }
      image.src = url
    })
  }

  choose.addEventListener('click', async () => {
    choose.disabled = true
    status.textContent = '正在选择图片…'
    try {
      const file = await openFile({ extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] })
      if (!file) { status.textContent = '已取消选择。'; return }
      if (!file.blob.type.startsWith('image/')) throw new Error('请选择 PNG、JPEG、WebP 或 GIF 图片。')
      const image = await decodeImage(file.blob)
      if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 16_000_000) {
        throw new Error('图片像素过大，最多支持 1600 万像素。')
      }
      const scale = Math.min(1, 1024 / Math.max(image.naturalWidth, image.naturalHeight))
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      originalPixels = context.getImageData(0, 0, canvas.width, canvas.height)
      brightness.disabled = false
      grayscale.disabled = false
      save.disabled = false
      render()
      status.textContent = `已载入 ${file.name}，预览尺寸 ${canvas.width} × ${canvas.height}。`
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : '读取图片失败。'
    } finally {
      choose.disabled = false
    }
  })

  brightness.addEventListener('input', scheduleRender)
  grayscale.addEventListener('change', scheduleRender)
  save.addEventListener('click', async () => {
    if (!originalPixels) return
    save.disabled = true
    status.textContent = '正在生成 PNG…'
    try {
      const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value
        ? resolve(value) : reject(new Error('无法生成 PNG。')), 'image/png'))
      status.textContent = await saveFile('adjusted-image.png', blob) ? '图片已保存。' : '已取消保存。'
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : '保存图片失败。'
    } finally {
      save.disabled = false
    }
  })
}
