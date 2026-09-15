import { useEffect, useState } from 'react'

const THEME_STORAGE_KEY = 'one-chat.theme'
type Theme = 'light' | 'dark'

function storedTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(theme: Theme | null): void {
  if (theme) document.documentElement.dataset.theme = theme
  else delete document.documentElement.dataset.theme
  document.documentElement.style.colorScheme = theme ?? 'light dark'
}

/** Run before React mounts so a stored theme never flashes the system palette. */
export function initializeTheme(): void {
  applyTheme(storedTheme())
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(() => storedTheme())
  const [system, setSystem] = useState<Theme>(() => systemTheme())
  const resolved = theme ?? system

  useEffect(() => {
    applyTheme(theme)
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystem(media.matches ? 'dark' : 'light')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [theme])

  const next: Theme = resolved === 'dark' ? 'light' : 'dark'
  return (
    <button
      type="button"
      className="one-chat-theme-toggle"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      data-testid="one-chat-theme-toggle"
      onClick={() => {
        setTheme(next)
        try {
          window.localStorage.setItem(THEME_STORAGE_KEY, next)
        } catch {
          // The explicit theme still applies for this page.
        }
      }}
    >
      {resolved === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  )
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2.5v2M12 19.5v2M4.5 12h-2M21.5 12h-2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 15.3A8.2 8.2 0 0 1 8.7 4a8.3 8.3 0 1 0 11.3 11.3Z" />
    </svg>
  )
}
