import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../../shared/error-codes'
import type { PiChatEvent, PiChatSnapshot } from '../../../../shared/chat'
import { PI_CHAT_CURSOR_AHEAD_CODE, PI_CHAT_REPLAY_GAP_CODE } from '../piChatStream'
import { RemotePiSession, piChatErrorCode } from '../remotePiSession'

const encoder = new TextEncoder()

function snapshot(overrides: Partial<PiChatSnapshot> = {}): PiChatSnapshot {
  return {
    protocolVersion: 1,
    sessionId: 's1',
    seq: 5,
    status: 'streaming',
    activeTurnId: 'turn-1',
    messages: [
      {
        id: 'u1',
        role: 'user',
        status: 'done',
        clientNonce: 'nonce-1',
        parts: [{ type: 'text', id: 'u1:text', text: 'hello' }],
      },
    ],
    queue: { followUps: [{ id: 'q1', kind: 'followup', clientNonce: 'nonce-q', clientSeq: 1, displayText: 'queued' }] },
    followUpMode: 'one-at-a-time',
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function openNdjsonStream() {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined
  const stream = new ReadableStream<Uint8Array>({
    start(nextController) {
      controller = nextController
    },
  })
  return {
    stream,
    write(frame: unknown) {
      controller?.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`))
    },
    error(error: unknown) {
      controller?.error(error)
    },
    close() {
      controller?.close()
    },
  }
}

function immediateStoreOptions() {
  return {
    scheduleNotify(notify: () => void) {
      notify()
      return 0
    },
    cancelNotify() {},
  }
}

type MockFetch = typeof globalThis.fetch & { mock: { calls: Array<[string, RequestInit?]> } }

function createSession(fetchMock: typeof globalThis.fetch, extra: Partial<ConstructorParameters<typeof RemotePiSession>[0]> = {}) {
  return new RemotePiSession({
    sessionId: 's1',
    workspaceId: 'workspace-a',
    storageScope: 'scope-a',
    apiBaseUrl: 'https://agent.test',
    fetch: fetchMock,
    storeOptions: immediateStoreOptions(),
    reconnect: { baseMs: 10, maxMs: 10, jitterRatio: 0, random: () => 0 },
    ...extra,
  })
}

async function flushPromises(times = 6): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve()
}

async function waitUntil(assertion: () => void | boolean, timeoutMs = 1000): Promise<void> {
  const started = Date.now()
  let lastError: unknown
  while (Date.now() - started < timeoutMs) {
    try {
      const result = assertion()
      if (result !== false) return
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  if (lastError) throw lastError
  throw new Error('condition was not met before timeout')
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

function installWindowLifecycleStub() {
  const listeners = new Map<string, Set<EventListener>>()
  const addEventListener = vi.fn((type: string, listener: EventListener) => {
    const current = listeners.get(type) ?? new Set<EventListener>()
    current.add(listener)
    listeners.set(type, current)
  })
  const removeEventListener = vi.fn((type: string, listener: EventListener) => {
    listeners.get(type)?.delete(listener)
  })
  const dispatch = (type: string) => {
    for (const listener of listeners.get(type) ?? []) listener(new Event(type))
  }
  vi.stubGlobal('window', { addEventListener, removeEventListener })
  return { addEventListener, removeEventListener, dispatch }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('RemotePiSession', () => {
  it('hydrates /state before replay and connects /events with cursor=snapshot.seq for active reload', async () => {
    const events = openNdjsonStream()
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/state')) return jsonResponse(snapshot({ seq: 42 }))
      if (url.endsWith('/events?cursor=42')) return new Response(events.stream)
      throw new Error(`unexpected URL ${url}`)
    }) as unknown as MockFetch
    const session = createSession(fetchMock)

    await waitUntil(() => fetchMock.mock.calls.length >= 2)

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://agent.test/api/v1/agent/pi-chat/s1/state')
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://agent.test/api/v1/agent/pi-chat/s1/events?cursor=42')
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ headers: { 'x-boring-storage-scope': 'scope-a' } })
    expect(session.getState()).toMatchObject({ hydrated: true, lastSeq: 42, status: 'streaming', turnId: 'turn-1' })
    expect(session.getState().committedMessages).toHaveLength(1)
    expect(session.getState().queue.followUps).toEqual([expect.objectContaining({ displayText: 'queued' })])

    events.write({ type: 'message-start', seq: 43, messageId: 'a1', role: 'assistant' } satisfies PiChatEvent)
    await waitUntil(() => session.getState().lastSeq === 43)
    expect(session.getState().streamingMessage).toMatchObject({ id: 'a1', role: 'assistant' })

    session.dispose()
  })

  it('silently reconnects after a hung event stream connect times out', async () => {
    const events = openNdjsonStream()
    let eventCalls = 0
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('/state')) return Promise.resolve(jsonResponse(snapshot({ seq: 7, status: 'idle', activeTurnId: undefined })))
      if (url.endsWith('/events?cursor=7')) {
        eventCalls += 1
        if (eventCalls === 1) {
          const signal = init?.signal
          return new Promise<Response>((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
          })
        }
        return Promise.resolve(new Response(events.stream))
      }
      throw new Error(`unexpected URL ${url}`)
    }) as unknown as MockFetch
    const session = createSession(fetchMock, { requestTimeoutMs: 20 })

    await waitUntil(() => eventCalls >= 2, 3000)
    await waitUntil(() => session.getState().connection.state === 'connected', 3000)

    expect(session.getState().notices.some((notice) => notice.id === 'protocol-error')).toBe(false)
    expect(session.getState().error).toBeUndefined()

    session.dispose()
  })

  it('recovers a hung /state hydration via the request timeout instead of stalling forever', async () => {
    // First /state never settles (saturated/restarting server). Without a
    // per-attempt timeout the chat stays stuck "Loading chat history…"; the
    // timeout must abort it so the reconnect loop re-issues a fresh request
    // that succeeds — no remount/workspace-switch needed.
    const events = openNdjsonStream()
    let stateCalls = 0
    const hang = deferred<Response>()
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('/state')) {
        stateCalls += 1
        if (stateCalls === 1) {
          // Hang until aborted by the request timeout.
          const signal = init?.signal
          return new Promise<Response>((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
          })
        }
        return Promise.resolve(jsonResponse(snapshot({ seq: 7 })))
      }
      if (url.endsWith('/events?cursor=7')) return Promise.resolve(new Response(events.stream))
      return hang.promise
    }) as unknown as MockFetch
    const session = createSession(fetchMock, { requestTimeoutMs: 20 })

    await waitUntil(() => session.getState().hydrated === true, 3000)
    expect(session.getState()).toMatchObject({ hydrated: true, lastSeq: 7 })
    expect(stateCalls).toBeGreaterThanOrEqual(2)

    session.dispose()
  })

  it('rehydrates /state and reconnects from returned seq on replay_gap route errors', async () => {
    const events = openNdjsonStream()
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/state') && fetchMock.mock.calls.length === 1) return jsonResponse(snapshot({ seq: 10 }))
      if (url.endsWith('/events?cursor=10')) {
        return jsonResponse({
          error: {
            code: ErrorCode.enum.CURSOR_OUT_OF_RANGE,
            message: PI_CHAT_REPLAY_GAP_CODE,
            retryable: true,
            details: { reason: PI_CHAT_REPLAY_GAP_CODE, latestSeq: 20, minReplaySeq: 18 },
          },
        }, 409)
      }
      if (url.endsWith('/state')) return jsonResponse(snapshot({ seq: 20, status: 'idle', activeTurnId: undefined }))
      if (url.endsWith('/events?cursor=20')) return new Response(events.stream)
      throw new Error(`unexpected URL ${url}`)
    }) as unknown as MockFetch
    const session = createSession(fetchMock)

    await waitUntil(() => fetchMock.mock.calls.some((call) => String(call[0]).endsWith('/events?cursor=20')))

    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      'https://agent.test/api/v1/agent/pi-chat/s1/state',
      'https://agent.test/api/v1/agent/pi-chat/s1/events?cursor=10',
      'https://agent.test/api/v1/agent/pi-chat/s1/state',
      'https://agent.test/api/v1/agent/pi-chat/s1/events?cursor=20',
    ])
    expect(session.getState()).toMatchObject({ hydrated: true, lastSeq: 20, status: 'idle' })
    expect(session.getState().committedMessages).toHaveLength(1)

    session.dispose()
  })

  it('also rehydrates /state on cursor_ahead route errors', async () => {
    const events = openNdjsonStream()
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/state') && fetchMock.mock.calls.length === 1) {
        return jsonResponse(snapshot({
          seq: 30,
          messages: [
            {
              id: 'u1',
              role: 'user',
              status: 'done',
              parts: [{ type: 'text', id: 'u1:text', text: 'stale ahead text' }],
            },
          ],
        }))
      }
      if (url.endsWith('/events?cursor=30')) {
        return jsonResponse({
          error: {
            code: ErrorCode.enum.CURSOR_OUT_OF_RANGE,
            message: PI_CHAT_CURSOR_AHEAD_CODE,
            retryable: true,
            details: { reason: PI_CHAT_CURSOR_AHEAD_CODE, latestSeq: 24 },
          },
        }, 409)
      }
      if (url.endsWith('/state')) {
        return jsonResponse(snapshot({
          seq: 24,
          status: 'idle',
          activeTurnId: undefined,
          messages: [
            {
              id: 'u1',
              role: 'user',
              status: 'done',
              parts: [{ type: 'text', id: 'u1:text', text: 'canonical text' }],
            },
          ],
        }))
      }
      if (url.endsWith('/events?cursor=24')) return new Response(events.stream)
      throw new Error(`unexpected URL ${url}`)
    }) as unknown as MockFetch
    const session = createSession(fetchMock)

    await waitUntil(() => fetchMock.mock.calls.some((call) => String(call[0]).endsWith('/events?cursor=24')))

    expect(session.getState()).toMatchObject({ hydrated: true, lastSeq: 24, status: 'idle' })
    expect(session.getState().committedMessages).toEqual([
      expect.objectContaining({ id: 'u1', parts: [expect.objectContaining({ text: 'canonical text' })] }),
    ])

    session.dispose()
  })

  it('survives repeated replay range recovery and a live seq gap without duplicating messages', async () => {
    const streamAfterRouteGaps = openNdjsonStream()
    const finalStream = openNdjsonStream()
    let stateReads = 0
    const assistantAfterFirstGap = {
      id: 'a1',
      role: 'assistant' as const,
      status: 'streaming' as const,
      parts: [
        { type: 'reasoning' as const, id: 'r1', text: 'thinking after first gap', state: 'done' as const },
      ],
    }
    const assistantAfterSecondGap = {
      id: 'a1',
      role: 'assistant' as const,
      status: 'streaming' as const,
      parts: [
        { type: 'reasoning' as const, id: 'r1', text: 'thinking after first gap', state: 'done' as const },
        {
          type: 'tool-call' as const,
          id: 'tool-1',
          toolName: 'bash',
          state: 'output-available' as const,
          output: 'redacted tool output',
        },
      ],
    }
    const finalAssistant = {
      id: 'a1',
      role: 'assistant' as const,
      status: 'done' as const,
      parts: [
        ...assistantAfterSecondGap.parts,
        { type: 'text' as const, id: 't1', text: 'final after replay churn' },
      ],
    }
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/state')) {
        stateReads += 1
        if (stateReads === 1) return jsonResponse(snapshot({ seq: 10 }))
        if (stateReads === 2) return jsonResponse(snapshot({ seq: 14, messages: [snapshot().messages[0]!, assistantAfterFirstGap] }))
        if (stateReads === 3) return jsonResponse(snapshot({ seq: 20, messages: [snapshot().messages[0]!, assistantAfterSecondGap] }))
        return jsonResponse(snapshot({
          seq: 22,
          messages: [snapshot().messages[0]!, assistantAfterSecondGap],
        }))
      }
      if (url.endsWith('/events?cursor=10')) {
        return jsonResponse({
          error: {
            code: ErrorCode.enum.CURSOR_OUT_OF_RANGE,
            message: PI_CHAT_REPLAY_GAP_CODE,
            retryable: true,
            details: { reason: PI_CHAT_REPLAY_GAP_CODE, latestSeq: 14, minReplaySeq: 13 },
          },
        }, 409)
      }
      if (url.endsWith('/events?cursor=14')) {
        return jsonResponse({
          error: {
            code: ErrorCode.enum.CURSOR_OUT_OF_RANGE,
            message: PI_CHAT_REPLAY_GAP_CODE,
            retryable: true,
            details: { reason: PI_CHAT_REPLAY_GAP_CODE, latestSeq: 20, minReplaySeq: 19 },
          },
        }, 409)
      }
      if (url.endsWith('/events?cursor=20')) return new Response(streamAfterRouteGaps.stream)
      if (url.endsWith('/events?cursor=22')) return new Response(finalStream.stream)
      throw new Error(`unexpected URL ${url}`)
    }) as unknown as MockFetch
    const session = createSession(fetchMock)

    await waitUntil(() => fetchMock.mock.calls.some((call) => String(call[0]).endsWith('/events?cursor=20')))
    expect(session.getState()).toMatchObject({
      hydrated: true,
      lastSeq: 20,
      committedMessages: [
        expect.objectContaining({ id: 'u1' }),
        expect.objectContaining({ id: 'a1', parts: [expect.objectContaining({ type: 'reasoning' }), expect.objectContaining({ type: 'tool-call' })] }),
      ],
    })

    streamAfterRouteGaps.write({ type: 'message-start', seq: 22, messageId: 'a-gap', role: 'assistant' } satisfies PiChatEvent)
    await waitUntil(() => fetchMock.mock.calls.some((call) => String(call[0]).endsWith('/events?cursor=22')))
    expect(session.getState()).toMatchObject({ hydrated: true, lastSeq: 22 })
    expect(session.getDebugState().gapCount).toBe(3)

    finalStream.write({ type: 'message-delta', seq: 23, messageId: 'a1', partId: 't1', kind: 'text', delta: 'final after replay churn' } satisfies PiChatEvent)
    finalStream.write({ type: 'message-part-end', seq: 24, messageId: 'a1', partId: 't1', kind: 'text', text: 'final after replay churn' } satisfies PiChatEvent)
    finalStream.write({ type: 'message-end', seq: 25, messageId: 'a1', final: finalAssistant } satisfies PiChatEvent)
    finalStream.write({ type: 'agent-end', seq: 26, turnId: 'turn-1', status: 'ok' } satisfies PiChatEvent)

    await waitUntil(() => session.getState().lastSeq === 26)
    const assistantMessages = session.getState().committedMessages.filter((message) => message.id === 'a1')
    expect(assistantMessages).toHaveLength(1)
    expect(assistantMessages[0]).toMatchObject({
      id: 'a1',
      status: 'done',
      parts: [
        expect.objectContaining({ type: 'reasoning', state: 'done' }),
        expect.objectContaining({ type: 'tool-call', state: 'output-available' }),
        expect.objectContaining({ type: 'text', text: 'final after replay churn' }),
      ],
    })
    expect(session.getState()).toMatchObject({ status: 'idle', streamingMessage: undefined, needsResync: undefined })
    expect(session.getState().committedMessages.map((message) => message.id)).toEqual(['u1', 'a1'])
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      'https://agent.test/api/v1/agent/pi-chat/s1/state',
      'https://agent.test/api/v1/agent/pi-chat/s1/events?cursor=10',
      'https://agent.test/api/v1/agent/pi-chat/s1/state',
      'https://agent.test/api/v1/agent/pi-chat/s1/events?cursor=14',
      'https://agent.test/api/v1/agent/pi-chat/s1/state',
      'https://agent.test/api/v1/agent/pi-chat/s1/events?cursor=20',
      'https://agent.test/api/v1/agent/pi-chat/s1/state',
      'https://agent.test/api/v1/agent/pi-chat/s1/events?cursor=22',
    ])

    session.dispose()
  })

  it('exposes safe debug metadata and large /state warnings without payload bodies or secrets', async () => {
    const events = openNdjsonStream()
    const warnings: unknown[] = []
    const sensitive = 'SECRET_PROMPT_TOKEN_/home/ubuntu/project/private.txt'
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/state')) {
        return jsonResponse(snapshot({
          seq: 5,
          messages: [
            { id: 'u1', role: 'user', status: 'done', parts: [{ type: 'text', id: 'u1:text', text: sensitive }] },
            { id: 'u2', role: 'user', status: 'done', parts: [{ type: 'text', id: 'u2:text', text: 'second' }] },
            { id: 'u3', role: 'user', status: 'done', parts: [{ type: 'text', id: 'u3:text', text: 'third' }] },
          ],
        }))
      }
      if (url.endsWith('/events?cursor=5')) return new Response(events.stream)
      if (url.endsWith('/prompt')) {
        const body = init?.body ? JSON.parse(String(init.body)) : undefined
        return jsonResponse({ accepted: true, cursor: 6, clientNonce: body.clientNonce })
      }
      throw new Error(`unexpected URL ${url}`)
    }) as unknown as MockFetch
    const session = createSession(fetchMock, {
      headers: { authorization: 'Bearer SECRET_TOKEN' },
      debug: { largeStateWarningMessages: 2, largeStateWarningBytes: 10, onWarning: (warning) => warnings.push(warning) },
    })

    await waitUntil(() => fetchMock.mock.calls.some((call) => String(call[0]).endsWith('/events?cursor=5')))
    events.write({ type: 'agent-start', seq: 6, turnId: 'turn-debug' } satisfies PiChatEvent)
    await waitUntil(() => session.getDebugState().lastSeq === 6)
    await session.prompt({
      message: 'never expose this prompt body',
      clientNonce: 'nonce-secret',
      attachments: [{ filename: 'secret.txt', url: 'file:///home/ubuntu/project/secret.txt' }],
    })

    const debug = session.getDebugState()
    expect(debug).toMatchObject({
      sessionId: 's1',
      lastSeq: 6,
      connection: 'connected',
      queue: { followUps: 1, optimisticOutbox: 1, pendingToolCalls: 0 },
      recentEventTypes: ['agent-start'],
      history: { mode: 'full', messageCount: 3, streamingMessageCount: 0 },
      largeStateWarning: expect.objectContaining({ type: 'large-state', sessionId: 's1', messageCount: 3 }),
    })
    expect(warnings).toEqual([expect.objectContaining({ type: 'large-state', sessionId: 's1', messageCount: 3 })])
    const serialized = JSON.stringify(debug)
    expect(serialized).not.toContain(sensitive)
    expect(serialized).not.toContain('SECRET_TOKEN')
    expect(serialized).not.toContain('never expose this prompt body')
    expect(serialized).not.toContain('file:///home/ubuntu/project/secret.txt')

    session.dispose()
  })

  it('increments safe gap counters for stream gaps and replay range recovery', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/state') && fetchMock.mock.calls.length === 1) return jsonResponse(snapshot({ seq: 10 }))
      if (url.endsWith('/events?cursor=10')) {
        return jsonResponse({
          error: {
            code: ErrorCode.enum.CURSOR_OUT_OF_RANGE,
            message: PI_CHAT_REPLAY_GAP_CODE,
            retryable: true,
            details: { reason: PI_CHAT_REPLAY_GAP_CODE, latestSeq: 20, minReplaySeq: 18 },
          },
        }, 409)
      }
      if (url.endsWith('/state')) return jsonResponse(snapshot({ seq: 20, status: 'idle', activeTurnId: undefined }))
      if (url.endsWith('/events?cursor=20')) return new Response(openNdjsonStream().stream)
      throw new Error(`unexpected URL ${url}`)
    }) as unknown as MockFetch
    const session = createSession(fetchMock)

    await waitUntil(() => fetchMock.mock.calls.some((call) => String(call[0]).endsWith('/events?cursor=20')))

    expect(session.getDebugState().gapCount).toBe(1)
    expect(JSON.stringify(session.getDebugState())).not.toContain('latestSeq')

    session.dispose()
  })

  it('shows a protocol runtime notice and does not open events for unsupported /state protocol versions', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/state')) return jsonResponse({ ...snapshot(), protocolVersion: 2 })
      throw new Error(`unexpected URL ${url}`)
    }) as unknown as MockFetch
    const session = createSession(fetchMock)

    await waitUntil(() => session.getState().notices.some((notice) => notice.id === 'protocol-error'))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(session.getState().hydrated).toBe(false)
    expect(session.getState().connection.state).toBe('reconnecting')
    expect(session.getState().notices).toContainEqual(expect.objectContaining({
      id: 'protocol-error',
      level: 'error',
      text: 'Unsupported Pi chat protocol version: 2',
    }))

    session.dispose()
  })

  it('aborts fetches, clears reconnect timers, and ignores stale callbacks after dispose', async () => {
    vi.useFakeTimers()
    const stateResponse = deferred<Response>()
    let stateSignal: AbortSignal | undefined
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('/state')) {
        stateSignal = init?.signal as AbortSignal | undefined
        return stateResponse.promise
      }
      return Promise.resolve(jsonResponse({}, 500))
    }) as unknown as MockFetch
    const listener = vi.fn()
    const session = createSession(fetchMock)
    const unsubscribe = session.subscribe(listener)

    await vi.waitFor(() => expect(stateSignal).toBeDefined())
    session.dispose()
    unsubscribe()
    listener.mockClear()

    expect(stateSignal?.aborted).toBe(true)
    expect(session.getDebugState()).toMatchObject({ disposed: true, hasReconnectTimer: false, inflightFetches: 0 })

    stateResponse.resolve(jsonResponse(snapshot({ seq: 99 })))
    await vi.runAllTimersAsync()
    await flushPromises()

    expect(session.getState().hydrated).toBe(false)
    expect(session.getState().lastSeq).toBe(0)
    expect(listener).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears scheduled reconnect timers on dispose', async () => {
    const timers = new Set<object>()
    let clearTimeoutCalls = 0
    const setTimeoutFn = ((_callback: () => void, _delay?: number) => {
      const handle = {}
      timers.add(handle)
      return handle
    }) as unknown as typeof globalThis.setTimeout
    const clearTimeoutFn = ((handle: object) => {
      clearTimeoutCalls += 1
      timers.delete(handle)
    }) as unknown as typeof globalThis.clearTimeout
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/state')) return jsonResponse(snapshot({ seq: 7 }))
      if (url.endsWith('/events?cursor=7')) return jsonResponse({ error: { message: 'down' } }, 503)
      throw new Error(`unexpected URL ${url}`)
    }) as unknown as MockFetch
    const session = createSession(fetchMock, { setTimeoutFn, clearTimeoutFn })

    await waitUntil(() => session.getDebugState().hasReconnectTimer)
    expect(timers.size).toBe(1)

    session.dispose()

    expect(session.getDebugState().hasReconnectTimer).toBe(false)
    expect(timers.size).toBe(0)
    expect(clearTimeoutCalls).toBe(1)
  })

  it('ignores event stream closure while the page is unloading', async () => {
    const lifecycle = installWindowLifecycleStub()
    const events = openNdjsonStream()
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/state')) return jsonResponse(snapshot({ seq: 5, status: 'idle', activeTurnId: undefined }))
      if (url.endsWith('/events?cursor=5')) return new Response(events.stream)
      throw new Error(`unexpected URL ${url}`)
    }) as unknown as MockFetch
    const session = createSession(fetchMock)

    await waitUntil(() => session.getState().connection.state === 'connected')

    lifecycle.dispatch('pagehide')
    events.error(new Error('Error in input stream'))
    await flushPromises()

    expect(session.getState().notices.some((notice) => notice.id === 'protocol-error')).toBe(false)
    expect(session.getDebugState().hasReconnectTimer).toBe(false)

    lifecycle.dispatch('pageshow')
    session.dispose()
    vi.unstubAllGlobals()
  })

  it('does not start fetches from commands after dispose', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ accepted: true, cursor: 1 })) as unknown as MockFetch
    const session = createSession(fetchMock, { autoStart: false })

    session.dispose()

    await expect(session.prompt({ message: 'hello', clientNonce: 'nonce-1' })).rejects.toMatchObject({ name: 'AbortError' })
    await expect(session.followUp({ message: 'next', clientNonce: 'nonce-2', clientSeq: 1 })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('starts idle without hydration when autoStart is false', () => {
    const fetchMock = vi.fn(async () => jsonResponse(snapshot())) as unknown as MockFetch
    const session = createSession(fetchMock, { autoStart: false })

    expect(session.getState()).toMatchObject({
      status: 'idle',
      hydrated: false,
      connection: { state: 'disconnected' },
    })
    expect(fetchMock).not.toHaveBeenCalled()

    session.dispose()
  })

  it('opens events from the current cursor before the first command when autoStart is false', async () => {
    const events = openNdjsonStream()
    const promptResponse = deferred<Response>()
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      if (url.endsWith('/events?cursor=0')) return new Response(events.stream)
      if (url.endsWith('/prompt')) return promptResponse.promise.then((response) => {
        expect(body.clientNonce).toBe('nonce-1')
        return response
      })
      throw new Error(`unexpected URL ${url}`)
    }) as unknown as MockFetch
    const session = createSession(fetchMock, { autoStart: false })

    const receipt = session.prompt({ message: 'hello', clientNonce: 'nonce-1' })
    await waitUntil(() => fetchMock.mock.calls.some((call) => String(call[0]).endsWith('/events?cursor=0')))
    await waitUntil(() => session.getState().connection.state === 'connected')

    expect(fetchMock.mock.calls.map((call) => String(call[0]))).not.toContain('https://agent.test/api/v1/agent/pi-chat/s1/state')
    const eventCallIndex = fetchMock.mock.calls.findIndex((call) => String(call[0]).endsWith('/events?cursor=0'))
    await waitUntil(() => fetchMock.mock.calls.some((call) => String(call[0]).endsWith('/prompt')))
    const promptCallIndex = fetchMock.mock.calls.findIndex((call) => String(call[0]).endsWith('/prompt'))
    expect(eventCallIndex).toBeLessThan(promptCallIndex)
    expect(session.getState()).toMatchObject({ hydrated: true, lastSeq: 0, connection: { state: 'connected' } })

    events.write({ type: 'agent-start', seq: 1, turnId: 'turn-1' } satisfies PiChatEvent)
    await waitUntil(() => session.getState().lastSeq === 1)
    expect(session.getState().status).toBe('streaming')
    promptResponse.resolve(jsonResponse({ accepted: true, cursor: 1, clientNonce: 'nonce-1' }))
    await expect(receipt).resolves.toEqual({ accepted: true, cursor: 1, clientNonce: 'nonce-1' })

    session.dispose()
  })

  it('rolls back optimistic follow-ups when the follow-up command fails', async () => {
    const events = openNdjsonStream()
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/events?cursor=0')) return new Response(events.stream)
      if (url.endsWith('/followup')) return jsonResponse({ error: { message: 'queue failed' } }, 500)
      throw new Error(`unexpected URL ${url}`)
    }) as unknown as MockFetch
    const session = createSession(fetchMock, { autoStart: false })

    await expect(session.followUp({ message: 'queued', clientNonce: 'nonce-q', clientSeq: 1 })).rejects.toThrow('queue failed')

    expect(session.getState().optimisticOutbox).toEqual({})

    session.dispose()
  })

  it('surfaces the stable, canonical server error code from a rejected command via piChatErrorCode', async () => {
    const events = openNdjsonStream()
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/events?cursor=0')) return new Response(events.stream)
      if (url.endsWith('/prompt')) {
        return jsonResponse({ error: { code: ErrorCode.enum.SESSION_LOCKED, message: 'locked' } }, 423)
      }
      throw new Error(`unexpected URL ${url}`)
    }) as unknown as MockFetch
    const session = createSession(fetchMock, { autoStart: false })

    const error = await session.prompt({ message: 'hello', clientNonce: 'nonce-1' }).then(
      () => { throw new Error('prompt should have rejected') },
      (err: unknown) => err,
    )
    expect(piChatErrorCode(error)).toBe(ErrorCode.enum.SESSION_LOCKED)
    // The rejection also rolls back the optimistic message so the composer recovers.
    expect(session.getState().optimisticOutbox).toEqual({})

    session.dispose()
  })

  it('piChatErrorCode ignores non-canonical/missing codes and reads a plain canonical errorCode', () => {
    expect(piChatErrorCode(new Error('boom'))).toBeUndefined()
    expect(piChatErrorCode(undefined)).toBeUndefined()
    // A non-canonical code must NOT be surfaced as a host action key.
    expect(piChatErrorCode(Object.assign(new Error('x'), { errorCode: 'NOT_A_REAL_CODE' }))).toBeUndefined()
    expect(piChatErrorCode(Object.assign(new Error('x'), { errorCode: ErrorCode.enum.SESSION_LOCKED }))).toBe(ErrorCode.enum.SESSION_LOCKED)
  })

  it('clears optimistic queued follow-ups from the stop receipt before a queue echo arrives', async () => {
    const events = openNdjsonStream()
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      if (url.endsWith('/events?cursor=0')) return new Response(events.stream)
      if (url.endsWith('/followup')) return jsonResponse({ accepted: true, cursor: 1, clientNonce: body.clientNonce, clientSeq: body.clientSeq, queued: true })
      if (url.endsWith('/stop')) {
        return jsonResponse({
          accepted: true,
          cursor: 2,
          stopped: true,
          clearedQueue: [{ id: 'q1', kind: 'followup', clientNonce: 'nonce-q', clientSeq: 1, displayText: 'queued' }],
        })
      }
      throw new Error(`unexpected URL ${url}`)
    }) as unknown as MockFetch
    const session = createSession(fetchMock, { autoStart: false })

    await expect(session.followUp({ message: 'queued', clientNonce: 'nonce-q', clientSeq: 1 })).resolves.toEqual({
      accepted: true,
      cursor: 1,
      clientNonce: 'nonce-q',
      clientSeq: 1,
      queued: true,
    })
    expect(session.getState().optimisticOutbox['nonce-q']).toMatchObject({ status: 'pending', clientSeq: 1 })

    await expect(session.stop()).resolves.toEqual({
      accepted: true,
      cursor: 2,
      stopped: true,
      clearedQueue: [{ id: 'q1', kind: 'followup', clientNonce: 'nonce-q', clientSeq: 1, displayText: 'queued' }],
    })

    expect(session.getState().optimisticOutbox).toEqual({})

    session.dispose()
  })

  it('does not start stale hydration fetches when async headers resolve after dispose', async () => {
    const headers = deferred<Record<string, string>>()
    const fetchMock = vi.fn(async () => jsonResponse(snapshot({ seq: 99 }))) as unknown as MockFetch
    const session = createSession(fetchMock, { headers: () => headers.promise })

    await flushPromises()
    session.dispose()
    headers.resolve({ authorization: 'Bearer redacted' })
    await flushPromises()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(session.getState().hydrated).toBe(false)
  })

  it('posts commands through the remote session seam and keeps command receipts out of canonical transcript', async () => {
    const events = openNdjsonStream()
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      if (url.endsWith('/prompt')) return jsonResponse({ accepted: true, cursor: 1, clientNonce: body.clientNonce })
      if (url.endsWith('/events?cursor=0')) return new Response(events.stream)
      if (url.endsWith('/followup')) return jsonResponse({ accepted: true, cursor: 2, clientNonce: body.clientNonce, clientSeq: body.clientSeq, queued: true })
      if (url.endsWith('/queue/clear')) return jsonResponse({ accepted: true, cursor: 3, cleared: 1 })
      if (url.endsWith('/interrupt')) return jsonResponse({ accepted: true, cursor: 4 })
      if (url.endsWith('/stop')) return jsonResponse({ accepted: true, cursor: 5, stopped: true, clearedQueue: [] })
      throw new Error(`unexpected URL ${url}`)
    }) as unknown as MockFetch
    const session = createSession(fetchMock, { autoStart: false })

    await expect(session.prompt({ message: 'hello', clientNonce: 'nonce-1', attachments: [{ filename: 'a.txt', url: 'https://file.test/a.txt' }] })).resolves.toEqual({ accepted: true, cursor: 1, clientNonce: 'nonce-1' })
    await expect(session.followUp({ message: 'queued', clientNonce: 'nonce-q', clientSeq: 1 })).resolves.toEqual({ accepted: true, cursor: 2, clientNonce: 'nonce-q', clientSeq: 1, queued: true })
    await expect(session.clearQueue({ clientNonce: 'nonce-q', clientSeq: 1 })).resolves.toEqual({ accepted: true, cursor: 3, cleared: 1 })
    await expect(session.interrupt()).resolves.toEqual({ accepted: true, cursor: 4 })
    await expect(session.stop()).resolves.toEqual({ accepted: true, cursor: 5, stopped: true, clearedQueue: [] })

    const postCalls = fetchMock.mock.calls.filter((call) => (call[1] as RequestInit | undefined)?.method === 'POST')
    expect(postCalls.map((call) => [String(call[0]), (call[1] as RequestInit | undefined)?.method])).toEqual([
      ['https://agent.test/api/v1/agent/pi-chat/s1/prompt', 'POST'],
      ['https://agent.test/api/v1/agent/pi-chat/s1/followup', 'POST'],
      ['https://agent.test/api/v1/agent/pi-chat/s1/queue/clear', 'POST'],
      ['https://agent.test/api/v1/agent/pi-chat/s1/interrupt', 'POST'],
      ['https://agent.test/api/v1/agent/pi-chat/s1/stop', 'POST'],
    ])
    expect(JSON.parse(String(postCalls[2]?.[1]?.body))).toEqual({ clientNonce: 'nonce-q', clientSeq: 1 })
    expect(session.getState().committedMessages).toEqual([])
    expect(session.getState().optimisticOutbox['nonce-1']).toMatchObject({
      role: 'user',
      status: 'pending',
      clientNonce: 'nonce-1',
      createdAt: expect.any(String),
    })
    expect(Date.parse(session.getState().optimisticOutbox['nonce-1']?.createdAt ?? '')).not.toBeNaN()
    expect(session.getState().optimisticOutbox['nonce-q']).toBeUndefined()

    session.dispose()
  })
})
