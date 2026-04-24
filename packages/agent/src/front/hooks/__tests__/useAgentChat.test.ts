import { describe, test, expect, vi, beforeEach } from 'vitest'

let capturedTransportOpts: Record<string, unknown> | undefined
const refStore = { current: undefined as unknown }
const mockOnFileChangeData = vi.fn()
const mockSetMessages = vi.fn()
const mockUseStateSetter = vi.fn()
const mockFetch = vi.fn()
const mockStorageGetItem = vi.fn()
const mockStorageSetItem = vi.fn()

vi.mock('@ai-sdk/react', () => ({
  useChat: vi.fn(() => ({
    messages: [],
    sendMessage: vi.fn(),
    status: 'ready' as const,
    error: undefined,
    stop: vi.fn(),
    setMessages: mockSetMessages,
  })),
}))

vi.mock('ai', () => ({
  DefaultChatTransport: vi.fn().mockImplementation((opts: unknown) => {
    capturedTransportOpts = opts as Record<string, unknown>
    return { __mockTransport: true }
  }),
}))

vi.mock('../useFileChangeStream', () => ({
  useFileChangeStream: () => ({ onData: mockOnFileChangeData }),
}))

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return {
    ...actual,
    useMemo: <T>(fn: () => T) => fn(),
    useRef: (initial: unknown) => {
      refStore.current = initial
      return refStore
    },
    useState: <T,>(initial: T | (() => T)) => [
      typeof initial === 'function' ? (initial as () => T)() : initial,
      mockUseStateSetter,
    ] as const,
    useEffect: (effect: () => void | (() => void)) => {
      effect()
    },
  }
})

import { useAgentChat } from '../useAgentChat'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'

async function flushPromises(iterations = 8): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve()
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  capturedTransportOpts = undefined
  mockSetMessages.mockReset()
  mockUseStateSetter.mockReset()
  mockStorageGetItem.mockReset()
  mockStorageSetItem.mockReset()
  mockFetch.mockReset()
  mockFetch.mockResolvedValue({
    ok: false,
    json: async () => null,
  })
  vi.stubGlobal('fetch', mockFetch)
  vi.stubGlobal('localStorage', {
    getItem: mockStorageGetItem,
    setItem: mockStorageSetItem,
  })
})

describe('useAgentChat', () => {
  test('calls useChat with correct sessionId', () => {
    useAgentChat({ sessionId: 'sess-1' })

    expect(useChat).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sess-1' }),
    )
  })

  test('creates DefaultChatTransport with correct api endpoint', () => {
    useAgentChat({ sessionId: 'sess-1' })

    expect(DefaultChatTransport).toHaveBeenCalledWith(
      expect.objectContaining({ api: '/api/v1/agent/chat' }),
    )
  })

  test('transport body is a function that returns current opts', () => {
    useAgentChat({
      sessionId: 'sess-1',
      model: { provider: 'anthropic', id: 'claude-3' },
      thinkingLevel: 'high',
    })

    expect(capturedTransportOpts).toBeDefined()
    const bodyFn = capturedTransportOpts!.body as () => Record<string, unknown>
    expect(typeof bodyFn).toBe('function')

    const body = bodyFn()
    expect(body).toEqual({
      sessionId: 'sess-1',
      model: { provider: 'anthropic', id: 'claude-3' },
      thinkingLevel: 'high',
    })
  })

  test('body function reads from ref for fresh values', () => {
    useAgentChat({
      sessionId: 'sess-1',
      model: { provider: 'anthropic', id: 'claude-3' },
      thinkingLevel: 'low',
    })

    refStore.current = {
      sessionId: 'sess-1',
      model: { provider: 'openai', id: 'gpt-4' },
      thinkingLevel: 'high',
    }

    const bodyFn = capturedTransportOpts!.body as () => Record<string, unknown>
    const body = bodyFn()

    expect(body.model).toEqual({ provider: 'openai', id: 'gpt-4' })
    expect(body.thinkingLevel).toBe('high')
  })

  test('omits optional fields when not provided', () => {
    useAgentChat({ sessionId: 'sess-2' })

    const bodyFn = capturedTransportOpts!.body as () => Record<string, unknown>
    const body = bodyFn()
    expect(body.sessionId).toBe('sess-2')
    expect(body.model).toBeUndefined()
    expect(body.thinkingLevel).toBeUndefined()
  })

  test('returns useChat result with expected shape', () => {
    const result = useAgentChat({ sessionId: 'sess-1' })

    expect(result).toHaveProperty('messages')
    expect(result).toHaveProperty('sendMessage')
    expect(result).toHaveProperty('status')
    expect(result).toHaveProperty('stop')
  })

  test('passes transport instance to useChat', () => {
    useAgentChat({ sessionId: 'sess-1' })

    const calls = vi.mocked(useChat).mock.calls
    const lastCall = calls[calls.length - 1]
    expect(lastCall[0]).toHaveProperty('transport')
    expect((lastCall[0] as Record<string, unknown>).transport).toEqual({
      __mockTransport: true,
    })
  })

  test('enables resume on useChat', () => {
    useAgentChat({ sessionId: 'sess-1' })

    expect(useChat).toHaveBeenCalledWith(
      expect.objectContaining({ resume: true }),
    )
  })

  test('forwards onData callback to useChat', () => {
    const onData = vi.fn()

    useAgentChat({ sessionId: 'sess-1', onData })

    const calls = vi.mocked(useChat).mock.calls
    const lastCall = calls[calls.length - 1]?.[0] as { onData?: (part: unknown) => void }
    expect(typeof lastCall.onData).toBe('function')

    const dataPart = { type: 'data-file-changed', data: { path: 'x.ts' } }
    lastCall.onData?.(dataPart)

    expect(mockOnFileChangeData).toHaveBeenCalledWith(dataPart)
    expect(onData).toHaveBeenCalledWith(dataPart)
  })

  test('hydrates full chat history from /messages endpoint on mount', async () => {
    const hydratedMessages = [
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: 'hi' }],
      },
      {
        id: 'a1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'hello' }],
      },
    ]
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ messages: hydratedMessages }),
    })

    useAgentChat({ sessionId: 'sess-refresh' })
    await flushPromises()

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/agent/chat/sess-refresh/messages',
    )
    expect(mockSetMessages).toHaveBeenCalledWith(hydratedMessages)
  })
})
