import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Agent, AgentSendInput } from '../../../../shared/events'
import { ErrorCode } from '../../../../shared/error-codes'
import { agentSessionsRoutes } from '../agentSessions'

const apps: FastifyInstance[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe('agentSessionsRoutes', () => {
  it('maps canonical write routes to the Agent facade', async () => {
    const agent = fakeAgent()
    const app = await createApp(agent)

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/default/sessions',
      payload: { content: 'hello', model: { provider: 'test', id: 'model-a' } },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json()).toEqual({ sessionId: 'created-session', startIndex: 0 })
    expect(agent.start).toHaveBeenLastCalledWith({
      content: 'hello',
      model: { provider: 'test', id: 'model-a' },
      ctx: { workspaceId: 'workspace-a', userId: 'user-a' },
    })

    const prompt = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/default/sessions/existing/prompt',
      payload: { content: [{ type: 'text', text: 'again' }] },
    })
    expect(prompt.statusCode).toBe(202)
    expect(agent.start).toHaveBeenLastCalledWith({
      sessionId: 'existing',
      content: [{ type: 'text', text: 'again' }],
      ctx: { workspaceId: 'workspace-a', userId: 'user-a' },
    })

    const interrupt = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/default/sessions/existing/interrupt',
    })
    expect(interrupt.statusCode).toBe(202)
    expect(agent.interrupt).toHaveBeenCalledWith('existing', { workspaceId: 'workspace-a', userId: 'user-a' })

    const stop = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/default/sessions/existing/stop',
    })
    expect(stop.statusCode).toBe(202)
    expect(agent.stop).toHaveBeenCalledWith('existing', { workspaceId: 'workspace-a', userId: 'user-a' })
  })

  it('requires the explicit default agent segment', async () => {
    const app = await createApp(fakeAgent())

    const nonDefault = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/reviewer/sessions',
      payload: { content: 'hello' },
    })
    expect(nonDefault.statusCode).toBe(404)
    expect(nonDefault.json()).toEqual({
      error: {
        code: ErrorCode.enum.SESSION_NOT_FOUND,
        message: 'agent not found',
      },
    })

    const absent = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/sessions',
      payload: { content: 'hello' },
    })
    expect(absent.statusCode).toBe(404)
  })

  it('rejects blank canonical start and prompt bodies', async () => {
    const agent = fakeAgent()
    const app = await createApp(agent)

    const missing = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/default/sessions',
      payload: {},
    })
    expect(missing.statusCode).toBe(400)
    expect(missing.json()).toMatchObject({
      error: {
        code: ErrorCode.enum.BRIDGE_COMMAND_INVALID,
        field: 'body.message',
      },
    })

    const empty = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/default/sessions/existing/prompt',
      payload: { message: '' },
    })
    expect(empty.statusCode).toBe(400)
    expect(empty.json()).toMatchObject({
      error: {
        code: ErrorCode.enum.BRIDGE_COMMAND_INVALID,
        field: 'body.message',
      },
    })

    const emptyContent = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/default/sessions/existing/prompt',
      payload: { content: [{ type: 'text', text: '' }] },
    })
    expect(emptyContent.statusCode).toBe(400)
    expect(emptyContent.json()).toMatchObject({
      error: {
        code: ErrorCode.enum.BRIDGE_COMMAND_INVALID,
        field: 'body.content',
      },
    })

    expect(agent.start).not.toHaveBeenCalled()
  })
})

async function createApp(agent: Agent): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook('onRequest', async (request) => {
    request.workspaceContext = { workspaceId: 'workspace-a', authenticated: true }
    ;(request as unknown as { user: { id: string } }).user = { id: 'user-a' }
  })
  await app.register(agentSessionsRoutes, { agent })
  await app.ready()
  apps.push(app)
  return app
}

function fakeAgent(): Agent & {
  start: ReturnType<typeof vi.fn>
  interrupt: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
} {
  const start = vi.fn(async (input: AgentSendInput) => ({
    sessionId: input.sessionId ?? 'created-session',
    startIndex: input.sessionId ? 10 : 0,
  }))
  const interrupt = vi.fn(async (_sessionId: string, _ctx?: { workspaceId?: string; userId?: string }) => ({ accepted: true }))
  const stop = vi.fn(async (_sessionId: string, _ctx?: { workspaceId?: string; userId?: string }) => ({ accepted: true, stopped: true }))

  return {
    start,
    stream: vi.fn(),
    send: vi.fn(),
    resolveInput: vi.fn(),
    interrupt,
    stop,
    sessions: {
      list: vi.fn(),
      create: vi.fn(),
      load: vi.fn(),
      delete: vi.fn(),
    },
    readiness: {
      requirements: [],
      status: vi.fn(async () => []),
    },
    dispose: vi.fn(),
  } as unknown as Agent & {
    start: ReturnType<typeof vi.fn>
    interrupt: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
  }
}
