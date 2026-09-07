import { describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../../shared/error-codes'
import { AgentGatewayErrorCode } from '../../../../shared/gateway/errors'
import type { PiChatSnapshot } from '../../../../shared/chat'
import { RemotePiSession, piChatErrorCode } from '../remotePiSession'

const encoder = new TextEncoder()

function jsonResponse(body: unknown, status = 200): Response {
  const addressed = typeof body === 'object' && body !== null && 'protocolVersion' in body
    ? { ref: { agentTypeId: 'default', sessionId: (body as PiChatSnapshot).sessionId }, state: body }
    : body
  return new Response(JSON.stringify(addressed), { status, headers: { 'Content-Type': 'application/json' } })
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
    agentTypeId: 'default',
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

describe('RemotePiSession commands and idempotency', () => {
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

  it('piChatErrorCode ignores unknown codes and reads shared or gateway errorCode values', () => {
    expect(piChatErrorCode(new Error('boom'))).toBeUndefined()
    expect(piChatErrorCode(undefined)).toBeUndefined()
    // A non-canonical code must NOT be surfaced as a host action key.
    expect(piChatErrorCode(Object.assign(new Error('x'), { errorCode: 'NOT_A_REAL_CODE' }))).toBeUndefined()
    expect(piChatErrorCode(Object.assign(new Error('x'), { errorCode: ErrorCode.enum.SESSION_LOCKED }))).toBe(ErrorCode.enum.SESSION_LOCKED)
    expect(piChatErrorCode(Object.assign(new Error('x'), {
      errorCode: AgentGatewayErrorCode.AGENT_COMMAND_INVALID_STATE,
    }))).toBe(AgentGatewayErrorCode.AGENT_COMMAND_INVALID_STATE)
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

  // gh-1295: Stop is wired to a holding interrupt precisely because that path
  // never returns a clearedQueue and therefore never drops the user's typed,
  // still-unsent content out of the optimistic outbox.
  it('keeps optimistic queued follow-ups when a holding interrupt stops the active turn', async () => {
    const events = openNdjsonStream()
    const interruptBodies: unknown[] = []
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      if (url.endsWith('/events?cursor=0')) return new Response(events.stream)
      if (url.endsWith('/followup')) return jsonResponse({ accepted: true, cursor: 1, clientNonce: body.clientNonce, clientSeq: body.clientSeq, queued: true })
      if (url.endsWith('/interrupt')) {
        interruptBodies.push(body)
        return jsonResponse({ accepted: true, cursor: 2 })
      }
      throw new Error(`unexpected URL ${url}`)
    }) as unknown as MockFetch
    const session = createSession(fetchMock, { autoStart: false })

    await expect(session.followUp({ message: 'keep me queued', clientNonce: 'nonce-q', clientSeq: 1 })).resolves.toMatchObject({ queued: true })
    expect(session.getState().optimisticOutbox['nonce-q']).toMatchObject({ status: 'pending', clientSeq: 1 })

    await expect(session.interrupt({ queueAction: 'hold' })).resolves.toEqual({ accepted: true, cursor: 2 })

    expect(interruptBodies).toEqual([{ queueAction: 'hold' }])
    // The typed content is still in hand and recoverable — nothing was dropped.
    expect(session.getState().optimisticOutbox['nonce-q']).toMatchObject({ status: 'pending', clientSeq: 1 })
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/stop'))).toBe(false)
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/queue/clear'))).toBe(false)

    session.dispose()
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
      ['https://agent.test/api/v1/agents/default/sessions/s1/prompt', 'POST'],
      ['https://agent.test/api/v1/agents/default/sessions/s1/followup', 'POST'],
      ['https://agent.test/api/v1/agents/default/sessions/s1/queue/clear', 'POST'],
      ['https://agent.test/api/v1/agents/default/sessions/s1/interrupt', 'POST'],
      ['https://agent.test/api/v1/agents/default/sessions/s1/stop', 'POST'],
    ])
    expect(JSON.parse(String(postCalls[2]?.[1]?.body))).toEqual({
      clientNonce: 'nonce-q',
      clientSeq: 1,
      requestId: expect.stringMatching(/^queue-clear:[a-f0-9-]{36}$/u),
    })
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

  it('retries one selected queue clear with the same operation key after an ambiguous transport failure', async () => {
    const bodies: unknown[] = []
    let attempts = 0
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (!url.endsWith('/queue/clear')) throw new Error(`unexpected URL ${url}`)
      bodies.push(JSON.parse(String(init?.body)))
      attempts += 1
      if (attempts === 1) throw new TypeError('connection reset after commit')
      if (attempts <= 3) {
        return jsonResponse({ error: { code: AgentGatewayErrorCode.AGENT_REQUEST_IN_PROGRESS, message: 'still clearing' } }, 409)
      }
      return jsonResponse({ accepted: true, cursor: 3, cleared: 1 })
    }) as unknown as MockFetch
    const session = createSession(fetchMock, { autoStart: false })

    await expect(session.clearQueue({ clientNonce: 'nonce-q', clientSeq: 1 })).resolves.toEqual({
      accepted: true,
      cursor: 3,
      cleared: 1,
    })
    expect(bodies).toHaveLength(4)
    expect(bodies[0]).toEqual({
      clientNonce: 'nonce-q',
      clientSeq: 1,
      requestId: expect.stringMatching(/^queue-clear:[a-f0-9-]{36}$/u),
    })
    expect(bodies.slice(1)).toEqual([bodies[0], bodies[0], bodies[0]])
    session.dispose()
  })

  it('retries a full queue clear with one stable operation key', async () => {
    const bodies: unknown[] = []
    let attempts = 0
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (!url.endsWith('/queue/clear')) throw new Error(`unexpected URL ${url}`)
      bodies.push(JSON.parse(String(init?.body)))
      attempts += 1
      if (attempts === 1) throw new TypeError('connection reset after commit')
      return jsonResponse({ accepted: true, cursor: 3, cleared: 2 })
    }) as unknown as MockFetch
    const session = createSession(fetchMock, { autoStart: false })

    await expect(session.clearQueue()).resolves.toMatchObject({ accepted: true, cleared: 2 })
    expect(bodies).toHaveLength(2)
    expect(bodies[0]).toEqual({ requestId: expect.stringMatching(/^queue-clear:[a-f0-9-]{36}$/u) })
    expect(bodies[1]).toEqual(bodies[0])
    session.dispose()
  })

  it('uses fresh bounded operation keys for repeated clears of the same arbitrary selector', async () => {
    const nonce = `external/nonce with spaces:${'x'.repeat(96)}`
    const bodies: Array<Record<string, unknown>> = []
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (!url.endsWith('/queue/clear')) throw new Error(`unexpected URL ${url}`)
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return jsonResponse({ accepted: true, cursor: 3, cleared: 1 })
    }) as unknown as MockFetch
    const session = createSession(fetchMock, { autoStart: false })

    await session.clearQueue({ clientNonce: nonce, clientSeq: 42 })
    await session.clearQueue({ clientNonce: nonce, clientSeq: 42 })

    expect(bodies).toHaveLength(2)
    for (const body of bodies) {
      expect(body).toMatchObject({ clientNonce: nonce, clientSeq: 42 })
      expect(body.requestId).toEqual(expect.stringMatching(/^queue-clear:[a-f0-9-]{36}$/u))
      expect(String(body.requestId)).toHaveLength(48)
    }
    expect(bodies[0]?.requestId).not.toBe(bodies[1]?.requestId)
    session.dispose()
  })

  it('adapts addressed Gateway command receipts without changing the legacy client contract', async () => {
    const events = openNdjsonStream()
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      if (url.endsWith('/events?cursor=0')) return new Response(events.stream)
      if (url.endsWith('/prompt')) {
        expect(body).toEqual({
          clientNonce: 'nonce-p',
          requestId: 'nonce-p',
          content: 'hello',
          displayContent: 'Hello',
        })
        return jsonResponse({
          accepted: true,
          cursor: 1,
          disposition: 'prompt',
          clientNonce: body.clientNonce,
        })
      }
      if (url.endsWith('/followup')) {
        expect(body).toEqual({
          clientNonce: 'nonce-q',
          clientSeq: 2,
          requestId: 'nonce-q:2',
          content: 'queued',
        })
        return jsonResponse({
          accepted: true,
          cursor: 1,
          disposition: 'followup',
          clientNonce: body.clientNonce,
          clientSeq: body.clientSeq,
        })
      }
      throw new Error(`unexpected URL ${url}`)
    }) as unknown as MockFetch
    const session = createSession(fetchMock, { agentTypeId: 'alpha', autoStart: false })

    await expect(session.prompt({ message: 'hello', displayMessage: 'Hello', clientNonce: 'nonce-p' })).resolves.toEqual({
      accepted: true,
      cursor: 1,
      clientNonce: 'nonce-p',
    })
    await expect(session.followUp({ message: 'queued', clientNonce: 'nonce-q', clientSeq: 2 })).resolves.toEqual({
      accepted: true,
      cursor: 1,
      clientNonce: 'nonce-q',
      clientSeq: 2,
      queued: true,
    })
    expect(fetchMock.mock.calls.some(([url]) => String(url) === 'https://agent.test/api/v1/agents/alpha/sessions/s1/followup')).toBe(true)

    session.dispose()
  })
})
