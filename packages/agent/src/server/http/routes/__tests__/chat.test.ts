import Fastify from 'fastify'
import { describe, test, expect, vi } from 'vitest'
import { chatRoutes, type ChatRouteOptions } from '../chat'
import type { AgentHarness, SendMessageInput, RunContext } from '../../../../shared/harness'
import type { UIMessageChunk } from '../../../../shared/message'
import type { SessionStore } from '../../../../shared/session'
import { ErrorCode } from '../../../../shared/error-codes'
import type { TelemetrySink, TelemetryEvent } from '../../../../shared/telemetry'
import {
  ERROR_CODE_VALIDATION_ERROR,
  ERROR_CODE_INTERNAL,
  ERROR_CODE_RANGE_NOT_SATISFIABLE,
} from '../../middleware'

function createMockHarness(
  chunks: unknown[] = [
    { type: 'start' },
    { type: 'text-start', id: '0' },
    { type: 'text-delta', id: '0', delta: 'hello' },
    { type: 'text-end', id: '0' },
    { type: 'finish' },
  ],
  opts?: { throwOnSend?: Error },
): AgentHarness {
  return {
    id: 'test-harness',
    placement: 'server',
    sendMessage(_input: SendMessageInput, _ctx: RunContext) {
      if (opts?.throwOnSend) throw opts.throwOnSend
      return (async function* () {
        for (const chunk of chunks) {
          yield chunk as UIMessageChunk
        }
      })()
    },
    sessions: {
      list: async () => [],
      create: async () => ({ id: 'new', title: 'New', createdAt: '', updatedAt: '', turnCount: 0 }),
      load: async () => ({ id: 'new', title: 'New', createdAt: '', updatedAt: '', turnCount: 0, messages: [] }),
      delete: async () => {},
    } satisfies SessionStore,
  }
}

function buildApp(overrides: Partial<ChatRouteOptions> = {}) {
  const app = Fastify({ logger: false })
  app.register(chatRoutes, {
    harness: overrides.harness ?? createMockHarness(),
    workdir: overrides.workdir ?? '/tmp/test',
    getRuntime: overrides.getRuntime,
    telemetry: overrides.telemetry,
  })
  return app.ready().then(() => app)
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
}

