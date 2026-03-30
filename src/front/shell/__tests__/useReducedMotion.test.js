import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useReducedMotion } from '../useReducedMotion'

describe('useReducedMotion', () => {
  let mockMatchMedia
  let listeners

  beforeEach(() => {
    listeners = new Map()

    mockMatchMedia = vi.fn((query) => {
      const mql = {
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn((event, cb) => {
          if (!listeners.has(event)) listeners.set(event, [])
          listeners.get(event).push(cb)
        }),
        removeEventListener: vi.fn((event, cb) => {
          const cbs = listeners.get(event) || []
          const idx = cbs.indexOf(cb)
          if (idx >= 0) cbs.splice(idx, 1)
        }),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }
      return mql
    })

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: mockMatchMedia,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns false by default (no prefers-reduced-motion)', () => {
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(false)
  })

  it('returns true when matchMedia matches prefers-reduced-motion: reduce', () => {
    mockMatchMedia = vi.fn((query) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: mockMatchMedia,
    })

    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(true)
  })

  it('queries the correct media query string', () => {
    renderHook(() => useReducedMotion())
    expect(mockMatchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)')
  })

  it('updates when media query changes', () => {
    // Start with no reduced motion
    let changeCallback = null
    mockMatchMedia = vi.fn((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn((event, cb) => {
        if (event === 'change') changeCallback = cb
      }),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: mockMatchMedia,
    })

    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(false)

    // Simulate user enabling reduced motion
    act(() => {
      if (changeCallback) {
        changeCallback({ matches: true })
      }
    })

    expect(result.current).toBe(true)
  })

  it('cleans up listener on unmount', () => {
    const removeEventListenerMock = vi.fn()

    mockMatchMedia = vi.fn((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: removeEventListenerMock,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: mockMatchMedia,
    })

    const { unmount } = renderHook(() => useReducedMotion())
    unmount()

    expect(removeEventListenerMock).toHaveBeenCalledWith('change', expect.any(Function))
  })
})
