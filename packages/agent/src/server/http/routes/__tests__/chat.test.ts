import Fastify from 'fastify'
import { describe, test, expect, vi } from 'vitest'
import { chatRoutes, type ChatRouteOptions } from '../chat'
import type { AgentHarness, SendMessageInput, RunContext } from '../../../../shared/harness'
import { ERROR_CODE_VALIDATION_ERROR, ERROR_CODE_INTERNAL } from '../../middleware'

function createMockHarness(
  chunks: unknown[] = [{ type: 'text', text: 'hello' }],
  opts?: { throwOnSend?: Error },
): AgentHarness {
  return {
    id: 'test-harness',
    placement: 'server',
    sendMessage(_input: SendMessageInput, _ctx: RunContext) {
      if (opts?.throwOnSend) throw opts.throwOnSend
      return (async function* () {
        for (const chunk of chunks) {
          yield chunk
        }
      })()
    },
    sessions: {},
  }
}

function buildApp(overrides: Partial<ChatRouteOptions> = {}) {
  const app = Fastify({ logger: false })
  app.register(chatRoutes, {
    harness: overrides.harness ?? createMockHarness(),
    workdir: overrides.workdir ?? '/tmp/test',
  })
  return app.ready().then(() => app)
}

const validBody = {
  sessionId: 'sess-1',
  message: 'hello',
}

describe('POST /api/v1/agent/chat', () => {
  test('streams SSE response with correct headers', async () => {
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat',
      payload: validBody,
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/event-stream')
    expect(res.headers['cache-control']).toContain('no-cache')
    expect(res.headers['x-accel-buffering']).toBe('no')

    await app.close()
  })

  test('streams contain SSE data lines', async () => {
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat',
      payload: validBody,
    })

    const body = res.body
    expect(body).toContain('data:')
    expect(body).toContain('[DONE]')

    await app.close()
  })

  test('accepts optional model and thinkingLevel', async () => {
    const sendMessage = vi.fn(function* () {
      yield { type: 'text', text: 'ok' }
    })
    const harness = createMockHarness()
    harness.sendMessage = sendMessage as unknown as AgentHarness['sendMessage']

    const app = await buildApp({ harness })

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat',
      payload: {
        sessionId: 'sess-1',
        message: 'test',
        model: { provider: 'anthropic', id: 'claude-3' },
        thinkingLevel: 'high',
      },
    })

    expect(res.statusCode).toBe(200)
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'sess-1',
        message: 'test',
        model: { provider: 'anthropic', id: 'claude-3' },
        thinkingLevel: 'high',
      }),
      expect.objectContaining({
        workdir: '/tmp/test',
        abortSignal: expect.any(AbortSignal),
      }),
    )

    await app.close()
  })

  test('returns 400 for missing sessionId', async () => {
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat',
      payload: { message: 'hello' },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe(ERROR_CODE_VALIDATION_ERROR)

    await app.close()
  })

  test('returns 400 for missing message', async () => {
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat',
      payload: { sessionId: 'sess-1' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe(ERROR_CODE_VALIDATION_ERROR)

    await app.close()
  })

  test('returns 400 for empty sessionId', async () => {
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat',
      payload: { sessionId: '', message: 'hello' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe(ERROR_CODE_VALIDATION_ERROR)

    await app.close()
  })

  test('returns 400 for invalid thinkingLevel', async () => {
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat',
      payload: { sessionId: 's1', message: 'hi', thinkingLevel: 'max' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe(ERROR_CODE_VALIDATION_ERROR)

    await app.close()
  })

  test('returns 400 for empty body', async () => {
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat',
      payload: {},
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe(ERROR_CODE_VALIDATION_ERROR)

    await app.close()
  })

  test('passes abort signal to harness via RunContext', async () => {
    let capturedCtx: RunContext | undefined
    const harness = createMockHarness()
    harness.sendMessage = function (_input, ctx) {
      capturedCtx = ctx
      return (async function* () {
        yield { type: 'text', text: 'ok' }
      })()
    }

    const app = await buildApp({ harness })

    await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat',
      payload: validBody,
    })

    expect(capturedCtx).toBeDefined()
    expect(capturedCtx!.abortSignal).toBeInstanceOf(AbortSignal)
    expect(capturedCtx!.workdir).toBe('/tmp/test')

    await app.close()
  })

  test('returns 500 when harness.sendMessage throws synchronously', async () => {
    const harness = createMockHarness([], {
      throwOnSend: new Error('harness exploded'),
    })

    const app = await buildApp({ harness })

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat',
      payload: validBody,
    })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe(ERROR_CODE_INTERNAL)
    expect(res.json().error.message).toBe('internal error')

    await app.close()
  })

  test('emits SSE error chunk when async iterator throws mid-stream', async () => {
    const harness = createMockHarness()
    harness.sendMessage = function () {
      return (async function* () {
        yield { type: 'text', text: 'before' }
        throw new Error('mid-stream kaboom')
      })()
    }

    const app = await buildApp({ harness })

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat',
      payload: validBody,
    })

    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('error')

    await app.close()
  })

  test('streams multiple chunks in order', async () => {
    const harness = createMockHarness([
      { type: 'text', text: 'one' },
      { type: 'text', text: 'two' },
      { type: 'text', text: 'three' },
    ])

    const app = await buildApp({ harness })

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat',
      payload: validBody,
    })

    expect(res.statusCode).toBe(200)
    const lines = res.body.split('\n').filter((l) => l.startsWith('data:'))
    expect(lines.length).toBeGreaterThanOrEqual(3)

    await app.close()
  })
})
