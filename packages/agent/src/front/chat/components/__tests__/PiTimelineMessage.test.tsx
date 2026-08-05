// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { BoringChatMessage } from '../../../../shared/chat'
import { ArtifactOpenProvider } from '../../../ArtifactOpenContext'
import { ChatMessageContributionProvider } from '../../messageContributions'
import { PiTimelineMessage } from '../PiTimelineMessage'

vi.mock('../../../primitives/message', () => ({
  Message: ({ children, from, ...props }: any) => <article data-from={from} {...props}>{children}</article>,
  MessageContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  MessageResponse: ({ children, components, codeFilename }: any) => {
    const Paragraph = components?.p
    return <div data-testid="message-response" data-code-filename={codeFilename}>{Paragraph ? <Paragraph>{children}</Paragraph> : children}</div>
  },
}))

vi.mock('../../../primitives/reasoning', () => ({
  Reasoning: ({ children, isStreaming, open, defaultOpen: _defaultOpen, onOpenChange: _onOpenChange, autoClose: _autoClose, ...props }: any) => (
    <section data-testid="reasoning" data-open={String(open)} data-streaming={String(isStreaming)} {...props}>
      {children}
    </section>
  ),
  ReasoningTrigger: ({ onClick, getThinkingMessage }: any) => (
    <button type="button" onClick={onClick}>
      {getThinkingMessage?.(false) ?? 'thoughts'}
    </button>
  ),
  ReasoningContent: ({ children }: any) => <div data-testid="reasoning-content">{children}</div>,
}))

vi.mock('../../../primitives/tool-call-group', () => ({
  ToolCallGroup: ({ tools }: any) => (
    <div data-testid="tool-call-group">
      {tools.map(({ part }: any) => `${part.toolName}:${part.state}`).join(',')}
    </div>
  ),
}))

vi.mock('../../../primitives/attachments', () => ({
  Attachments: ({ children }: any) => <div data-testid="attachments">{children}</div>,
  Attachment: ({ children, data, ...props }: any) => <div data-filename={data.filename} {...props}>{children}</div>,
  AttachmentPreview: () => <span>preview</span>,
  AttachmentInfo: () => <span>info</span>,
}))

