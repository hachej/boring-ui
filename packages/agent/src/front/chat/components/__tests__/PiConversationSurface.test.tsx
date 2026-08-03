// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
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
  test.each([
    'chat-error',
    'protocol-error',
    'session-navigation-error',
  ])('gives %s precedence over empty-chat hydration', (id) => {
    render(
      <PiConversationSurface
        chrome
        emptyHero={false}
        messages={[]}
        emptyStateHydrating
        suggestions={[]}
        isStreaming={false}
        showThoughts={false}
        toolRenderers={{}}
        runtimeNotices={[{ id, level: 'error', text: 'Request failed with 500' }]}
        onDismissNotice={() => {}}
        onScrollToBottomReady={() => {}}
        onSuggestionSubmit={async () => undefined}
        onRestoreDraft={() => {}}
      />,
    )

    expect(screen.getByRole('alert').textContent).toContain('Chat history unavailable')
    expect(screen.queryByText('Loading chat history…')).toBeNull()
    expect(document.querySelector('[data-boring-agent-part="empty-state"]')).toBeNull()
  })

  test('gives a known terminal error precedence over the empty hero', () => {
    render(
      <PiConversationSurface
        chrome
        emptyHero
        messages={[]}
        emptyStateHydrating={false}
        emptyState={{ title: 'Start a new conversation' }}
        suggestions={[]}
        isStreaming={false}
        showThoughts={false}
        toolRenderers={{}}
        runtimeNotices={[{ id: 'chat-error', level: 'error', text: 'History failed' }]}
        onDismissNotice={() => {}}
        onScrollToBottomReady={() => {}}
        onSuggestionSubmit={async () => undefined}
        onRestoreDraft={() => {}}
      />,
    )

    expect(screen.getByText('Chat history unavailable')).toBeTruthy()
    expect(screen.queryByText('Start a new conversation')).toBeNull()
    expect(document.querySelector('[data-boring-agent-part="empty-state"]')).toBeNull()
  })

  test('does not give a generic error terminal empty-chat precedence', () => {
    render(
      <PiConversationSurface
        chrome
        emptyHero
        messages={[]}
        emptyStateHydrating={false}
        emptyState={{ title: 'Start a new conversation' }}
        suggestions={[]}
        isStreaming={false}
        showThoughts={false}
        toolRenderers={{}}
        runtimeNotices={[{ id: 'generic-error', level: 'error', text: 'Generic failure' }]}
        onDismissNotice={() => {}}
        onScrollToBottomReady={() => {}}
        onSuggestionSubmit={async () => undefined}
        onRestoreDraft={() => {}}
      />,
    )

    expect(screen.getByText('Start a new conversation')).toBeTruthy()
    expect(screen.getByText('Generic failure')).toBeTruthy()
    expect(screen.queryByText('Chat history unavailable')).toBeNull()
  })

  test('suppresses only reconnect and warmup notices in a known terminal empty state', () => {
    render(
      <PiConversationSurface
        chrome
        emptyHero={false}
        messages={[]}
        emptyStateHydrating
        suggestions={[]}
        isStreaming={false}
        showThoughts={false}
        toolRenderers={{}}
        runtimeNotices={[
          { id: 'chat-error', level: 'error', text: 'History failed' },
          { id: 'connection-reconnecting', level: 'warning', text: 'Reconnecting…' },
          { id: 'runtime-warmup', level: 'warning', text: 'Starting runtime…' },
          { id: 'generic-warning', level: 'warning', text: 'Other warning remains' },
        ]}
        onDismissNotice={() => {}}
        onScrollToBottomReady={() => {}}
        onSuggestionSubmit={async () => undefined}
        onRestoreDraft={() => {}}
      />,
    )

    expect(screen.getByText('Chat history unavailable')).toBeTruthy()
    expect(screen.queryByText('Reconnecting…')).toBeNull()
    expect(screen.queryByText('Starting runtime…')).toBeNull()
    expect(screen.getByText('Other warning remains')).toBeTruthy()
  })

  test('keeps reconnect and warmup notices outside a terminal empty state', () => {
    render(
      <PiConversationSurface
        chrome
        emptyHero={false}
        messages={textMessages(1)}
        emptyStateHydrating={false}
        suggestions={[]}
        isStreaming={false}
        showThoughts={false}
        toolRenderers={{}}
        runtimeNotices={[
          { id: 'connection-reconnecting', level: 'warning', text: 'Reconnecting…' },
          { id: 'runtime-warmup', level: 'warning', text: 'Starting runtime…' },
        ]}
        onDismissNotice={() => {}}
        onScrollToBottomReady={() => {}}
        onSuggestionSubmit={async () => undefined}
        onRestoreDraft={() => {}}
      />,
    )

    expect(screen.getByText('Reconnecting…')).toBeTruthy()
    expect(screen.getByText('Starting runtime…')).toBeTruthy()
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
