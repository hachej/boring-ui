import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ComposerProps } from '../components/Composer'
import type { ToolPart } from '../toolRenderers'

const mockUseAgentChat = vi.fn()
const mockSendMessage = vi.fn()
const mockSetMessages = vi.fn()
let capturedComposerProps: ComposerProps | undefined

vi.mock('../hooks/useAgentChat', () => ({
  useAgentChat: (opts: unknown) => mockUseAgentChat(opts),
}))

vi.mock('../components/Composer', () => ({
  Composer: (props: ComposerProps) => {
    capturedComposerProps = props
    return null
  },
}))

import { ChatPanel } from '../ChatPanel'

beforeEach(() => {
  capturedComposerProps = undefined
  mockSendMessage.mockReset()
  mockSetMessages.mockReset()
  mockUseAgentChat.mockReset()
  mockUseAgentChat.mockReturnValue({
    messages: [],
    sendMessage: mockSendMessage,
    setMessages: mockSetMessages,
    status: 'ready',
    error: undefined,
  })
})

describe('ChatPanel', () => {
  test('renders message rows and raw tool calls as pre JSON', () => {
    mockUseAgentChat.mockReturnValue({
      messages: [
        {
          id: 'm-user',
          role: 'user',
          parts: [{ type: 'text', text: 'Hello from user' }],
        },
        {
          id: 'm-assistant',
          role: 'assistant',
          parts: [
            { type: 'text', text: 'Hello from assistant' },
            {
              type: 'tool-bash',
              toolCallId: 'call-1',
              state: 'output-available',
              input: { command: 'ls' },
              output: { text: 'file.txt' },
            },
          ],
        },
      ],
      sendMessage: mockSendMessage,
      status: 'ready',
      error: undefined,
    })

    const html = renderToStaticMarkup(<ChatPanel sessionId="sess-1" />)

    expect(html).toContain('Hello from user')
    expect(html).toContain('Hello from assistant')
    expect(html).toContain('data-tool-state')
    expect(html).toContain('bash')
  })

  test('typing in composer send path forwards user message to useAgentChat', async () => {
    renderToStaticMarkup(<ChatPanel sessionId="sess-42" />)

    expect(capturedComposerProps).toBeDefined()
    await capturedComposerProps!.onSend({
      message: 'Run tests',
      model: { provider: 'anthropic', id: 'opus' },
      thinkingLevel: 'high',
    })

    expect(mockSendMessage).toHaveBeenCalledWith(
      { text: 'Run tests' },
      {
        body: {
          sessionId: 'sess-42',
          message: 'Run tests',
          model: { provider: 'anthropic', id: 'opus' },
          thinkingLevel: 'high',
        },
      },
    )
  })

  test('marks composer as streaming while chat is in-flight', () => {
    mockUseAgentChat.mockReturnValue({
      messages: [],
      sendMessage: mockSendMessage,
      status: 'streaming',
      error: undefined,
    })

    renderToStaticMarkup(<ChatPanel sessionId="sess-1" />)

    expect(capturedComposerProps?.isStreaming).toBe(true)
  })

  test('toolRenderers override replaces default renderer for matching tool name', () => {
    const customBashRenderer = vi.fn((part: ToolPart) => (
      <div data-testid="custom-bash">custom:{part.toolCallId}</div>
    ))

    mockUseAgentChat.mockReturnValue({
      messages: [
        {
          id: 'm-assistant',
          role: 'assistant',
          parts: [
            {
              type: 'tool-bash',
              toolCallId: 'call-custom',
              state: 'output-available',
              input: { command: 'ls' },
              output: { stdout: 'ok' },
            },
          ],
        },
      ],
      sendMessage: mockSendMessage,
      status: 'ready',
      error: undefined,
    })

    const html = renderToStaticMarkup(
      <ChatPanel
        sessionId="sess-custom"
        toolRenderers={{ bash: customBashRenderer }}
      />,
    )

    expect(customBashRenderer).toHaveBeenCalledTimes(1)
    expect(html).toContain('custom:call-custom')
  })

  test('non-overridden tool still uses default/fallback renderer', () => {
    const customBashRenderer = vi.fn((part: ToolPart) => (
      <div data-testid="custom-bash">custom:{part.toolCallId}</div>
    ))

    mockUseAgentChat.mockReturnValue({
      messages: [
        {
          id: 'm-assistant',
          role: 'assistant',
          parts: [
            {
              type: 'tool-plugin_magic',
              toolCallId: 'call-plugin',
              state: 'output-available',
              input: { x: 1 },
              output: { y: 2 },
            },
          ],
        },
      ],
      sendMessage: mockSendMessage,
      setMessages: mockSetMessages,
      status: 'ready',
      error: undefined,
    })

    const html = renderToStaticMarkup(
      <ChatPanel
        sessionId="sess-plugin"
        toolRenderers={{ bash: customBashRenderer }}
      />,
    )

    expect(customBashRenderer).not.toHaveBeenCalled()
    expect(html).toContain('plugin_magic')
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('&quot;x&quot;')
    expect(html).toContain('&quot;y&quot;')
  })

  test('slash command is intercepted and does not send to AI', async () => {
    renderToStaticMarkup(<ChatPanel sessionId="sess-cmd" />)

    await capturedComposerProps!.onSend({
      message: '/cost',
      model: { provider: 'anthropic', id: 'sonnet' },
      thinkingLevel: 'off',
    })

    expect(mockSendMessage).not.toHaveBeenCalled()
    expect(mockSetMessages).toHaveBeenCalled()
  })

  test('slash command result message is appended via setMessages', async () => {
    renderToStaticMarkup(<ChatPanel sessionId="sess-cmd" />)

    await capturedComposerProps!.onSend({
      message: '/cost',
      model: { provider: 'anthropic', id: 'sonnet' },
      thinkingLevel: 'off',
    })

    const updater = mockSetMessages.mock.calls[0][0]
    expect(typeof updater).toBe('function')
    const result = updater([])
    expect(result).toHaveLength(1)
    expect(result[0].role).toBe('assistant')
    expect(result[0].content).toBe('Coming soon.')
  })

  test('unknown slash command falls through as regular message', async () => {
    renderToStaticMarkup(<ChatPanel sessionId="sess-cmd" />)

    await capturedComposerProps!.onSend({
      message: '/unknown hello',
      model: { provider: 'anthropic', id: 'sonnet' },
      thinkingLevel: 'off',
    })

    expect(mockSendMessage).toHaveBeenCalledWith(
      { text: '/unknown hello' },
      {
        body: {
          sessionId: 'sess-cmd',
          message: '/unknown hello',
          model: { provider: 'anthropic', id: 'sonnet' },
          thinkingLevel: 'off',
        },
      },
    )
  })

  test('extraCommands are available as slash commands', async () => {
    const customHandler = vi.fn().mockReturnValue('custom result')
    renderToStaticMarkup(
      <ChatPanel
        sessionId="sess-ext"
        extraCommands={[
          { name: 'greet', description: 'Say hello', handler: customHandler },
        ]}
      />,
    )

    await capturedComposerProps!.onSend({
      message: '/greet world',
      model: { provider: 'anthropic', id: 'sonnet' },
      thinkingLevel: 'off',
    })

    expect(mockSendMessage).not.toHaveBeenCalled()
    expect(customHandler).toHaveBeenCalledWith('world', expect.objectContaining({ sessionId: 'sess-ext' }))
  })

  test('/clear calls setMessages with empty array', async () => {
    renderToStaticMarkup(<ChatPanel sessionId="sess-clear" />)

    await capturedComposerProps!.onSend({
      message: '/clear',
      model: { provider: 'anthropic', id: 'sonnet' },
      thinkingLevel: 'off',
    })

    expect(mockSendMessage).not.toHaveBeenCalled()
    expect(mockSetMessages).toHaveBeenCalledWith([])
  })

  test('/reset deletes server session and calls onSessionReset', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
    const mockFetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', mockFetch)
    const onSessionReset = vi.fn()

    renderToStaticMarkup(
      <ChatPanel sessionId="sess-reset" onSessionReset={onSessionReset} />,
    )

    await capturedComposerProps!.onSend({
      message: '/reset',
      model: { provider: 'anthropic', id: 'sonnet' },
      thinkingLevel: 'off',
    })

    expect(mockSendMessage).not.toHaveBeenCalled()
    expect(mockSetMessages).toHaveBeenCalledWith([])
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/agent/sessions/sess-reset',
      { method: 'DELETE' },
    )
    expect(onSessionReset).toHaveBeenCalledOnce()
  })
})