describe('PiTimelineMessage', () => {
  test('uses an inline renderer only while an action tool is pending', () => {
    const inlineRenderer = Object.assign(
      vi.fn(() => <div data-testid="inline-tool">Pending question</div>),
      { presentation: 'inline' as const },
    )
    const pending: BoringChatMessage = {
      id: 'ask-user-pending', role: 'assistant',
      parts: [{ type: 'tool-call', id: 'ask-call', toolName: 'ask_user', state: 'input-available' }],
    }
    const resolved: BoringChatMessage = {
      ...pending,
      id: 'ask-user-resolved',
      parts: [{ type: 'tool-call', id: 'ask-call', toolName: 'ask_user', state: 'output-available', output: { content: [{ type: 'text', text: 'User answered: A' }] } }],
    }
    const { rerender } = render(<PiTimelineMessage message={pending} isLast={false} isStreaming={false} showThoughts={false} toolRenderers={{ ask_user: inlineRenderer }} />)
    expect(screen.getByTestId('inline-tool').textContent).toBe('Pending question')

    rerender(<PiTimelineMessage message={resolved} isLast={false} isStreaming={false} showThoughts={false} toolRenderers={{ ask_user: inlineRenderer }} />)
    expect(screen.queryByTestId('inline-tool')).toBeNull()
    expect(screen.getByTestId('tool-output').textContent).toContain('User answered: A')
  })

  test('allows a provider to replace a message without feature logic in the timeline', () => {
    const message: BoringChatMessage = {
      id: 'custom-1',
      role: 'user',
      parts: [{ type: 'text', text: 'opaque integration payload' }],
    }

    render(
      <ChatMessageContributionProvider contribution={{
        id: 'test-renderer',
        matches: (candidate) => candidate.id === message.id,
        Component: () => <div>Custom message card</div>,
      }}>
        <PiTimelineMessage message={message} isLast isStreaming={false} showThoughts={false} toolRenderers={{}} />
      </ChatMessageContributionProvider>,
    )

    expect(screen.getByText('Custom message card')).toBeTruthy()
    expect(screen.queryByText('opaque integration payload')).toBeNull()
  })

  test('renders live assistant parts in reasoning, tool, notice, text order and opens collapsed thoughts', () => {
    const message: BoringChatMessage = {
      id: 'a-live',
      role: 'assistant',
      status: 'streaming',
      parts: [
        { type: 'reasoning', id: 'r1', text: 'first thought', state: 'done' },
        { type: 'reasoning', id: 'r2', text: 'second thought', state: 'streaming' },
        { type: 'tool-call', id: 'tool-1', toolName: 'grep', input: { pattern: 'todo' }, state: 'input-available' },
        { type: 'tool-call', id: 'tool-2', toolName: 'read', input: { path: 'README.md' }, state: 'output-available' },
        { type: 'notice', id: 'notice-1', level: 'warning', text: 'Command warning:\nvery-long-unbroken-token-that-should-wrap' },
        { type: 'text', id: 'a-live:text', text: 'Final answer' },
      ],
    }

    render(
      <PiTimelineMessage
        message={message}
        isLast
        isStreaming
        showThoughts={false}
        toolRenderers={{}}
      />,
    )

    const row = screen.getByRole('article')
    expect(row.getAttribute('data-boring-agent-message-id')).toBe('a-live')
    expect(row.getAttribute('data-boring-agent-message-status')).toBe('streaming')

    const reasoning = within(row).getByTestId('reasoning')
    expect(reasoning.getAttribute('data-open')).toBe('false')
    expect(reasoning.getAttribute('data-streaming')).toBe('true')
    expect(within(reasoning).getByTestId('reasoning-content').textContent).toBe('first thought\n\nsecond thought')

    fireEvent.click(within(reasoning).getByRole('button', { name: 'Reasoning' }))
    expect(within(row).getByTestId('reasoning').getAttribute('data-open')).toBe('true')

    const tools = within(row).getByTestId('tool-call-group').closest('[data-boring-agent-part="message-tools"]')
    const notice = row.querySelector('[data-boring-agent-part="message-notice"]')
    const text = within(row).getByText('Final answer').closest('[data-boring-agent-part="message-text"]')
    expect(tools?.textContent).toBe('grep:input-available,read:output-available')
    expect(notice?.querySelector('.whitespace-pre-wrap')?.textContent).toBe('Command warning:\nvery-long-unbroken-token-that-should-wrap')

    expect(reasoning.compareDocumentPosition(tools!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(tools!.compareDocumentPosition(notice!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(notice!.compareDocumentPosition(text!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(row).queryByRole('button', { name: 'Copy message' })).toBeNull()
  })

  test('keeps final assistant actions hidden from message streaming status alone', () => {
    const message: BoringChatMessage = {
      id: 'a-status-streaming',
      role: 'assistant',
      status: 'streaming',
      parts: [{ type: 'text', id: 'a-status-streaming:text', text: 'Still working' }],
    }

    render(
      <PiTimelineMessage
        message={message}
        isLast
        isStreaming={false}
        showThoughts={false}
        toolRenderers={{}}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Copy message' })).toBeNull()
  })

  test('infers a code filename from the immediately preceding write tool', () => {
    const message: BoringChatMessage = {
      id: 'a-timestamp',
      role: 'assistant',
      status: 'done',
      parts: [
        { type: 'tool-call', id: 'write', toolName: 'write', input: { path: 'packages/agent/src/example.ts' }, state: 'output-available' },
        { type: 'text', id: 'a-timestamp:text', text: 'Updated the file.' },
      ],
    }

    render(<PiTimelineMessage message={message} isLast isStreaming={false} showThoughts={false} toolRenderers={{}} />)

    expect(screen.getByText('Updated the file.').closest('[data-testid="message-response"]')?.getAttribute('data-code-filename')).toBe('packages/agent/src/example.ts')
  })

  test('does not infer a filename from a stale or non-writing tool', () => {
    const message: BoringChatMessage = {
      id: 'a-tool-only',
      role: 'assistant',
      status: 'done',
      parts: [
        { type: 'tool-call', id: 'write', toolName: 'write', input: { path: 'stale.ts' }, state: 'output-available' },
        { type: 'notice', id: 'notice', level: 'info', text: 'Finished.' },
        { type: 'text', id: 'a-tool-only:text', text: '```ts\nconst done = true\n```' },
      ],
    }

    render(<PiTimelineMessage message={message} isLast isStreaming={false} showThoughts={false} toolRenderers={{}} />)
    expect(screen.getByTestId('message-response').getAttribute('data-code-filename')).toBeNull()
  })

  test('renders action tools (bash) as plain cards and groups read-only tools', () => {
    const message: BoringChatMessage = {
      id: 'a-tools',
      role: 'assistant',
      status: 'done',
      parts: [
        { type: 'tool-call', id: 'call-read', toolName: 'read', input: { path: 'a.ts' }, state: 'output-available' },
        { type: 'tool-call', id: 'call-bash', toolName: 'bash', input: { command: 'echo hi' }, state: 'output-available', output: { stdout: 'hi' } },
      ],
    }

    render(
      <PiTimelineMessage message={message} isLast isStreaming={false} showThoughts={false} toolRenderers={{}} />,
    )

    const row = screen.getByRole('article')
    // read-only tool stays in the collapsed group summary…
    const group = within(row).getByTestId('tool-call-group')
    expect(group.textContent).toBe('read:output-available')
    // …and the bash action tool renders as its own plain card (not in the group).
    const bashCard = row.querySelector('[data-tool-call-id="call-bash"]')
    expect(bashCard).toBeTruthy()
    expect(group.contains(bashCard)).toBe(false)
    // read group precedes the bash card (emitted order preserved).
    expect(group.closest('[data-boring-agent-part="message-tools"]')!
      .compareDocumentPosition(bashCard!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test('renders user file attachments separately from model-only attachment markers', () => {
    const message: BoringChatMessage = {
      id: 'u-file',
      role: 'user',
      status: 'done',
      parts: [
        { type: 'text', id: 'u-file:text', text: 'wait is inside the image?\n\n[attached: image.png (image/png, not inlined — binary)]' },
        { type: 'file', id: 'u-file:file', filename: 'image.png', mediaType: 'image/png', url: 'blob:image' },
      ],
    }

    render(
      <PiTimelineMessage
        message={message}
        isLast={false}
        isStreaming={false}
        showThoughts={false}
        toolRenderers={{}}
      />,
    )

    expect(screen.getByTestId('attachments').querySelector('[data-filename="image.png"]')).toBeTruthy()
    expect(screen.getByTestId('message-response').textContent).toBe('wait is inside the image?')
    expect(screen.queryByText(/attached: image\.png/)).toBeNull()
  })

  test('opens uploaded workspace attachment chips through the artifact opener', () => {
    const onOpenArtifact = vi.fn()
    const message: BoringChatMessage = {
      id: 'u-open-file',
      role: 'user',
      status: 'done',
      parts: [
        { type: 'file', id: 'u-open-file:file', filename: 'image.png', mediaType: 'image/png', url: '/raw', path: 'assets/images/image.png' },
      ],
    }

    render(
      <ArtifactOpenProvider onOpenArtifact={onOpenArtifact}>
        <PiTimelineMessage
          message={message}
          isLast={false}
          isStreaming={false}
          showThoughts={false}
          toolRenderers={{}}
        />
      </ArtifactOpenProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open image.png in workspace' }))
    expect(onOpenArtifact).toHaveBeenCalledWith('assets/images/image.png')
  })

  test('opens lazy history attachment chips by URL when no workspace path is available', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const message: BoringChatMessage = {
      id: 'u-lazy-url',
      role: 'user',
      status: 'done',
      parts: [
        { type: 'file', id: 'u-lazy-url:file', filename: 'image.png', mediaType: 'image/png', url: '/api/v1/agents/default/sessions/pi-1/attachments/m-user-image/1' },
      ],
    }

    render(<PiTimelineMessage message={message} isLast={false} isStreaming={false} showThoughts={false} toolRenderers={{}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Open image.png' }))
    expect(open).toHaveBeenCalledWith('/api/v1/agents/default/sessions/pi-1/attachments/m-user-image/1', '_blank', 'noopener,noreferrer')
    open.mockRestore()
  })

  test('opens recovered history attachment chips using the stripped workspace path note', () => {
    const onOpenArtifact = vi.fn()
    const message: BoringChatMessage = {
      id: 'u-recovered-path',
      role: 'user',
      status: 'done',
      parts: [
        { type: 'file', id: 'u-recovered-path:file', mediaType: 'image/png', url: 'data:image/png;base64,abc123' },
        { type: 'text', id: 'u-recovered-path:text', text: 'can you read this ?\n\n[attached: grafik.png (image/png, not inlined — binary)\nSaved in workspace at: assets/images/grafik-mqhmrp1k-2drpcs.png\nUse the workspace file/read tools with this path if you need to inspect it.]' },
      ],
    }

    render(
      <ArtifactOpenProvider onOpenArtifact={onOpenArtifact}>
        <PiTimelineMessage
          message={message}
          isLast={false}
          isStreaming={false}
          showThoughts={false}
          toolRenderers={{}}
        />
      </ArtifactOpenProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open assets/images/grafik-mqhmrp1k-2drpcs.png in workspace' }))
    expect(onOpenArtifact).toHaveBeenCalledWith('assets/images/grafik-mqhmrp1k-2drpcs.png')
    expect(screen.getByTestId('message-response').textContent).toBe('can you read this ?')
  })

  test('strips generated binary attachment path notes from recovered user text', () => {
    const message: BoringChatMessage = {
      id: 'u-path-note',
      role: 'user',
      status: 'done',
      parts: [
        { type: 'text', id: 'u-path-note:text', text: 'can you read this ?\n\n[attached: grafik.png (image/png, not inlined — binary)\nSaved in workspace at: assets/images/grafik-mqhmrp1k-2drpcs.png\nUse the workspace file/read tools with this path if you need to inspect it.]' },
      ],
    }

    render(
      <PiTimelineMessage
        message={message}
        isLast={false}
        isStreaming={false}
        showThoughts={false}
        toolRenderers={{}}
      />,
    )

    expect(screen.getByTestId('message-response').textContent).toBe('can you read this ?')
    expect(screen.queryByText(/attached: grafik\.png/)).toBeNull()
    expect(screen.queryByText(/Saved in workspace at/)).toBeNull()
  })

  test('strips generated structured attachment tags from recovered user text', () => {
    const message: BoringChatMessage = {
      id: 'u-tag-note',
      role: 'user',
      status: 'done',
      parts: [
        { type: 'text', id: 'u-tag-note:text', text: 'please review\n\n<attachment data-boring-agent="composer-file" filename="spec.md" mime="text/markdown" path="assets/uploads/spec.md">\n```\n# spec\n```\n</attachment>' },
      ],
    }

    render(
      <PiTimelineMessage
        message={message}
        isLast={false}
        isStreaming={false}
        showThoughts={false}
        toolRenderers={{}}
      />,
    )

    expect(screen.getByTestId('message-response').textContent).toBe('please review')
    expect(screen.queryByText(/attachment data-boring-agent/)).toBeNull()
    expect(screen.queryByText(/# spec/)).toBeNull()
  })

  test('renders only explicitly actionable assistant slash commands as buttons', () => {
    const onMentionActivate = vi.fn()
    const message: BoringChatMessage = {
      id: 'a-command',
      role: 'assistant',
      status: 'done',
      parts: [{
        type: 'text',
        id: 'a-command:text',
        text: 'Run /reload, not /reset, /unknown, /reload/config, /reload.md, /reload?unknown, /reload:unknown, /reload#unknown, /reload=unknown, or /reloadé.',
      }],
    }

    render(
      <PiTimelineMessage
        message={message}
        isLast
        isStreaming={false}
        showThoughts={false}
        toolRenderers={{}}
        mentionCatalog={{ commands: [{ name: 'reload', clickBehavior: 'execute' }], skills: [], files: false }}
        onMentionActivate={onMentionActivate}
      />,
    )

    const button = screen.getByRole('button', { name: 'Run /reload command' })
    expect(button.textContent).toBe('/reload')
    expect(screen.getAllByText(/\/reload/).length).toBeGreaterThan(0)
    fireEvent.click(button)
    expect(onMentionActivate).toHaveBeenCalledWith({ kind: 'command', name: 'reload', label: '/reload', behavior: 'execute' })
    expect(onMentionActivate).toHaveBeenCalledTimes(1)
  })

  test('opens explicit workspace file mentions through the artifact opener', () => {
    const onOpenArtifact = vi.fn()
    const message: BoringChatMessage = {
      id: 'a-file-mention',
      role: 'assistant',
      status: 'done',
      parts: [{ type: 'text', id: 'a-file-mention:text', text: 'Open @packages/agent/README.md.' }],
    }

    render(
      <ArtifactOpenProvider onOpenArtifact={onOpenArtifact}>
        <PiTimelineMessage
          message={message}
          isLast
          isStreaming={false}
          showThoughts={false}
          toolRenderers={{}}
          mentionCatalog={{ commands: [], skills: [], files: true }}
        />
      </ArtifactOpenProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open packages/agent/README.md' }))
    expect(onOpenArtifact).toHaveBeenCalledWith('packages/agent/README.md')
  })

  test('does not make a partial command actionable while its assistant message is streaming', () => {
    const message: BoringChatMessage = {
      id: 'a-streaming-command',
      role: 'assistant',
      status: 'streaming',
      parts: [{ type: 'text', id: 'a-streaming-command:text', text: 'Run /reload' }],
    }

    render(
      <PiTimelineMessage
        message={message}
        isLast
        isStreaming
        showThoughts={false}
        toolRenderers={{}}
        mentionCatalog={{ commands: [{ name: 'reload', clickBehavior: 'execute' }], skills: [], files: false }}
        onMentionActivate={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Run /reload command' })).toBeNull()
  })

  test('does not make slash commands in user messages actionable', () => {
    const message: BoringChatMessage = {
      id: 'u-command',
      role: 'user',
      status: 'done',
      parts: [{ type: 'text', id: 'u-command:text', text: 'Run /reload' }],
    }

    render(
      <PiTimelineMessage
        message={message}
        isLast
        isStreaming={false}
        showThoughts={false}
        toolRenderers={{}}
        mentionCatalog={{ commands: [{ name: 'reload', clickBehavior: 'execute' }], skills: [], files: false }}
        onMentionActivate={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Run /reload command' })).toBeNull()
    expect(screen.getByText('Run /reload')).toBeTruthy()
  })

  test('strips generated text attachment blocks from recovered user text', () => {
    const message: BoringChatMessage = {
      id: 'u-text-file',
      role: 'user',
      status: 'done',
      parts: [
        { type: 'text', id: 'u-text-file:text', text: 'please review this\n\n[attached: spec.md (text/markdown)]\n```\n# spec\n```ts\nsecret contents\n```\n```' },
      ],
    }

    render(
      <PiTimelineMessage
        message={message}
        isLast={false}
        isStreaming={false}
        showThoughts={false}
        toolRenderers={{}}
      />,
    )

    expect(screen.getByTestId('message-response').textContent).toBe('please review this')
    expect(screen.queryByText(/attached: spec\.md/)).toBeNull()
    expect(screen.queryByText(/secret contents/)).toBeNull()
    expect(screen.queryByText(/# spec/)).toBeNull()
  })
})
