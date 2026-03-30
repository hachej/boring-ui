import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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

  it('renders text parts as paragraphs', () => {
    const msg = makeMessage('assistant', [
      { type: 'text', text: 'First paragraph' },
      { type: 'text', text: 'Second paragraph' },
    ])
    render(<ChatMessage message={msg} />)
    expect(screen.getByText('First paragraph')).toBeInTheDocument()
    expect(screen.getByText('Second paragraph')).toBeInTheDocument()
  })

  it('renders reasoning parts with muted styling', () => {
    const msg = makeMessage('assistant', [
      { type: 'reasoning', reasoning: 'Let me think about this...' },
      { type: 'text', text: 'Here is my answer' },
    ])
    render(<ChatMessage message={msg} />)
    const reasoning = screen.getByText('Let me think about this...')
    expect(reasoning).toBeInTheDocument()
    expect(reasoning.closest('[data-part="reasoning"]')).toBeInTheDocument()
  })

  it('renders tool-call parts as ToolCallCard components', () => {
    const msg = makeMessage('assistant', [
      {
        type: 'tool-invocation',
        toolInvocation: {
          toolCallId: 'tc-1',
          toolName: 'read_file',
          args: { path: '/src/main.js' },
          state: 'result',
          result: 'file contents',
        },
      },
    ])
    render(<ChatMessage message={msg} />)
    expect(screen.getByText('read_file')).toBeInTheDocument()
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