function createTelemetryRecorder(): { telemetry: TelemetrySink; events: TelemetryEvent[] } {
  const events: TelemetryEvent[] = []
  return {
    events,
    telemetry: {
      capture(event) {
        events.push(event)
      },
    },
  }
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

  test('emits safe chat telemetry for submitted and completed turns', async () => {
    const recorder = createTelemetryRecorder()
    const app = await buildApp({ telemetry: recorder.telemetry })

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat',
      payload: {
        sessionId: 'sess-telemetry',
        message: 'secret user prompt must not be captured',
        model: { provider: 'anthropic', id: 'claude-secret' },
      },
    })

    expect(res.statusCode).toBe(200)
    expect(recorder.events.map((event) => event.name)).toEqual([
      'agent.chat.started',
      'agent.chat.message.submitted',
      'agent.chat.completed',
    ])
    expect(recorder.events.at(-1)?.properties).toEqual(expect.objectContaining({
      sessionId: 'sess-telemetry',
      requestId: expect.any(String),
      modelProvider: 'anthropic',
      status: 'ok',
      durationMs: expect.any(Number),
    }))
    const serialized = JSON.stringify(recorder.events)
    expect(serialized).not.toContain('secret user prompt')
    expect(serialized).not.toContain('claude-secret')

    await app.close()
  })

  test('emits safe chat failure telemetry without changing the response', async () => {
    const recorder = createTelemetryRecorder()
    const rawError = new Error('raw failure with /tmp/private-path and secret') as Error & { code?: string }
    rawError.code = 'SECRET_TOKEN'
    const harness = createMockHarness([], {
      throwOnSend: rawError,
    })
    const app = await buildApp({ harness, telemetry: recorder.telemetry })

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat',
      payload: { sessionId: 'sess-failed', message: 'secret prompt' },
    })

    expect(res.statusCode).toBe(500)
    expect(recorder.events.map((event) => event.name)).toEqual([
      'agent.chat.started',
      'agent.chat.message.submitted',
      'agent.chat.failed',
    ])
    expect(recorder.events.at(-1)?.properties).toEqual(expect.objectContaining({
      sessionId: 'sess-failed',
      status: 'error',
      durationMs: expect.any(Number),
      errorCode: ErrorCode.enum.INTERNAL_ERROR,
    }))
    const serialized = JSON.stringify(recorder.events)
    expect(serialized).not.toContain('secret prompt')
    expect(serialized).not.toContain('private-path')

    await app.close()
  })

  test('telemetry sink failures do not break chat streaming', async () => {
    const app = await buildApp({
      telemetry: {
        capture() {
          throw new Error('telemetry down')
        },
      },
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat',
      payload: validBody,
    })

    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('[DONE]')

    await app.close()
  })

  test('accepts optional model and thinkingLevel', async () => {
    const sendMessage = vi.fn(function* () {
      yield { type: 'start' }
      yield { type: 'text-start', id: '0' }
      yield { type: 'text-delta', id: '0', delta: 'ok' }
      yield { type: 'text-end', id: '0' }
      yield { type: 'finish' }
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
        yield { type: 'start' }
        yield { type: 'text-start', id: '0' }
        yield { type: 'text-delta', id: '0', delta: 'ok' }
        yield { type: 'text-end', id: '0' }
        yield { type: 'finish' }
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

  test('emits SSE error chunk and failed telemetry when async iterator throws mid-stream', async () => {
    const recorder = createTelemetryRecorder()
    const harness = createMockHarness()
    harness.sendMessage = function () {
      return (async function* () {
        yield { type: 'start' }
        yield { type: 'text-start', id: '0' }
        yield { type: 'text-delta', id: '0', delta: 'before' }
        throw new Error('mid-stream kaboom with /tmp/private-path secret')
      })()
    }

    const app = await buildApp({ harness, telemetry: recorder.telemetry })

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat',
      payload: validBody,
    })

    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('error')
    expect(recorder.events.map((event) => event.name)).toEqual([
      'agent.chat.started',
      'agent.chat.message.submitted',
      'agent.chat.failed',
    ])
    expect(recorder.events.at(-1)?.properties).toEqual(expect.objectContaining({
      sessionId: 'sess-1',
      status: 'error',
      errorCode: ErrorCode.enum.INTERNAL_ERROR,
      durationMs: expect.any(Number),
    }))
    expect(JSON.stringify(recorder.events)).not.toContain('private-path')

    await app.close()
  })

  test('returns 400 for sessionId exceeding max length', async () => {
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat',
      payload: { sessionId: 'x'.repeat(129), message: 'hello' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe(ERROR_CODE_VALIDATION_ERROR)

    await app.close()
  })

  test('returns 400 for message exceeding max length', async () => {
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat',
      payload: { sessionId: 's1', message: 'x'.repeat(1_000_001) },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe(ERROR_CODE_VALIDATION_ERROR)

    await app.close()
  })

  test('returns 400 for malformed model object', async () => {
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat',
      payload: { sessionId: 's1', message: 'hi', model: { provider: '' } },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe(ERROR_CODE_VALIDATION_ERROR)

    await app.close()
  })

  test('rejects a second active POST turn for the same session', async () => {
    let resolveStarted: () => void = () => {}
    const started = new Promise<void>((resolve) => { resolveStarted = resolve })
    const harness: AgentHarness = {
      id: 'single-turn-harness',
      placement: 'server',
      sendMessage(_input, ctx) {
        resolveStarted()
        return (async function* () {
          yield { type: 'start' } as UIMessageChunk
          await waitForAbort(ctx.abortSignal)
          yield { type: 'finish' } as UIMessageChunk
        })()
      },
      sessions: createMockHarness().sessions,
    }
    const app = await buildApp({ harness })

    const postA = app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat',
      payload: { ...validBody, clientTurnId: 'turn-a' },
    })
    await started

    const postB = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat',
      payload: { ...validBody, message: 'turn-b', clientTurnId: 'turn-b' },
    })

    expect(postB.statusCode).toBe(409)
    expect(postB.json().error.message).toBe('turn_already_active')

    await app.inject({ method: 'DELETE', url: '/api/v1/agent/chat/sess-1/turn?turnId=turn-a' })
    await postA
    await app.close()
  }, 10_000)

  test('reserves the active turn before async runtime resolution', async () => {
    let resolveRuntimeGate: () => void = () => {}
    let resolveRuntimeEntered: () => void = () => {}
    const runtimeGate = new Promise<void>((resolve) => { resolveRuntimeGate = resolve })
    const runtimeEntered = new Promise<void>((resolve) => { resolveRuntimeEntered = resolve })
    const harness = createMockHarness()
    let runtimeCalls = 0
    const app = await buildApp({
      getRuntime: async () => {
        runtimeCalls += 1
        if (runtimeCalls === 1) {
          resolveRuntimeEntered()
          await runtimeGate
        }
        return { harness, workdir: '/tmp/test' }
      },
    })

    const postA = app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat',
      payload: { ...validBody, clientTurnId: 'turn-a' },
    })
    await runtimeEntered

    const postB = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat',
      payload: { ...validBody, message: 'turn-b', clientTurnId: 'turn-b' },
    })
    resolveRuntimeGate()
    const resA = await postA

    expect(postB.statusCode).toBe(409)
    expect(postB.json().error.message).toBe('turn_already_active')
    expect(resA.statusCode).toBe(200)

    await app.close()
  })

  test('stale turn cancel does not abort the newer sequential turn', async () => {
    const signals = new Map<string, AbortSignal>()
    const startedResolvers = new Map<string, () => void>()
    const started = (turnId: string) => new Promise<void>((resolve) => startedResolvers.set(turnId, resolve))
    const harness: AgentHarness = {
      id: 'abortable-harness',
      placement: 'server',
      sendMessage(input, ctx) {
        const turnId = input.message
        signals.set(turnId, ctx.abortSignal)
        startedResolvers.get(turnId)?.()
        return (async function* () {
          yield { type: 'start' } as UIMessageChunk
          await waitForAbort(ctx.abortSignal)
          yield { type: 'finish' } as UIMessageChunk
        })()
      },
      sessions: createMockHarness().sessions,
    }
    const app = await buildApp({ harness })

    const aStarted = started('turn-a')
    const postA = app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat',
      payload: { ...validBody, message: 'turn-a', clientTurnId: 'turn-a' },
    })
    await aStarted
    await app.inject({ method: 'DELETE', url: '/api/v1/agent/chat/sess-1/turn?turnId=turn-a' })
    await postA

    const bStarted = started('turn-b')
    const postB = app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat',
      payload: { ...validBody, message: 'turn-b', clientTurnId: 'turn-b' },
    })
    await bStarted

    const staleCancelA = await app.inject({
      method: 'DELETE',
      url: '/api/v1/agent/chat/sess-1/turn?turnId=turn-a',
    })

    expect(staleCancelA.statusCode).toBe(204)
    expect(signals.get('turn-a')?.aborted).toBe(true)
    expect(signals.get('turn-b')?.aborted).toBe(false)

    await app.inject({ method: 'DELETE', url: '/api/v1/agent/chat/sess-1/turn?turnId=turn-b' })
    expect(signals.get('turn-b')?.aborted).toBe(true)

    await postB
    await app.close()
  }, 10_000)

  test('response includes X-Turn-Id header', async () => {
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat',
      payload: validBody,
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['x-turn-id']).toBeDefined()
    expect(typeof res.headers['x-turn-id']).toBe('string')
    expect((res.headers['x-turn-id'] as string).length).toBeGreaterThan(0)

    await app.close()
  })

  test('streams multiple chunks in order', async () => {
    const harness = createMockHarness([
      { type: 'start' },
      { type: 'text-start', id: '0' },
      { type: 'text-delta', id: '0', delta: 'one' },
      { type: 'text-delta', id: '0', delta: 'two' },
      { type: 'text-delta', id: '0', delta: 'three' },
      { type: 'text-end', id: '0' },
      { type: 'finish' },
    ])

    const app = await buildApp({ harness })

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat',
      payload: validBody,
    })

    expect(res.statusCode).toBe(200)
    const lines = res.body.split('\n').filter((l) => l.startsWith('data:'))
    expect(lines.length).toBeGreaterThan(0)

    await app.close()
  })
})

