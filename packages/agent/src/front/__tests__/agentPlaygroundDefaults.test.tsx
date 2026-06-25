// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import type { ChatPanelProps } from '@hachej/boring-agent/front'

const mocks = vi.hoisted(() => ({
  chatPanelProps: [] as Array<Record<string, unknown>>,
}))

function MockChatPanel(props: ChatPanelProps) {
  mocks.chatPanelProps.push(props as Record<string, unknown>)
  return (
    <div
      data-testid="mock-chat-panel"
      data-chrome={String(props.chrome)}
      data-debug={String(props.debug)}
      data-show-sessions={String(props.showSessions)}
      data-thinking-control={String(props.thinkingControl)}
      data-storage-scope={String(props.storageScope)}
    />
  )
}

vi.mock('@hachej/boring-agent/shared', () => ({
  WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT: 'boring-agent:plugins-reloaded',
}))

vi.mock('../../../../../apps/agent-playground/src/Showcase', () => ({
  Showcase: () => <div data-testid="mock-showcase" />,
}))

type PlaygroundApp = typeof import('../../../../../apps/agent-playground/src/front/App')['App']

async function loadApp(): Promise<PlaygroundApp> {
  vi.resetModules()
  return (await import('../../../../../apps/agent-playground/src/front/App')).App
}

beforeAll(() => {
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver =
    class { observe() {}; unobserve() {}; disconnect() {} }
})

describe('agent playground defaults', () => {
  afterEach(() => {
    cleanup()
    mocks.chatPanelProps.length = 0
    window.localStorage.clear()
    window.history.replaceState(null, '', '/')
    document.documentElement.className = ''
  })

  test('opens in the workspace-like composer surface by default', async () => {
    const App = await loadApp()
    window.localStorage.setItem('agent-playground:theme', 'dark')

    render(<App ChatPanelComponent={MockChatPanel} />)

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

  test('keeps diagnostic chrome controls available without changing the default', async () => {
    const App = await loadApp()
    render(<App ChatPanelComponent={MockChatPanel} />)

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
