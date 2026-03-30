/**
 * Accessibility utilities for the chat-centered shell.
 *
 * Used by ChatStage, BrowseDrawer, Surface, and dialog/drawer components.
 */

/**
 * Announce a message to screen readers via an aria-live region.
 *
 * Creates a visually-hidden element, inserts the text, and auto-removes
 * after 1 second so the DOM doesn't accumulate stale announcements.
 *
 * @param {string} message - Text to announce
 * @param {'polite' | 'assertive'} [priority='polite'] - Announcement urgency
 */
export function announceToScreenReader(message, priority = 'polite') {
  const el = document.createElement('div')
  el.setAttribute('aria-live', priority)
  el.setAttribute('role', 'status')
  el.setAttribute('aria-atomic', 'true')

  // Visually hidden but accessible to screen readers
  Object.assign(el.style, {
    position: 'absolute',
    width: '1px',
    height: '1px',
    padding: '0',
    margin: '-1px',
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    border: '0',
  })

  el.textContent = message
  document.body.appendChild(el)

  // Remove after 1 second — long enough for screen readers to pick it up
  setTimeout(() => {
    if (el.parentNode) {
      el.parentNode.removeChild(el)
    }
  }, 1000)
}

/**
 * Selector for commonly focusable HTML elements.
 * @type {string}
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]',
].join(', ')

/**
 * Return an array of focusable elements within a container, in DOM order.
 *
 * Excludes disabled elements, hidden inputs, and elements with tabindex="-1".
 *
 * @param {HTMLElement} container
 * @returns {HTMLElement[]}
 */
export function getFocusableElements(container) {
  if (!container) return []

  const candidates = Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR))

  return candidates.filter((el) => {
    // Exclude negative tabindex (programmatically focusable but not tabbable)
    const tabindex = el.getAttribute('tabindex')
    if (tabindex !== null && parseInt(tabindex, 10) < 0) {
      return false
    }
    return true
  })
}

/**
 * Trap Tab / Shift+Tab focus within a container element.
 *
 * Call this from a keydown handler to keep keyboard navigation within
 * a dialog, drawer, or modal surface.
 *
 * @param {HTMLElement} container - The container to trap focus within
 * @param {KeyboardEvent} event - The keydown event
 */
export function trapFocus(container, event) {
  if (event.key !== 'Tab') return

  const focusable = getFocusableElements(container)
  if (focusable.length === 0) return

  const first = focusable[0]
  const last = focusable[focusable.length - 1]

  if (event.shiftKey) {
    // Shift+Tab: if on first element, wrap to last
    if (document.activeElement === first) {
      event.preventDefault()
      last.focus()
    }
  } else {
    // Tab: if on last element, wrap to first
    if (document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }
}
