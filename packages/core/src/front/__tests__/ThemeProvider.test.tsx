// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ThemeProvider, useTheme } from '../ThemeProvider'

let storage: Map<string, string>
let originalStorage: Storage

beforeEach(() => {
  storage = new Map()
  const mock = {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
    removeItem: vi.fn((key: string) => storage.delete(key)),
    clear: vi.fn(() => storage.clear()),
    get length() { return storage.size },
    key: vi.fn((i: number) => [...storage.keys()][i] ?? null),
  } as unknown as Storage

  originalStorage = globalThis.localStorage
  Object.defineProperty(globalThis, 'localStorage', {
    value: mock,
    writable: true,
    configurable: true,
  })

  document.documentElement.removeAttribute('data-theme')
  document.documentElement.classList.remove('dark')
})

afterEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: originalStorage,
    writable: true,
    configurable: true,
  })
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.classList.remove('dark')
})

function mockMatchMedia(prefersDark: boolean) {
  const listeners: Array<(e: MediaQueryListEvent) => void> = []
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: query === '(prefers-color-scheme: dark)' ? prefersDark : false,
      media: query,
      addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => {
        listeners.push(cb)
      },
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    })),
  })
  return listeners
}

function wrapper({ children }: { children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>
}

describe('ThemeProvider', () => {
  it('sets data-theme="dark" when theme is dark', () => {
    mockMatchMedia(false)
    const { result } = renderHook(() => useTheme(), { wrapper })

    act(() => {
      result.current.setTheme('dark')
    })

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('sets data-theme="light" when theme is light', () => {
    mockMatchMedia(false)
    const { result } = renderHook(() => useTheme(), { wrapper })

    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('system mode follows prefers-color-scheme: dark', () => {
    mockMatchMedia(true)
    const { result } = renderHook(() => useTheme(), { wrapper })

    expect(result.current.theme).toBe('dark')
    expect(result.current.preference).toBe('system')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('system mode follows prefers-color-scheme: light', () => {
    mockMatchMedia(false)
    const { result } = renderHook(() => useTheme(), { wrapper })

    expect(result.current.theme).toBe('light')
    expect(result.current.preference).toBe('system')
  })

  it('system mode reacts to media query change', () => {
    const listeners = mockMatchMedia(false)
    const { result } = renderHook(() => useTheme(), { wrapper })

    expect(result.current.theme).toBe('light')

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn((query: string) => ({
        matches: query === '(prefers-color-scheme: dark)',
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        onchange: null,
        dispatchEvent: () => false,
      })),
    })

    act(() => {
      for (const cb of listeners) {
        cb({ matches: true } as MediaQueryListEvent)
      }
    })

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(result.current.theme).toBe('dark')
    expect(result.current.preference).toBe('system')
  })

  it('toggleTheme switches light → dark → light', () => {
    mockMatchMedia(false)
    const { result } = renderHook(() => useTheme(), { wrapper })

    expect(result.current.theme).toBe('light')

    act(() => result.current.toggleTheme())
    expect(result.current.theme).toBe('dark')

    act(() => result.current.toggleTheme())
    expect(result.current.theme).toBe('light')
  })

  it('persists preference to localStorage', () => {
    mockMatchMedia(false)
    const { result } = renderHook(() => useTheme(), { wrapper })

    act(() => result.current.setTheme('dark'))
    expect(storage.get('boring-core:theme')).toBe('dark')

    act(() => result.current.setTheme('system'))
    expect(storage.get('boring-core:theme')).toBe('system')
  })

  it('restores persisted preference on mount', () => {
    mockMatchMedia(false)
    storage.set('boring-core:theme', 'dark')

    const { result } = renderHook(() => useTheme(), { wrapper })
    expect(result.current.theme).toBe('dark')
    expect(result.current.preference).toBe('dark')
  })

  it('cross-tab sync via storage event', () => {
    mockMatchMedia(false)
    const { result } = renderHook(() => useTheme(), { wrapper })

    expect(result.current.theme).toBe('light')

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'boring-core:theme',
          newValue: 'dark',
        }),
      )
    })

    expect(result.current.preference).toBe('dark')
    expect(result.current.theme).toBe('dark')
  })

  it('respects defaultTheme prop', () => {
    mockMatchMedia(false)
    function darkWrapper({ children }: { children: ReactNode }) {
      return <ThemeProvider defaultTheme="dark">{children}</ThemeProvider>
    }
    const { result } = renderHook(() => useTheme(), { wrapper: darkWrapper })
    expect(result.current.theme).toBe('dark')
    expect(result.current.preference).toBe('dark')
  })

  it('useTheme throws outside ThemeProvider', () => {
    expect(() => {
      renderHook(() => useTheme())
    }).toThrow('useTheme must be used within a ThemeProvider')
  })

  it('renders children', () => {
    mockMatchMedia(false)
    render(
      <ThemeProvider>
        <div data-testid="child">hello</div>
      </ThemeProvider>,
    )
    expect(screen.getByTestId('child').textContent).toBe('hello')
  })
})
