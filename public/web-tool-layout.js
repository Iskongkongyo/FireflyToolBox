function fireflyViewportValue(value, rootHeight = false) {
  // Preserve quoted text and image URLs. Stable host-based vertical viewport
  // units prevent 100vh + padding from growing the iframe on every resize.
  return value.replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|url\([^)]*\))|(-?(?:\d*\.)?\d+)([dsl]?vh|%)(?![\w-])/gi,
    (match, literal, number, unit, offset) => {
      if (literal || (unit === '%' && !rootHeight) || (offset && /[\w-]/.test(value[offset - 1]))) return match
      return `calc(var(--firefly-viewport-height) * ${Number(number) / 100})`
    })
}

// Layout bridge for the opaque-origin page. Content stays in its own document;
// the host page owns the vertical scroll and the available viewport dimensions.
window.FireflyWebToolLayout = (id, send, viewportHeight, font, textColor) => {
  const root = document.documentElement
  const body = document.body
  const requestFrame = window.requestAnimationFrame.bind(window)
  const cancelFrame = window.cancelAnimationFrame.bind(window)
  const delay = window.setTimeout.bind(window)
  const cancelDelay = window.clearTimeout.bind(window)
  let stopped = false
  let pendingFrame = 0
  let fallbackTimer
  let lastHeight = 0
  let lastLeft = -1
  let lastWidth = -1
  let stylesDirty = true
  let focusTarget = null
  const inlineRoots = new Set([body])

  const defaults = document.createElement('style')
  defaults.textContent = 'html{background:transparent}body{margin:0;display:flow-root;font:var(--firefly-tool-font,14px/1.6 system-ui,sans-serif);color:var(--firefly-tool-text,inherit)}'
  document.head.prepend(defaults)
  if (typeof font === 'string' && font.length < 512) root.style.setProperty('--firefly-tool-font', font)
  if (typeof textColor === 'string' && textColor.length < 128) root.style.setProperty('--firefly-tool-text', textColor)

  function updateDeclaration(style, isRoot) {
    for (const property of Array.from(style)) {
      const value = style.getPropertyValue(property)
      const next = fireflyViewportValue(value, isRoot && /^(min-|max-)?height$/.test(property))
      if (next !== value) style.setProperty(property, next, style.getPropertyPriority(property))
    }
  }
  function updateRules(rules) {
    for (const rule of rules) {
      if (rule.style) {
        let isRoot = false
        if (rule.selectorText) {
          try { isRoot = root.matches(rule.selectorText) || body.matches(rule.selectorText) } catch { /* Non-element selectors. */ }
        }
        updateDeclaration(rule.style, isRoot)
      }
      if (rule.cssRules) updateRules(rule.cssRules)
    }
  }
  function updateStyles() {
    if (stylesDirty) {
      stylesDirty = false
      for (const sheet of Array.from(document.styleSheets)) {
        try { updateRules(sheet.cssRules) } catch { /* An inaccessible sheet cannot participate. */ }
      }
    }
    for (const node of inlineRoots) {
      if (!node.isConnected) continue
      if (node.style) updateDeclaration(node.style, node === root || node === body)
      for (const child of node.querySelectorAll?.('[style]') ?? []) updateDeclaration(child.style, child === root || child === body)
    }
    inlineRoots.clear()
  }
  const pixels = value => Number.parseFloat(value) || 0
  function measure() {
    if (pendingFrame) cancelFrame(pendingFrame)
    pendingFrame = 0
    cancelDelay(fallbackTimer)
    fallbackTimer = undefined
    if (stopped) return
    updateStyles()
    const rect = body.getBoundingClientRect()
    const bodyStyle = getComputedStyle(body)
    let bottom = rect.bottom + window.scrollY + pixels(bodyStyle.marginBottom)
    let fixedContent = bodyStyle.position === 'fixed'
    let flowingContent = rect.height > pixels(bodyStyle.paddingTop) + pixels(bodyStyle.paddingBottom)
    // Unlike document.scrollHeight, intrinsic body/child bounds can shrink when
    // results are collapsed. Include overflow from absolute children as well.
    for (const child of body.children) {
      const style = getComputedStyle(child)
      if (style.display === 'none') continue
      if (style.position === 'fixed') { fixedContent = true; continue }
      const bounds = child.getBoundingClientRect()
      if (bounds.height) flowingContent = true
      const overflow = /^(visible|clip)$/.test(style.overflowY) ? Math.max(0, child.scrollHeight - child.clientHeight) : 0
      bottom = Math.max(bottom, bounds.bottom + window.scrollY + overflow + pixels(style.marginBottom) + pixels(bodyStyle.paddingBottom))
    }
    // A tool made entirely of a fixed viewport panel still needs a viewport.
    // Floating controls on an ordinary flow page do not impose a minimum.
    if (fixedContent && (!flowingContent || bodyStyle.position === 'fixed')) bottom = Math.max(bottom, pixels(root.style.getPropertyValue('--firefly-viewport-height')))
    const horizontalBar = Math.max(0, window.innerHeight - root.clientHeight)
    const height = Math.max(1, Math.min(100000, Math.ceil(bottom + horizontalBar)))
    const content = body.querySelector('main') ?? body
    const contentRect = content.getBoundingClientRect()
    const contentStyle = getComputedStyle(content)
    const left = Math.max(0, Math.min(window.innerWidth, contentRect.left + pixels(contentStyle.paddingLeft)))
    const width = Math.max(0, Math.min(window.innerWidth - left, contentRect.width - pixels(contentStyle.paddingLeft) - pixels(contentStyle.paddingRight)))
    if (height !== lastHeight || Math.abs(left - lastLeft) > .5 || Math.abs(width - lastWidth) > .5) {
      lastHeight = height; lastLeft = left; lastWidth = width
      send({ type: 'layout', id, height, left, width })
    }
    if (focusTarget?.isConnected) {
      const bounds = focusTarget.getBoundingClientRect()
      send({ type: 'focus', id, top: bounds.top + window.scrollY, bottom: bounds.bottom + window.scrollY })
    }
    focusTarget = null
  }
  function schedule() {
    if (stopped || pendingFrame) return
    pendingFrame = requestFrame(measure)
    // Browsers pause iframe animation frames below the fold. Previews and
    // background results still need a height before the user scrolls to them.
    fallbackTimer = delay(measure, 80)
  }
  function setViewportHeight(value) {
    if (!Number.isFinite(value) || value < 1 || value > 20000 || stopped) return
    const next = `${Math.round(value)}px`
    if (root.style.getPropertyValue('--firefly-viewport-height') !== next) {
      root.style.setProperty('--firefly-viewport-height', next)
      const active = document.activeElement
      if (document.hasFocus() && active?.matches('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) focusTarget = active
    }
    schedule()
  }
  const resize = new ResizeObserver(schedule)
  resize.observe(body)
  const mutation = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes' && record.attributeName === 'style') inlineRoots.add(record.target)
      if (record.target.nodeName === 'STYLE' || record.target.parentElement?.nodeName === 'STYLE') stylesDirty = true
      for (const node of record.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue
        inlineRoots.add(node)
        if (node.nodeName === 'STYLE' || node.querySelector('style')) stylesDirty = true
      }
    }
    schedule()
  })
  mutation.observe(root, { subtree: true, childList: true, attributes: true, characterData: true })
  const focus = event => { focusTarget = event.target; schedule() }
  window.addEventListener('resize', schedule)
  document.addEventListener('load', schedule, true)
  document.addEventListener('focusin', focus)
  document.fonts?.ready.then(schedule)
  setViewportHeight(viewportHeight)
  updateStyles()
  measure()
  schedule()
  return {
    setViewportHeight,
    dispose() {
      if (stopped) return
      stopped = true
      if (pendingFrame) cancelFrame(pendingFrame)
      cancelDelay(fallbackTimer)
      resize.disconnect(); mutation.disconnect(); inlineRoots.clear()
      window.removeEventListener('resize', schedule)
      document.removeEventListener('load', schedule, true)
      document.removeEventListener('focusin', focus)
    },
  }
}
