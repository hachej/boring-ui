// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { withBeadId } from '../../server/__tests__/_setup'
import { useViewportBreakpoint } from '../hooks/useViewportBreakpoint'

const BEAD_ID = 'boring-ui-v2-d37p'

function installMatchMediaFromInnerWidth(): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => {
      const match = /min-width:\s*(\d+)px/.exec(query)
      const minWidth = match ? Number.parseInt(match[1] ?? '0', 10) : 0
      return {
        matches: window.innerWidth >= minWidth,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => true,
        onchange: null,
      }
    }),
  })
}

beforeEach(() => {
  installMatchMediaFromInnerWidth()
})

describe('useViewportBreakpoint hook', () => {
  it(
    'tracks Tailwind breakpoints via matchMedia',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 })
      const { result } = renderHook(() => useViewportBreakpoint())
      expect(result.current).toBe('md')
      assertionPassed('useViewportBreakpoint-md')

      act(() => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 })
        window.dispatchEvent(new Event('resize'))
      })

      expect(result.current).toBe('xl')
      assertionPassed('useViewportBreakpoint-xl')
    }),
  )
})
