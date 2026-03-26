import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createApp } from '../app.js'
import { createSessionCookie } from '../auth/session.js'
import { loadConfig } from '../config.js'
import { TEST_SECRET } from './helpers.js'

const {
  mockAnthropicModel,
  mockCreateAnthropic,
  mockConvertToModelMessages,
  mockStreamText,
  mockStepCountIs,
  mockJsonSchema,
  mockTool,
} = vi.hoisted(() => {
  const mockAnthropicModel = vi.fn((modelId: string) => ({ provider: 'anthropic', modelId }))
  const mockCreateAnthropic = vi.fn(() => mockAnthropicModel)
  const mockConvertToModelMessages = vi.fn(async (messages) => messages)
  const mockStreamText = vi.fn()
  const mockStepCountIs = vi.fn((count: number) => ({ type: 'step-count', count }))
  const mockJsonSchema = vi.fn((schema) => schema)
  const mockTool = vi.fn((definition) => definition)

  return {
    mockAnthropicModel,
    mockCreateAnthropic,
    mockConvertToModelMessages,
    mockStreamText,
    mockStepCountIs,
    mockJsonSchema,
    mockTool,
  }
})

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: mockCreateAnthropic,
}))

vi.mock('ai', () => ({
  convertToModelMessages: mockConvertToModelMessages,
  jsonSchema: mockJsonSchema,
  stepCountIs: mockStepCountIs,
  streamText: mockStreamText,
  tool: mockTool,
}))

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
    agentRuntime: 'ai-sdk',
    workspaceRoot: '/tmp/boring-ui-ai-sdk',
    ...overrides,
  }
  return createApp({ config: config as any, skipValidation: true })
}

describe('AI SDK routes', () => {
  let app: FastifyInstance
  const originalAnthropicApiKey = process.env.ANTHROPIC_API_KEY

  beforeEach(() => {
    vi.clearAllMocks()
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

  it('returns 503 when the server Anthropic API key is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY
    app = makeApp()
    const cookie = await makeCookie('user-1', 'user1@example.com')

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat',
      cookies: cookie,
      payload: {
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hello' }] }],
      },
    })

    expect(response.statusCode).toBe(503)
    expect(JSON.parse(response.payload)).toMatchObject({
      code: 'ANTHROPIC_API_KEY_REQUIRED',
    })
  })

  it('returns 400 when no messages are provided', async () => {
    app = makeApp()
    const cookie = await makeCookie('user-1', 'user1@example.com')

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat',
      cookies: cookie,
      payload: { messages: [] },
    })

    expect(response.statusCode).toBe(400)
    expect(JSON.parse(response.payload)).toMatchObject({
      code: 'MESSAGES_REQUIRED',
    })
  })

  it('pipes a UI message stream and binds workspace tools for the active workspace', async () => {
    mockStreamText.mockImplementation((options) => ({
      pipeUIMessageStreamToResponse(response: any, init: any) {
        response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' })
        response.write(`data: ${JSON.stringify({ ok: true, messages: init.originalMessages.length })}\n\n`)
        response.end()
      },
      options,
    }))

    app = makeApp()
    const cookie = await makeCookie('user-1', 'user1@example.com')
    const messages = [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'pwd' }] }]

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat',
      cookies: cookie,
      payload: {
        messages,
        workspace_id: 'ws-123',
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/event-stream')
    expect(response.payload).toContain('"ok":true')

    expect(mockCreateAnthropic).toHaveBeenCalledWith({ apiKey: 'test-anthropic-key' })
    expect(mockAnthropicModel).toHaveBeenCalled()
    expect(mockConvertToModelMessages).toHaveBeenCalledWith(messages, {
      ignoreIncompleteToolCalls: true,
    })
    expect(mockStreamText).toHaveBeenCalledTimes(1)

    const streamOptions = mockStreamText.mock.calls[0][0]
    expect(streamOptions.system).toContain('/tmp/boring-ui-ai-sdk/ws-123')
    expect(streamOptions.tools.exec_bash).toBeDefined()
    expect(streamOptions.tools.list_panes).toBeDefined()
    expect(streamOptions.tools.open_file).toBeDefined()

    const output = await streamOptions.tools.exec_bash.execute({ command: 'printf ai-sdk-test' })
    expect(output).toContain('ai-sdk-test')
  })

  it('ignores client-supplied workspace_root overrides', async () => {
    mockStreamText.mockImplementation((options) => ({
      pipeUIMessageStreamToResponse(response: any) {
        response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' })
        response.write('data: {"ok":true}\n\n')
        response.end()
      },
      options,
    }))

    app = makeApp()
    const cookie = await makeCookie('user-1', 'user1@example.com')

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat',
      cookies: cookie,
      payload: {
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'pwd' }] }],
        workspace_root: '/etc',
      },
    })

    expect(response.statusCode).toBe(200)

    const streamOptions = mockStreamText.mock.calls.at(-1)?.[0]
    expect(streamOptions.system).toContain('/tmp/boring-ui-ai-sdk')
    expect(streamOptions.system).not.toContain('/etc')
  })
})
