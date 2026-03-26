import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { FakeAgent } = vi.hoisted(() => {
  class HoistedFakeAgent {
    state: any
    sessionId?: string
    #listeners = new Set<(event: any) => void>()

    constructor({ initialState }: { initialState: any }) {
      this.state = {
        ...initialState,
        messages: Array.isArray(initialState?.messages) ? [...initialState.messages] : [],
        isStreaming: false,
      }
    }

    subscribe(listener: (event: any) => void) {
      this.#listeners.add(listener)
      return () => this.#listeners.delete(listener)
    }

    setSystemPrompt(systemPrompt: string) {
      this.state.systemPrompt = systemPrompt
    }

    setTools(tools: any[]) {
      this.state.tools = tools
    }

    abort() {
      this.state.isStreaming = false
    }

    async prompt(text: string) {
      this.state.isStreaming = true

      const userMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: [{ type: 'text', text }],
        timestamp: Date.now(),
      }
      const assistantMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: [
          { type: 'text', text: `Echo: ${text}` },
          { type: 'toolCall', id: 'tool-1', name: 'exec_bash', arguments: { command: 'pwd' } },
        ],
        timestamp: Date.now(),
      }
      const toolResultMessage = {
        id: `tool-${Date.now()}`,
        role: 'toolResult',
        content: [{
          toolCallId: 'tool-1',
          result: { content: [{ type: 'text', text: '/tmp/workspace' }] },
          isError: false,
        }],
        timestamp: Date.now(),
      }

      this.state.messages = [...this.state.messages, userMessage]
      this.#emit({ type: 'tool_execution_start', toolCallId: 'tool-1', toolName: 'exec_bash', args: { command: 'pwd' } })
      this.#emit({
        type: 'tool_execution_end',
        toolCallId: 'tool-1',
        toolName: 'exec_bash',
        result: { content: [{ type: 'text', text: '/tmp/workspace' }] },
        isError: false,
      })
      this.#emit({ type: 'message_update', message: assistantMessage })
      this.#emit({ type: 'message_end', message: assistantMessage })
      this.state.messages = [...this.state.messages, assistantMessage, toolResultMessage]
      this.state.isStreaming = false
    }

    #emit(event: any) {
      for (const listener of this.#listeners) listener(event)
    }
  }

  return { FakeAgent: HoistedFakeAgent }
})

vi.mock('@mariozechner/pi-agent-core', () => ({
  Agent: FakeAgent,
}))

vi.mock('@mariozechner/pi-ai', () => ({
  getEnvApiKey: vi.fn(() => 'test-anthropic-key'),
  getModel: vi.fn((_provider: string, id: string) => ({ id })),
  registerBuiltInApiProviders: vi.fn(),
}))

import type { FastifyInstance } from 'fastify'
import { createApp } from '../app.js'
import { createSessionCookie } from '../auth/session.js'
import { loadConfig } from '../config.js'
import { TEST_SECRET } from './helpers.js'

async function makeCookie(userId: string, email: string) {
  const token = await createSessionCookie(userId, email, TEST_SECRET, { ttlSeconds: 3600 })
  return { boring_session: token }
}

function makeApp(overrides: Record<string, unknown> = {}) {
  const config = {
    ...loadConfig(),
    sessionSecret: TEST_SECRET,
    controlPlaneProvider: 'local',
    databaseUrl: 'postgresql://test',
    workspaceBackend: 'bwrap',
    agentPlacement: 'server',
    agentRuntime: 'pi',
    ...overrides,
  }
  return createApp({ config: config as any, skipValidation: true })
}

