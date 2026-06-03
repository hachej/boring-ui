// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { BoringChatMessage, QueuedUserMessage } from '../../../../shared/chat'
import { MessageTimeline } from '../MessageTimeline'

vi.mock('../../../primitives/conversation', () => ({
  Conversation: ({ children, onScrollToBottomReady, ...props }: any) => {
    onScrollToBottomReady?.(vi.fn())
    return <div role="log" {...props}>{children}</div>
  },
  ConversationContent: ({ children, ...props }: any) => <div data-testid="conversation-content" {...props}>{children}</div>,
  ConversationEmptyState: ({ title, description, ...props }: any) => <div {...props}><h3>{title}</h3><p>{description}</p></div>,
  ConversationScrollButton: () => <button type="button">Scroll to latest message</button>,
}))

vi.mock('../../../primitives/message', () => ({
  Message: ({ children, from, ...props }: any) => <article data-from={from} {...props}>{children}</article>,
  MessageContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  MessageResponse: ({ children }: any) => <div data-testid="message-response">{children}</div>,
}))

vi.mock('../../../primitives/reasoning', () => ({
  Reasoning: ({ children, isStreaming }: any) => <section data-testid="reasoning" data-streaming={String(isStreaming)}>{children}</section>,
  ReasoningTrigger: () => <button type="button">thoughts</button>,
  ReasoningContent: ({ children }: any) => <div>{children}</div>,
}))

vi.mock('../../../primitives/tool-call-group', () => ({
  ToolCallGroup: ({ tools }: any) => <div data-testid="tool-call-group">{tools.map(({ part }: any) => part.toolName).join(',')}</div>,
}))

vi.mock('../../../primitives/attachments', () => ({
  Attachments: ({ children }: any) => <div data-testid="attachments">{children}</div>,
  Attachment: ({ children, data }: any) => <div data-filename={data.filename}>{children}</div>,
  AttachmentPreview: () => <span>preview</span>,
  AttachmentInfo: () => <span>info</span>,
}))

function messages(): BoringChatMessage[] {
  return [
    {
      id: 'u1',
      role: 'user',
      status: 'done',
      parts: [
        { type: 'text', id: 'u1:text', text: 'Hello' },
        { type: 'file', id: 'file-1', filename: 'spec.md', mediaType: 'text/markdown', url: '/files/spec.md' },
      ],
    },
    {
      id: 'a1',
      role: 'assistant',
      status: 'streaming',
      parts: [
        { type: 'reasoning', id: 'r1', text: 'Think first', state: 'streaming' },
        { type: 'tool-call', id: 'tool-1', toolName: 'read', input: { path: 'README.md' }, state: 'input-available' },
        { type: 'tool-call', id: 'tool-2', toolName: 'grep', input: { pattern: 'TODO' }, state: 'output-available' },
        { type: 'text', id: 'a1:text', text: 'Done' },
      ],
    },
  ]
}

describe('MessageTimeline', () => {
  test('renders selected messagesForRender in part order with stable data attrs', () => {
    render(<MessageTimeline messages={messages()} />)

    const timeline = screen.getByRole('log', { name: 'Agent conversation' })
    expect(timeline.getAttribute('data-boring-agent-part')).toBe('message-timeline')
    expect(timeline.getAttribute('aria-live')).toBe('polite')

    const articles = screen.getAllByRole('article')
    expect(articles[0]?.getAttribute('data-from')).toBe('user')
    expect(articles[0]?.getAttribute('data-boring-agent-message-id')).toBe('u1')
    expect(articles[1]?.getAttribute('data-from')).toBe('assistant')
    expect(articles[1]?.getAttribute('data-boring-agent-message-status')).toBe('streaming')

    expect(screen.getByText('Hello')).toBeTruthy()
    expect(screen.getByText('Done')).toBeTruthy()
    expect(screen.getByTestId('reasoning').getAttribute('data-streaming')).toBe('true')
    expect(screen.getByTestId('tool-call-group').textContent).toBe('read,grep')
    expect(screen.getByTestId('attachments').querySelector('[data-filename="spec.md"]')).toBeTruthy()

    const assistantContent = within(articles[1]).getByText('Think first').closest('[data-boring-agent-part="message-reasoning"]')
    const tools = within(articles[1]).getByTestId('tool-call-group').closest('[data-boring-agent-part="message-tools"]')
    const finalText = within(articles[1]).getByText('Done').closest('[data-boring-agent-part="message-text"]')
    expect(Boolean(assistantContent && tools && finalText)).toBe(true)
    expect(assistantContent!.compareDocumentPosition(tools!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(tools!.compareDocumentPosition(finalText!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test('renders queue preview from queue selector output, not as transcript messages', () => {
    const queuePreview: QueuedUserMessage[] = [
      { id: 'q1', kind: 'followup', displayText: 'then run tests', clientSeq: 1 },
      { id: 'q2', kind: 'followup', displayText: 'then summarize', clientSeq: 2 },
    ]

    render(<MessageTimeline messages={messages()} queuePreview={queuePreview} />)

    const preview = screen.getByText('Queued follow-ups').closest('[data-boring-agent-part="queue-preview"]')
    expect(preview).toBeTruthy()
    expect(within(preview as HTMLElement).getByText('then run tests')).toBeTruthy()
    expect(within(preview as HTMLElement).getByText('then summarize')).toBeTruthy()
    expect(screen.getAllByRole('article')).toHaveLength(2)
  })

  test('renders empty state without requiring browser transcript cache', () => {
    render(<MessageTimeline messages={[]} emptyState={{ title: 'Start fresh', description: 'Hydrated from /state.' }} />)

    expect(screen.getByText('Start fresh')).toBeTruthy()
    expect(screen.getByText('Hydrated from /state.')).toBeTruthy()
    expect(screen.getByText('Start fresh').closest('[data-boring-agent-part="chat-empty-state"]')).toBeTruthy()
  })
})
