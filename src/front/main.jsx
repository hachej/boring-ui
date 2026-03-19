import React from 'react'
import { createRoot } from 'react-dom/client'
import { Buffer } from 'buffer'
import App from './App'
import { ConfigProvider } from './config'
import { fetchRuntimeConfig, runtimeConfigToProviderConfig } from './config/runtimeConfig'
import './styles.css'

if (typeof globalThis !== 'undefined' && !globalThis.Buffer) {
  globalThis.Buffer = Buffer
}

// Suppress known xterm.js renderer race condition errors during layout transitions
// These occur when the terminal is destroyed while renderer is still initializing
const originalError = console.error
console.error = (...args) => {
  const msg = args[0]
  if (typeof msg === 'string' && msg.includes('_renderer.value is undefined')) {
    return // Suppress this specific xterm error
  }
  originalError.apply(console, args)
}

// Also catch unhandled errors for xterm renderer issues
window.addEventListener('error', (event) => {
  if (event.message?.includes('_renderer.value is undefined')) {
    event.preventDefault()
    return false
  }
})

let scrollbarIdleTimer = null
const markScrollbarActive = () => {
  document.documentElement.classList.add('scrollbar-active')
  if (scrollbarIdleTimer) {
    window.clearTimeout(scrollbarIdleTimer)
  }
  scrollbarIdleTimer = window.setTimeout(() => {
    document.documentElement.classList.remove('scrollbar-active')
  }, 1000)
}

document.addEventListener('scroll', markScrollbarActive, { capture: true, passive: true })
document.addEventListener('mouseover', markScrollbarActive, { capture: true, passive: true })

async function bootstrap() {
  let appConfig = {}

  try {
    const runtimeConfig = await fetchRuntimeConfig()
    appConfig = runtimeConfigToProviderConfig(runtimeConfig)
  } catch (error) {
    console.error('[bootstrap] failed to load /__bui/config, falling back to defaults', error)
  }

  createRoot(document.getElementById('root')).render(
    <ConfigProvider config={appConfig}>
      <App />
    </ConfigProvider>
  )
}

void bootstrap()
