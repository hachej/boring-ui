import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import {
  announceToScreenReader,
  getFocusableElements,
  trapFocus,
} from '../a11y'

describe('announceToScreenReader', () => {
  beforeEach(() => {
    // Clean up any leftover live regions
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates a live region announcement', () => {
    announceToScreenReader('New message from agent')

    const liveRegion = document.querySelector('[aria-live]')
    expect(liveRegion).not.toBeNull()
    expect(liveRegion.textContent).toBe('New message from agent')
    expect(liveRegion.getAttribute('aria-live')).toBe('polite')
  })

  it('uses assertive priority when specified', () => {
    announceToScreenReader('Error occurred', 'assertive')

    const liveRegion = document.querySelector('[aria-live="assertive"]')
    expect(liveRegion).not.toBeNull()
    expect(liveRegion.textContent).toBe('Error occurred')
  })

  it('screen reader announcement is removed after timeout', () => {
    vi.useFakeTimers()

    announceToScreenReader('Temporary message')

    expect(document.querySelector('[aria-live]')).not.toBeNull()

    vi.advanceTimersByTime(1100) // slightly over 1s

    expect(document.querySelector('[aria-live]')).toBeNull()

    vi.useRealTimers()
  })

  it('multiple announcements coexist before timeout', () => {
    vi.useFakeTimers()

    announceToScreenReader('First message')
    announceToScreenReader('Second message')

    const regions = document.querySelectorAll('[aria-live]')
    expect(regions).toHaveLength(2)

    vi.useRealTimers()
  })
})

describe('getFocusableElements', () => {
  it('returns focusable elements in DOM order', () => {
    const container = document.createElement('div')
    container.innerHTML = `
      <button id="btn1">Click</button>
      <span>Not focusable</span>
      <input id="input1" type="text" />
      <a id="link1" href="#">Link</a>
      <div tabindex="0" id="custom1">Custom</div>
      <div>Also not focusable</div>
      <textarea id="textarea1"></textarea>
      <select id="select1"><option>A</option></select>
    `
    document.body.appendChild(container)

    const focusable = getFocusableElements(container)

    expect(focusable).toHaveLength(6)
    expect(focusable[0].id).toBe('btn1')
    expect(focusable[1].id).toBe('input1')
    expect(focusable[2].id).toBe('link1')
    expect(focusable[3].id).toBe('custom1')
    expect(focusable[4].id).toBe('textarea1')
    expect(focusable[5].id).toBe('select1')
  })

  it('excludes disabled and hidden elements', () => {
    const container = document.createElement('div')
    container.innerHTML = `
      <button id="btn1">Visible</button>
      <button id="btn2" disabled>Disabled</button>
      <input id="input1" type="hidden" />
      <button id="btn3" tabindex="-1">Negative tabindex</button>
    `
    document.body.appendChild(container)

    const focusable = getFocusableElements(container)

    // btn1 is focusable, btn2 disabled, input1 hidden type, btn3 tabindex=-1
    expect(focusable).toHaveLength(1)
    expect(focusable[0].id).toBe('btn1')
  })

  it('returns empty array for container with no focusable elements', () => {
    const container = document.createElement('div')
    container.innerHTML = '<span>Nothing here</span><div>Nope</div>'
    document.body.appendChild(container)

    const focusable = getFocusableElements(container)
    expect(focusable).toHaveLength(0)
  })
})

describe('trapFocus', () => {
  it('keeps Tab within container (wraps from last to first)', () => {
    const container = document.createElement('div')
    container.innerHTML = `
      <button id="first">First</button>
      <button id="second">Second</button>
      <button id="last">Last</button>
    `
    document.body.appendChild(container)

    const lastBtn = container.querySelector('#last')
    lastBtn.focus()

    // Simulate Tab on last element — should wrap to first
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: false,
      bubbles: true,
      cancelable: true,
    })
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault')

    trapFocus(container, event)

    expect(preventDefaultSpy).toHaveBeenCalled()
    expect(document.activeElement.id).toBe('first')
  })

  it('keeps Shift+Tab within container (wraps from first to last)', () => {
    const container = document.createElement('div')
    container.innerHTML = `
      <button id="first">First</button>
      <button id="second">Second</button>
      <button id="last">Last</button>
    `
    document.body.appendChild(container)

    const firstBtn = container.querySelector('#first')
    firstBtn.focus()

    // Simulate Shift+Tab on first element — should wrap to last
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault')

    trapFocus(container, event)

    expect(preventDefaultSpy).toHaveBeenCalled()
    expect(document.activeElement.id).toBe('last')
  })

  it('does nothing for non-Tab key events', () => {
    const container = document.createElement('div')
    container.innerHTML = '<button id="btn">Button</button>'
    document.body.appendChild(container)

    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    })
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault')

    trapFocus(container, event)

    expect(preventDefaultSpy).not.toHaveBeenCalled()
  })
})
