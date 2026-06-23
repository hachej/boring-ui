// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { withTaskId } from '../../server/__tests__/_setup'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'

const TASK_ID = 'boring-ui-v2-d37p'

function setPlatform(platform: string): void {
  Object.defineProperty(window.navigator, 'platform', {
    configurable: true,
    value: platform,
  })
}

function fireKey(
  key: string,
  init: Partial<KeyboardEventInit> = {},
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  })
  window.dispatchEvent(event)
  return event
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useKeyboardShortcuts hook', () => {
  it(
    'maps Cmd+K to metaKey on Mac',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      setPlatform('MacIntel')
      const handler = vi.fn()

      renderHook(() =>
        useKeyboardShortcuts([{ shortcut: 'Cmd+K', handler }]),
      )

      act(() => {
        fireKey('k', { metaKey: true })
      })

      expect(handler).toHaveBeenCalledOnce()
      assertionPassed('useKeyboardShortcuts-mac-meta-mapping')
    }),
  )

  it(
    'maps Cmd+K to ctrlKey on Windows/Linux and cleans up on unmount',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      setPlatform('Win32')
      const handler = vi.fn()

      const { unmount } = renderHook(() =>
        useKeyboardShortcuts([{ shortcut: 'Cmd+K', handler }]),
      )

      act(() => {
        fireKey('k', { ctrlKey: true })
      })
      expect(handler).toHaveBeenCalledOnce()
      assertionPassed('useKeyboardShortcuts-win-ctrl-mapping')

      unmount()
      act(() => {
        fireKey('k', { ctrlKey: true })
      })
      expect(handler).toHaveBeenCalledOnce()
      assertionPassed('useKeyboardShortcuts-cleanup')
    }),
  )
})
