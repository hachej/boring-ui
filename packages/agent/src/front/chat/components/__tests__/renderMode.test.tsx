// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { BoringChatMessage } from '../../../../shared/chat'
import { PiTimelineMessage } from '../PiTimelineMessage'
import { PiConversationSurface } from '../PiConversationSurface'

vi.mock('../../../primitives/message', () => ({
  Message: ({ children, from, ...props }: any) => <article data-from={from} {...props}>{children}</article>,
  MessageContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  MessageResponse: ({ children }: any) => <div data-testid="message-response">{children}</div>,
}))

vi.mock('../../../primitives/reasoning', () => ({
  Reasoning: ({ children }: any) => <section data-testid="reasoning">{children}</section>,
  ReasoningTrigger: () => <button type="button">thoughts</button>,
  ReasoningContent: ({ children }: any) => <div data-testid="reasoning-content">{children}</div>,
}))

vi.mock('../../../primitives/tool-call-group', () => ({
  ToolCallGroup: ({ tools }: any) => (
    <div data-testid="tool-call-group">{tools.map(({ part }: any) => part.toolName).join(',')}</div>
  ),
}))

vi.mock('../../../primitives/conversation', () => ({
  Conversation: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  ConversationContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  ConversationScrollButton: () => null,
}))

vi.mock('use-stick-to-bottom', () => ({
  useStickToBottomContext: () => ({ scrollRef: { current: null } }),
}))

/** One assistant turn with the full machinery: reasoning, a read-only tool, an action tool, text. */
const noisyTurn: BoringChatMessage = {
  id: 'assistant-1',
  role: 'assistant',
  parts: [
    { type: 'reasoning', id: 'reason-1', text: 'Let me look at the client list first.', state: 'done' },
    { type: 'tool-call', id: 'call-read', toolName: 'read', state: 'output-available', input: { path: 'src/App.tsx' } },
    { type: 'tool-call', id: 'call-edit', toolName: 'edit', state: 'output-available', input: { path: 'src/App.tsx' } },
    { type: 'text', text: 'Done — your client list now shows the last contact date.' },
  ],
}

function renderMessage(renderMode?: 'full' | 'messages-only') {
  return render(
        <PiTimelineMessage
          message={noisyTurn}
          isLast
          isStreaming={false}
          showThoughts
          toolRenderers={{}}
          {...(renderMode ? { renderMode } : {})}
        />
  )
}

describe('PiTimelineMessage renderMode', () => {
  test('defaults to full: reasoning and tool parts are rendered', () => {
    renderMessage()
    expect(screen.getByTestId('reasoning')).toBeTruthy()
    expect(screen.getByTestId('tool-call-group')).toBeTruthy()
    expect(document.querySelectorAll('[data-boring-agent-part="message-tools"]').length).toBeGreaterThan(0)
    expect(screen.getByTestId('message-response').textContent).toContain('Done — your client list')
  })

  test('messages-only keeps the text and drops reasoning and every tool part', () => {
    renderMessage('messages-only')
    expect(screen.queryByTestId('reasoning')).toBeNull()
    expect(screen.queryByTestId('tool-call-group')).toBeNull()
    expect(document.querySelector('[data-boring-agent-part="message-tools"]')).toBeNull()
    expect(screen.getByTestId('message-response').textContent).toContain('Done — your client list')
  })
})

function renderSurface(renderMode: 'full' | 'messages-only', isStreaming: boolean) {
  return render(
        <PiConversationSurface
          chrome={false}
          emptyHero={false}
          messages={[noisyTurn]}
          emptyStateHydrating={false}
          suggestions={[]}
          isStreaming={isStreaming}
          showThoughts
          toolRenderers={{}}
          runtimeNotices={[]}
          onDismissNotice={() => {}}
          onScrollToBottomReady={() => {}}
          onSuggestionSubmit={async () => undefined}
          onRestoreDraft={() => {}}
          renderMode={renderMode}
        />
  )
}

describe('PiConversationSurface messages-only status line', () => {
  test('hides host control prompts by prefix without hiding ordinary user messages', () => {
    const messages: BoringChatMessage[] = [
      { id: 'user-system', role: 'user', parts: [{ type: 'text', text: '[system event] builder done' }] },
      { id: 'user-person', role: 'user', parts: [{ type: 'text', text: 'show me' }] },
      noisyTurn,
    ]
    render(
      <PiConversationSurface
        chrome={false}
        emptyHero={false}
        messages={messages}
        emptyStateHydrating={false}
        suggestions={[]}
        isStreaming={false}
        showThoughts
        toolRenderers={{}}
        runtimeNotices={[]}
        onDismissNotice={() => {}}
        onScrollToBottomReady={() => {}}
        onSuggestionSubmit={async () => undefined}
        onRestoreDraft={() => {}}
        renderMode="messages-only"
        messagesOnlyHiddenUserPrefixes={['[system event]']}
      />,
    )

    expect(screen.queryByText('[system event] builder done')).toBeNull()
    expect(screen.getByText('show me')).toBeTruthy()
    expect(screen.getByText('Done — your client list now shows the last contact date.')).toBeTruthy()
  })

  test('shows one quiet working line while a turn streams', () => {
    renderSurface('messages-only', true)
    const working = document.querySelectorAll('[data-boring-agent-part="messages-only-working"]')
    expect(working.length).toBe(1)
    expect(working[0]?.textContent).toContain('Working on it')
  })

  test('hides the working line once the turn settles', () => {
    renderSurface('messages-only', false)
    expect(document.querySelector('[data-boring-agent-part="messages-only-working"]')).toBeNull()
  })

  test('never shows it in full mode', () => {
    renderSurface('full', true)
    expect(document.querySelector('[data-boring-agent-part="messages-only-working"]')).toBeNull()
    expect(screen.getByTestId('tool-call-group')).toBeTruthy()
  })
})

describe('messages-only, one tool opted back in', () => {
  const askTurn: BoringChatMessage = {
    id: 'assistant-2',
    role: 'assistant',
    parts: [
      { type: 'tool-call', id: 'call-read', toolName: 'read', state: 'output-available', input: {} },
      { type: 'tool-call', id: 'call-ask', toolName: 'ask_user', state: 'input-available', input: { title: 'Which one?' } },
      { type: 'text', text: 'Pick one and I will continue.' },
    ],
  }

  const renderAsk = (visible?: readonly string[]) =>
    render(
      <PiTimelineMessage
        message={askTurn}
        isLast
        isStreaming={false}
        showThoughts
        renderMode="messages-only"
        toolRenderers={{
          ask_user: Object.assign(() => <div data-testid="question-card">Which one?</div>, { presentation: 'inline' as const }),
        }}
        {...(visible ? { messagesOnlyVisibleTools: visible } : {})}
      />,
    )

  test('stays hidden by default, so the mode is unchanged for every other host', () => {
    renderAsk()
    expect(screen.queryByTestId('question-card')).toBeNull()
    expect(screen.queryByTestId('tool-call-group')).toBeNull()
  })

  test('renders the opted-in tool with the host renderer, and nothing else', () => {
    renderAsk(['ask_user'])
    expect(screen.getByTestId('question-card')).toBeTruthy()
    // The other tool call is still machinery, and never joins a group summary.
    expect(screen.queryByTestId('tool-call-group')).toBeNull()
    expect(screen.getByText('Pick one and I will continue.')).toBeTruthy()
  })
})
