import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import {
  AgentGatewayError,
  AgentGatewayErrorCode,
  type AgentGateway,
  type AgentSessionConnection,
  type AgentSessionEvent,
  type AgentSessionRef,
  type AuthorizedAgentScope,
  type IdempotentAgentControl,
  type IdempotentAgentSend,
  type IdempotentQueueClear,
} from '../../../shared/index'
import type { PiChatSessionService } from '../../../core/piChatSessionService'
import type { AgentHostHandle } from '../types'
import { createAgentHostRoutes } from '../httpProjection'

const scope = { workspaceScopeId: 'workspace-a', authSubjectId: 'subject-a' } as AuthorizedAgentScope
const ref: AgentSessionRef = { agentTypeId: 'alpha', sessionId: 'session-1' }
const summary = {
  ref,
  title: 'Session one',
  status: 'idle' as const,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_001_000,
}
const snapshot = {
  ref,
  seq: 7,
  summary,
  state: {
    protocolVersion: 1 as const,
    sessionId: ref.sessionId,
    seq: 7,
    status: 'idle' as const,
    messages: [],
    queue: { followUps: [] },
    followUpMode: 'one-at-a-time' as const,
  },
}
const event: AgentSessionEvent = {
  ref,
  seq: 8,
  event: { type: 'agent-start', seq: 8, turnId: 'turn-1' },
}

class FakeGateway implements AgentGateway {
  readonly calls: Array<{ method: string; input: unknown }> = []
  events: AgentSessionEvent[] = [event]
  sendError: AgentGatewayError | undefined

  async listAgents(input: Parameters<AgentGateway['listAgents']>[0]) {
    this.calls.push({ method: 'listAgents', input })
    return [{ agentTypeId: 'alpha', label: 'Alpha' }]
  }

  async listSessions(input: Parameters<AgentGateway['listSessions']>[0]) {
    this.calls.push({ method: 'listSessions', input })
    return { sessions: [summary], nextCursor: 'next-page' }
  }

  async createSession(input: Parameters<AgentGateway['createSession']>[0]) {
    this.calls.push({ method: 'createSession', input })
    return ref
  }

  async readSessionState(input: Parameters<AgentGateway['readSessionState']>[0]) {
    this.calls.push({ method: 'readSessionState', input })
    return snapshot
  }

  async renameSession(input: Parameters<AgentGateway['renameSession']>[0]) {
    this.calls.push({ method: 'renameSession', input })
    return { ...summary, title: input.title }
  }

  async deleteSession(input: Parameters<AgentGateway['deleteSession']>[0]) {
    this.calls.push({ method: 'deleteSession', input })
  }

  async connectSession(input: Parameters<AgentGateway['connectSession']>[0]): Promise<AgentSessionConnection> {
    this.calls.push({ method: 'connectSession', input })
    const events = [...this.events]
    return {
      ref: input.ref,
      events: {
        async *[Symbol.asyncIterator]() {
          yield* events
        },
      },
      send: async (command: IdempotentAgentSend) => {
        this.calls.push({ method: 'send', input: command })
        if (this.sendError) throw this.sendError
        return {
          accepted: true,
          cursor: 9,
          disposition: command.kind,
          clientNonce: command.clientNonce,
          ...(command.kind === 'followup' ? { clientSeq: command.clientSeq } : {}),
        }
      },
      interrupt: async (control: IdempotentAgentControl) => {
        this.calls.push({ method: 'interrupt', input: control })
        return { accepted: true, cursor: 10 }
      },
      stop: async (control: IdempotentAgentControl) => {
        this.calls.push({ method: 'stop', input: control })
        return { accepted: true, cursor: 11, stopped: true, clearedQueue: [] }
      },
      clearQueue: async (control: IdempotentQueueClear) => {
        this.calls.push({ method: 'clearQueue', input: control })
        return { accepted: true, cursor: 12, cleared: 2 }
      },
      close: async () => {
        this.calls.push({ method: 'close', input: input.ref })
      },
    }
  }

  async close() {}
}

