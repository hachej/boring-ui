/**
 * @vitest-environment jsdom
 */
import React from 'react'
import '../setup.ts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import AiChat from '../../shared/components/chat/AiChat'

const mockUseChat = vi.fn()
const mockTransport = vi.fn((options) => ({ options }))
const mockBuildApiUrl = vi.fn(() => '/api/v1/agent/chat')
const mockGetWorkspaceIdFromPathname = vi.fn(() => 'ws-123')
const mockRenderToolPart = vi.fn((part) => (
  <div data-testid={`tool-render-${part.name}`}>{JSON.stringify(part)}</div>
))

vi.mock('@ai-sdk/react', () => ({
  useChat: (...args) => mockUseChat(...args),
}))

vi.mock('ai', () => ({
  DefaultChatTransport: function DefaultChatTransport(options) {
    return mockTransport(options)
  },
}))

vi.mock('../../shared/utils/apiBase', () => ({
  buildApiUrl: (...args) => mockBuildApiUrl(...args),
}))

vi.mock('../../shared/utils/controlPlane', () => ({
  getWorkspaceIdFromPathname: (...args) => mockGetWorkspaceIdFromPathname(...args),
}))

vi.mock('../../shared/components/chat/toolRenderers', () => ({
  renderToolPart: (...args) => mockRenderToolPart(...args),
}))

