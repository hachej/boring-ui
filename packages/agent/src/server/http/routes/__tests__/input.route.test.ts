import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Agent, PendingInputRequest, ResolveInputResponse } from '../../../../shared/events'
import { ErrorCode } from '../../../../shared/error-codes'
import type { SessionCtx, SessionDetail } from '../../../../shared/session'
import { inputRoutes } from '../input'

const apps: FastifyInstance[] = []
const CTX = { workspaceId: 'workspace-a', userId: 'user-a' }

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe('inputRoutes', () => {
  it('mirrors pendingInputs and resolveInput through canonical agent routes', async () => {
    const pending: PendingInputRequest = {
      sessionId: 's1',
      requestId: 'r1',
      kind: 'approval',
      toolName: 'bash',
      toolCallId: 'tool-1',
      createdAt: '2026-07-06T00:00:00.000Z',
    }
    const agent = fakeAgent([pending])
    const app = await createApp(agent)

    const scoped = await app.inject({
      method: 'GET',
      url: '/api/v1/agents/default/sessions/s1/input',
    })
    expect(scoped.statusCode).toBe(200)
    expect(scoped.json()).toEqual([pending])
    expect(agent.sessions.pendingInputs).toHaveBeenCalledWith(CTX, { sessionId: 's1' })

    const inbox = await app.inject({
      method: 'GET',
      url: '/api/v1/agents/default/pending-inputs',
    })
    expect(inbox.statusCode).toBe(200)
    expect(inbox.json()).toEqual([pending])
    expect(agent.sessions.pendingInputs).toHaveBeenLastCalledWith(CTX)

    const response: ResolveInputResponse = { kind: 'approval', decision: 'approve' }
    const resolved = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/default/sessions/s1/input',
      payload: { requestId: 'r1', response },
    })
    expect(resolved.statusCode).toBe(202)
    expect(resolved.json()).toEqual({ accepted: true })
    expect(agent.sessions.load).toHaveBeenCalledWith(CTX, 's1')
    expect(agent.resolveInput).toHaveBeenCalledWith('s1', 'r1', response, CTX)
  })

  it('rejects non-default agents and invalid resolve bodies', async () => {
    const app = await createApp(fakeAgent([]))

    const nonDefault = await app.inject({
      method: 'GET',
      url: '/api/v1/agents/reviewer/pending-inputs',
    })
    expect(nonDefault.statusCode).toBe(404)
    expect(nonDefault.json()).toEqual({
      error: {
        code: ErrorCode.enum.SESSION_NOT_FOUND,
        message: 'agent not found',
      },
    })

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/default/sessions/s1/input',
      payload: { requestId: 'r1', response: { approved: true } },
    })
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json()).toMatchObject({
      error: {
        code: ErrorCode.enum.BRIDGE_COMMAND_INVALID,
      },
    })
  })
})

async function createApp(agent: Agent): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook('onRequest', async (request) => {
    request.workspaceContext = { workspaceId: CTX.workspaceId, authenticated: true }
    ;(request as unknown as { user: { id: string } }).user = { id: CTX.userId }
  })
  await app.register(inputRoutes, { agent })
  await app.ready()
  apps.push(app)
  return app
}

function fakeAgent(pending: PendingInputRequest[]): Agent & {
  resolveInput: ReturnType<typeof vi.fn>
  sessions: Agent['sessions'] & {
    load: ReturnType<typeof vi.fn>
    pendingInputs: ReturnType<typeof vi.fn>
  }
} {
  return {
    start: vi.fn(),
    stream: vi.fn(),
    send: vi.fn(),
    resolveInput: vi.fn(async () => {}),
    interrupt: vi.fn(),
    stop: vi.fn(),
    sessions: {
      list: vi.fn(async () => []),
      create: vi.fn(async () => sessionDetail('created')),
      load: vi.fn(async (_ctx: SessionCtx, sessionId: string) => sessionDetail(sessionId)),
      delete: vi.fn(async () => {}),
      pendingInputs: vi.fn(async () => pending),
    },
    readiness: {
      requirements: [],
      status: vi.fn(async () => []),
    },
    dispose: vi.fn(),
  } as unknown as Agent & {
    resolveInput: ReturnType<typeof vi.fn>
    sessions: Agent['sessions'] & {
      load: ReturnType<typeof vi.fn>
      pendingInputs: ReturnType<typeof vi.fn>
    }
  }
}

function sessionDetail(sessionId: string): SessionDetail {
  return {
    id: sessionId,
    title: sessionId,
    createdAt: '2026-07-06T00:00:00.000Z',
    updatedAt: '2026-07-06T00:00:00.000Z',
    turnCount: 0,
  }
}