function legacyService(): PiChatSessionService {
  return {
    async listSessions() {
      return [{ id: 'session-1', title: 'Legacy', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:01.000Z', turnCount: 1 }]
    },
    async createSession() {
      return { id: 'session-new', title: 'New', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', turnCount: 0 }
    },
    async deleteSession() {},
    async readAttachment() {
      return { data: new TextEncoder().encode('image-bytes'), mediaType: 'image/png', filename: 'image.png' }
    },
    async readState() {
      return snapshot.state
    },
    async subscribe(_ctx, _sessionId, _cursor, subscriber) {
      subscriber({ type: 'agent-start', seq: 8, turnId: 'turn-1' })
      return { type: 'ok', unsubscribe: vi.fn(), closed: Promise.resolve() }
    },
    async prompt(_ctx, _sessionId, payload) {
      return { accepted: true, cursor: 9, clientNonce: payload.clientNonce }
    },
    async followUp(_ctx, _sessionId, payload) {
      return { accepted: true, cursor: 9, clientNonce: payload.clientNonce, clientSeq: payload.clientSeq, queued: true }
    },
    async clearQueue() {
      return { accepted: true, cursor: 9, cleared: 0 }
    },
    async interrupt() {
      return { accepted: true, cursor: 9 }
    },
    async stop() {
      return { accepted: true, cursor: 9, stopped: true, clearedQueue: [] }
    },
  }
}

async function buildApp(options: {
  gateway?: FakeGateway
  authorizeRequest?: () => Promise<AuthorizedAgentScope>
  legacyPiChatAliases?: boolean
} = {}) {
  const gateway = options.gateway ?? new FakeGateway()
  const host: AgentHostHandle = {
    hostId: 'host-a',
    describe: async () => ({ hostId: 'host-a', agents: [{ agentTypeId: 'alpha', label: 'Alpha' }], draining: false }),
    drain: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  }
  const app = Fastify({ logger: false })
  await app.register(createAgentHostRoutes({
    host,
    gateway,
    options: {
      authorizeRequest: options.authorizeRequest ?? (async () => scope),
      defaultAgentTypeId: 'alpha',
      legacyPiChatAliases: options.legacyPiChatAliases,
    },
    resolveLegacyPiChatService: async () => legacyService(),
  }))
  await app.ready()
  return { app, gateway, host }
}

function expectValidation(response: { statusCode: number; json(): unknown }, field: string) {
  expect(response.statusCode).toBe(400)
  expect(response.json()).toMatchObject({
    error: {
      code: AgentGatewayErrorCode.AGENT_COMMAND_INVALID_STATE,
      details: { field },
    },
  })
}

describe('addressed Agent Host HTTP projection', () => {
  it('projects catalog and every addressed session/command route onto typed Gateway inputs', async () => {
    const { app, gateway } = await buildApp()

    expect((await app.inject({ method: 'GET', url: '/api/v1/agents' })).json()).toEqual([
      { agentTypeId: 'alpha', label: 'Alpha' },
    ])
    const listed = await app.inject({ method: 'GET', url: '/api/v1/agents/alpha/sessions?limit=25' })
    expect(listed.statusCode).toBe(200)
    expect(listed.json()).toEqual({ sessions: [summary], nextCursor: 'next-page' })
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/alpha/sessions',
      payload: { requestId: 'create-1', title: 'Created' },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json()).toEqual(ref)
    expect((await app.inject({ method: 'GET', url: '/api/v1/agents/alpha/sessions/session-1/state' })).json()).toEqual(snapshot)
    expect((await app.inject({
      method: 'POST',
      url: '/api/v1/agents/alpha/sessions/session-1/rename',
      payload: { requestId: 'rename-1', title: 'Renamed' },
    })).json()).toMatchObject({ title: 'Renamed' })

    const prompt = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/alpha/sessions/session-1/prompt',
      payload: {
        requestId: 'prompt-1',
        clientNonce: 'nonce-p',
        content: 'hello',
        displayContent: 'Hello',
        model: { provider: 'anthropic', id: 'claude' },
        thinkingLevel: 'medium',
        attachments: [{ filename: 'chart.png', mediaType: 'image/png', url: 'data:image/png;base64,AA==', path: 'uploads/chart.png' }],
      },
    })
    expect(prompt.statusCode).toBe(202)
    expect(prompt.json()).toMatchObject({ disposition: 'prompt', clientNonce: 'nonce-p' })
    const followup = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/alpha/sessions/session-1/followup',
      payload: { requestId: 'follow-1', clientNonce: 'nonce-f', content: 'next', displayContent: 'Next', clientSeq: 3 },
    })
    expect(followup.statusCode).toBe(202)
    expect(followup.json()).toMatchObject({ disposition: 'followup', clientSeq: 3 })
    expect((await app.inject({
      method: 'POST',
      url: '/api/v1/agents/alpha/sessions/session-1/interrupt',
      payload: { requestId: 'interrupt-1' },
    })).statusCode).toBe(202)
    expect((await app.inject({
      method: 'POST',
      url: '/api/v1/agents/alpha/sessions/session-1/stop',
      payload: { requestId: 'stop-1' },
    })).statusCode).toBe(202)
    expect((await app.inject({
      method: 'POST',
      url: '/api/v1/agents/alpha/sessions/session-1/queue/clear',
      payload: { requestId: 'clear-1', clientNonce: 'nonce-f', clientSeq: 3 },
    })).statusCode).toBe(202)
    expect((await app.inject({
      method: 'POST',
      url: '/api/v1/agents/alpha/sessions/session-1/queue-clear',
      payload: { requestId: 'clear-legacy-addressed' },
    })).statusCode).toBe(202)
    expect((await app.inject({
      method: 'DELETE',
      url: '/api/v1/agents/alpha/sessions/session-1?requestId=delete-1',
    })).statusCode).toBe(204)

    expect(gateway.calls).toEqual(expect.arrayContaining([
      { method: 'listSessions', input: { scope, agentTypeId: 'alpha', cursor: undefined, limit: 25 } },
      { method: 'createSession', input: { scope, agentTypeId: 'alpha', requestId: 'create-1', title: 'Created' } },
      { method: 'send', input: expect.objectContaining({ kind: 'prompt', requestId: 'prompt-1', attachments: [expect.objectContaining({ path: 'uploads/chart.png' })] }) },
      { method: 'send', input: { kind: 'followup', requestId: 'follow-1', clientNonce: 'nonce-f', content: 'next', displayContent: 'Next', clientSeq: 3 } },
      { method: 'interrupt', input: { requestId: 'interrupt-1' } },
      { method: 'stop', input: { requestId: 'stop-1' } },
      { method: 'clearQueue', input: { requestId: 'clear-1', clientNonce: 'nonce-f', clientSeq: 3 } },
      { method: 'deleteSession', input: { scope, ref, requestId: 'delete-1' } },
    ]))

    await app.close()
  })

  it('streams heartbeat plus addressed NDJSON event envelopes and forwards replay cursors', async () => {
    const { app, gateway } = await buildApp()
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/agents/alpha/sessions/session-1/events?cursor=7',
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('application/x-ndjson')
    expect(response.headers['cache-control']).toBe('no-cache, no-transform')
    expect(response.headers['x-accel-buffering']).toBe('no')
    const frames = response.body.trim().split('\n').map((line) => JSON.parse(line))
    expect(frames[0]).toMatchObject({ type: 'heartbeat', now: expect.any(String) })
    expect(frames[1]).toEqual(event)
    expect(gateway.calls).toContainEqual({ method: 'connectSession', input: { scope, ref, cursor: 7 } })
    expect(gateway.calls).toContainEqual({ method: 'close', input: ref })

    await app.close()
  })

  it('rejects malformed, extra, and invalid addressed inputs before authorization or Gateway dispatch', async () => {
    const authorizeRequest = vi.fn(async () => scope)
    const { app, gateway } = await buildApp({ authorizeRequest })
    const cases = [
      { request: { method: 'GET', url: '/api/v1/agents?extra=1' }, field: 'query' },
      { request: { method: 'GET', url: '/api/v1/agents/alpha/sessions?limit=0' }, field: 'query.limit' },
      { request: { method: 'POST', url: '/api/v1/agents/alpha/sessions', payload: { title: 'ok', extra: true } }, field: 'body' },
      { request: { method: 'GET', url: '/api/v1/agents/alpha/sessions/session-1/state?extra=1' }, field: 'query' },
      { request: { method: 'GET', url: '/api/v1/agents/alpha/sessions/session-1/events?cursor=abc' }, field: 'query.cursor' },
      { request: { method: 'POST', url: '/api/v1/agents/alpha/sessions/session-1/rename', payload: { requestId: 'rename', title: '', extra: true } }, field: 'body.title' },
      { request: { method: 'DELETE', url: '/api/v1/agents/alpha/sessions/session-1', payload: { extra: true } }, field: 'body' },
      { request: { method: 'POST', url: '/api/v1/agents/alpha/sessions/session-1/prompt', payload: { requestId: 'prompt', clientNonce: 'nonce', content: 'hi', attachments: [{ url: 'x', extra: true }] } }, field: 'body.attachments.0' },
      { request: { method: 'POST', url: '/api/v1/agents/alpha/sessions/session-1/followup', payload: { requestId: 'follow', clientNonce: 'nonce', content: 'next', clientSeq: -1 } }, field: 'body.clientSeq' },
      { request: { method: 'POST', url: '/api/v1/agents/alpha/sessions/session-1/interrupt', payload: { extra: true } }, field: 'body' },
      { request: { method: 'POST', url: '/api/v1/agents/alpha/sessions/session-1/stop', payload: { extra: true } }, field: 'body' },
      { request: { method: 'POST', url: '/api/v1/agents/alpha/sessions/session-1/queue/clear', payload: { clientSeq: -1 } }, field: 'body.clientSeq' },
    ] as const

    for (const item of cases) {
      const response = await app.inject(item.request)
      expectValidation(response, item.field)
    }
    const malformed = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/alpha/sessions',
      headers: { 'content-type': 'application/json' },
      payload: '{',
    })
    expectValidation(malformed, 'body')
    expect(authorizeRequest).not.toHaveBeenCalled()
    expect(gateway.calls).toEqual([])

    await app.close()
  })

  it('maps authorization, replay, lifecycle, and invalid-state failures to stable Gateway errors', async () => {
    const denied = await buildApp({
      authorizeRequest: async () => {
        throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_SCOPE_DENIED, 'denied')
      },
    })
    const denial = await denied.app.inject({ method: 'GET', url: '/api/v1/agents' })
    expect(denial.statusCode).toBe(403)
    expect(denial.json()).toEqual({ error: { code: AgentGatewayErrorCode.AGENT_SCOPE_DENIED, message: 'denied' } })
    await denied.app.close()

    for (const [code, status] of [
      [AgentGatewayErrorCode.AGENT_SESSION_REPLAY_GAP, 409],
      [AgentGatewayErrorCode.AGENT_SESSION_CURSOR_AHEAD, 409],
      [AgentGatewayErrorCode.AGENT_GATEWAY_CLOSED, 503],
    ] as const) {
      const gateway = new FakeGateway()
      gateway.connectSession = vi.fn(async () => {
        throw new AgentGatewayError(code, 'mapped', { latestSeq: 7, minReplaySeq: 3 })
      })
      const built = await buildApp({ gateway })
      const response = await built.app.inject({ method: 'GET', url: '/api/v1/agents/alpha/sessions/session-1/events?cursor=1' })
      expect(response.statusCode).toBe(status)
      expect(response.json()).toMatchObject({ error: { code, message: 'mapped' } })
      await built.app.close()
    }

    const gateway = new FakeGateway()
    gateway.sendError = new AgentGatewayError(AgentGatewayErrorCode.AGENT_COMMAND_INVALID_STATE, 'session is running')
    const invalidState = await buildApp({ gateway })
    const response = await invalidState.app.inject({
      method: 'POST',
      url: '/api/v1/agents/alpha/sessions/session-1/prompt',
      payload: { requestId: 'prompt', clientNonce: 'nonce', content: 'hello' },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ error: { code: AgentGatewayErrorCode.AGENT_COMMAND_INVALID_STATE, message: 'session is running' } })
    expect(gateway.calls).toContainEqual({ method: 'close', input: ref })
    await invalidState.app.close()
  })

  it('mounts frozen Pi-chat aliases only when requested, including attachment bytes and unwrapped heartbeat frames', async () => {
    const withoutAliases = await buildApp()
    expect((await withoutAliases.app.inject({ method: 'GET', url: '/api/v1/agent/pi-chat/sessions' })).statusCode).toBe(404)
    await withoutAliases.app.close()

    const withAliases = await buildApp({ legacyPiChatAliases: true })
    const list = await withAliases.app.inject({ method: 'GET', url: '/api/v1/agent/pi-chat/sessions' })
    expect(list.statusCode).toBe(200)
    expect(list.json()).toEqual([{ id: 'session-1', title: 'Legacy', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:01.000Z', turnCount: 1 }])

    const attachment = await withAliases.app.inject({
      method: 'GET',
      url: '/api/v1/agent/pi-chat/session-1/attachments/message-1/0',
    })
    expect(attachment.statusCode).toBe(200)
    expect(attachment.headers['content-type']).toContain('image/png')
    expect(attachment.headers['x-content-type-options']).toBe('nosniff')
    expect(attachment.body).toBe('image-bytes')

    const events = await withAliases.app.inject({
      method: 'GET',
      url: '/api/v1/agent/pi-chat/session-1/events?cursor=7',
    })
    const frames = events.body.trim().split('\n').map((line) => JSON.parse(line))
    expect(frames[0]).toEqual({ type: 'agent-start', seq: 8, turnId: 'turn-1' })
    expect(frames[0]).not.toHaveProperty('ref')
    expect(frames[0]).not.toHaveProperty('event')
    expect(frames[1]).toMatchObject({ type: 'heartbeat', now: expect.any(String) })

    await withAliases.app.close()
  })
})
