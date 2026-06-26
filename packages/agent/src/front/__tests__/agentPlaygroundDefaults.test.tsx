// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  chatPanelProps: [] as Array<Record<string, unknown>>,
}))

vi.mock('@hachej/boring-agent/front', async () => {
  const React = await import('react')
  return {
    ChatPanel: (props: Record<string, unknown>) => {
      mocks.chatPanelProps.push(props)
      return React.createElement('div', {
        'data-testid': 'mock-chat-panel',
        'data-chrome': String(props.chrome),
        'data-debug': String(props.debug),
        'data-show-sessions': String(props.showSessions),
        'data-thinking-control': String(props.thinkingControl),
        'data-storage-scope': String(props.storageScope),
      })
    },
  }
})

vi.mock('@hachej/boring-agent/shared', () => ({
  WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT: 'boring-agent:plugins-reloaded',
}))

vi.mock('../../../../../apps/agent-playground/src/Showcase', () => ({
  Showcase: () => <div data-testid="mock-showcase" />,
}))

import { App } from '../../../../../apps/agent-playground/src/front/App'

describe('agent playground defaults', () => {
  afterEach(() => {
    cleanup()
    mocks.chatPanelProps.length = 0
    window.localStorage.clear()
    window.history.replaceState(null, '', '/')
    document.documentElement.className = ''
  })

  test('opens in the workspace-like composer surface by default', () => {
    window.localStorage.setItem('agent-playground:theme', 'dark')

    render(<App />)

    const panel = screen.getByTestId('mock-chat-panel')
    expect(panel.getAttribute('data-chrome')).toBe('true')
    expect(panel.getAttribute('data-debug')).toBe('true')
    expect(panel.getAttribute('data-show-sessions')).toBe('false')
    expect(panel.getAttribute('data-thinking-control')).toBe('true')
    expect(panel.getAttribute('data-storage-scope')).toBe('agent-playground')

    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(window.localStorage.getItem('agent-playground:theme:v2')).toBe('light')
    expect(window.localStorage.getItem('agent-playground:theme')).toBe('dark')

    expect((screen.getByLabelText('chrome') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('debug') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('sessions') as HTMLInputElement).checked).toBe(false)
    expect((screen.getByLabelText('thinking control') as HTMLInputElement).checked).toBe(true)
  })

  test('keeps diagnostic chrome controls available without changing the default', () => {
    render(<App />)

    fireEvent.click(screen.getByLabelText('chrome'))
    fireEvent.click(screen.getByLabelText('debug'))
    fireEvent.click(screen.getByLabelText('sessions'))

    const latestProps = mocks.chatPanelProps.at(-1)
    expect(latestProps).toMatchObject({
      chrome: false,
      debug: false,
      showSessions: true,
      thinkingControl: true,
    })
  })
})
