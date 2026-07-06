// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { BoringChatMessage } from '../../../../shared/chat'
import { ArtifactOpenProvider } from '../../../ArtifactOpenContext'
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
  ToolApprovalActions: ({ requestId, onResolveApproval }: any) => (
    <div data-testid="approval-actions" data-approval-request-id={requestId}>
      <button type="button" onClick={() => onResolveApproval(requestId, 'approve')}>Approve</button>
      <button type="button" onClick={() => onResolveApproval(requestId, 'deny')}>Deny</button>
    </div>
  ),
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

  test('resolves standalone approval tool cards from the request id', () => {
    const onResolveApproval = vi.fn()
    const message: BoringChatMessage = {
      id: 'a-approval',
      role: 'assistant',
      status: 'streaming',
      parts: [
        {
          type: 'tool-call',
          id: 'call-bash',
          toolName: 'bash',
          input: { command: 'touch approved.txt' },
          state: 'approval-requested',
          approvalRequestId: 'approval-1',
        },
      ],
    }

    render(
      <PiTimelineMessage
        message={message}
        isLast
        isStreaming={false}
        showThoughts={false}
        toolRenderers={{}}
        onResolveApproval={onResolveApproval}
      />,
    )

    expect(screen.getByTestId('approval-actions').getAttribute('data-approval-request-id')).toBe('approval-1')

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(onResolveApproval).toHaveBeenLastCalledWith('approval-1', 'approve')

    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))
    expect(onResolveApproval).toHaveBeenLastCalledWith('approval-1', 'deny')
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
