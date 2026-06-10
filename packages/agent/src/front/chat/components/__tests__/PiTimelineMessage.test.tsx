// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { BoringChatMessage } from '../../../../shared/chat'
import { PiTimelineMessage } from '../PiTimelineMessage'

vi.mock('../../../primitives/message', () => ({
  Message: ({ children, from, ...props }: any) => <article data-from={from} {...props}>{children}</article>,
  MessageContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  MessageResponse: ({ children }: any) => <div data-testid="message-response">{children}</div>,
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
  Attachment: ({ children, data }: any) => <div data-filename={data.filename}>{children}</div>,
  AttachmentPreview: () => <span>preview</span>,
  AttachmentInfo: () => <span>info</span>,
}))

describe('PiTimelineMessage', () => {
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

    fireEvent.click(within(reasoning).getByRole('button', { name: 'thoughts' }))
    expect(within(row).getByTestId('reasoning').getAttribute('data-open')).toBe('true')

    const tools = within(row).getByTestId('tool-call-group').closest('[data-boring-agent-part="message-tools"]')
    const notice = row.querySelector('[data-boring-agent-part="message-notice"]')
    const text = within(row).getByText('Final answer').closest('[data-boring-agent-part="message-text"]')
    expect(tools?.textContent).toBe('grep:input-available,read:output-available')
    expect(notice?.querySelector('.whitespace-pre-wrap')?.textContent).toBe('Command warning:\nvery-long-unbroken-token-that-should-wrap')

    expect(reasoning.compareDocumentPosition(tools!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(tools!.compareDocumentPosition(notice!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(notice!.compareDocumentPosition(text!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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
