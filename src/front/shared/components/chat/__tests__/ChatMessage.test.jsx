import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ChatMessage from '../ChatMessage'

// Helper to build an AI SDK UIMessage with parts
function makeMessage(role, parts) {
  return {
    id: `msg-${Date.now()}`,
    role,
    parts,
  }
}

describe('ChatMessage', () => {
  it('renders user message with User icon avatar', () => {
    const msg = makeMessage('user', [{ type: 'text', text: 'Hello world' }])
    render(<ChatMessage message={msg} />)
    expect(screen.getByText('You')).toBeInTheDocument()
    // The User icon should be present as an SVG
    const avatar = screen.getByTestId('chat-avatar')
    expect(avatar).toBeInTheDocument()
  })

  it('renders agent message with Sparkles icon avatar', () => {
    const msg = makeMessage('assistant', [{ type: 'text', text: 'Hi there' }])
    render(<ChatMessage message={msg} />)
    expect(screen.getByText('Agent')).toBeInTheDocument()
    const avatar = screen.getByTestId('chat-avatar')
    expect(avatar).toBeInTheDocument()
  })

  it('renders text parts as markdown', () => {
    const msg = makeMessage('assistant', [
      { type: 'text', text: '# Heading\n\nSecond paragraph' },
    ])
    render(<ChatMessage message={msg} />)
    expect(screen.getByRole('heading', { name: 'Heading' })).toBeInTheDocument()
    expect(screen.getByText('Second paragraph')).toBeInTheDocument()
  })

  it('renders reasoning parts with muted styling', () => {
    const msg = makeMessage('assistant', [
      { type: 'reasoning', reasoning: 'Let me think about this...' },
      { type: 'text', text: 'Here is my answer' },
    ])
    render(<ChatMessage message={msg} />)
    const reasoning = screen.getByText('Let me think about this…')
    expect(reasoning).toBeInTheDocument()
    expect(reasoning.closest('[data-part="reasoning"]')).toBeInTheDocument()
  })

  it('renders AI SDK tool parts with the shared tool renderer', () => {
    const msg = makeMessage('assistant', [
      {
        type: 'tool-result',
        toolCallId: 'tc-1',
        toolName: 'read_file',
        input: { path: '/src/main.js' },
        output: 'file contents',
      },
    ])
    render(<ChatMessage message={msg} />)
    expect(screen.getByText('Read')).toBeInTheDocument()
    expect(screen.getByText('main.js')).toBeInTheDocument()
  })

  it('renders AI SDK v6 static tool parts with the shared tool renderer', () => {
    const onOpenArtifact = vi.fn()
    const msg = makeMessage('assistant', [
      {
        type: 'tool-open_file',
        toolCallId: 'tc-open-1',
        state: 'output-available',
        input: { path: 'workbench.feret-overview.json' },
        output: { opened: true, path: 'workbench.feret-overview.json' },
      },
    ])

    render(<ChatMessage message={msg} onOpenArtifact={onOpenArtifact} activeSessionId="session-1" />)

    expect(screen.getByText('open_file')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open workbench\.feret-overview\.json/i })).toBeInTheDocument()
  })

  it('renders file references as inline links instead of capped artifact cards', () => {
    const onOpenArtifact = vi.fn()
    const msg = makeMessage('assistant', [
      { type: 'text', text: 'Files: src/a.js src/b.js src/c.js src/d.js' },
    ])

    render(<ChatMessage message={msg} onOpenArtifact={onOpenArtifact} activeSessionId="session-1" isLastAssistantMessage />)

    const links = ['src/a.js', 'src/b.js', 'src/c.js', 'src/d.js']
    links.forEach((path) => {
      expect(screen.getByRole('button', { name: path })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'src/d.js' }))
    expect(onOpenArtifact).toHaveBeenCalledWith(expect.objectContaining({
      canonicalKey: 'src/d.js',
      params: { path: 'src/d.js' },
    }))
  })

  it('renders bare filenames like README.md as inline open links', () => {
    const onOpenArtifact = vi.fn()
    const msg = makeMessage('assistant', [
      { type: 'text', text: 'I opened README.md and checked package.json for you.' },
    ])

    render(<ChatMessage message={msg} onOpenArtifact={onOpenArtifact} activeSessionId="session-1" isLastAssistantMessage />)

    fireEvent.click(screen.getByRole('button', { name: 'README.md' }))
    expect(onOpenArtifact).toHaveBeenCalledWith(expect.objectContaining({
      canonicalKey: 'README.md',
      params: { path: 'README.md' },
    }))
  })

  it('renders legacy tool_use parts and exposes an artifact link for read_file', () => {
    const onOpenArtifact = vi.fn()
    const msg = makeMessage('assistant', [
      {
        type: 'tool_use',
        id: 'tool-1',
        name: 'read_file',
        input: { path: 'README.md' },
        output: '# Hello',
        status: 'complete',
      },
    ])

    render(<ChatMessage message={msg} onOpenArtifact={onOpenArtifact} activeSessionId="session-1" />)

    expect(screen.getByText('Read')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /open readme\.md/i }))
    expect(onOpenArtifact).toHaveBeenCalledWith(expect.objectContaining({
      canonicalKey: 'README.md',
      params: { path: 'README.md' },
    }))
  })

  it('does NOT render hidden protocol parts', () => {
    const msg = makeMessage('assistant', [
      { type: 'text', text: 'Visible text' },
      { type: 'source', source: { url: 'http://example.com' } },
    ])
    render(<ChatMessage message={msg} />)
    expect(screen.getByText('Visible text')).toBeInTheDocument()
    expect(screen.queryByText('http://example.com')).not.toBeInTheDocument()
  })
})
