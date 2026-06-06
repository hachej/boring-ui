// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { BoringChatMessage } from '../../../../shared/chat'
import { PiConversationSurface } from '../PiConversationSurface'

vi.mock('../../../primitives/conversation', () => ({
  Conversation: ({ children, onScrollToBottomReady, ...props }: any) => {
    onScrollToBottomReady?.(vi.fn())
    return <section {...props}>{children}</section>
  },
  ConversationContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  ConversationScrollButton: () => <button type="button">Scroll to latest message</button>,
}))

vi.mock('../PiTimelineMessage', () => ({
  PiTimelineMessage: ({ message }: { message: BoringChatMessage }) => (
    <article
      data-testid="timeline-message"
      data-boring-agent-message-id={message.id}
      data-boring-agent-message-role={message.role}
    />
  ),
}))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PiConversationSurface', () => {
  test('keeps assistant render keys unique when same-turn rows pass through', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const messages: BoringChatMessage[] = [
      {
        id: 'a3',
        role: 'assistant',
        status: 'done',
        turnId: 'turn-3',
        parts: [{ type: 'reasoning', id: 'a3:reasoning', text: 'thoughts' }],
      },
      {
        id: 'a3-live',
        role: 'assistant',
        status: 'streaming',
        turnId: 'turn-3',
        parts: [{ type: 'text', id: 'a3-live:text', text: 'final answer' }],
      },
    ]

    render(
      <PiConversationSurface
        chrome
        emptyHero={false}
        messages={messages}
        emptyStateHydrating={false}
        suggestions={[]}
        isStreaming
        showThoughts={false}
        toolRenderers={{}}
        runtimeNotices={[]}
        onDismissNotice={() => {}}
        onScrollToBottomReady={() => {}}
        onSuggestionSubmit={async () => undefined}
        onRestoreDraft={() => {}}
      />,
    )

    expect(screen.getAllByTestId('timeline-message')).toHaveLength(2)
    expect(consoleError.mock.calls.some((call) => call.join(' ').includes('same key'))).toBe(false)
  })

  test('keeps the same assistant turn row mounted when the message id changes', () => {
    const initialMessages: BoringChatMessage[] = [
      {
        id: 'a-tool',
        role: 'assistant',
        status: 'aborted',
        turnId: 'turn-aborted-tool',
        parts: [{ type: 'tool-call', id: 'call-aborted', toolName: 'bash', state: 'aborted' }],
      },
    ]
    const finalMessages: BoringChatMessage[] = [
      {
        id: 'a-final',
        role: 'assistant',
        status: 'aborted',
        turnId: 'turn-aborted-tool',
        parts: [
          { type: 'tool-call', id: 'call-aborted', toolName: 'bash', state: 'aborted' },
          { type: 'text', id: 'late-final:text', text: 'LATE_FINAL_AFTER_ABORT' },
        ],
      },
    ]

    const { rerender } = render(
      <PiConversationSurface
        chrome
        emptyHero={false}
        messages={initialMessages}
        emptyStateHydrating={false}
        suggestions={[]}
        isStreaming={false}
        showThoughts={false}
        toolRenderers={{}}
        runtimeNotices={[]}
        onDismissNotice={() => {}}
        onScrollToBottomReady={() => {}}
        onSuggestionSubmit={async () => undefined}
        onRestoreDraft={() => {}}
      />,
    )
    const row = screen.getByTestId('timeline-message')
    row.setAttribute('data-row-marker', 'late-final-live-row-marker')

    rerender(
      <PiConversationSurface
        chrome
        emptyHero={false}
        messages={finalMessages}
        emptyStateHydrating={false}
        suggestions={[]}
        isStreaming={false}
        showThoughts={false}
        toolRenderers={{}}
        runtimeNotices={[]}
        onDismissNotice={() => {}}
        onScrollToBottomReady={() => {}}
        onSuggestionSubmit={async () => undefined}
        onRestoreDraft={() => {}}
      />,
    )

    const updatedRow = screen.getByTestId('timeline-message')
    expect(updatedRow.getAttribute('data-boring-agent-message-id')).toBe('a-final')
    expect(updatedRow.getAttribute('data-row-marker')).toBe('late-final-live-row-marker')
  })
})
