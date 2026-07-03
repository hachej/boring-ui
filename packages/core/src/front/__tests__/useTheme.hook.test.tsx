// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { withTaskId } from '../../server/__tests__/_setup'
import { ThemeProvider } from '../ThemeProvider'
import { useTheme } from '../hooks/useTheme'

const TASK_ID = 'boring-ui-v2-d37p'

let prefersDark = false

function wrapper({ children }: { children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>
}

beforeEach(() => {
  prefersDark = false
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.classList.remove('dark')

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      matches: query === '(prefers-color-scheme: dark)' ? prefersDark : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
      onchange: null,
    })),
  })
})

afterEach(() => {
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.classList.remove('dark')
})

describe('useTheme hook', () => {
  it(
    'applies dark, supports system preference, and syncs via storage event',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      const { result, unmount } = renderHook(() => useTheme(), { wrapper })

      act(() => {
        result.current.setTheme('dark')
      })
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
      assertionPassed('useTheme-dark-applies')

      prefersDark = true
      unmount()

      localStorage.setItem('boring-core:theme', 'system')
      const { result: systemResult } = renderHook(() => useTheme(), { wrapper })
      expect(systemResult.current.preference).toBe('system')
      expect(systemResult.current.theme).toBe('dark')
      assertionPassed('useTheme-system-prefers-dark')

      act(() => {
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: 'boring-core:theme',
            newValue: 'light',
          }),
        )
      })
      expect(systemResult.current.preference).toBe('light')
      expect(systemResult.current.theme).toBe('light')
      assertionPassed('useTheme-storage-sync')
    }),
  )
})