describe('AiChat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a transport for the server chat endpoint and submits text messages', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined)
    mockUseChat.mockReturnValue({
      messages: [],
      sendMessage,
      status: 'ready',
      error: undefined,
      stop: vi.fn(),
    })

    render(<AiChat />)

    expect(mockBuildApiUrl).toHaveBeenCalledWith('/api/v1/agent/chat')
    expect(mockTransport).toHaveBeenCalledWith({
      api: '/api/v1/agent/chat',
      credentials: 'include',
      body: { workspace_id: 'ws-123' },
    })

    fireEvent.change(screen.getByPlaceholderText('Send a message to the server-side AI SDK runtime...'), {
      target: { value: 'Ship it' },
    })
    fireEvent.submit(screen.getByRole('button', { name: /send/i }).closest('form'))

    expect(sendMessage).toHaveBeenCalledWith({ text: 'Ship it' })
  })

  it('renders streamed messages and exposes the stop action while busy', () => {
    const stop = vi.fn()
    mockUseChat.mockReturnValue({
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          parts: [{ type: 'text', text: 'Hello from ai-sdk' }],
        },
      ],
      sendMessage: vi.fn(),
      status: 'streaming',
      error: undefined,
      stop,
    })

    render(<AiChat />)

    expect(screen.getByTestId('ai-chat-message-assistant')).toHaveTextContent('Hello from ai-sdk')
    fireEvent.click(screen.getByRole('button', { name: /stop/i }))
    expect(stop).toHaveBeenCalled()
  })

  it('updates the transport workspace scope after browser navigation', async () => {
    const originalPath = window.location.pathname
    mockGetWorkspaceIdFromPathname.mockImplementation((pathname) => {
      if (pathname.includes('ws-999')) return 'ws-999'
      return 'ws-123'
    })
    mockUseChat.mockReturnValue({
      messages: [],
      sendMessage: vi.fn(),
      status: 'ready',
      error: undefined,
      stop: vi.fn(),
    })

    render(<AiChat />)
    expect(mockTransport).toHaveBeenCalledWith(expect.objectContaining({
      body: { workspace_id: 'ws-123' },
    }))

    await act(async () => {
      window.history.pushState({}, '', '/w/ws-999/app')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    await waitFor(() => {
      expect(mockTransport).toHaveBeenLastCalledWith(expect.objectContaining({
        body: { workspace_id: 'ws-999' },
      }))
    })

    await act(async () => {
      window.history.pushState({}, '', originalPath)
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
  })

  it('resets visible chat state when the workspace scope changes', async () => {
    const originalPath = window.location.pathname
    mockGetWorkspaceIdFromPathname.mockImplementation((pathname) => {
      if (pathname.includes('ws-999')) return 'ws-999'
      return 'ws-123'
    })
    mockUseChat
      .mockReturnValueOnce({
        messages: [
          {
            id: 'old-msg',
            role: 'assistant',
            parts: [{ type: 'text', text: 'Old workspace response' }],
          },
        ],
        sendMessage: vi.fn(),
        status: 'ready',
        error: undefined,
        stop: vi.fn(),
      })
      .mockReturnValue({
        messages: [],
        sendMessage: vi.fn(),
        status: 'ready',
        error: undefined,
        stop: vi.fn(),
      })

    render(<AiChat />)
    expect(screen.getByText('Old workspace response')).toBeInTheDocument()

    await act(async () => {
      window.history.replaceState({}, '', '/w/ws-999/app')
    })

    await waitFor(() => {
      expect(screen.queryByText('Old workspace response')).not.toBeInTheDocument()
      expect(screen.getByTestId('ai-chat-empty')).toBeInTheDocument()
    })

    await act(async () => {
      window.history.replaceState({}, '', originalPath)
    })
  })

  it('normalizes AI SDK tool parts into the shared tool renderer contract', () => {
    mockUseChat.mockReturnValue({
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          parts: [
            { type: 'text', text: 'Running a command' },
            { type: 'tool-input-start', id: 'tool-1', toolName: 'exec_bash' },
            { type: 'tool-input-delta', id: 'tool-1', delta: '{"command":"pwd"}' },
            { type: 'tool-call', toolCallId: 'tool-1', toolName: 'exec_bash', input: { command: 'pwd' } },
            {
              type: 'tool-result',
              toolCallId: 'tool-1',
              toolName: 'exec_bash',
              input: { command: 'pwd' },
              output: { content: [{ type: 'text', text: '/tmp/workspace' }] },
            },
          ],
        },
      ],
      sendMessage: vi.fn(),
      status: 'ready',
      error: undefined,
      stop: vi.fn(),
    })

    render(<AiChat />)

    expect(screen.getByTestId('ai-chat-message-assistant')).toHaveTextContent('Running a command')
    expect(mockRenderToolPart).toHaveBeenCalledTimes(1)
    expect(mockRenderToolPart).toHaveBeenCalledWith(expect.objectContaining({
      name: 'exec_bash',
      input: { command: 'pwd' },
      output: '/tmp/workspace',
      status: 'complete',
    }))
    expect(screen.getByTestId('tool-render-exec_bash')).toBeInTheDocument()
    expect(screen.queryByText(/\[tool-input-start part\]/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/\[tool-input-delta part\]/i)).not.toBeInTheDocument()
  })

  it('extracts structured AI SDK outputs into renderer-friendly text', () => {
    mockUseChat.mockReturnValue({
      messages: [
        {
          id: 'm2',
          role: 'assistant',
          parts: [
            {
              type: 'tool-result',
              toolCallId: 'tool-2',
              toolName: 'list_dir',
              input: { path: '.' },
              output: {
                path: '.',
                entries: [
                  { path: 'src', is_dir: true },
                  { path: 'README.md', is_dir: false },
                ],
              },
            },
            {
              type: 'tool-result',
              toolCallId: 'tool-3',
              toolName: 'run_command',
              input: { command: 'pwd' },
              output: {
                stdout: '/tmp/workspace\n',
                stderr: '',
              },
            },
            {
              type: 'tool-result',
              toolCallId: 'tool-4',
              toolName: 'git_status',
              input: {},
              output: {
                is_repo: true,
                files: [
                  { path: 'tracked.txt', status: 'modified' },
                  { path: 'notes/todo.txt', status: 'untracked' },
                ],
              },
            },
          ],
        },
      ],
      sendMessage: vi.fn(),
      status: 'ready',
      error: undefined,
      stop: vi.fn(),
    })

    render(<AiChat />)

    expect(mockRenderToolPart).toHaveBeenNthCalledWith(1, expect.objectContaining({
      name: 'list_dir',
      output: 'src/\nREADME.md',
      status: 'complete',
    }))
    expect(mockRenderToolPart).toHaveBeenNthCalledWith(2, expect.objectContaining({
      name: 'run_command',
      output: '/tmp/workspace',
      status: 'complete',
    }))
    expect(mockRenderToolPart).toHaveBeenNthCalledWith(3, expect.objectContaining({
      name: 'git_status',
      output: 'modified tracked.txt\nuntracked notes/todo.txt',
      status: 'complete',
    }))
  })

  it('renders only the final visible tool part for a tool call', () => {
    mockUseChat.mockReturnValue({
      messages: [
        {
          id: 'm3',
          role: 'assistant',
          parts: [
            { type: 'tool-call', toolCallId: 'tool-9', toolName: 'run_command', input: { command: 'pwd' } },
            {
              type: 'tool-result',
              toolCallId: 'tool-9',
              toolName: 'run_command',
              preliminary: true,
              input: { command: 'pwd' },
              output: { stdout: '/tmp/first\n', stderr: '' },
            },
            {
              type: 'tool-result',
              toolCallId: 'tool-9',
              toolName: 'run_command',
              input: { command: 'pwd' },
              output: { stdout: '/tmp/final\n', stderr: '' },
            },
          ],
        },
      ],
      sendMessage: vi.fn(),
      status: 'ready',
      error: undefined,
      stop: vi.fn(),
    })

    render(<AiChat />)

    expect(mockRenderToolPart).toHaveBeenCalledTimes(1)
    expect(mockRenderToolPart).toHaveBeenCalledWith(expect.objectContaining({
      name: 'run_command',
      output: '/tmp/final',
      status: 'complete',
    }))
  })
})
