// Host-owned escape gestures run before tool listeners, even with iframe focus.
// The bridge can only exit/reveal controls; it cannot enter native fullscreen.
(() => {
  const add = EventTarget.prototype.addEventListener
  const remove = EventTarget.prototype.removeEventListener
  window.FireflyWebToolPresentation = (id, send) => {
    let enabled = false, start = null, hover = null, hoverTimer, holdTimer, suppressClick = null, lastReveal = -Infinity
    const pointers = new Set()
    const matchesPath = (event, selector) => event.composedPath().some(node => node instanceof Element && node.matches(selector))
    const editing = event => matchesPath(event, 'input,textarea,select,[contenteditable]:not([contenteditable="false"])')
    const interactive = event => matchesPath(event, 'button,a[href],input,textarea,select,summary,label,[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="switch"],[role="slider"],[role="tab"],[role="menuitem"],[tabindex]:not([tabindex="-1"]),[draggable="true"],[contenteditable]:not([contenteditable="false"])')
    const clearHover = () => { clearTimeout(hoverTimer); hover = null }
    const clearHold = () => { clearTimeout(holdTimer) }
    const reset = () => { clearHover(); clearHold(); start = null; pointers.clear(); suppressClick = null }
    const reveal = () => { if (performance.now() - lastReveal > 350) { lastReveal = performance.now(); send({ type: 'presentation', id, action: 'reveal' }) } }
    const key = event => {
      if (!enabled || event.key !== 'Escape' || event.isComposing) return
      reset()
      event.preventDefault(); event.stopImmediatePropagation()
      send({ type: 'presentation', id, action: 'exit' })
    }
    const down = event => {
      if (!enabled) return
      clearHover(); clearHold(); suppressClick = null
      pointers.add(event.pointerId)
      if (event.pointerType !== 'touch' || event.isPrimary === false || pointers.size !== 1 || editing(event)) { start = null; return }
      const candidate = start = { id: event.pointerId, x: event.clientX, y: event.clientY, time: performance.now(), held: false }
      // Ordinary taps, controls and drawing surfaces never summon host UI.
      if (candidate.x < innerWidth - 80 || candidate.y >= 96 || interactive(event) || matchesPath(event, 'canvas,svg,video,audio')) return
      holdTimer = setTimeout(() => {
        if (!enabled || start !== candidate || pointers.size !== 1 || event.defaultPrevented || window.getSelection()?.toString()) return
        candidate.held = true
        reveal()
      }, 600)
    }
    const move = event => {
      if (!enabled) return
      if (event.pointerType === 'mouse') {
        if (event.buttons || pointers.size || event.clientX < innerWidth - 80 || event.clientY < 0 || event.clientY > 8 || interactive(event)) { clearHover(); return }
        if (!hover || Math.hypot(event.clientX - hover.x, event.clientY - hover.y) > 6) {
          clearHover()
          const candidate = hover = { x: event.clientX, y: event.clientY }
          hoverTimer = setTimeout(() => { if (enabled && hover === candidate && !pointers.size) reveal() }, 400)
        }
        return
      }
      if (!start || start.id !== event.pointerId || start.held) return
      const dx = event.clientX - start.x, dy = event.clientY - start.y
      if (Math.abs(dx) >= 12 || Math.abs(dy) >= 12) clearHold()
      if (start.x < innerWidth - 24) return
      if (Math.abs(dy) > 40 || performance.now() - start.time > 1000) { start = null; return }
      if (dx <= -72) { clearHold(); start = null; send({ type: 'presentation', id, action: 'exit' }) }
    }
    const up = event => {
      pointers.delete(event.pointerId)
      clearHover(); clearHold()
      if (enabled && start?.id === event.pointerId && start.held) {
        suppressClick = { x: event.clientX, y: event.clientY, until: performance.now() + 700 }
        event.preventDefault(); event.stopImmediatePropagation()
      }
      start = null
    }
    const click = event => {
      if (!suppressClick) return
      const last = suppressClick; suppressClick = null
      if (event.detail > 0 && performance.now() <= last.until && Math.hypot(event.clientX - last.x, event.clientY - last.y) < 16) { event.preventDefault(); event.stopImmediatePropagation() }
    }
    const cancel = event => { pointers.delete(event.pointerId); clearHover(); clearHold(); start = null }
    // Touch pointerout follows pointerup before its compatibility click. Keep
    // that click's suppression token while canceling unfinished gestures.
    const out = event => { if (event.relatedTarget === null) { pointers.delete(event.pointerId); clearHover(); clearHold(); start = null } }
    const context = event => { if (start && performance.now() - start.time >= 400 && !interactive(event) && !matchesPath(event, 'canvas,svg,video,audio') && start.x >= innerWidth - 80 && start.y < 96 && !window.getSelection()?.toString()) event.preventDefault() }
    const listeners = [['keydown', key], ['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', cancel], ['pointerout', out], ['click', click], ['contextmenu', context], ['blur', reset], ['pagehide', reset], ['scroll', reset], ['resize', reset]]
    for (const [type, fn] of listeners) add.call(window, type, fn, true)
    return {
      setFullscreen(value) { reset(); enabled = value === true },
      dispose() { enabled = false; reset(); for (const [type, fn] of listeners) remove.call(window, type, fn, true) },
    }
  }
})()
