import { describe, test, expect, vi, beforeEach } from 'vitest'

let capturedTransportOpts: Record<string, unknown> | undefined
// Exposed as refStore so tests can mutate it to simulate fresh opt reads.
// Points to the first ref created (optsRef inside useAgentChat).
const refStore = { current: undefined as unknown }
const allRefs: Array<{ current: unknown }> = []
const mockSetMessages = vi.fn()
const mockUseStateSetter = vi.fn()
const mockFetch = vi.fn()
const mockStorageGetItem = vi.fn()
const mockStorageSetItem = vi.fn()
let mockChatStatus: 'ready' | 'submitted' | 'streaming' | 'error' = 'ready'

vi.mock('@ai-sdk/react', () => ({
  useChat: vi.fn(() => ({
    id: 'mock-chat',
    messages: [],
    sendMessage: vi.fn(),
    status: mockChatStatus,
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

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return {
    ...actual,
    useMemo: <T>(fn: () => T) => fn(),
    useCallback: <T extends (...args: never[]) => unknown>(fn: T) => fn,
    useRef: (initial: unknown) => {
      const ref = { current: initial }
      allRefs.push(ref)
      if (allRefs.length === 1) {
        // Keep refStore in sync with the first ref (optsRef) so tests that
        // mutate refStore.current can still observe changes via the body fn.
        Object.defineProperty(refStore, 'current', {
          get: () => ref.current,
          set: (v) => { ref.current = v },
          configurable: true,
        })
      }
      return ref
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
  allRefs.length = 0
  mockSetMessages.mockReset()
  mockUseStateSetter.mockReset()
  mockStorageGetItem.mockReset()
  mockStorageSetItem.mockReset()
  mockFetch.mockReset()
  mockChatStatus = 'ready'
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

  test('marks the current session as hydrating until its own history load completes', () => {
    const result = useAgentChat({ sessionId: 'sess-1' })

    expect(result.hydratingMessages).toBe(true)
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

  test('does not resume completed cached histories on mount', () => {
    mockStorageGetItem.mockReturnValueOnce(JSON.stringify([
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'done' }] },
    ]))

    useAgentChat({ sessionId: 'sess-1' })

    expect(useChat).toHaveBeenCalledWith(
      expect.objectContaining({ resume: false }),
    )
  })

  test('treats stale SDK streaming state as ready for completed cached histories', () => {
    mockChatStatus = 'streaming'
    mockStorageGetItem.mockReturnValueOnce(JSON.stringify([
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'done' }] },
    ]))

    const result = useAgentChat({ sessionId: 'sess-1' })

    expect(result.status).toBe('ready')
  })

  test('resumes when cached history ends with an in-flight user message', () => {
    mockStorageGetItem.mockReturnValueOnce(JSON.stringify([
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'keep going' }] },
    ]))

    useAgentChat({ sessionId: 'sess-1' })

    expect(useChat).toHaveBeenCalledWith(
      expect.objectContaining({ resume: true }),
    )
  })

  test('resumes partial assistant text when the cached session status is active', () => {
    mockStorageGetItem.mockImplementation((key: string) => {
      if (key === 'boring-agent:messages:sess-1') {
        return JSON.stringify([
          { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
          { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'partial answer' }] },
        ])
      }
      if (key === 'boring-agent:status:sess-1') return 'active'
      return null
    })

    useAgentChat({ sessionId: 'sess-1' })

    expect(useChat).toHaveBeenCalledWith(
      expect.objectContaining({ resume: true }),
    )
  })

  test('shows an active resumed session as submitted while the SDK reconnects', () => {
    mockChatStatus = 'ready'
    mockStorageGetItem.mockImplementation((key: string) => {
      if (key === 'boring-agent:messages:sess-1') {
        return JSON.stringify([
          { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
          { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'partial answer' }] },
        ])
      }
      if (key === 'boring-agent:status:sess-1') return 'active'
      return null
    })

    const result = useAgentChat({ sessionId: 'sess-1' })

    expect(result.status).toBe('submitted')
  })

  test('marks stale SDK streaming state ready in the cached session status', () => {
    mockChatStatus = 'streaming'
    mockStorageGetItem.mockReturnValueOnce(JSON.stringify([
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'done' }] },
    ]))

    useAgentChat({ sessionId: 'sess-1' })

    expect(mockStorageSetItem).toHaveBeenCalledWith('boring-agent:status:sess-1', 'ready')
  })

  test('throttles AI SDK message-store updates while streaming', () => {
    useAgentChat({ sessionId: 'sess-1' })

    expect(useChat).toHaveBeenCalledWith(
      expect.objectContaining({ experimental_throttle: 50 }),
    )
  })

  test('caches the submitted user message synchronously before the stream starts', () => {
    mockStorageGetItem.mockReturnValue(JSON.stringify([]))
    const result = useAgentChat({ sessionId: 'sess-1' })
    mockStorageSetItem.mockClear()

    result.sendMessage({ text: 'message before switch', files: [] })

    const messagesWrite = mockStorageSetItem.mock.calls.find(([key]) => key === 'boring-agent:messages:sess-1')
    expect(messagesWrite).toBeDefined()
    const cached = JSON.parse(messagesWrite?.[1] as string)
    expect(cached).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^pending-user:/),
        role: 'user',
        parts: [{ type: 'text', text: 'message before switch' }],
      }),
    ])
    expect(mockStorageSetItem).toHaveBeenCalledWith('boring-agent:status:sess-1', 'active')
    expect(mockUseStateSetter).toHaveBeenCalledWith(expect.any(Function))
  })

  test('preserves a new optimistic user message even when it repeats an earlier prompt', () => {
    mockStorageGetItem.mockReturnValue(JSON.stringify([
      { id: 'u-old', role: 'user', parts: [{ type: 'text', text: 'same prompt' }] },
      { id: 'a-old', role: 'assistant', parts: [{ type: 'text', text: 'old answer' }] },
    ]))
    const result = useAgentChat({ sessionId: 'sess-repeat' })
    mockStorageSetItem.mockClear()

    result.sendMessage({ text: 'same prompt', files: [] })

    const messagesWrite = mockStorageSetItem.mock.calls.find(([key]) => key === 'boring-agent:messages:sess-repeat')
    const cached = JSON.parse(messagesWrite?.[1] as string)
    expect(cached).toHaveLength(3)
    expect(cached[2]).toEqual(expect.objectContaining({
      id: expect.stringMatching(/^pending-user:/),
      role: 'user',
      parts: [{ type: 'text', text: 'same prompt' }],
    }))
  })

  test('keeps an active partial assistant cache resumable when server history is stale', async () => {
    const cachedUser = { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'run long thing' }] }
    const partialAssistant = { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'partial answer' }] }
    mockChatStatus = 'streaming'
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ messages: [] }),
    })
    mockStorageGetItem.mockImplementation((key: string) => {
      if (key === 'boring-agent:messages:sess-1') return JSON.stringify([cachedUser, partialAssistant])
      if (key === 'boring-agent:status:sess-1') return 'active'
      return null
    })

    const result = useAgentChat({ sessionId: 'sess-1' })
    await flushPromises()

    expect(result.status).toBe('streaming')
    expect(useChat).toHaveBeenCalledWith(expect.objectContaining({ resume: true }))
    expect(mockStorageSetItem).not.toHaveBeenCalledWith('boring-agent:status:sess-1', 'ready')
  })

  test('clears an active marker when settled server history supersedes a partial cache', async () => {
    const cachedUser = { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'run long thing' }] }
    const partialAssistant = { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'partial answer' }] }
    const serverUser = { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'run long thing' }] }
    const serverTool = {
      id: 'a1',
      role: 'assistant',
      parts: [{ type: 'tool-bash', state: 'output-available', input: {}, output: [] }],
    }
    const serverDone = { id: 'a2', role: 'assistant', parts: [{ type: 'text', text: 'Done.' }] }
    mockChatStatus = 'streaming'
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ messages: [serverUser, serverTool, serverDone] }),
    })
    mockStorageGetItem.mockImplementation((key: string) => {
      if (key === 'boring-agent:messages:sess-1') return JSON.stringify([cachedUser, partialAssistant])
      if (key === 'boring-agent:status:sess-1') return 'active'
      return null
    })

    useAgentChat({ sessionId: 'sess-1' })
    await flushPromises()

    expect(mockStorageSetItem).toHaveBeenCalledWith('boring-agent:status:sess-1', 'ready')
    expect(mockUseStateSetter).toHaveBeenCalledWith('boring-agent:messages:sess-1')
  })

  test('places an optimistic pending user before the completed server assistant response', async () => {
    const pendingUser = { id: 'pending-user:123', role: 'user', parts: [{ type: 'text', text: 'message while switching' }] }
    const serverAssistant = { id: 'server-a1', role: 'assistant', parts: [{ type: 'text', text: 'done' }] }
    mockChatStatus = 'streaming'
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ messages: [serverAssistant] }),
    })
    mockStorageGetItem.mockImplementation((key: string) => {
      if (key === 'boring-agent:messages:sess-1') return JSON.stringify([pendingUser])
      if (key === 'boring-agent:status:sess-1') return 'active'
      return null
    })

    useAgentChat({ sessionId: 'sess-1' })
    await flushPromises()

    expect(mockSetMessages).toHaveBeenCalledWith([pendingUser, serverAssistant])
    expect(mockStorageSetItem).toHaveBeenCalledWith('boring-agent:status:sess-1', 'ready')
    expect(mockUseStateSetter).toHaveBeenCalledWith('boring-agent:messages:sess-1')
  })

  test('replaces an optimistic pending user message with the server copy when both exist', async () => {
    const serverUser = { id: 'server-u1', role: 'user', parts: [{ type: 'text', text: 'same message' }] }
    const serverAssistant = { id: 'server-a1', role: 'assistant', parts: [{ type: 'text', text: 'done' }] }
    const pendingUser = { id: 'pending-user:123', role: 'user', parts: [{ type: 'text', text: 'same message' }] }
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ messages: [serverUser, serverAssistant] }),
    })
    mockStorageGetItem.mockImplementation((key: string) => {
      if (key === 'boring-agent:messages:sess-1') return JSON.stringify([pendingUser])
      return null
    })

    useAgentChat({ sessionId: 'sess-1' })
    await flushPromises()

    expect(mockSetMessages).toHaveBeenCalledWith([serverUser, serverAssistant])
  })

  test('forwards onData callback to useChat', () => {
    const onData = vi.fn()

    useAgentChat({ sessionId: 'sess-1', onData })

    const calls = vi.mocked(useChat).mock.calls
    const lastCall = calls[calls.length - 1]?.[0] as { onData?: (part: unknown) => void }
    expect(typeof lastCall.onData).toBe('function')

    const dataPart = { type: 'data-file-changed', data: { path: 'x.ts' } }
    lastCall.onData?.(dataPart)

    // useAgentChat no longer invalidates queries directly — that work
    // moved to the workspace bus subscriber. It only forwards onData
    // through to the host (which may bridge it onto its bus).
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

  test('dedupes duplicate assistant text from cached snapshots during hydration', async () => {
    const serverUser = { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'yo respond me in 10 s' }] }
    const serverAssistant = {
      id: 'a1',
      role: 'assistant',
      parts: [
        { type: 'reasoning', text: '', state: 'done' },
        { type: 'text', text: 'yo — responding now ✅', state: 'done' },
      ],
    }
    const duplicateAssistant = {
      id: 'assistant-1780433653864',
      role: 'assistant',
      parts: [
        { type: 'reasoning', id: '0', text: '' },
        { type: 'text', text: 'yo — responding now ✅' },
      ],
    }
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ messages: [serverUser, serverAssistant] }),
    })
    mockStorageGetItem.mockReturnValue(JSON.stringify([serverUser, serverAssistant, duplicateAssistant]))

    useAgentChat({ sessionId: 'sess-duplicate-assistant' })
    await flushPromises()

    expect(mockSetMessages).toHaveBeenCalledWith([serverUser, serverAssistant])
  })

  test('merges cached in-flight user message with stale server history on reload', async () => {
    const serverOld = { id: 'server-old', role: 'assistant', parts: [{ type: 'text', text: 'old server state' }] }
    const cachedLocalUser = { id: 'local-u1', role: 'user', parts: [{ type: 'text', text: 'new message while running' }] }
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ messages: [serverOld] }),
    })
    mockStorageGetItem.mockReturnValue(JSON.stringify([serverOld, cachedLocalUser]))

    useAgentChat({ sessionId: 'sess-running-reload' })
    await flushPromises()

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/agent/chat/sess-running-reload/messages')
    expect(mockStorageGetItem).toHaveBeenCalledWith('boring-agent:messages:sess-running-reload')
    expect(mockSetMessages).toHaveBeenCalledWith([serverOld, cachedLocalUser])
  })

  test('does not collapse repeated user messages with distinct ids', async () => {
    vi.mocked(useChat).mockReturnValueOnce({
      id: 'mock-chat',
      messages: [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'retry this' }] },
        { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'retry this' }] },
      ],
      sendMessage: vi.fn(),
      status: 'ready',
      error: undefined,
      stop: vi.fn(),
      setMessages: mockSetMessages,
    } as unknown as ReturnType<typeof useChat>)

    useAgentChat({ sessionId: 'sess-repeat', hydrateMessages: false })
    await flushPromises()

    expect(mockSetMessages).not.toHaveBeenCalled()
  })

  test('merges late hydration with an in-flight local turn', async () => {
    vi.mocked(useChat).mockReturnValueOnce({
      id: 'mock-chat',
      messages: [{ id: 'local-u1', role: 'user', parts: [{ type: 'text', text: 'new draft' }] }],
      sendMessage: vi.fn(),
      status: 'submitted',
      error: undefined,
      stop: vi.fn(),
      setMessages: mockSetMessages,
    } as unknown as ReturnType<typeof useChat>)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        messages: [{ id: 'server-old', role: 'assistant', parts: [{ type: 'text', text: 'old server state' }] }],
      }),
    })

    useAgentChat({ sessionId: 'sess-race' })
    await flushPromises()

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/agent/chat/sess-race/messages')
    expect(mockSetMessages).toHaveBeenCalledWith([
      { id: 'server-old', role: 'assistant', parts: [{ type: 'text', text: 'old server state' }] },
      { id: 'local-u1', role: 'user', parts: [{ type: 'text', text: 'new draft' }] },
    ])
  })
})
