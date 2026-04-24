import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ToolPart } from '../../front/toolRenderers'

const mockUseAgentChat = vi.fn()
const mockSendMessage = vi.fn()
const mockSetMessages = vi.fn()

vi.mock('../../front/hooks/useAgentChat', () => ({
  useAgentChat: (opts: unknown) => mockUseAgentChat(opts),
}))

vi.mock('../primitives/conversation', () => ({
  Conversation: ({ children, ...rest }: any) => <div data-testid="conversation" role="log" {...rest}>{children}</div>,
  ConversationContent: ({ children }: any) => <div data-testid="conversation-content">{children}</div>,
  ConversationEmptyState: ({ title, description }: any) => (
    <div data-testid="empty-state" data-title={title}>{description}</div>
  ),
  ConversationScrollButton: () => <div data-testid="scroll-button" />,
}))

vi.mock('../primitives/message', () => ({
  Message: ({ children, from }: any) => <div data-testid="message" data-from={from}>{children}</div>,
  MessageContent: ({ children }: any) => <div data-testid="message-content">{children}</div>,
  MessageResponse: ({ children }: any) => <div data-testid="message-response">{children}</div>,
}))

vi.mock('../primitives/reasoning', () => ({
  Reasoning: ({ children }: any) => <div data-testid="reasoning">{children}</div>,
  ReasoningTrigger: () => <div data-testid="reasoning-trigger" />,
  ReasoningContent: ({ children }: any) => <div data-testid="reasoning-content">{children}</div>,
}))

vi.mock('../primitives/attachments', () => ({
  Attachments: ({ children }: any) => <div data-testid="attachments">{children}</div>,
  Attachment: ({ children }: any) => <div>{children}</div>,
  AttachmentPreview: () => <div />,
  AttachmentInfo: () => <div />,
  AttachmentRemove: () => <div />,
}))

vi.mock('../ui/select', () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => <div data-value={value}>{children}</div>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => <div />,
}))

let capturedOnSubmit: ((input: { text: string; files: unknown[] }) => void) | undefined

vi.mock('../primitives/prompt-input', () => ({
  PromptInput: ({ children, onSubmit }: any) => {
    capturedOnSubmit = onSubmit
    return <div data-testid="prompt-input">{children}</div>
  },
  PromptInputTextarea: () => <div data-testid="prompt-textarea" />,
  PromptInputFooter: ({ children }: any) => <div data-testid="prompt-footer">{children}</div>,
  PromptInputSubmit: ({ status }: any) => <div data-testid="prompt-submit" data-status={status} />,
  usePromptInputAttachments: () => ({
    files: [],
    openFileDialog: vi.fn(),
    remove: vi.fn(),
  }),
}))

import { ChatPanel } from '../ChatPanel'

