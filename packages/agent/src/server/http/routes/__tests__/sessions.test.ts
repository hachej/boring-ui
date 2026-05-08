import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, test } from 'vitest'
import { ERROR_CODE_NOT_FOUND, ERROR_CODE_VALIDATION_ERROR } from '../../middleware'
import { sessionRoutes } from '../sessions'
import type { SessionStore, SessionCtx, SessionSummary, SessionDetail } from '../../../../shared/session'
import type { UIMessage, UIMessageChunk } from '../../../../shared/message'
import type { AgentHarness } from '../../../../shared/harness'

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

  async saveMessages(ctx: SessionCtx, sessionId: string, messages: UIMessage[]): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    session.workspaceId = ctx.workspaceId
    session.messages = messages
    session.updatedAt = new Date().toISOString()
  }
}

async function buildApp(opts: Parameters<typeof sessionRoutes>[1] = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(sessionRoutes, { sessionStore: new MockSessionStore(), ...opts })
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

  test('exports a readable markdown transcript', async () => {
    const store = new MockSessionStore()
    const created = await store.create({ workspaceId: 'default' }, { title: 'Debug me' })
    await store.saveMessages?.({ workspaceId: 'default' }, created.id, [
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: 'Why did the deck fail?' }],
      } as UIMessage,
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'I checked the file.' },
          {
            type: 'tool-bash',
            toolName: 'bash',
            input: { command: 'pnpm test' },
            output: 'failed\n',
          },
        ],
      } as UIMessage,
    ])
    const app = await buildApp({ sessionStore: store })

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/agent/sessions/${created.id}/transcript`,
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/markdown')
    expect(res.body).toContain('# Agent session transcript: Debug me')
    expect(res.body).toContain('Why did the deck fail?')
    expect(res.body).toContain('[tool:bash]')
    expect(res.body).toContain('pnpm test')
  })

  test('creates an analysis session and prompt without running the harness by default', async () => {
    const store = new MockSessionStore()
    const created = await store.create({ workspaceId: 'default' }, { title: 'Need analysis' })
    await store.saveMessages?.({ workspaceId: 'default' }, created.id, [
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: 'Make a labor deck' }],
      } as UIMessage,
    ])
    const app = await buildApp({ sessionStore: store })

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agent/sessions/${created.id}/analysis`,
      payload: { instructions: 'Focus on blockers' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.sourceSession.id).toBe(created.id)
    expect(body.analysisSession.id).toEqual(expect.any(String))
    expect(body.analysisSession.title).toBe('Analysis: Need analysis')
    expect(body.prompt).toContain('agent-session analyst')
    expect(body.prompt).toContain('Focus on blockers')
    expect(body.prompt).toContain('Make a labor deck')
    expect(body.transcriptUrl).toBe(`/api/v1/agent/sessions/${created.id}/transcript`)
  })

  test('can run an analysis through the configured harness', async () => {
    const store = new MockSessionStore()
    const created = await store.create({ workspaceId: 'default' }, { title: 'Run analysis' })
    await store.saveMessages?.({ workspaceId: 'default' }, created.id, [
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: 'What happened?' }],
      } as UIMessage,
    ])
    const sent: string[] = []
    const harness: AgentHarness = {
      id: 'mock',
      placement: 'server',
      sessions: store,
      async *sendMessage(input): AsyncIterable<UIMessageChunk> {
        sent.push(input.message)
        yield { type: 'text-delta', id: '0', delta: 'analysis ' } as UIMessageChunk
        yield { type: 'text-delta', id: '0', delta: 'done' } as UIMessageChunk
      },
    }
    const app = await buildApp({ sessionStore: store, harness, workdir: '/tmp/work' })

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agent/sessions/${created.id}/analysis`,
      payload: { run: true },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.analysisText).toBe('analysis done')
    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain('What happened?')
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
