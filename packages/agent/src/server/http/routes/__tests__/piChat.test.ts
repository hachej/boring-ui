import Fastify from 'fastify'
import { describe, expect, test, vi } from 'vitest'
import { AgentEffectAdmissionError } from '../../../../core/piChatSessionService'
import { ErrorCode } from '../../../../shared/error-codes'
import type {
  CommandReceipt,
  FollowUpPayload,
  FollowUpReceipt,
  PiChatEvent,
  PiChatSnapshot,
  PromptPayload,
  PromptReceipt,
  QueueClearPayload,
  QueueClearReceipt,
  StopReceipt,
} from '../../../../shared/chat'
import type { PiSessionRequestContext } from '../../../pi-chat/piSessionIdentity'
import { PI_CHAT_CURSOR_AHEAD, PI_CHAT_REPLAY_GAP } from '../../../pi-chat/piChatReplayBuffer'
import type { SessionListOptions } from '../../../../shared/session'
import { piChatBusyError, piChatRoutes, PiChatRouteError, type PiChatRoutesOptions, type PiChatSessionService } from '../piChat'

const ADMISSION_ERROR_CODE = 'AGENT_HOST_ADMISSION_RECORD_FAILED'

function activeSnapshot(overrides: Partial<PiChatSnapshot> = {}): PiChatSnapshot {
  return {
    protocolVersion: 1,
    sessionId: 'pi-1',
    seq: 12,
    status: 'streaming',
    activeTurnId: 'turn-active',
    messages: [
      {
        id: 'u1',
        role: 'user',
        status: 'done',
        clientNonce: 'nonce-1',
        parts: [{ type: 'text', id: 'u1:text', text: 'hello' }],
      },
    ],
    queue: {
      followUps: [{ id: 'q1', kind: 'followup', clientNonce: 'nonce-q', clientSeq: 1, displayText: 'queued follow-up' }],
    },
    followUpMode: 'one-at-a-time',
    ...overrides,
  }
}

class FakePiChatService implements PiChatSessionService {
  snapshot = activeSnapshot()
  sessions = [
    { id: 'pi-1', title: 'Running session', createdAt: '2026-06-03T00:00:00.000Z', updatedAt: '2026-06-03T00:01:00.000Z', turnCount: 1 },
  ]
  events: PiChatEvent[] = []
  subscriptionResult: Awaited<ReturnType<PiChatSessionService['subscribe']>> | undefined
  attachment = { data: Buffer.from('image-bytes'), mediaType: 'image/png', filename: 'image.png' }
  readonly unsubscribe = vi.fn()
  readonly calls: Array<{ method: string; ctx: PiSessionRequestContext; sessionId?: string; messageId?: string; index?: number; payload?: unknown; cursor?: number; options?: SessionListOptions }> = []

  async listSessions(ctx: PiSessionRequestContext, options?: SessionListOptions) {
    this.calls.push({ method: 'listSessions', ctx, options })
    return this.sessions
  }

  async promptNewSession(ctx: PiSessionRequestContext, payload: PromptPayload, start: { idempotencyKey: string; retry: boolean }) {
    this.calls.push({ method: 'promptNewSession', ctx, payload: { ...payload, start } })
    return {
      accepted: true as const,
      cursor: 13,
      clientNonce: payload.clientNonce,
      nativeSessionId: 'native-1',
      session: { id: 'native-1', nativeSessionId: 'native-1', title: payload.message, createdAt: '2026-06-03T00:00:00.000Z', updatedAt: '2026-06-03T00:00:00.000Z', turnCount: 1, hasAssistantReply: false },
    }
  }

  async renameSession(ctx: PiSessionRequestContext, sessionId: string, title: string) {
    this.calls.push({ method: 'renameSession', ctx, sessionId, payload: { title } })
    return { id: sessionId, nativeSessionId: sessionId, title, createdAt: '2026-06-03T00:00:00.000Z', updatedAt: '2026-06-03T00:00:00.000Z', turnCount: 1, hasAssistantReply: true }
  }

