import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, test } from 'vitest'
import { ERROR_CODE_NOT_FOUND, ERROR_CODE_VALIDATION_ERROR } from '../../middleware'
import { sessionRoutes } from '../sessions'
import type { SessionStore, SessionCtx, SessionSummary, SessionDetail } from '../../../../shared/session'
import type { UIMessage } from '../../../../shared/message'

const apps: FastifyInstance[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()))
})

// In-memory mock session store for tests
class MockSessionStore implements SessionStore {
  private sessions = new Map<string, {
    id: string
    title: string
    createdAt: string
    updatedAt: string
    workspaceId: string
    messages: UIMessage[]
  }>()

  async list(_ctx: SessionCtx): Promise<SessionSummary[]> {
    return Array.from(this.sessions.values()).map(s => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      turnCount: s.messages.filter(m => m.role === 'user').length,
    }))
  }

  async create(_ctx: SessionCtx, init?: { title?: string }): Promise<SessionSummary> {
    const id = Math.random().toString(36).slice(2)
    const now = new Date().toISOString()
    const title = init?.title ?? 'New session'
    const session = {
      id,
      title,
      createdAt: now,
      updatedAt: now,
      workspaceId: _ctx.workspaceId,
      messages: [],
    }
    this.sessions.set(id, session)
    return {
      id,
      title: session.title,
      createdAt: now,
      updatedAt: now,
      turnCount: 0,
    }
  }

  async load(_ctx: SessionCtx, sessionId: string): Promise<SessionDetail> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    return {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      turnCount: session.messages.filter(m => m.role === 'user').length,
      messages: session.messages,
    }
  }

  async delete(_ctx: SessionCtx, sessionId: string): Promise<void> {
    if (!this.sessions.has(sessionId)) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    this.sessions.delete(sessionId)
  }
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(sessionRoutes, { sessionStore: new MockSessionStore() })
  await app.ready()
  apps.push(app)
  return app
}

describe('session routes', () => {
  test('CRUD roundtrip and delete twice semantics', async () => {
    const app = await buildApp()

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/sessions',
      payload: { title: 'Session A' },
    })
    expect(createRes.statusCode).toBe(200)
    const created = createRes.json()
    expect(created).toEqual({
      id: expect.any(String),
      title: 'Session A',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      turnCount: 0,
    })

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/sessions',
    })
    expect(listRes.statusCode).toBe(200)
    expect(listRes.json()).toEqual([created])

    const loadRes = await app.inject({
      method: 'GET',
      url: `/api/v1/agent/sessions/${created.id}`,
    })
    expect(loadRes.statusCode).toBe(200)
    expect(loadRes.json()).toEqual({
      ...created,
      messages: [],
    })

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/agent/sessions/${created.id}`,
    })
    expect(deleteRes.statusCode).toBe(204)
    expect(deleteRes.body).toBe('')

    const deleteAgainRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/agent/sessions/${created.id}`,
    })
    expect(deleteAgainRes.statusCode).toBe(404)
    expect(deleteAgainRes.json()).toEqual({
      error: {
        code: ERROR_CODE_NOT_FOUND,
        message: 'session not found',
      },
    })
  })

  test('create defaults to New session title when no title is provided', async () => {
    const app = await buildApp()

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/sessions',
      payload: {},
    })
    expect(createRes.statusCode).toBe(200)
    expect(createRes.json().title).toBe('New session')
  })

  test('returns 400 for invalid session id params', async () => {
    const app = await buildApp()

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/sessions/',
    })

    expect(getRes.statusCode).toBe(400)
  })
})
