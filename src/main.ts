import { createApp } from 'vue'
import { createPinia } from 'pinia'
import 'virtual:uno.css'
import './style.css'
import App from './App.vue'
import { isTauri } from '@tauri-apps/api/core'
import { initializeAndroidShell } from './services/androidShell'
import { initializeAppLayout } from './services/appLayout'

async function start() {
  initializeAppLayout()
  if (isTauri() && navigator.userAgent.includes('Android')) await initializeAndroidShell()
  if (window.FireflyInsets) {
    document.documentElement.classList.add('android-shell')
    const updateInsets = () => {
      const top = Math.max(0, window.FireflyInsets?.top() ?? 0)
      const bottom = Math.max(0, window.FireflyInsets?.bottom() ?? 0)
      document.documentElement.style.setProperty('--system-status-top', `${top}px`)
      document.documentElement.style.setProperty('--system-navigation-bottom', `${bottom}px`)
      document.documentElement.style.setProperty('--system-cutout-top', `${Math.max(0, window.FireflyInsets?.cutoutTop?.() ?? 0)}px`)
      document.documentElement.style.setProperty('--system-cutout-right', `${Math.max(0, window.FireflyInsets?.cutoutRight?.() ?? 0)}px`)
    }
    updateInsets()
    window.addEventListener('resize', updateInsets)
  }

  createApp(App).use(createPinia()).mount('#app')
}

void start().catch(error => {
  const root = document.getElementById('app')
  if (root) { root.setAttribute('role', 'alert'); root.textContent = String(error instanceof Error ? error.message : error) }
})
