import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { ReactNode } from 'react'

type Theme = 'light' | 'dark'
type ThemePreference = 'light' | 'dark' | 'system'

export interface ThemeApi {
  theme: Theme
  preference: ThemePreference
  setTheme: (theme: ThemePreference) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeApi | null>(null)

const STORAGE_KEY = 'boring-core:theme'

function getSystemTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function resolveTheme(pref: ThemePreference): Theme {
  return pref === 'system' ? getSystemTheme() : pref
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme)
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

export interface ThemeProviderProps {
  children: ReactNode
  defaultTheme?: ThemePreference
}

export function ThemeProvider({ children, defaultTheme = 'system' }: ThemeProviderProps) {
  const [preference, setPreference] = useState<ThemePreference>(() => {
    if (typeof window === 'undefined') return defaultTheme
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
    } catch {}
    return defaultTheme
  })

  const [systemTheme, setSystemTheme] = useState<Theme>(getSystemTheme)

  const resolved: Theme = preference === 'system' ? systemTheme : preference

  useEffect(() => {
    applyTheme(resolved)
    return () => {
      document.documentElement.removeAttribute('data-theme')
      document.documentElement.classList.remove('dark')
    }
  }, [resolved])

  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => setSystemTheme(getSystemTheme())
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return
      const val = e.newValue
      if (val === 'light' || val === 'dark' || val === 'system') {
        setPreference(val)
      }
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  const setTheme = useCallback((theme: ThemePreference) => {
    setPreference(theme)
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {}
  }, [])

  const toggleTheme = useCallback(() => {
    setPreference((prev) => {
      const next: Theme = resolveTheme(prev) === 'light' ? 'dark' : 'light'
      try {
        localStorage.setItem(STORAGE_KEY, next)
      } catch {}
      return next
    })
  }, [])

  const value = useMemo<ThemeApi>(
    () => ({ theme: resolved, preference, setTheme, toggleTheme }),
    [resolved, preference, setTheme, toggleTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeApi {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}
