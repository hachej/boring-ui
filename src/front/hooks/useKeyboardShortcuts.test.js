/**
 * useKeyboardShortcuts hook tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useKeyboardShortcuts, formatShortcut, DEFAULT_SHORTCUTS } from './useKeyboardShortcuts'

describe('useKeyboardShortcuts', () => {
  let handlers
  let addEventListenerSpy
  let removeEventListenerSpy

  beforeEach(() => {
    handlers = {
      toggleFiletree: vi.fn(),
    }

    addEventListenerSpy = vi.spyOn(window, 'addEventListener')
    removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')
  })

  afterEach(() => {
    addEventListenerSpy.mockRestore()
    removeEventListenerSpy.mockRestore()
  })

  it('registers keydown listener on mount', () => {
    renderHook(() => useKeyboardShortcuts(handlers))

    expect(addEventListenerSpy).toHaveBeenCalledWith(
      'keydown',
      expect.any(Function),
    )
  })

  it('removes keydown listener on unmount', () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(handlers))
    unmount()

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      'keydown',
      expect.any(Function),
    )
  })

  it('does not register listener when disabled', () => {
    renderHook(() => useKeyboardShortcuts(handlers, { enabled: false }))

    // Listener added then removed, or not added at all
    const addCalls = addEventListenerSpy.mock.calls.filter(
      (call) => call[0] === 'keydown',
    )
    expect(addCalls.length).toBe(0)
  })

  it('returns shortcuts configuration', () => {
    const { result } = renderHook(() => useKeyboardShortcuts(handlers))

    expect(result.current.shortcuts).toEqual(DEFAULT_SHORTCUTS)
    expect(result.current.formatShortcut).toBe(formatShortcut)
  })

  it('calls handler when shortcut matches', () => {
    renderHook(() => useKeyboardShortcuts(handlers))

    const keydownHandler = addEventListenerSpy.mock.calls.find(
      (call) => call[0] === 'keydown',
    )[1]

    // Simulate Ctrl+B (or Cmd+B on Mac)
    const event = new KeyboardEvent('keydown', {
      key: 'b',
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      bubbles: true,
    })

    // Override target (not in input)
    Object.defineProperty(event, 'target', {
      value: { tagName: 'DIV', isContentEditable: false },
    })

    // Spy on preventDefault
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault')
    const stopPropagationSpy = vi.spyOn(event, 'stopPropagation')

    keydownHandler(event)

    // On non-Mac, Ctrl+B should trigger toggleFiletree
    expect(handlers.toggleFiletree).toHaveBeenCalled()
    expect(preventDefaultSpy).toHaveBeenCalled()
    expect(stopPropagationSpy).toHaveBeenCalled()
  })

  it('ignores shortcuts when typing in input', () => {
    renderHook(() => useKeyboardShortcuts(handlers))

    const keydownHandler = addEventListenerSpy.mock.calls.find(
      (call) => call[0] === 'keydown',
    )[1]

    const event = new KeyboardEvent('keydown', {
      key: 'b',
      ctrlKey: true,
    })

    Object.defineProperty(event, 'target', {
      value: { tagName: 'INPUT', isContentEditable: false },
    })

    keydownHandler(event)

    expect(handlers.toggleFiletree).not.toHaveBeenCalled()
  })

  it('ignores shortcuts when typing in textarea', () => {
    renderHook(() => useKeyboardShortcuts(handlers))

    const keydownHandler = addEventListenerSpy.mock.calls.find(
      (call) => call[0] === 'keydown',
    )[1]

    const event = new KeyboardEvent('keydown', {
      key: 'b',
      ctrlKey: true,
    })

    Object.defineProperty(event, 'target', {
      value: { tagName: 'TEXTAREA', isContentEditable: false },
    })

    keydownHandler(event)

    expect(handlers.toggleFiletree).not.toHaveBeenCalled()
  })

  it('ignores unregistered shortcuts', () => {
    renderHook(() => useKeyboardShortcuts(handlers))

    const keydownHandler = addEventListenerSpy.mock.calls.find(
      (call) => call[0] === 'keydown',
    )[1]

    const event = new KeyboardEvent('keydown', {
      key: 'x',
      ctrlKey: true,
    })

    Object.defineProperty(event, 'target', {
      value: { tagName: 'DIV', isContentEditable: false },
    })

    const preventDefaultSpy = vi.spyOn(event, 'preventDefault')

    keydownHandler(event)

    // No handler should be called
    expect(handlers.toggleFiletree).not.toHaveBeenCalled()
    expect(preventDefaultSpy).not.toHaveBeenCalled()
  })
})

describe('formatShortcut', () => {
  it('formats simple shortcuts', () => {
    const shortcut = { key: 'b', modifiers: ['cmd'] }
    const formatted = formatShortcut(shortcut)

    // Should include Ctrl (on non-Mac test environment)
    expect(formatted).toContain('B')
    expect(formatted).toMatch(/Ctrl|⌘/)
  })

  it('formats shortcuts with multiple modifiers', () => {
    const shortcut = { key: 'd', modifiers: ['cmd', 'shift'] }
    const formatted = formatShortcut(shortcut)

    expect(formatted).toContain('D')
    expect(formatted).toMatch(/Shift|⇧/)
    expect(formatted).toMatch(/Ctrl|⌘/)
  })

  it('handles special keys', () => {
    const shortcut = { key: '`', modifiers: ['cmd'] }
    const formatted = formatShortcut(shortcut)

    expect(formatted).toContain('`')
  })

  it('returns empty string for null shortcut', () => {
    expect(formatShortcut(null)).toBe('')
    expect(formatShortcut(undefined)).toBe('')
  })
})

describe('DEFAULT_SHORTCUTS', () => {
  it('has expected shortcuts defined', () => {
    expect(DEFAULT_SHORTCUTS.toggleFiletree).toBeDefined()
    expect(DEFAULT_SHORTCUTS.toggleTerminal).toBeUndefined()
    expect(DEFAULT_SHORTCUTS.toggleShell).toBeUndefined()
    expect(DEFAULT_SHORTCUTS.searchFiles).toBeDefined()
    expect(DEFAULT_SHORTCUTS.searchCatalog).toBeDefined()
    expect(DEFAULT_SHORTCUTS.toggleTheme).toBeDefined()
  })

  it('uses cmd modifier for all shortcuts', () => {
    for (const shortcut of Object.values(DEFAULT_SHORTCUTS)) {
      expect(shortcut.modifiers).toContain('cmd')
    }
  })
})