  async createSession(ctx: PiSessionRequestContext, init?: { title?: string }) {
    const session = { id: 'pi-new', title: init?.title ?? 'New session', createdAt: '2026-06-03T00:02:00.000Z', updatedAt: '2026-06-03T00:02:00.000Z', turnCount: 0 }
    this.calls.push({ method: 'createSession', ctx, sessionId: session.id, payload: init ?? {} })
    this.sessions = [session, ...this.sessions]
    return session
  }

  async deleteSession(ctx: PiSessionRequestContext, sessionId: string) {
    this.calls.push({ method: 'deleteSession', ctx, sessionId })
    this.sessions = this.sessions.filter((session) => session.id !== sessionId)
  }

  async readState(ctx: PiSessionRequestContext, sessionId: string): Promise<PiChatSnapshot> {
    this.calls.push({ method: 'readState', ctx, sessionId })
    return this.snapshot
  }

  async readAttachment(ctx: PiSessionRequestContext, sessionId: string, messageId: string, index: number) {
    this.calls.push({ method: 'readAttachment', ctx, sessionId, messageId, index })
    return this.attachment
  }

  async subscribe(ctx: PiSessionRequestContext, sessionId: string, cursor: number, subscriber: (event: PiChatEvent) => void) {
    this.calls.push({ method: 'subscribe', ctx, sessionId, cursor })
    if (this.subscriptionResult) return this.subscriptionResult
    for (const event of this.events) subscriber(event)
    return { type: 'ok' as const, unsubscribe: this.unsubscribe, closed: Promise.resolve() }
  }

  async prompt(ctx: PiSessionRequestContext, sessionId: string, payload: PromptPayload): Promise<PromptReceipt> {
    this.calls.push({ method: 'prompt', ctx, sessionId, payload })
    return { accepted: true, cursor: 13, clientNonce: payload.clientNonce }
  }

  async followUp(ctx: PiSessionRequestContext, sessionId: string, payload: FollowUpPayload): Promise<FollowUpReceipt> {
    this.calls.push({ method: 'followUp', ctx, sessionId, payload })
    return { accepted: true, cursor: 14, clientNonce: payload.clientNonce, clientSeq: payload.clientSeq, queued: true }
  }

  async clearQueue(ctx: PiSessionRequestContext, sessionId: string, payload: QueueClearPayload = {}): Promise<QueueClearReceipt> {
    this.calls.push({ method: 'clearQueue', ctx, sessionId, payload })
    return { accepted: true, cursor: 15, cleared: 2 }
  }

  async interrupt(ctx: PiSessionRequestContext, sessionId: string): Promise<CommandReceipt> {
    this.calls.push({ method: 'interrupt', ctx, sessionId, payload: {} })
    return { accepted: true, cursor: 16 }
  }

  async stop(ctx: PiSessionRequestContext, sessionId: string): Promise<StopReceipt> {
    this.calls.push({ method: 'stop', ctx, sessionId, payload: {} })
    return { accepted: true, cursor: 17, stopped: true, clearedQueue: this.snapshot.queue.followUps }
  }
}

async function buildApp(service = new FakePiChatService(), routeOptions: Omit<PiChatRoutesOptions, 'service'> = {}) {
  const app = Fastify({ logger: false })
  app.addHook('onRequest', async (request) => {
    request.workspaceContext = { workspaceId: 'workspace-a', authenticated: true }
    ;(request as unknown as { user: { id: string } }).user = { id: 'user-a' }
  })
  await app.register(piChatRoutes, { service, heartbeatIntervalMs: false, ...routeOptions })
  await app.ready()
  return { app, service }
}

