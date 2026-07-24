// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
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

// The Conversation provider is mocked above, so the history loader's
// stick-to-bottom context needs a stub (no real scroll element in jsdom).
vi.mock('use-stick-to-bottom', () => ({
  useStickToBottomContext: () => ({ scrollRef: { current: null } }),
}))

function textMessages(count: number): BoringChatMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `m${i}`,
    role: i % 2 === 0 ? 'user' : 'assistant',
    status: 'done',
    parts: [{ type: 'text', id: `m${i}:t`, text: `msg ${i}` }],
  }))
}

function renderSurface(messages: BoringChatMessage[], windowResetKey?: string) {
  return (
    <PiConversationSurface
      chrome
      emptyHero={false}
      messages={messages}
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
      windowResetKey={windowResetKey}
    />
  )
}

vi.mock('../PiTimelineMessage', () => ({
  PiTimelineMessage: ({ message, footer }: { message: BoringChatMessage; footer?: ReactNode }) => (
    <article
      data-testid="timeline-message"
      data-boring-agent-message-id={message.id}
      data-boring-agent-message-role={message.role}
    >{footer}</article>
  ),
}))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PiConversationSurface', () => {
  test('computes message footer projections once per transcript render', () => {
    const messages = textMessages(60)
    const projection = vi.fn((items: readonly { key: string }[]) => new Map([[items.at(-1)!.key, <span>Projected footer</span>]]))
    render(
      <PiConversationSurface
        chrome emptyHero={false} messages={messages} emptyStateHydrating={false}
        suggestions={[]} isStreaming={false} showThoughts={false} toolRenderers={{}}
        messageFooterProjection={projection} runtimeNotices={[]} onDismissNotice={() => {}}
        onScrollToBottomReady={() => {}} onSuggestionSubmit={async () => undefined} onRestoreDraft={() => {}}
      />,
    )
    expect(projection).toHaveBeenCalledTimes(1)
    expect(screen.getByText("Projected footer")).toBeTruthy()
  })

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

  test('windows the transcript to the latest page and reveals older on demand', () => {
    render(renderSurface(textMessages(100)))

    // Only the latest window mounts, anchored to the newest message.
    let ids = screen.getAllByTestId('timeline-message').map((el) => el.getAttribute('data-boring-agent-message-id'))
    expect(ids).toHaveLength(60)
    expect(ids[0]).toBe('m40')
    expect(ids).toContain('m99')
    expect(ids).not.toContain('m0')

    // Revealing older expands the window upward.
    fireEvent.click(screen.getByRole('button', { name: /Load 40 older messages/ }))
    ids = screen.getAllByTestId('timeline-message').map((el) => el.getAttribute('data-boring-agent-message-id'))
    expect(ids).toHaveLength(100)
    expect(ids[0]).toBe('m0')
    expect(screen.queryByRole('button', { name: /older message/ })).toBeNull()
  })

  test('renders short transcripts in full with no load-older affordance', () => {
    render(renderSurface(textMessages(12)))
    expect(screen.getAllByTestId('timeline-message')).toHaveLength(12)
    expect(screen.queryByRole('button', { name: /older message/ })).toBeNull()
  })

  test('resets the window to the latest page when the active session changes', () => {
    const { rerender } = render(renderSurface(textMessages(100), 'session-a'))
    fireEvent.click(screen.getByRole('button', { name: /Load 40 older messages/ }))
    expect(screen.getAllByTestId('timeline-message')).toHaveLength(100)

    // Switching sessions snaps back to the latest window.
    rerender(renderSurface(textMessages(100), 'session-b'))
    expect(screen.getAllByTestId('timeline-message')).toHaveLength(60)
  })
})