describe('GET /api/v1/agent/chat/:sessionId/stream (resume)', () => {
  test('replays completed turn from buffer', async () => {
    const app = await buildApp()

    const postRes = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat',
      payload: validBody,
    })
    expect(postRes.statusCode).toBe(200)

    const resumeRes = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/chat/sess-1/stream',
    })
    expect(resumeRes.statusCode).toBe(200)
    expect(resumeRes.body).toContain('data:')

    await app.close()
  })

  test('cursor skips already-received chunks', async () => {
    const harness = createMockHarness([
      { type: 'start' },
      { type: 'text-start', id: '0' },
      { type: 'text-delta', id: '0', delta: 'one' },
      { type: 'text-delta', id: '0', delta: 'two' },
      { type: 'text-delta', id: '0', delta: 'three' },
      { type: 'text-end', id: '0' },
      { type: 'finish' },
    ])
    const app = await buildApp({ harness })

    await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat',
      payload: validBody,
    })

    const fullRes = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/chat/sess-1/stream?cursor=-1',
    })
    const fullLines = fullRes.body
      .split('\n')
      .filter((l: string) => l.startsWith('data:') && !l.includes('[DONE]'))

    const partialRes = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/chat/sess-1/stream?cursor=0',
    })
    const partialLines = partialRes.body
      .split('\n')
      .filter((l: string) => l.startsWith('data:') && !l.includes('[DONE]'))

    expect(fullLines.length).toBeGreaterThan(0)
    expect(partialLines.length).toBeLessThan(fullLines.length)

    await app.close()
  })

  test('cursor beyond buffer returns 416', async () => {
    const harness = createMockHarness([{ type: 'text-delta', delta: 'a' }])
    const app = await buildApp({ harness })

    await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat',
      payload: validBody,
    })

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/chat/sess-1/stream?cursor=9999',
    })
    expect(res.statusCode).toBe(416)
    expect(res.json().error.code).toBe(ERROR_CODE_RANGE_NOT_SATISFIABLE)

    await app.close()
  })

  test('invalid cursor returns 400', async () => {
    const app = await buildApp()

    await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat',
      payload: validBody,
    })

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/chat/sess-1/stream?cursor=abc',
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe(ERROR_CODE_VALIDATION_ERROR)

    await app.close()
  })

  test('no active turn and no SessionStore returns 204', async () => {
    const app = await buildApp()

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/chat/unknown-session/stream',
    })
    expect(res.statusCode).toBe(204)

    await app.close()
  })

  test('no active turn returns 204 even when SessionStore has persisted messages', async () => {
    const mockLoad = vi.fn().mockResolvedValue({
      id: 'sess-ignored',
      title: 'ignored',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      turnCount: 2,
      messages: [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'user turn' }] },
        { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'assistant turn' }] },
      ],
    })
    const harness = createMockHarness()
    harness.sessions = { load: mockLoad } as any
    const app = await buildApp({ harness })

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/chat/sess-ignored/stream',
    })
    expect(res.statusCode).toBe(204)
    expect(mockLoad).not.toHaveBeenCalled()

    await app.close()
  })
})

