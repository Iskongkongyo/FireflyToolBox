// Platform decides the navigation shell; width still controls content density.
// Android tablet WebViews omit "Mobile" in their UA and can exceed desktop breakpoints.
export function isMobileLayout() {
  return document.documentElement.dataset.appLayout === 'mobile'
}

export function initializeAppLayout() {
  const narrow = window.matchMedia('(max-width: 599px)')
  const mobilePlatform = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  const update = () => {
    const layout = mobilePlatform || narrow.matches ? 'mobile' : 'desktop'
    if (document.documentElement.dataset.appLayout === layout) return
    document.documentElement.dataset.appLayout = layout
    window.dispatchEvent(new Event('firefly:layout-change'))
  }
  narrow.addEventListener('change', update)
  update()
  return () => narrow.removeEventListener('change', update)
}
