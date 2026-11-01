import { createApp } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import StartupSplash from './components/StartupSplash.vue'
import splashPc from '../png/splash_pc.jpg'
import { readStartupImage, startupSplashEnabled } from './services/wallpaper'

async function start() {
  if (!startupSplashEnabled()) {
    await invoke('finish_splash')
    return
  }
  let imageSrc = splashPc
  try {
    const saved = await readStartupImage()
    if (saved) imageSrc = URL.createObjectURL(saved)
  } catch { /* Keep the factory image when storage is unavailable. */ }
  createApp(StartupSplash, {
    imageSrc, draggableWindow: true,
    onDrag: () => { void getCurrentWindow().startDragging().catch(() => {}) },
    onDone: () => { void invoke('finish_splash').catch(() => {}) },
  }).mount('#splash')
  await invoke('show_splash')
}

void start().catch(() => { void invoke('finish_splash').catch(() => {}) })
