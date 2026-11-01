import type { ObjectDirective } from 'vue'
import { isMobileLayout } from '../services/appLayout'

// Delegate to the main shell so dynamically loaded groups and tools work too.
const buttons = '.bottom-nav button, .topbar .menu-button, .topbar .top-icon-button, .topbar .top-text-button, .sidebar .nav-button, .tab-viewport button'
const instances = new WeakMap<HTMLElement, ReturnType<typeof install>>()

function install(root: HTMLElement) {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
  const effects = new Set<{ button: HTMLButtonElement; remove: () => void }>()
  let press: { id: number; x: number; y: number; release: () => void; remove: () => void } | undefined

  function clearPress() { press?.remove(); press = undefined }
  function clear() { clearPress(); for (const effect of effects) effect.remove() }
  function refresh() {
    if (!isMobileLayout() || !root.matches('.tab-shell') || root.closest('[inert]')) return clear()
    for (const effect of effects) {
      if (!effect.button.isConnected || effect.button.matches(':disabled') || effect.button.closest('[inert]')) effect.remove()
    }
  }
  function target(event: Event) {
    if (!isMobileLayout() || !root.matches('.tab-shell') || !(event.target instanceof Element)) return
    const button = event.target.closest<HTMLButtonElement>('button')
    if (!button || !root.contains(button) || !button.matches(buttons)
      || button.matches(':disabled') || button.closest('[inert], [aria-disabled="true"]')) return
    return button
  }
  function start(button: HTMLButtonElement, x?: number, y?: number) {
    // Fast repeated taps must not accumulate unbounded layers or timers.
    while (effects.size >= 6) effects.values().next().value?.remove()
    const rect = button.getBoundingClientRect()
    const left = Math.max(0, Math.min((x ?? rect.left + rect.width / 2) - rect.left, rect.width))
    const top = Math.max(0, Math.min((y ?? rect.top + rect.height / 2) - rect.top, rect.height))
    const diameter = 2 * Math.hypot(Math.max(left, rect.width - left), Math.max(top, rect.height - top))
    // A separate clipped layer preserves focus rings, card shadows and drag outlines.
    const layer = document.createElement('i')
    layer.className = 'mobile-ripple-layer'
    layer.setAttribute('aria-hidden', 'true')
    const wave = document.createElement('i')
    wave.className = 'mobile-ripple-wave'
    wave.style.cssText = `left:${left}px;top:${top}px;width:${diameter}px;height:${diameter}px`
    layer.append(wave)
    button.setAttribute('data-mobile-ripple', '')
    button.append(layer)
    const started = performance.now()
    let timer = 0
    let released = false
    const effect = { button, remove() {
      clearTimeout(timer)
      layer.remove()
      effects.delete(effect)
      if (!button.querySelector('.mobile-ripple-layer')) button.removeAttribute('data-mobile-ripple')
      if (press?.remove === effect.remove) press = undefined
    } }
    effects.add(effect)
    layer.addEventListener('animationend', event => { if (event.target === layer) effect.remove() })
    function release() {
      if (released) return
      released = true
      clearTimeout(timer)
      if (reducedMotion.matches) return effect.remove()
      const delay = Math.max(0, 140 - (performance.now() - started))
      layer.style.animationDelay = `${delay}ms`
      layer.classList.add('is-released')
      timer = window.setTimeout(effect.remove, delay + 300)
    }
    // Clear before the existing 430 ms long-press sorter activates.
    timer = window.setTimeout(effect.remove, button.closest('[data-swap-scope]') ? 400 : 1800)
    return { release, remove: effect.remove }
  }
  function down(event: PointerEvent) {
    clearPress()
    if (!event.isPrimary || event.button !== 0) return
    const button = target(event)
    if (button) press = { id: event.pointerId, x: event.clientX, y: event.clientY, ...start(button, event.clientX, event.clientY) }
  }
  function move(event: PointerEvent) {
    if (press?.id === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10) clearPress()
  }
  function up(event: PointerEvent) {
    if (press?.id !== event.pointerId) return
    press.release()
    press = undefined
  }
  function cancel(event: PointerEvent) { if (press?.id === event.pointerId) clearPress() }
  function click(event: MouseEvent) {
    // Keyboard / assistive activation has no pointerdown; originate in the center.
    if (event.detail !== 0) return
    const button = target(event)
    if (button) start(button).release()
  }
  function visibility() { if (document.hidden) clear() }
  const passiveCapture = { passive: true, capture: true }
  root.addEventListener('pointerdown', down, passiveCapture)
  root.addEventListener('click', click, passiveCapture)
  root.addEventListener('scroll', clearPress, passiveCapture)
  root.addEventListener('dragstart', clearPress, passiveCapture)
  window.addEventListener('pointermove', move, passiveCapture)
  window.addEventListener('pointerup', up, passiveCapture)
  window.addEventListener('pointercancel', cancel, passiveCapture)
  window.addEventListener('blur', clear)
  document.addEventListener('visibilitychange', visibility)
  window.addEventListener('firefly:layout-change', clear)
  reducedMotion.addEventListener('change', clear)
  return { refresh, dispose() {
    clear()
    root.removeEventListener('pointerdown', down, true)
    root.removeEventListener('click', click, true)
    root.removeEventListener('scroll', clearPress, true)
    root.removeEventListener('dragstart', clearPress, true)
    window.removeEventListener('pointermove', move, true)
    window.removeEventListener('pointerup', up, true)
    window.removeEventListener('pointercancel', cancel, true)
    window.removeEventListener('blur', clear)
    document.removeEventListener('visibilitychange', visibility)
    window.removeEventListener('firefly:layout-change', clear)
    reducedMotion.removeEventListener('change', clear)
  } }
}

export const vMobileRipples: ObjectDirective<HTMLElement> = {
  mounted(root) { instances.set(root, install(root)) },
  updated(root) { instances.get(root)?.refresh() },
  beforeUnmount(root) { instances.get(root)?.dispose(); instances.delete(root) },
}
