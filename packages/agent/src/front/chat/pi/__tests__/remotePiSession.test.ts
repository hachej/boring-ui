import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../../shared/error-codes'
import type { PiChatEvent, PiChatSnapshot } from '../../../../shared/chat'
import { PI_CHAT_CURSOR_AHEAD_CODE, PI_CHAT_REPLAY_GAP_CODE } from '../piChatStream'
import { RemotePiSession } from '../remotePiSession'

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
      if (url.endsWith('/state') && fetchMock.mock.calls.length === 1) return jsonResponse(snapshot({ seq: 10 }))
      if (url.endsWith('/events?cursor=10')) {
        return jsonResponse({
          error: {
            code: ErrorCode.enum.CURSOR_OUT_OF_RANGE,
            message: PI_CHAT_CURSOR_AHEAD_CODE,
            retryable: true,
            details: { reason: PI_CHAT_CURSOR_AHEAD_CODE, latestSeq: 12 },
          },
        }, 409)
      }
      if (url.endsWith('/state')) return jsonResponse(snapshot({ seq: 12, status: 'idle', activeTurnId: undefined }))
      if (url.endsWith('/events?cursor=12')) return new Response(events.stream)
      throw new Error(`unexpected URL ${url}`)
    }) as unknown as MockFetch
    const session = createSession(fetchMock)

    await waitUntil(() => fetchMock.mock.calls.some((call) => String(call[0]).endsWith('/events?cursor=12')))

    expect(session.getState()).toMatchObject({ hydrated: true, lastSeq: 12, status: 'idle' })

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

  it('does not start fetches from commands after dispose', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ accepted: true, cursor: 1 })) as unknown as MockFetch
    const session = createSession(fetchMock, { autoStart: false })

    session.dispose()

    await expect(session.prompt({ message: 'hello', clientNonce: 'nonce-1' })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
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
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      if (url.endsWith('/prompt')) return jsonResponse({ accepted: true, cursor: 1, clientNonce: body.clientNonce })
      if (url.endsWith('/followup')) return jsonResponse({ accepted: true, cursor: 2, clientNonce: body.clientNonce, clientSeq: body.clientSeq, queued: true })
      if (url.endsWith('/queue/clear')) return jsonResponse({ accepted: true, cursor: 3, cleared: 1 })
      if (url.endsWith('/interrupt')) return jsonResponse({ accepted: true, cursor: 4 })
      if (url.endsWith('/stop')) return jsonResponse({ accepted: true, cursor: 5, stopped: true, clearedQueue: [] })
      throw new Error(`unexpected URL ${url}`)
    }) as unknown as MockFetch
    const session = createSession(fetchMock, { autoStart: false })

    await expect(session.prompt({ message: 'hello', clientNonce: 'nonce-1', attachments: [{ filename: 'a.txt', url: 'https://file.test/a.txt' }] })).resolves.toEqual({ accepted: true, cursor: 1, clientNonce: 'nonce-1' })
    await expect(session.followUp({ message: 'queued', clientNonce: 'nonce-q', clientSeq: 1 })).resolves.toEqual({ accepted: true, cursor: 2, clientNonce: 'nonce-q', clientSeq: 1, queued: true })
    await expect(session.clearQueue()).resolves.toEqual({ accepted: true, cursor: 3, cleared: 1 })
    await expect(session.interrupt()).resolves.toEqual({ accepted: true, cursor: 4 })
    await expect(session.stop()).resolves.toEqual({ accepted: true, cursor: 5, stopped: true, clearedQueue: [] })

    expect(fetchMock.mock.calls.map((call) => [String(call[0]), (call[1] as RequestInit | undefined)?.method])).toEqual([
      ['https://agent.test/api/v1/agent/pi-chat/s1/prompt', 'POST'],
      ['https://agent.test/api/v1/agent/pi-chat/s1/followup', 'POST'],
      ['https://agent.test/api/v1/agent/pi-chat/s1/queue/clear', 'POST'],
      ['https://agent.test/api/v1/agent/pi-chat/s1/interrupt', 'POST'],
      ['https://agent.test/api/v1/agent/pi-chat/s1/stop', 'POST'],
    ])
    expect(session.getState().committedMessages).toEqual([])
    expect(session.getState().optimisticOutbox['nonce-1']).toMatchObject({ role: 'user', status: 'pending', clientNonce: 'nonce-1' })

    session.dispose()
  })
})