describe('POST /api/v1/agent/chat/:sessionId/followup', () => {
  test('accepts idempotent retry with matching client nonce and rejects stale different nonce', async () => {
    const followUp = vi.fn().mockResolvedValue(undefined)
    const harness = createMockHarness()
    harness.followUp = followUp
    const app = await buildApp({ harness })

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat/sess-seq/followup',
      payload: { message: 'next', clientSeq: 1, clientNonce: 'nonce-1' },
    })
    expect(first.statusCode).toBe(202)
    expect(followUp).toHaveBeenCalledTimes(1)
    expect(followUp).toHaveBeenLastCalledWith('sess-seq', 'next', undefined, 'next', { clientNonce: 'nonce-1', clientSeq: 1 })

    const retry = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat/sess-seq/followup',
      payload: { message: 'next', clientSeq: 1, clientNonce: 'nonce-1' },
    })
    expect(retry.statusCode).toBe(202)
    expect(retry.json()).toEqual({ queued: true, duplicate: true })
    expect(followUp).toHaveBeenCalledTimes(1)

    const stale = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat/sess-seq/followup',
      payload: { message: 'different', clientSeq: 1, clientNonce: 'nonce-2' },
    })
    expect(stale.statusCode).toBe(409)
    expect(followUp).toHaveBeenCalledTimes(1)

    await app.close()
  })

  test('deletes one queued follow-up by client nonce', async () => {
    const clearFollowUp = vi.fn()
    const harness = createMockHarness()
    harness.clearFollowUp = clearFollowUp
    const app = await buildApp({ harness })

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/agent/chat/sess-delete/followup?clientNonce=nonce-delete&clientSeq=7',
    })

    expect(res.statusCode).toBe(204)
    expect(clearFollowUp).toHaveBeenCalledWith('sess-delete', { clientNonce: 'nonce-delete', clientSeq: 7 })

    await app.close()
  })

  test('ignores a follow-up POST that arrives after its DELETE', async () => {
    const followUp = vi.fn().mockResolvedValue(undefined)
    const harness = createMockHarness()
    harness.followUp = followUp
    const app = await buildApp({ harness })

    const deleted = await app.inject({
      method: 'DELETE',
      url: '/api/v1/agent/chat/sess-delete-race/followup?clientNonce=nonce-race&clientSeq=9',
    })
    expect(deleted.statusCode).toBe(204)

    const latePost = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat/sess-delete-race/followup',
      payload: { message: 'already deleted', clientSeq: 9, clientNonce: 'nonce-race' },
    })

    expect(latePost.statusCode).toBe(202)
    expect(latePost.json()).toEqual({ queued: false, deleted: true })
    expect(followUp).not.toHaveBeenCalled()

    await app.close()
  })

  test('returns retryable conflict when harness has no active follow-up session', async () => {
    const followUp = vi.fn().mockRejectedValue(new Error('followup_session_not_ready'))
    const harness = createMockHarness()
    harness.followUp = followUp
    const app = await buildApp({ harness })

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat/sess-not-ready/followup',
      payload: { message: 'next', clientSeq: 1, clientNonce: 'nonce-1' },
    })
    expect(first.statusCode).toBe(409)
    expect(first.json().error.message).toBe('followup_session_not_ready')

    followUp.mockResolvedValueOnce(undefined)
    const retry = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat/sess-not-ready/followup',
      payload: { message: 'next', clientSeq: 1, clientNonce: 'nonce-1' },
    })
    expect(retry.statusCode).toBe(202)
    expect(retry.json()).toEqual({ queued: true })
    expect(followUp).toHaveBeenCalledTimes(2)

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat/sess-not-ready/followup',
      payload: { message: 'next', clientSeq: 1, clientNonce: 'nonce-1' },
    })
    expect(duplicate.statusCode).toBe(202)
    expect(duplicate.json()).toEqual({ queued: true, duplicate: true })
    expect(followUp).toHaveBeenCalledTimes(2)

    await app.close()
  })
})

