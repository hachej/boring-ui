import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ComposerProps } from '../components/Composer'

const mockUseAgentChat = vi.fn()
const mockSendMessage = vi.fn()
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
  mockUseAgentChat.mockReset()
  mockUseAgentChat.mockReturnValue({
    messages: [],
    sendMessage: mockSendMessage,
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
})
