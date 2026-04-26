// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { withBeadId } from '../../server/__tests__/_setup'
import { useReducedMotion } from '../hooks/useReducedMotion'

const BEAD_ID = 'boring-ui-v2-d37p'

type ChangeListener = (event: MediaQueryListEvent) => void

let reduce = true
let listeners: ChangeListener[]

beforeEach(() => {
  reduce = true
  listeners = []

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)' ? reduce : false,
      media: query,
      addEventListener: (_event: string, cb: ChangeListener) => {
        listeners.push(cb)
      },
      removeEventListener: (_event: string, cb: ChangeListener) => {
        listeners = listeners.filter((listener) => listener !== cb)
      },
      addListener: (cb: ChangeListener) => {
        listeners.push(cb)
      },
      removeListener: (cb: ChangeListener) => {
        listeners = listeners.filter((listener) => listener !== cb)
      },
      dispatchEvent: () => true,
      onchange: null,
    })),
  })
})

describe('useReducedMotion hook', () => {
  it(
    'tracks prefers-reduced-motion changes',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      const { result } = renderHook(() => useReducedMotion())
      expect(result.current).toBe(true)
      assertionPassed('useReducedMotion-initial-true')

      act(() => {
        reduce = false
        for (const listener of listeners) {
          listener({ matches: false } as MediaQueryListEvent)
        }
      })

      expect(result.current).toBe(false)
      assertionPassed('useReducedMotion-updates-on-change')
    }),
  )
})