describe('GET /api/v1/agent/chat/:sessionId/messages', () => {
  test('returns full persisted history including user + assistant turns', async () => {
    const messages = [
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: 'how are you?' }],
      },
      {
        id: 'a1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'doing well' }],
      },
    ]
    const mockLoad = vi.fn().mockResolvedValue({
      id: 'sess-history',
      title: 'history',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      turnCount: 2,
      messages,
    })
    const harness = createMockHarness()
    harness.sessions = { load: mockLoad } as any
    const app = await buildApp({ harness })

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/chat/sess-history/messages',
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ messages })
    expect(mockLoad).toHaveBeenCalledWith(
      { workspaceId: 'default' },
      'sess-history',
    )

    await app.close()
  })

  test('returns empty message array when persisted session has no messages', async () => {
    const mockLoad = vi.fn().mockResolvedValue({
      id: 'sess-empty',
      title: 'empty',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      turnCount: 0,
      messages: undefined,
    })
    const harness = createMockHarness()
    harness.sessions = { load: mockLoad } as any
    const app = await buildApp({ harness })

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/chat/sess-empty/messages',
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ messages: [] })

    await app.close()
  })

  test('returns empty history payload when session lookup fails', async () => {
    const mockLoad = vi.fn().mockRejectedValue(new Error('not found'))
    const harness = createMockHarness()
    harness.sessions = { load: mockLoad } as any
    const app = await buildApp({ harness })

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/chat/sess-missing/messages',
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ messages: [] })

    await app.close()
  })
})
