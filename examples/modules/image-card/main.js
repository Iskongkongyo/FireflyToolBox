export function mount({ saveFile }) {
  const input = document.querySelector('#card-title')
  const canvas = document.querySelector('#preview')
  const button = document.querySelector('#save-png')
  const status = document.querySelector('#status')
  const context = canvas.getContext('2d')
  if (!input || !canvas || !button || !status || !context) throw new Error('图片卡片页面不完整。')

  function redraw() {
    const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height)
    gradient.addColorStop(0, '#d5ead6')
    gradient.addColorStop(1, '#f6e9be')
    context.fillStyle = gradient
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = '#254d3d'
    context.font = 'bold 66px system-ui, sans-serif'
    context.textAlign = 'center'
    context.fillText(input.value.trim() || '我的图片卡片', canvas.width / 2, canvas.height / 2, 1040)
    context.font = '28px system-ui, sans-serif'
    context.fillText('由流萤百宝箱网页工具生成', canvas.width / 2, canvas.height / 2 + 70)
  }

  input.addEventListener('input', redraw)
  button.addEventListener('click', async () => {
    button.disabled = true
    status.textContent = '正在生成图片…'
    try {
      const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('无法生成 PNG。')), 'image/png'))
      status.textContent = await saveFile('firefly-card.png', blob) ? '图片已保存。' : '已取消保存。'
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : '保存失败。'
    } finally {
      button.disabled = false
    }
  })
  redraw()
}
