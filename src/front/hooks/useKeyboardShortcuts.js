/**
 * Keyboard shortcuts hook.
 *
 * Provides global keyboard shortcut handling with platform-aware modifier keys.
 *
 * @module hooks/useKeyboardShortcuts
 */

import { useEffect, useCallback, useRef } from 'react'

/**
 * Check if running on Mac.
 */
const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)

/**
 * Default keyboard shortcuts configuration.
 * Uses Cmd on Mac, Ctrl on Windows/Linux.
 */
export const DEFAULT_SHORTCUTS = {
  // Panel toggles
  toggleFiletree: { key: 'b', modifiers: ['cmd'] },
  toggleTerminal: { key: '`', modifiers: ['cmd'] },
  toggleShell: { key: 'j', modifiers: ['cmd'] },

  // Navigation
  searchFiles: { key: 'p', modifiers: ['cmd'] },
  searchCatalog: { key: 'k', modifiers: ['cmd'] },
  closeTab: { key: 'w', modifiers: ['cmd'] },

  // Theme
  toggleTheme: { key: 'd', modifiers: ['cmd', 'shift'] },
}

/**
 * Check if event matches a shortcut configuration.
 *
 * @param {KeyboardEvent} event - The keyboard event
 * @param {Object} shortcut - Shortcut config { key, modifiers }
 * @returns {boolean}
 */
function matchesShortcut(event, shortcut) {
  if (!shortcut) return false

  // Check key (case-insensitive)
  if (event.key.toLowerCase() !== shortcut.key.toLowerCase()) {
    return false
  }

  // Check modifiers
  const modifiers = shortcut.modifiers || []
  const requiresCmd = modifiers.includes('cmd')
  const requiresShift = modifiers.includes('shift')
  const requiresAlt = modifiers.includes('alt')

  // Cmd = metaKey on Mac, ctrlKey on Windows/Linux
  const cmdPressed = isMac ? event.metaKey : event.ctrlKey
  const shiftPressed = event.shiftKey
  const altPressed = event.altKey

  // Must match required modifiers
  if (requiresCmd !== cmdPressed) return false
  if (requiresShift !== shiftPressed) return false
  if (requiresAlt !== altPressed) return false

  return true
}

/**
 * Format shortcut for display.
 *
 * @param {Object} shortcut - Shortcut config { key, modifiers }
 * @returns {string} - Human-readable shortcut string
 */
export function formatShortcut(shortcut) {
  if (!shortcut) return ''

  const parts = []
  const modifiers = shortcut.modifiers || []

  if (modifiers.includes('cmd')) {
    parts.push(isMac ? '⌘' : 'Ctrl')
  }
  if (modifiers.includes('shift')) {
    parts.push(isMac ? '⇧' : 'Shift')
  }
  if (modifiers.includes('alt')) {
    parts.push(isMac ? '⌥' : 'Alt')
  }

  // Format key display
  let keyDisplay = shortcut.key.toUpperCase()
  if (shortcut.key === '`') keyDisplay = '`'
  if (shortcut.key === ' ') keyDisplay = 'Space'

  parts.push(keyDisplay)

  return isMac ? parts.join('') : parts.join('+')
}

/**
 * Hook for handling keyboard shortcuts.
 *
 * @param {Object} handlers - Map of action names to handler functions
 * @param {Object} [options] - Options
 * @param {Object} [options.shortcuts] - Custom shortcut configuration
 * @param {boolean} [options.enabled=true] - Whether shortcuts are enabled
 * @returns {Object} - { shortcuts, formatShortcut }
 *
 * @example
 * useKeyboardShortcuts({
 *   toggleFiletree: () => setCollapsed(prev => ({ ...prev, filetree: !prev.filetree })),
 *   searchFiles: () => focusSearchInput(),
 * })
 */
export function useKeyboardShortcuts(handlers, options = {}) {
  const { shortcuts = DEFAULT_SHORTCUTS, enabled = true } = options
  const handlersRef = useRef(handlers)

  // Keep handlers ref updated
  useEffect(() => {
    handlersRef.current = handlers
  }, [handlers])

  const handleKeyDown = useCallback(
    (event) => {
      if (!enabled) return

      // Skip if typing in an input, textarea, or contenteditable
      const target = event.target
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        // Allow some shortcuts even in inputs (like Cmd+S for save, Cmd+W for close tab)
        const isEditorShortcut =
          matchesShortcut(event, shortcuts.saveFile) ||
          matchesShortcut(event, shortcuts.closeTab)
        if (!isEditorShortcut) {
          return
        }
      }

      // Check each shortcut
      for (const [action, shortcut] of Object.entries(shortcuts)) {
        if (matchesShortcut(event, shortcut)) {
          const handler = handlersRef.current[action]
          if (handler) {
            event.preventDefault()
            event.stopPropagation()
            handler(event)
            return
          }
        }
      }
    },
    [shortcuts, enabled],
  )

  useEffect(() => {
    if (!enabled) return

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleKeyDown, enabled])

  return {
    shortcuts,
    formatShortcut,
  }
}

export default useKeyboardShortcuts