beforeEach(() => {
  capturedOnSubmit = undefined
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

describe('ChatPanel (shadcn)', () => {
  test('renders data-boring-chat attribute on root', () => {
    const html = renderToStaticMarkup(<ChatPanel sessionId="sess-1" />)
    expect(html).toMatch(/data-boring-chat(?:=| |>|\/>)/)
    expect(html).toContain('role="region"')
    expect(html).toContain('aria-label="Agent assistant"')
    expect(html).toContain('data-testid="conversation"')
    expect(html).toContain('role="log"')
    expect(html).toContain('aria-label="Agent conversation"')
    expect(html).toContain('aria-live="polite"')
  })

  test('renders empty state when no messages', () => {
    const html = renderToStaticMarkup(<ChatPanel sessionId="sess-empty" />)
    expect(html).toContain('data-testid="empty-state"')
    expect(html).toContain('How can I help?')
  })

  test('renders user and assistant messages', () => {
    mockUseAgentChat.mockReturnValue({
      messages: [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
        { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'Hi there' }] },
      ],
      sendMessage: mockSendMessage,
      status: 'ready',
      error: undefined,
    })

    const html = renderToStaticMarkup(<ChatPanel sessionId="sess-msgs" />)

    expect(html).toContain('data-from="user"')
    expect(html).toContain('data-from="assistant"')
    expect(html).toContain('Hello')
    expect(html).toContain('Hi there')
  })

  test('renders reasoning parts', () => {
    mockUseAgentChat.mockReturnValue({
      messages: [
        {
          id: 'a1',
          role: 'assistant',
          parts: [
            { type: 'reasoning', text: 'thinking hard', state: 'done' },
            { type: 'text', text: 'The answer is 42' },
          ],
        },
      ],
      sendMessage: mockSendMessage,
      status: 'ready',
      error: undefined,
    })

    const html = renderToStaticMarkup(<ChatPanel sessionId="sess-reasoning" />)

    expect(html).toContain('data-testid="reasoning"')
    expect(html).toContain('thinking hard')
    expect(html).toContain('The answer is 42')
  })

  test('renders tool call with default renderer', () => {
    mockUseAgentChat.mockReturnValue({
      messages: [
        {
          id: 'a1',
          role: 'assistant',
          parts: [
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

    const html = renderToStaticMarkup(<ChatPanel sessionId="sess-tool" />)

    expect(html).toContain('bash · ls')
  })

  test('custom toolRenderers override default renderer', () => {
    const customRenderer = vi.fn((part: ToolPart) => (
      <div data-testid="custom-tool">custom:{part.toolCallId}</div>
    ))

    mockUseAgentChat.mockReturnValue({
      messages: [
        {
          id: 'a1',
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
      <ChatPanel sessionId="sess-custom" toolRenderers={{ bash: customRenderer }} />,
    )

    expect(customRenderer).toHaveBeenCalledTimes(1)
    expect(html).toContain('custom:call-custom')
  })

  test('renders error message', () => {
    mockUseAgentChat.mockReturnValue({
      messages: [],
      sendMessage: mockSendMessage,
      status: 'error',
      error: new Error('Something went wrong'),
    })

    const html = renderToStaticMarkup(<ChatPanel sessionId="sess-err" />)

    expect(html).toContain('Something went wrong')
    expect(html).toContain('role="alert"')
  })

  test('sends message through useAgentChat', async () => {
    renderToStaticMarkup(<ChatPanel sessionId="sess-send" />)

    expect(capturedOnSubmit).toBeDefined()
    await capturedOnSubmit!({ text: 'Run tests', files: [] })

    expect(mockSendMessage).toHaveBeenCalledWith(
      { text: 'Run tests', files: [] },
      {
        body: {
          sessionId: 'sess-send',
          message: 'Run tests',
          model: { provider: 'anthropic', id: 'sonnet' },
          attachments: [],
        },
      },
    )
  })

  test('slash command is intercepted and does not send to AI', async () => {
    renderToStaticMarkup(<ChatPanel sessionId="sess-cmd" />)

    await capturedOnSubmit!({ text: '/cost', files: [] })

    expect(mockSendMessage).not.toHaveBeenCalled()
    expect(mockSetMessages).toHaveBeenCalled()
  })

  test('/clear calls setMessages with empty array', async () => {
    renderToStaticMarkup(<ChatPanel sessionId="sess-clear" />)

    await capturedOnSubmit!({ text: '/clear', files: [] })

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

    await capturedOnSubmit!({ text: '/reset', files: [] })

    expect(mockSendMessage).not.toHaveBeenCalled()
    expect(mockSetMessages).toHaveBeenCalledWith([])
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/agent/sessions/sess-reset',
      { method: 'DELETE' },
    )
    expect(onSessionReset).toHaveBeenCalledOnce()
  })

  test('unknown slash command falls through as regular message', async () => {
    renderToStaticMarkup(<ChatPanel sessionId="sess-unk" />)

    await capturedOnSubmit!({ text: '/unknown hello', files: [] })

    expect(mockSendMessage).toHaveBeenCalledWith(
      { text: '/unknown hello', files: [] },
      {
        body: {
          sessionId: 'sess-unk',
          message: '/unknown hello',
          model: { provider: 'anthropic', id: 'sonnet' },
          attachments: [],
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

    await capturedOnSubmit!({ text: '/greet world', files: [] })

    expect(mockSendMessage).not.toHaveBeenCalled()
    expect(customHandler).toHaveBeenCalledWith('world', expect.objectContaining({ sessionId: 'sess-ext' }))
  })

  test('className prop is forwarded to root element', () => {
    const html = renderToStaticMarkup(<ChatPanel sessionId="sess-cls" className="custom-class" />)
    expect(html).toContain('custom-class')
  })

  test('passes sessionId to useAgentChat', () => {
    renderToStaticMarkup(<ChatPanel sessionId="test-session-42" />)
    expect(mockUseAgentChat).toHaveBeenCalledWith({ sessionId: 'test-session-42' })
  })

  test('prompt submit status reflects streaming state', () => {
    mockUseAgentChat.mockReturnValue({
      messages: [],
      sendMessage: mockSendMessage,
      setMessages: mockSetMessages,
      status: 'streaming',
      error: undefined,
    })

    const html = renderToStaticMarkup(<ChatPanel sessionId="sess-stream" />)
    expect(html).toContain('data-status="streaming"')
  })
})
