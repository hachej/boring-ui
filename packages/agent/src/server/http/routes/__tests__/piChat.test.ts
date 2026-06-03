import Fastify from 'fastify'
import { describe, expect, test, vi } from 'vitest'
import { ErrorCode } from '../../../../shared/error-codes'
import type {
  CommandReceipt,
  FollowUpPayload,
  FollowUpReceipt,
  PiChatEvent,
  PiChatSnapshot,
  PromptPayload,
  PromptReceipt,
  QueueClearReceipt,
  StopReceipt,
} from '../../../../shared/chat'
import type { PiSessionRequestContext } from '../../../pi-chat/piSessionIdentity'
import { PI_CHAT_CURSOR_AHEAD, PI_CHAT_REPLAY_GAP } from '../../../pi-chat/piChatReplayBuffer'
import { piChatBusyError, piChatRoutes, PiChatRouteError, type PiChatSessionService } from '../piChat'

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
  events: PiChatEvent[] = []
  subscriptionResult: Awaited<ReturnType<PiChatSessionService['subscribe']>> | undefined
  readonly unsubscribe = vi.fn()
  readonly calls: Array<{ method: string; ctx: PiSessionRequestContext; sessionId: string; payload?: unknown; cursor?: number }> = []

  async readState(ctx: PiSessionRequestContext, sessionId: string): Promise<PiChatSnapshot> {
    this.calls.push({ method: 'readState', ctx, sessionId })
    return this.snapshot
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

  async clearQueue(ctx: PiSessionRequestContext, sessionId: string): Promise<QueueClearReceipt> {
    this.calls.push({ method: 'clearQueue', ctx, sessionId, payload: {} })
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

async function buildApp(service = new FakePiChatService()) {
  const app = Fastify({ logger: false })
  app.addHook('onRequest', async (request) => {
    request.workspaceContext = { workspaceId: 'workspace-a', authenticated: true }
    ;(request as unknown as { user: { id: string } }).user = { id: 'user-a' }
  })
  await app.register(piChatRoutes, { service, heartbeatIntervalMs: false })
  await app.ready()
  return { app, service }
}

describe('piChatRoutes', () => {
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

    const interrupt = await app.inject({ method: 'POST', url: '/api/v1/agent/pi-chat/pi-1/interrupt' })
    expect(interrupt.statusCode).toBe(202)
    expect(interrupt.json()).toEqual({ accepted: true, cursor: 16 })

    const stop = await app.inject({ method: 'POST', url: '/api/v1/agent/pi-chat/pi-1/stop' })
    expect(stop.statusCode).toBe(202)
    expect(stop.json()).toEqual({ accepted: true, cursor: 17, stopped: true, clearedQueue: service.snapshot.queue.followUps })

    const invalid = await app.inject({ method: 'POST', url: '/api/v1/agent/pi-chat/pi-1/stop', payload: { extra: true } })
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json()).toMatchObject({ error: { code: ErrorCode.enum.BRIDGE_COMMAND_INVALID, field: 'body' } })

    expect(service.calls.map((call) => call.method)).toEqual(['clearQueue', 'interrupt', 'stop'])

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
})