describe('piChatRoutes', () => {
  test('Pi-native session list/create/delete routes use scoped context instead of legacy transcript store', async () => {
    const { app, service } = await buildApp()

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/pi-chat/sessions',
      headers: { 'x-boring-storage-scope': 'scope-a' },
    })
    expect(list.statusCode).toBe(200)
    expect(list.json()).toEqual(service.sessions)

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/pi-chat/sessions',
      headers: { 'x-boring-storage-scope': 'scope-a' },
      payload: { title: 'New Pi session' },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json()).toMatchObject({ id: 'pi-new', title: 'New Pi session' })

    const deleted = await app.inject({
      method: 'DELETE',
      url: '/api/v1/agent/pi-chat/sessions/pi-new',
      headers: { 'x-boring-storage-scope': 'scope-a' },
    })
    expect(deleted.statusCode).toBe(204)

    expect(service.calls.map((call) => call.method)).toEqual(['listSessions', 'createSession', 'deleteSession'])
    expect(service.calls[0]).toMatchObject({
      ctx: { workspaceId: 'workspace-a', storageScope: 'scope-a', authSubject: 'user-a' },
      options: { limit: 50, offset: 0 },
    })

    await app.close()
  })

  test('native first-send route is absent unless direct/local capability is enabled', async () => {
    const { app } = await buildApp()
    const absent = await app.inject({ method: 'POST', url: '/api/v1/agent/pi-chat/sessions/native-prompt', payload: {} })
    const renameAbsent = await app.inject({ method: 'PATCH', url: '/api/v1/agent/pi-chat/sessions/pi-1', payload: { title: 'Nope' } })
    expect(absent.statusCode).toBe(404)
    expect(renameAbsent.statusCode).toBe(404)
    await app.close()
  })

  test('native first-send route forwards one idempotency key and adopts the returned Pi id', async () => {
    const { app, service } = await buildApp(new FakePiChatService(), { nativeSessionStartEnabled: true })
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/pi-chat/sessions/native-prompt',
      payload: { message: 'hello', clientNonce: 'nonce-1', nativeSessionStart: { idempotencyKey: 'first-send', retry: false } },
    })
    expect(response.statusCode).toBe(202)
    expect(response.json()).toMatchObject({ accepted: true, nativeSessionId: 'native-1', session: { id: 'native-1' } })
    expect(service.calls).toContainEqual(expect.objectContaining({ method: 'promptNewSession', payload: expect.objectContaining({ start: { idempotencyKey: 'first-send', retry: false } }) }))
    await app.close()
  })

  test('PATCH rename normalizes a title before forwarding through the scoped service seam', async () => {
    const { app, service } = await buildApp(new FakePiChatService(), { nativeSessionStartEnabled: true })
    const response = await app.inject({ method: 'PATCH', url: '/api/v1/agent/pi-chat/sessions/pi-1', payload: { title: '\r\n Renamed \n' } })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ id: 'pi-1', title: 'Renamed' })
    expect(service.calls).toContainEqual(expect.objectContaining({ method: 'renameSession', sessionId: 'pi-1', payload: { title: 'Renamed' } }))

    const invalid = await app.inject({ method: 'PATCH', url: '/api/v1/agent/pi-chat/sessions/pi-1', payload: { title: ' \r\n ' } })
    expect(invalid.statusCode).toBe(400)
    expect(service.calls).toHaveLength(1)
    await app.close()
  })

  test('GET /sessions forwards bounded pagination options to the Pi-native service', async () => {
    const { app, service } = await buildApp()

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/pi-chat/sessions?limit=500&offset=25&activeSessionId=pi-older',
    })

    expect(res.statusCode).toBe(200)
    expect(service.calls[0]).toMatchObject({
      method: 'listSessions',
      options: { limit: 100, offset: 25, includeId: 'pi-older' },
    })

    await app.close()
  })

  test('GET /sessions forwards retryable runtime-not-ready service errors', async () => {
    const service = new FakePiChatService()
    service.listSessions = vi.fn(async () => {
      throw new PiChatRouteError({
        statusCode: 503,
        code: ErrorCode.enum.AGENT_RUNTIME_NOT_READY,
        message: 'Agent runtime is still preparing. Try again in a moment.',
        retryable: true,
      })
    })
    const { app } = await buildApp(service)

    const res = await app.inject({ method: 'GET', url: '/api/v1/agent/pi-chat/sessions' })
    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({
      error: {
        code: ErrorCode.enum.AGENT_RUNTIME_NOT_READY,
        message: 'Agent runtime is still preparing. Try again in a moment.',
        retryable: true,
      },
    })

    expect(service.listSessions).toHaveBeenCalledTimes(1)

    await app.close()
  })

  test('GET /state returns active canonical snapshot for reload without browser transcript cache', async () => {
    const { app, service } = await buildApp()

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/pi-chat/pi-1/state',
      headers: { 'x-boring-storage-scope': 'scope-a' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      protocolVersion: 1,
      sessionId: 'pi-1',
      seq: 12,
      status: 'streaming',
      activeTurnId: 'turn-active',
      messages: [{ id: 'u1', role: 'user' }],
      queue: { followUps: [{ displayText: 'queued follow-up' }] },
    })
    expect(service.calls[0]).toMatchObject({
      method: 'readState',
      sessionId: 'pi-1',
      ctx: { workspaceId: 'workspace-a', storageScope: 'scope-a', authSubject: 'user-a', requestId: expect.any(String) },
    })

    await app.close()
  })

  test('GET /attachments streams a scoped historical Pi image attachment', async () => {
    const { app, service } = await buildApp()

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/pi-chat/pi-1/attachments/m-user-image/1',
      headers: { 'x-boring-storage-scope': 'scope-a' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('image/png')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.body).toBe('image-bytes')
    expect(service.calls[0]).toMatchObject({
      method: 'readAttachment',
      sessionId: 'pi-1',
      messageId: 'm-user-image',
      index: 1,
      ctx: { workspaceId: 'workspace-a', storageScope: 'scope-a', authSubject: 'user-a', requestId: expect.any(String) },
    })

    await app.close()
  })

  test('GET /events streams NDJSON frames with replay cursor and unsubscribes on close', async () => {
    const service = new FakePiChatService()
    service.events = [
      { type: 'agent-start', seq: 13, turnId: 'turn-active' },
      { type: 'message-delta', seq: 14, messageId: 'a1', partId: '1', kind: 'text', delta: 'hi' },
    ]
    const { app } = await buildApp(service)

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/pi-chat/pi-1/events?cursor=12',
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('application/x-ndjson')
    expect(res.headers['cache-control']).toContain('no-cache')
    expect(res.headers['x-accel-buffering']).toBe('no')
    expect(res.body.trim().split('\n').map((line) => JSON.parse(line))).toEqual(service.events)
    expect(service.calls[0]).toMatchObject({ method: 'subscribe', sessionId: 'pi-1', cursor: 12 })
    expect(service.unsubscribe).toHaveBeenCalledTimes(1)

    await app.close()
  })

  test('GET /events releases its subscription when the response socket closes', async () => {
    const service = new FakePiChatService()
    service.subscriptionResult = {
      type: 'ok',
      unsubscribe: service.unsubscribe,
      closed: new Promise<void>(() => {}),
    }
    const { app } = await buildApp(service, { heartbeatIntervalMs: 10 })
    await app.listen({ port: 0, host: '127.0.0.1' })
    const address = app.server.address()
    if (typeof address !== 'object' || !address) throw new Error('no server address')
    const abort = new AbortController()
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/agent/pi-chat/pi-1/events?cursor=0`,
      { signal: abort.signal },
    )
    expect(response.status).toBe(200)

    abort.abort()
    await response.body?.cancel().catch(() => {})
    for (let index = 0; index < 20 && service.unsubscribe.mock.calls.length === 0; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }

    expect(service.unsubscribe).toHaveBeenCalledOnce()
    await app.close()
  }, 15_000)

  test('GET /events maps replay range errors to stable retryable HTTP errors', async () => {
    const service = new FakePiChatService()
    service.subscriptionResult = { type: PI_CHAT_REPLAY_GAP, latestSeq: 25, minReplaySeq: 20 }
    const { app } = await buildApp(service)

    const res = await app.inject({ method: 'GET', url: '/api/v1/agent/pi-chat/pi-1/events?cursor=1' })

    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({
      error: {
        code: ErrorCode.enum.CURSOR_OUT_OF_RANGE,
        message: PI_CHAT_REPLAY_GAP,
        retryable: true,
        details: { reason: PI_CHAT_REPLAY_GAP, latestSeq: 25, minReplaySeq: 20 },
      },
    })

    service.subscriptionResult = { type: PI_CHAT_CURSOR_AHEAD, latestSeq: 25, minReplaySeq: 20 }
    const ahead = await app.inject({ method: 'GET', url: '/api/v1/agent/pi-chat/pi-1/events?cursor=30' })
    expect(ahead.statusCode).toBe(409)
    expect(ahead.json().error.details.reason).toBe(PI_CHAT_CURSOR_AHEAD)

    await app.close()
  })

  test('POST /prompt validates model/thinking payload and returns a quick receipt', async () => {
    const { app, service } = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/pi-chat/pi-1/prompt',
      payload: {
        message: 'hello',
        clientNonce: 'nonce-1',
        model: { provider: 'anthropic', id: 'claude' },
        thinkingLevel: 'medium',
      },
    })

    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ accepted: true, cursor: 13, clientNonce: 'nonce-1' })
    expect(service.calls[0]).toMatchObject({
      method: 'prompt',
      payload: { message: 'hello', clientNonce: 'nonce-1', model: { provider: 'anthropic', id: 'claude' }, thinkingLevel: 'medium' },
    })

    await app.close()
  })

  test('POST /prompt rejects invalid bodies before calling the service', async () => {
    const { app, service } = await buildApp()

    const empty = await app.inject({ method: 'POST', url: '/api/v1/agent/pi-chat/pi-1/prompt', payload: { message: '', clientNonce: 'nonce' } })
    expect(empty.statusCode).toBe(400)
    expect(empty.json()).toMatchObject({ error: { code: ErrorCode.enum.BRIDGE_COMMAND_INVALID, field: 'body.message' } })

    const model = await app.inject({ method: 'POST', url: '/api/v1/agent/pi-chat/pi-1/prompt', payload: { message: 'x', clientNonce: 'nonce', model: { provider: '', id: 'm' } } })
    expect(model.statusCode).toBe(400)
    expect(model.json()).toMatchObject({ error: { code: ErrorCode.enum.BRIDGE_COMMAND_INVALID, field: 'body.model.provider' } })

    const thinking = await app.inject({ method: 'POST', url: '/api/v1/agent/pi-chat/pi-1/prompt', payload: { message: 'x', clientNonce: 'nonce', thinkingLevel: 'max' } })
    expect(thinking.statusCode).toBe(400)
    expect(thinking.json()).toMatchObject({ error: { code: ErrorCode.enum.BRIDGE_COMMAND_INVALID, field: 'body.thinkingLevel' } })
    expect(service.calls).toEqual([])

    await app.close()
  })

  test('POST /prompt maps busy service rejection to stable retryable HTTP error without transcript mutation', async () => {
    const service = new FakePiChatService()
    service.prompt = vi.fn(async () => {
      throw piChatBusyError()
    }) as unknown as FakePiChatService['prompt']
    const { app } = await buildApp(service)

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/pi-chat/pi-1/prompt',
      payload: { message: 'hello', clientNonce: 'nonce-1' },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({ error: { code: ErrorCode.enum.SESSION_LOCKED, message: 'session is busy', retryable: true } })

    await app.close()
  })

  test('POST /prompt surfaces a metering PAYMENT_REQUIRED rejection as HTTP 402 even without an explicit statusCode', async () => {
    const service = new FakePiChatService()
    service.prompt = vi.fn(async () => {
      // A metering sink rejecting reserveRun with the canonical code but no
      // statusCode (e.g. core's InsufficientCreditError shape minus statusCode).
      throw Object.assign(new Error('insufficient credit'), { code: ErrorCode.enum.PAYMENT_REQUIRED })
    }) as unknown as FakePiChatService['prompt']
    const { app } = await buildApp(service)

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/pi-chat/pi-1/prompt',
      payload: { message: 'hello', clientNonce: 'nonce-1' },
    })

    expect(res.statusCode).toBe(402)
    expect(res.json().error.code).toBe(ErrorCode.enum.PAYMENT_REQUIRED)

    await app.close()
  })

  test('POST /followup validates nonce/seq and returns queued receipt', async () => {
    const { app, service } = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/pi-chat/pi-1/followup',
      payload: { message: 'next', clientNonce: 'nonce-q', clientSeq: 1 },
    })

    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ accepted: true, cursor: 14, clientNonce: 'nonce-q', clientSeq: 1, queued: true })
    expect(service.calls[0]).toMatchObject({ method: 'followUp', payload: { message: 'next', clientNonce: 'nonce-q', clientSeq: 1 } })

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/pi-chat/pi-1/followup',
      payload: { message: 'next', clientNonce: 'nonce-q', clientSeq: -1 },
    })
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json()).toMatchObject({ error: { code: ErrorCode.enum.BRIDGE_COMMAND_INVALID, field: 'body.clientSeq' } })

    await app.close()
  })

  test('queue clear, interrupt, and stop are fast command receipts with empty body validation', async () => {
    const { app, service } = await buildApp()

    const clear = await app.inject({ method: 'POST', url: '/api/v1/agent/pi-chat/pi-1/queue/clear' })
    expect(clear.statusCode).toBe(202)
    expect(clear.json()).toEqual({ accepted: true, cursor: 15, cleared: 2 })

    const clearSelected = await app.inject({ method: 'POST', url: '/api/v1/agent/pi-chat/pi-1/queue/clear', payload: { clientNonce: 'nonce-q', clientSeq: 1 } })
    expect(clearSelected.statusCode).toBe(202)
    expect(clearSelected.json()).toEqual({ accepted: true, cursor: 15, cleared: 2 })
    expect(service.calls.at(-1)).toMatchObject({ method: 'clearQueue', payload: { clientNonce: 'nonce-q', clientSeq: 1 } })

    const interrupt = await app.inject({ method: 'POST', url: '/api/v1/agent/pi-chat/pi-1/interrupt' })
    expect(interrupt.statusCode).toBe(202)
    expect(interrupt.json()).toEqual({ accepted: true, cursor: 16 })

    const stop = await app.inject({ method: 'POST', url: '/api/v1/agent/pi-chat/pi-1/stop' })
    expect(stop.statusCode).toBe(202)
    expect(stop.json()).toEqual({ accepted: true, cursor: 17, stopped: true, clearedQueue: service.snapshot.queue.followUps })

    const invalid = await app.inject({ method: 'POST', url: '/api/v1/agent/pi-chat/pi-1/stop', payload: { extra: true } })
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json()).toMatchObject({ error: { code: ErrorCode.enum.BRIDGE_COMMAND_INVALID, field: 'body' } })

    expect(service.calls.map((call) => call.method)).toEqual(['clearQueue', 'clearQueue', 'interrupt', 'stop'])

    await app.close()
  })

  test('service errors use stable HTTP error payloads', async () => {
    const service = new FakePiChatService()
    service.readState = vi.fn(async () => {
      throw new PiChatRouteError({ statusCode: 404, code: ErrorCode.enum.SESSION_NOT_FOUND, message: 'session not found' })
    }) as unknown as FakePiChatService['readState']
    const { app } = await buildApp(service)

    const res = await app.inject({ method: 'GET', url: '/api/v1/agent/pi-chat/pi-1/state' })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: { code: ErrorCode.enum.SESSION_NOT_FOUND, message: 'session not found' } })

    await app.close()
  })

  test('effect admission errors preserve their host-owned stable code', async () => {
    const service = new FakePiChatService()
    service.createSession = vi.fn(async () => {
      throw new AgentEffectAdmissionError(ADMISSION_ERROR_CODE, { field: 'admission' })
    })
    const { app } = await buildApp(service)

    const res = await app.inject({ method: 'POST', url: '/api/v1/agent/pi-chat/sessions', payload: {} })

    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({
      error: { code: ADMISSION_ERROR_CODE, message: ADMISSION_ERROR_CODE, details: { field: 'admission' } },
    })
    expect(ErrorCode.safeParse(ADMISSION_ERROR_CODE).success).toBe(false)

    service.listSessions = vi.fn(async () => {
      throw new AgentEffectAdmissionError(ADMISSION_ERROR_CODE, { field: 'should-not-leak' })
    })
    const list = await app.inject({ method: 'GET', url: '/api/v1/agent/pi-chat/sessions' })
    expect(list.statusCode).toBe(500)
    expect(list.json()).toEqual({
      error: { code: ErrorCode.enum.INTERNAL_ERROR, message: 'list pi chat sessions failed' },
    })
    await app.close()
  })
})