describe('PI routes', () => {
  let app: FastifyInstance
  const originalAnthropicApiKey = process.env.ANTHROPIC_API_KEY

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key'
  })

  afterEach(async () => {
    if (app) await app.close()
    if (typeof originalAnthropicApiKey === 'string') {
      process.env.ANTHROPIC_API_KEY = originalAnthropicApiKey
    } else {
      delete process.env.ANTHROPIC_API_KEY
    }
  })

  it('isolates session listings by authenticated user and workspace', async () => {
    app = makeApp()

    const user1 = await makeCookie('user-1', 'user1@example.com')
    const user2 = await makeCookie('user-2', 'user2@example.com')

    const createUser1A = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/pi/sessions/create',
      cookies: user1,
      payload: { workspace_id: 'ws-a' },
    })
    const createUser1B = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/pi/sessions/create',
      cookies: user1,
      payload: { workspace_id: 'ws-b' },
    })
    const createUser2A = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/pi/sessions/create',
      cookies: user2,
      payload: { workspace_id: 'ws-a' },
    })

    expect(createUser1A.statusCode).toBe(201)
    expect(createUser1B.statusCode).toBe(201)
    expect(createUser2A.statusCode).toBe(201)

    const listUser1 = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/pi/sessions',
      cookies: user1,
    })
    const listUser1WorkspaceA = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/pi/sessions?workspace_id=ws-a',
      cookies: user1,
    })
    const listUser2 = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/pi/sessions',
      cookies: user2,
    })

    expect(listUser1.statusCode).toBe(200)
    expect(listUser1WorkspaceA.statusCode).toBe(200)
    expect(listUser2.statusCode).toBe(200)

    const user1Sessions = JSON.parse(listUser1.payload).sessions
    const user1WorkspaceASessions = JSON.parse(listUser1WorkspaceA.payload).sessions
    const user2Sessions = JSON.parse(listUser2.payload).sessions

    expect(user1Sessions).toHaveLength(2)
    expect(user1WorkspaceASessions).toHaveLength(1)
    expect(user1WorkspaceASessions[0].workspaceId).toBe('ws-a')
    expect(user2Sessions).toHaveLength(1)
    expect(user2Sessions[0].id).not.toBe(user1Sessions[0].id)
    expect(user2Sessions[0].id).not.toBe(user1Sessions[1].id)
  })

  it('streams SSE responses and persists owner-visible history', async () => {
    app = makeApp()

    const user1 = await makeCookie('user-1', 'user1@example.com')
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/pi/sessions/create',
      cookies: user1,
      payload: { workspace_id: 'ws-stream' },
    })
    const sessionId = JSON.parse(created.payload).session.id

    const stream = await app.inject({
      method: 'POST',
      url: `/api/v1/agent/pi/sessions/${encodeURIComponent(sessionId)}/stream`,
      cookies: user1,
      payload: { message: 'hello world', workspace_id: 'ws-stream' },
    })

    expect(stream.statusCode).toBe(200)
    expect(stream.headers['content-type']).toContain('text/event-stream')
    expect(stream.payload).toContain('event: session')
    expect(stream.payload).toContain('event: tool_start')
    expect(stream.payload).toContain('event: tool_end')
    expect(stream.payload).toContain('event: delta')
    expect(stream.payload).toContain('event: done')
    expect(stream.payload).toContain('Echo: hello world')

    const history = await app.inject({
      method: 'GET',
      url: `/api/v1/agent/pi/sessions/${encodeURIComponent(sessionId)}/history`,
      cookies: user1,
    })

    expect(history.statusCode).toBe(200)
    const body = JSON.parse(history.payload)
    expect(body.session.workspaceId).toBe('ws-stream')
    expect(body.messages).toHaveLength(2)
    expect(body.messages[0]).toMatchObject({
      role: 'user',
      text: 'hello world',
    })
    expect(body.messages[1]).toMatchObject({
      role: 'assistant',
      text: 'Echo: hello world',
    })
    expect(body.messages[1].parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'tool_use',
        toolCallId: 'tool-1',
        result: expect.objectContaining({
          text: '/tmp/workspace',
          isError: false,
        }),
      }),
    ]))
  })

  it('returns 404 when a different user tries to access a foreign session', async () => {
    app = makeApp()

    const user1 = await makeCookie('user-1', 'user1@example.com')
    const user2 = await makeCookie('user-2', 'user2@example.com')

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/pi/sessions/create',
      cookies: user1,
      payload: { workspace_id: 'ws-private' },
    })
    const sessionId = JSON.parse(created.payload).session.id

    const foreignHistory = await app.inject({
      method: 'GET',
      url: `/api/v1/agent/pi/sessions/${encodeURIComponent(sessionId)}/history`,
      cookies: user2,
    })
    const foreignStream = await app.inject({
      method: 'POST',
      url: `/api/v1/agent/pi/sessions/${encodeURIComponent(sessionId)}/stream`,
      cookies: user2,
      payload: { message: 'steal session' },
    })

    expect(foreignHistory.statusCode).toBe(404)
    expect(foreignStream.statusCode).toBe(404)
  })
})
