import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { systemPromptRoutes } from '../systemPrompt'
import type { AgentHarness } from '../../../../shared/harness'

const apps: FastifyInstance[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()))
})

async function buildApp(harness: AgentHarness): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(systemPromptRoutes, { harness })
  await app.ready()
  apps.push(app)
  return app
}

function fakeHarness(overrides: Partial<AgentHarness> = {}): AgentHarness {
  return {
    id: 'fake',
    placement: 'server',
    sendMessage: vi.fn(),
    sessions: {} as AgentHarness['sessions'],
    ...overrides,
  }
}

describe('system prompt route', () => {
  test('returns 200 with the resolved prompt when harness yields one', async () => {
    const app = await buildApp(
      fakeHarness({
        getSystemPrompt: vi.fn().mockReturnValue('You are a helpful agent.'),
      }),
    )

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/sessions/abc/system-prompt',
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ systemPrompt: 'You are a helpful agent.' })
  })

  test('returns 404 when session has not been materialised', async () => {
    const app = await buildApp(
      fakeHarness({
        getSystemPrompt: vi.fn().mockReturnValue(undefined),
      }),
    )

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/sessions/never-sent/system-prompt',
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('not_found')
  })

  test('returns 501 when harness does not implement getSystemPrompt', async () => {
    const app = await buildApp(fakeHarness())

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/sessions/abc/system-prompt',
    })
    expect(res.statusCode).toBe(501)
    expect(res.json().error.code).toBe('not_implemented')
  })

  test('forwards sessionId to the harness', async () => {
    const spy = vi.fn().mockReturnValue('prompt-for-xyz')
    const app = await buildApp(fakeHarness({ getSystemPrompt: spy }))

    await app.inject({
      method: 'GET',
      url: '/api/v1/agent/sessions/xyz/system-prompt',
    })
    expect(spy).toHaveBeenCalledWith('xyz')
  })
})
