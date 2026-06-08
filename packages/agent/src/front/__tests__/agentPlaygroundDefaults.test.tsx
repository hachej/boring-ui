// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

// The real ChatPanel renders here. Mocking the `@hachej/boring-agent/front`
// package entry is unreliable from this package's own test context (it resolves
// to a built bundle, and vitest cannot intercept it consistently across the
// app/package boundary), so we render the real composer surface and assert on
// the App's own default-state controls — which reflect the props handed to it.
vi.stubGlobal('ResizeObserver', class {
  observe() {}
  unobserve() {}
  disconnect() {}
})
Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:attachment') })
Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
Element.prototype.scrollIntoView = vi.fn()

// Keep the default 'chat' tab lightweight: the showcase tab is never rendered by
// default, but stubbing it avoids pulling its module tree into the test graph.
vi.mock('../../../../../apps/agent-playground/src/Showcase', () => ({
  Showcase: () => <div data-testid="mock-showcase" />,
}))

import { App } from '../../../../../apps/agent-playground/src/front/App'

const checkbox = (label: string) => screen.getByLabelText(label) as HTMLInputElement

describe('agent playground defaults', () => {
  afterEach(() => {
    cleanup()
    window.localStorage.clear()
    window.history.replaceState(null, '', '/')
    document.documentElement.className = ''
  })

  test('opens in the workspace-like composer surface by default', () => {
    // A stale pre-v2 theme key must be ignored: the playground defaults to light.
    window.localStorage.setItem('agent-playground:theme', 'dark')

    render(<App />)

    // Defaults match the workspace-like composer: chrome + debug + thinking on,
    // session browser off.
    expect(checkbox('chrome').checked).toBe(true)
    expect(checkbox('debug').checked).toBe(true)
    expect(checkbox('sessions').checked).toBe(false)
    expect(checkbox('thinking control').checked).toBe(true)

    // Theme migration: the legacy key is left untouched and v2 defaults to light.
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(window.localStorage.getItem('agent-playground:theme:v2')).toBe('light')
    expect(window.localStorage.getItem('agent-playground:theme')).toBe('dark')
  })

  test('keeps diagnostic chrome controls available without changing the default', () => {
    render(<App />)

    fireEvent.click(checkbox('chrome'))
    fireEvent.click(checkbox('debug'))
    fireEvent.click(checkbox('sessions'))

    // Toggling the diagnostic controls flips their state; thinking control stays on.
    expect(checkbox('chrome').checked).toBe(false)
    expect(checkbox('debug').checked).toBe(false)
    expect(checkbox('sessions').checked).toBe(true)
    expect(checkbox('thinking control').checked).toBe(true)
  })
})
