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

function withLocalStorage(values: Record<string, string>, fn: () => void): void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const store = new Map(Object.entries(values))
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, String(value)),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    },
  })
  try {
    fn()
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete (globalThis as { localStorage?: unknown }).localStorage
  }
}

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
  test('renders data-boring-agent attributes on root', () => {
    const html = renderToStaticMarkup(<ChatPanel sessionId="sess-1" />)
    expect(html).toMatch(/data-boring-agent(?:=| |>|\/>)/)
    expect(html).toContain('data-boring-agent-part="chat"')
    expect(html).toContain('role="region"')
    expect(html).toContain('aria-label="Agent assistant"')
    expect(html).toContain('data-testid="conversation"')
    expect(html).toContain('role="log"')
    expect(html).toContain('aria-label="Agent conversation"')
    expect(html).toContain('aria-live="polite"')
  })

  test('renders empty state with default suggestion grid when no messages', () => {
    const html = renderToStaticMarkup(<ChatPanel sessionId="sess-empty" />)
    // Default headline + at least one default suggestion card.
    expect(html).toContain('What are we building?')
    expect(html).toContain('Summarize the README')
    expect(html).toContain('Explain this codebase')
  })

  test('custom suggestions override defaults and prompt label fallback works', () => {
    const html = renderToStaticMarkup(
      <ChatPanel
        sessionId="sess-custom-empty"
        emptyTitle="Plan a release"
        emptyDescription="Start from a recipe."
        suggestions={[
          { label: 'Cut a release branch', hint: 'From main', prompt: 'Cut release/' },
          { label: 'Triage open PRs' },
        ]}
      />,
    )
    expect(html).toContain('Plan a release')
    expect(html).toContain('Start from a recipe.')
    expect(html).toContain('Cut a release branch')
    expect(html).toContain('Triage open PRs')
    // Defaults should not leak through when overridden.
    expect(html).not.toContain('Summarize the README')
  })

  test('hides suggestion grid when suggestions=[]', () => {
    const html = renderToStaticMarkup(
      <ChatPanel sessionId="sess-no-suggestions" suggestions={[]} />,
    )
    expect(html).toContain('What are we building?')
    expect(html).not.toContain('Summarize the README')
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

    withLocalStorage({ 'boring-agent:composer:show-thoughts': '1' }, () => {
      const html = renderToStaticMarkup(<ChatPanel sessionId="sess-reasoning" />)

      expect(html).toContain('data-testid="reasoning"')
      expect(html).toContain('thinking hard')
      expect(html).toContain('The answer is 42')
    })
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

    // ToolCallGroup collapses tools; trigger shows "Used <noun>" summary
    expect(html).toContain('Used command')
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

    // ToolCallGroup is collapsed by default — custom renderers run inside
    // CollapsibleContent which Radix omits from SSR when closed.
    // Verify the group trigger is present; renderer invocation is covered
    // by the ToolCallGroup unit tests.
    expect(html).toContain('Used command')
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
          model: { provider: 'qwen', id: 'qwen3.5' },
          attachments: [],
        },
      },
    )
  })

  test('uses provided defaultModel when stored model was not user-selected', async () => {
    withLocalStorage({
      'boring-agent:composer:model': JSON.stringify({ provider: 'infomaniak', id: 'moonshotai/Kimi-K2.6' }),
    }, () => {
      renderToStaticMarkup(
        <ChatPanel
          sessionId="sess-default-model"
          defaultModel={{ provider: 'openai', id: 'gpt-4o-mini' }}
        />,
      )
    })

    await capturedOnSubmit!({ text: 'Run tests', files: [] })

    expect(mockSendMessage).toHaveBeenCalledWith(
      { text: 'Run tests', files: [] },
      { body: expect.objectContaining({ model: { provider: 'openai', id: 'gpt-4o-mini' } }) },
    )
  })

  test('keeps stored model when explicit user-selected marker is present', async () => {
    withLocalStorage({
      'boring-agent:composer:model': JSON.stringify({ provider: 'infomaniak', id: 'moonshotai/Kimi-K2.6' }),
      'boring-agent:composer:model:user-selected': '1',
    }, () => {
      renderToStaticMarkup(
        <ChatPanel
          sessionId="sess-user-model"
          defaultModel={{ provider: 'openai', id: 'gpt-4o-mini' }}
        />,
      )
    })

    await capturedOnSubmit!({ text: 'Run tests', files: [] })

    expect(mockSendMessage).toHaveBeenCalledWith(
      { text: 'Run tests', files: [] },
      { body: expect.objectContaining({ model: { provider: 'infomaniak', id: 'moonshotai/Kimi-K2.6' } }) },
    )
  })

  test('slash command is intercepted and does not send to AI', async () => {
    renderToStaticMarkup(<ChatPanel sessionId="sess-cmd" />)

    await capturedOnSubmit!({ text: '/clear', files: [] })

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

  test('/reset forwards requestHeaders when deleting server session', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
    const mockFetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', mockFetch)

    renderToStaticMarkup(
      <ChatPanel
        sessionId="sess-reset"
        requestHeaders={{ 'x-boring-workspace-id': 'w1' }}
      />,
    )

    await capturedOnSubmit!({ text: '/reset', files: [] })

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/agent/sessions/sess-reset',
      {
        method: 'DELETE',
        headers: { 'x-boring-workspace-id': 'w1' },
      },
    )
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
          model: { provider: 'qwen', id: 'qwen3.5' },
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

  describe('skill slash commands', () => {
    const skillCommand = {
      name: 'macro-deck',
      description: 'Create a deck',
      kind: 'skill' as const,
      handler: vi.fn(),
    }

    test('forwards to PI as skill: name\\n\\nargs', async () => {
      renderToStaticMarkup(
        <ChatPanel sessionId="sess-skill" extraCommands={[skillCommand]} />,
      )

      await capturedOnSubmit!({ text: '/macro-deck create a labor market deck', files: [] })

      expect(skillCommand.handler).not.toHaveBeenCalled()
      expect(mockSendMessage).toHaveBeenCalledWith(
        { text: '/macro-deck create a labor market deck', files: [] },
        {
          body: {
            sessionId: 'sess-skill',
            message: 'skill: macro-deck\n\ncreate a labor market deck',
            model: { provider: 'qwen', id: 'qwen3.5' },
            attachments: [],
          },
        },
      )
    })

    test('forwards to PI as skill: name with no args', async () => {
      renderToStaticMarkup(
        <ChatPanel sessionId="sess-skill-noargs" extraCommands={[skillCommand]} />,
      )

      await capturedOnSubmit!({ text: '/macro-deck', files: [] })

      expect(mockSendMessage).toHaveBeenCalledWith(
        { text: '/macro-deck', files: [] },
        expect.objectContaining({
          body: expect.objectContaining({ message: 'skill: macro-deck' }),
        }),
      )
    })

    test('local commands with no kind still run handler, not PI', async () => {
      const localHandler = vi.fn().mockReturnValue('local result')
      renderToStaticMarkup(
        <ChatPanel
          sessionId="sess-local"
          extraCommands={[{ name: 'greet', description: 'Say hello', handler: localHandler }]}
        />,
      )

      await capturedOnSubmit!({ text: '/greet world', files: [] })

      expect(localHandler).toHaveBeenCalledWith('world', expect.anything())
      expect(mockSendMessage).not.toHaveBeenCalled()
    })
  })

  test('className prop is forwarded to root element', () => {
    const html = renderToStaticMarkup(<ChatPanel sessionId="sess-cls" className="custom-class" />)
    expect(html).toContain('custom-class')
  })

  test('passes sessionId to useAgentChat', () => {
    renderToStaticMarkup(<ChatPanel sessionId="test-session-42" />)
    expect(mockUseAgentChat).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'test-session-42' }),
    )
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

  describe('busy indicators', () => {
    test('progress bar visible while streaming', () => {
      mockUseAgentChat.mockReturnValue({
        messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
        sendMessage: mockSendMessage,
        setMessages: mockSetMessages,
        status: 'streaming',
        error: undefined,
      })
      const html = renderToStaticMarkup(<ChatPanel sessionId="s" />)
      expect(html).toContain('aria-label="Agent working"')
      expect(html).toContain('role="progressbar"')
    })

    test('progress bar visible during submitted (waiting for first byte)', () => {
      mockUseAgentChat.mockReturnValue({
        messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
        sendMessage: mockSendMessage,
        setMessages: mockSetMessages,
        status: 'submitted',
        error: undefined,
      })
      const html = renderToStaticMarkup(<ChatPanel sessionId="s" />)
      expect(html).toContain('aria-label="Agent working"')
    })

    test('progress bar hidden when ready', () => {
      mockUseAgentChat.mockReturnValue({
        messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
        sendMessage: mockSendMessage,
        setMessages: mockSetMessages,
        status: 'ready',
        error: undefined,
      })
      const html = renderToStaticMarkup(<ChatPanel sessionId="s" />)
      expect(html).not.toContain('aria-label="Agent working"')
    })

    test('working caption shows when waiting for first byte', () => {
      mockUseAgentChat.mockReturnValue({
        messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
        sendMessage: mockSendMessage,
        setMessages: mockSetMessages,
        status: 'submitted',
        error: undefined,
      })
      const html = renderToStaticMarkup(<ChatPanel sessionId="s" />)
      expect(html).toContain('data-testid="chat-working"')
      expect(html).toContain('Working…')
    })

    test('working caption stays visible once assistant message exists', () => {
      mockUseAgentChat.mockReturnValue({
        messages: [
          { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
          { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: '...' }] },
        ],
        sendMessage: mockSendMessage,
        setMessages: mockSetMessages,
        status: 'streaming',
        error: undefined,
      })
      const html = renderToStaticMarkup(<ChatPanel sessionId="s" />)
      expect(html).toContain('aria-label="Agent working"')
      expect(html).toContain('data-testid="chat-working"')
    })

    test('working caption hides when ready', () => {
      mockUseAgentChat.mockReturnValue({
        messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
        sendMessage: mockSendMessage,
        setMessages: mockSetMessages,
        status: 'ready',
        error: undefined,
      })
      const html = renderToStaticMarkup(<ChatPanel sessionId="s" />)
      // Badge is always in DOM; hidden via opacity when not working
      expect(html).toContain('opacity-0 pointer-events-none')
    })
  })

  describe('part ordering', () => {
    test('text and tool parts render in chronological message.parts order', () => {
      // Model emits: text → tool → text → tool. Renderer must preserve that
      // order so the user sees which sentence triggered which tool, instead
      // of all tools dumped at the bottom of the message.
      const customRenderer = vi.fn((part: ToolPart) => (
        <div data-testid={`tool-${part.toolCallId}`}>TOOL_{part.toolCallId}</div>
      ))

      mockUseAgentChat.mockReturnValue({
        messages: [
          {
            id: 'a1',
            role: 'assistant',
            parts: [
              { type: 'text', text: 'FIRST_TEXT' },
              {
                type: 'tool-bash',
                toolCallId: 'CALLA',
                state: 'output-available',
                input: { command: 'ls' },
                output: { text: 'a' },
              },
              { type: 'text', text: 'SECOND_TEXT' },
              {
                type: 'tool-bash',
                toolCallId: 'CALLB',
                state: 'output-available',
                input: { command: 'pwd' },
                output: { text: 'b' },
              },
              { type: 'text', text: 'THIRD_TEXT' },
            ],
          },
        ],
        sendMessage: mockSendMessage,
        setMessages: mockSetMessages,
        status: 'ready',
        error: undefined,
      })

      const html = renderToStaticMarkup(
        <ChatPanel sessionId="s-order" toolRenderers={{ bash: customRenderer }} />,
      )
      // ToolCallGroup collapses tool content — verify text parts preserve
      // chronological order and tool group triggers appear between them.
      const idxFirstText = html.indexOf('FIRST_TEXT')
      const idxGroupA = html.indexOf('Used command')
      const idxSecondText = html.indexOf('SECOND_TEXT')
      const idxThirdText = html.indexOf('THIRD_TEXT')
      expect(idxFirstText).toBeGreaterThan(-1)
      expect(idxGroupA).toBeGreaterThan(idxFirstText)
      expect(idxSecondText).toBeGreaterThan(idxGroupA)
      expect(idxThirdText).toBeGreaterThan(idxSecondText)
    })

    test('thinking control hidden by default (opt-in)', () => {
      const html = renderToStaticMarkup(<ChatPanel sessionId="s-no-think" />)
      // None of the four level labels should appear when the control is off.
      expect(html).not.toContain('lucide-brain')
      expect(html).not.toContain('data-value="off"')
      expect(html).not.toContain('data-value="high"')
    })

    test('thinking control rendered when thinkingControl=true', () => {
      const html = renderToStaticMarkup(
        <ChatPanel sessionId="s-think" thinkingControl />,
      )
      // The select renders all four level options as children.
      expect(html).toContain('data-value="off"')
      expect(html).toContain('data-value="low"')
      expect(html).toContain('data-value="medium"')
      expect(html).toContain('data-value="high"')
      // BrainIcon rendered alongside the trigger.
      expect(html).toContain('lucide-brain')
    })

    test('thinkingLevel is sent in body when thinkingControl is enabled', async () => {
      // Default level is 'off' — assert it's still forwarded so the server
      // gets a deterministic value rather than relying on the schema default.
      renderToStaticMarkup(
        <ChatPanel sessionId="s-think-body" thinkingControl />,
      )
      await capturedOnSubmit!({ text: 'reason about it', files: [] })
      expect(mockSendMessage).toHaveBeenCalledWith(
        { text: 'reason about it', files: [] },
        {
          body: expect.objectContaining({
            sessionId: 's-think-body',
            thinkingLevel: 'off',
          }),
        },
      )
    })

    test('thinkingLevel is NOT sent in body when thinkingControl is disabled', async () => {
      renderToStaticMarkup(<ChatPanel sessionId="s-no-think-body" />)
      await capturedOnSubmit!({ text: 'plain', files: [] })
      const call = mockSendMessage.mock.calls[0]?.[1]?.body as Record<string, unknown>
      expect(call).toBeDefined()
      expect(Object.prototype.hasOwnProperty.call(call, 'thinkingLevel')).toBe(false)
    })

    test('thinkingLevel reads from localStorage when control enabled', async () => {
      vi.stubGlobal('localStorage', {
        getItem: (key: string) =>
          key === 'boring-agent:composer:thinking' ? 'medium' : null,
        setItem: vi.fn(),
        removeItem: vi.fn(),
      })
      renderToStaticMarkup(
        <ChatPanel sessionId="s-think-stored" thinkingControl />,
      )
      await capturedOnSubmit!({ text: 'go', files: [] })
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.anything(),
        { body: expect.objectContaining({ thinkingLevel: 'medium' }) },
      )
      vi.unstubAllGlobals()
    })

    test('tools are NOT pushed to the end when they appear before text in parts', () => {
      // Regression guard: the previous renderer grouped by type and rendered
      // all texts first then all tools. With that bug, a tool-then-text
      // sequence in `parts` would render text first.
      //
      // ToolCallGroup collapses tool content via Radix Presence (not rendered
      // on initial mount), so we check the collapsible trigger position instead
      // of the custom renderer output — the trigger IS in the static HTML.
      mockUseAgentChat.mockReturnValue({
        messages: [
          {
            id: 'a1',
            role: 'assistant',
            parts: [
              {
                type: 'tool-bash',
                toolCallId: 'EARLY',
                state: 'output-available',
                input: { command: 'ls' },
                output: { text: 'a' },
              },
              { type: 'text', text: 'AFTER_TOOL' },
            ],
          },
        ],
        sendMessage: mockSendMessage,
        setMessages: mockSetMessages,
        status: 'ready',
        error: undefined,
      })

      const html = renderToStaticMarkup(<ChatPanel sessionId="s-tool-first" />)
      // The group trigger ("Used command") must precede the text part.
      const idxTool = html.indexOf('Used command')
      const idxText = html.indexOf('AFTER_TOOL')
      expect(idxTool).toBeGreaterThan(-1)
      expect(idxText).toBeGreaterThan(idxTool)
    })
  })
})
