import { describe, expect, it, vi } from 'vitest'
import type { AgentSessionEvent } from '@mariozechner/pi-coding-agent'
import type { AgentHarness, RunContext, SendMessageInput } from '../../../shared/harness'
import type { SessionStore } from '../../../shared/session'
import type { PiAgentSessionAdapter, PiAgentSessionSnapshot } from '../PiAgentSessionAdapter'
import { HarnessPiChatService } from '../harnessPiChatService'
import type { PiSessionRequestContext } from '../piSessionIdentity'
import type {
  AgentMeteringSink,
  MeteringReleaseInput,
  MeteringReserveInput,
  MeteringSettleInput,
  MeteringUsageInput,
} from '../metering'
import { normalizeMeteringUsage, PiChatMeteringCoordinator } from '../metering'

const ctx: PiSessionRequestContext = {
  workspaceId: 'workspace-a',
  storageScope: 'scope-a',
  authSubject: 'user-a',
  requestId: 'request-a',
}

const sessionStore: SessionStore = {
  list: vi.fn(async () => []),
  create: vi.fn(async () => ({ id: 's1', title: 'New session', createdAt: '', updatedAt: '', turnCount: 0 })),
  load: vi.fn(async () => ({ id: 's1', title: 'New session', createdAt: '', updatedAt: '', turnCount: 0 })),
  delete: vi.fn(async () => {}),
}

type FakeAdapter = PiAgentSessionAdapter & {
  emit(event: AgentSessionEvent): void
}

function createAdapter(followUps: string[] = []): FakeAdapter {
  const listeners = new Set<(event: AgentSessionEvent) => void>()
  const nativeFollowUps: Array<{ text: string; clientNonce?: string; clientSeq?: number }> = followUps.map((text) => ({ text }))
  const snapshot: PiAgentSessionSnapshot = {
    state: {},
    messages: [],
    isStreaming: true,
    isRetrying: false,
    retryAttempt: 0,
    pendingMessageCount: 0,
    steeringMessages: [],
    followUpMessages: followUps,
    followUpMode: 'one-at-a-time',
    sessionId: 's1',
  }

  return {
    readSnapshot: vi.fn(() => snapshot),
    subscribe: vi.fn((listener: (event: AgentSessionEvent) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
    prompt: vi.fn(async () => {}),
    followUp: vi.fn(async (text: string, options?: { displayText?: string; clientNonce?: string; clientSeq?: number }) => {
      nativeFollowUps.push({ text: options?.displayText ?? text, clientNonce: options?.clientNonce, clientSeq: options?.clientSeq })
      snapshot.followUpMessages = nativeFollowUps.map((item) => item.text)
    }),
    clearFollowUp: vi.fn((options?: { clientNonce?: string; clientSeq?: number }) => {
      if (options?.clientNonce || options?.clientSeq !== undefined) {
        const index = nativeFollowUps.findIndex((item) => options.clientNonce
          ? item.clientNonce === options.clientNonce
          : item.clientSeq === options.clientSeq)
        if (index >= 0) nativeFollowUps.splice(index, 1)
      } else {
        nativeFollowUps.splice(0)
      }
      snapshot.followUpMessages = nativeFollowUps.map((item) => item.text)
    }),
    abort: vi.fn(async () => {}),
    abortRetry: vi.fn(),
    emit: (event: AgentSessionEvent) => {
      for (const listener of listeners) listener(event)
    },
  }
}

interface SinkCalls {
  reserved: MeteringReserveInput[]
  usage: MeteringUsageInput[]
  settled: MeteringSettleInput[]
  released: MeteringReleaseInput[]
}

function createSink(overrides: Partial<AgentMeteringSink> = {}): { sink: AgentMeteringSink; calls: SinkCalls } {
  const calls: SinkCalls = { reserved: [], usage: [], settled: [], released: [] }
  const sink: AgentMeteringSink = {
    reserveRun: async (input) => {
      calls.reserved.push(input)
      return { reservationId: `res-${calls.reserved.length}` }
    },
    recordUsage: async (input) => {
      calls.usage.push(input)
    },
    settleRun: async (input) => {
      calls.settled.push(input)
    },
    releaseRun: async (input) => {
      calls.released.push(input)
    },
    ...overrides,
  }
  return { sink, calls }
}

function createService(adapter: FakeAdapter, sink: AgentMeteringSink) {
  const harness: AgentHarness & {
    getPiSessionAdapter: (input: SendMessageInput, ctx: RunContext) => Promise<PiAgentSessionAdapter>
    hasPiSession: (sessionId: string) => boolean
  } = {
    id: 'fake-pi',
    placement: 'server',
    sessions: sessionStore,
    hasPiSession: vi.fn(() => false),
    getPiSessionAdapter: vi.fn(async () => adapter),
  }
  const service = new HarnessPiChatService({
    harness,
    sessionStore,
    workdir: '/workspace',
    metering: sink,
    meteringLogger: () => {},
  })
  return { service, harness }
}

const USAGE = {
  input: 1200,
  output: 340,
  cacheRead: 90,
  cacheWrite: 10,
  totalTokens: 1640,
  cost: { input: 0.0012, output: 0.0034, cacheRead: 0.00001, cacheWrite: 0.00002, total: 0.00463 },
}

function assistantMessageEnd(overrides: Record<string, unknown> = {}): AgentSessionEvent {
  return {
    type: 'message_end',
    message: {
      id: 'a1',
      role: 'assistant',
      content: [{ type: 'text', text: 'done' }],
      provider: 'ollama',
      model: 'kimi-k2:1t',
      usage: USAGE,
      stopReason: 'stop',
      timestamp: 1,
      ...overrides,
    },
  } as unknown as AgentSessionEvent
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

function agentEnd(
  stopReason: 'stop' | 'error' | 'aborted',
  errorMessage?: string,
  opts: { willRetry?: boolean; messages?: unknown[] } = {},
): AgentSessionEvent {
  return {
    type: 'agent_end',
    willRetry: opts.willRetry,
    messages: opts.messages ?? [{ role: 'assistant', content: [], stopReason, errorMessage }],
  } as unknown as AgentSessionEvent
}

describe('pi chat metering', () => {
  it('meters a normal prompt run: reserve, record native usage, settle ok', async () => {
    const adapter = createAdapter()
    const { sink, calls } = createSink()
    const { service } = createService(adapter, sink)

    await service.prompt(ctx, 's1', {
      message: 'hello',
      clientNonce: 'nonce-1',
      model: { provider: 'ollama', id: 'kimi-k2:1t' },
    })

    expect(calls.reserved).toEqual([
      expect.objectContaining({
        kind: 'prompt',
        workspaceId: 'workspace-a',
        userId: 'user-a',
        sessionId: 's1',
        source: 'pi-chat',
        message: 'hello',
        model: { provider: 'ollama', id: 'kimi-k2:1t' },
        runId: 'pi-run:s1:prompt:nonce-1',
      }),
    ])

    adapter.emit({ type: 'agent_start', turnId: 'turn-1' } as unknown as AgentSessionEvent)
    adapter.emit(assistantMessageEnd())
    adapter.emit(agentEnd('stop'))
    await service.flushMetering()

    expect(calls.usage).toEqual([
      expect.objectContaining({
        runId: 'pi-run:s1:prompt:nonce-1',
        reservationId: 'res-1',
        usageId: 'pi-usage:s1:message:a1',
        messageId: 'a1',
        model: { provider: 'ollama', id: 'kimi-k2:1t' },
        stopReason: 'stop',
        usage: {
          input: 1200,
          output: 340,
          cacheRead: 90,
          cacheWrite: 10,
          cost: { input: 0.0012, output: 0.0034, cacheRead: 0.00001, cacheWrite: 0.00002, total: 0.00463 },
        },
      }),
    ])
    expect(calls.settled).toEqual([
      expect.objectContaining({ runId: 'pi-run:s1:prompt:nonce-1', reservationId: 'res-1', status: 'ok' }),
    ])
    expect(calls.released).toEqual([])
  })

  it('records zero-cost provider usage verbatim so hosts can apply fallback pricing', async () => {
    const adapter = createAdapter()
    const { sink, calls } = createSink()
    const { service } = createService(adapter, sink)

    await service.prompt(ctx, 's1', { message: 'hi', clientNonce: 'nonce-zero' })
    adapter.emit({ type: 'agent_start', turnId: 'turn-1' } as unknown as AgentSessionEvent)
    adapter.emit(assistantMessageEnd({
      usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    }))
    adapter.emit(agentEnd('stop'))
    await service.flushMetering()

    expect(calls.usage).toEqual([
      expect.objectContaining({
        usage: expect.objectContaining({ input: 10, output: 5, cost: expect.objectContaining({ total: 0 }) }),
      }),
    ])
    expect(calls.settled).toHaveLength(1)
  })

  it('settles ok without usage rows when the provider reported no usage', async () => {
    const adapter = createAdapter()
    const { sink, calls } = createSink()
    const { service } = createService(adapter, sink)

    await service.prompt(ctx, 's1', { message: 'hi', clientNonce: 'nonce-no-usage' })
    adapter.emit({ type: 'agent_start', turnId: 'turn-1' } as unknown as AgentSessionEvent)
    adapter.emit(agentEnd('stop'))
    await service.flushMetering()

    expect(calls.usage).toEqual([])
    expect(calls.settled).toEqual([expect.objectContaining({ status: 'ok' })])
    expect(calls.released).toEqual([])
  })

  it('releases the reservation when the run errors before any usage arrived', async () => {
    const adapter = createAdapter()
    const { sink, calls } = createSink()
    const { service } = createService(adapter, sink)

    await service.prompt(ctx, 's1', { message: 'boom', clientNonce: 'nonce-err' })
    adapter.emit({ type: 'agent_start', turnId: 'turn-1' } as unknown as AgentSessionEvent)
    adapter.emit(agentEnd('error', 'No API key for provider'))
    await service.flushMetering()

    expect(calls.usage).toEqual([])
    expect(calls.settled).toEqual([])
    expect(calls.released).toEqual([
      expect.objectContaining({ runId: 'pi-run:s1:prompt:nonce-err', reason: 'error-before-usage' }),
    ])
  })

  it('releases the reservation when the prompt run rejects before streaming', async () => {
    const adapter = createAdapter()
    adapter.prompt = vi.fn(async () => {
      throw new Error('provider down')
    })
    const { sink, calls } = createSink()
    const { service } = createService(adapter, sink)

    await service.prompt(ctx, 's1', { message: 'boom', clientNonce: 'nonce-reject' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await service.flushMetering()

    expect(calls.settled).toEqual([])
    expect(calls.released).toEqual([
      expect.objectContaining({ runId: 'pi-run:s1:prompt:nonce-reject', reason: 'error-before-usage' }),
    ])
  })

  it('settles an errored run that already produced billable usage', async () => {
    const adapter = createAdapter()
    const { sink, calls } = createSink()
    const { service } = createService(adapter, sink)

    await service.prompt(ctx, 's1', { message: 'partial', clientNonce: 'nonce-partial' })
    adapter.emit({ type: 'agent_start', turnId: 'turn-1' } as unknown as AgentSessionEvent)
    adapter.emit(assistantMessageEnd())
    adapter.emit(agentEnd('error', 'tool crashed'))
    await service.flushMetering()

    expect(calls.usage).toHaveLength(1)
    expect(calls.settled).toEqual([expect.objectContaining({ status: 'error' })])
    expect(calls.released).toEqual([])
  })

  it('records duplicate native message_end events once, with a stable idempotency key', async () => {
    const adapter = createAdapter()
    const { sink, calls } = createSink()
    const { service } = createService(adapter, sink)

    await service.prompt(ctx, 's1', { message: 'dup', clientNonce: 'nonce-dup' })
    adapter.emit({ type: 'agent_start', turnId: 'turn-1' } as unknown as AgentSessionEvent)
    adapter.emit(assistantMessageEnd())
    adapter.emit(assistantMessageEnd())
    adapter.emit(agentEnd('stop'))
    await service.flushMetering()

    expect(calls.usage).toHaveLength(1)
    expect(calls.usage[0]?.usageId).toBe('pi-usage:s1:message:a1')
  })

  it('meters consumed follow-ups independently from the originating prompt', async () => {
    const adapter = createAdapter()
    const { sink, calls } = createSink()
    const { service } = createService(adapter, sink)

    await service.prompt(ctx, 's1', { message: 'first', clientNonce: 'nonce-p' })
    await service.followUp(ctx, 's1', { message: 'second', clientNonce: 'nonce-f', clientSeq: 0 })

    expect(calls.reserved).toEqual([
      expect.objectContaining({ kind: 'prompt', runId: 'pi-run:s1:prompt:nonce-p' }),
      expect.objectContaining({ kind: 'followup', runId: 'pi-run:s1:followup:nonce-f:0' }),
    ])

    adapter.emit({ type: 'agent_start', turnId: 'turn-1' } as unknown as AgentSessionEvent)
    adapter.emit(assistantMessageEnd({ id: 'a1' }))
    // Pi consumes the queued follow-up inside the same agent loop.
    adapter.emit({
      type: 'message_start',
      message: { id: 'u2', role: 'user', content: [{ type: 'text', text: 'second' }], clientNonce: 'nonce-f', clientSeq: 0 },
    } as unknown as AgentSessionEvent)
    adapter.emit(assistantMessageEnd({ id: 'a2' }))
    adapter.emit(agentEnd('stop'))
    await service.flushMetering()

    expect(calls.usage).toEqual([
      expect.objectContaining({ usageId: 'pi-usage:s1:message:a1', runId: 'pi-run:s1:prompt:nonce-p' }),
      expect.objectContaining({ usageId: 'pi-usage:s1:message:a2', runId: 'pi-run:s1:followup:nonce-f:0' }),
    ])
    expect(calls.settled).toEqual([
      expect.objectContaining({ runId: 'pi-run:s1:prompt:nonce-p', status: 'ok' }),
      expect.objectContaining({ runId: 'pi-run:s1:followup:nonce-f:0', status: 'ok' }),
    ])
    expect(calls.released).toEqual([])
  })

  it('releases a prompt reservation stranded before agent-start when the session is stopped', async () => {
    const adapter = createAdapter()
    const run = deferred<void>()
    adapter.prompt = vi.fn(() => run.promise)
    const { sink, calls } = createSink()
    const { service } = createService(adapter, sink)

    // Accepted, reserved, but no agent_start yet (run still in flight).
    await service.prompt(ctx, 's1', { message: 'stranded', clientNonce: 'nonce-strand' })
    expect(calls.reserved).toHaveLength(1)

    await service.stop(ctx, 's1', {})
    await service.flushMetering()

    expect(calls.settled).toEqual([])
    expect(calls.released).toEqual([
      expect.objectContaining({ runId: 'pi-run:s1:prompt:nonce-strand', reason: 'cancelled' }),
    ])
    run.resolve()
  })

  it('releases a stranded prompt reservation on interrupt', async () => {
    const adapter = createAdapter()
    const run = deferred<void>()
    adapter.prompt = vi.fn(() => run.promise)
    // interrupt awaits the in-flight run after aborting; the native abort
    // settles it.
    adapter.abort = vi.fn(async () => run.resolve())
    const { sink, calls } = createSink()
    const { service } = createService(adapter, sink)

    await service.prompt(ctx, 's1', { message: 'stranded', clientNonce: 'nonce-int' })
    await service.interrupt(ctx, 's1', {})
    await service.flushMetering()

    expect(calls.released).toEqual([
      expect.objectContaining({ runId: 'pi-run:s1:prompt:nonce-int', reason: 'cancelled' }),
    ])
  })

  it('does not attribute usage to a prompt already released by a racing stop', async () => {
    const adapter = createAdapter()
    const run = deferred<void>()
    adapter.prompt = vi.fn(() => run.promise)
    const { sink, calls } = createSink()
    const { service } = createService(adapter, sink)

    await service.prompt(ctx, 's1', { message: 'raced', clientNonce: 'nonce-race' })
    await service.stop(ctx, 's1', {})
    // A late agent_start + usage races in after the stop released the run.
    adapter.emit({ type: 'agent_start', turnId: 'turn-late' } as unknown as AgentSessionEvent)
    adapter.emit(assistantMessageEnd())
    adapter.emit(agentEnd('stop'))
    await service.flushMetering()

    expect(calls.usage).toEqual([])
    expect(calls.released).toEqual([
      expect.objectContaining({ runId: 'pi-run:s1:prompt:nonce-race', reason: 'cancelled' }),
    ])
    run.resolve()
  })

  it('meters a consumed follow-up when the native message carries no selectors (production path)', async () => {
    const adapter = createAdapter()
    const { sink, calls } = createSink()
    const { service } = createService(adapter, sink)

    await service.prompt(ctx, 's1', { message: 'first', clientNonce: 'nonce-p' })
    await service.followUp(ctx, 's1', { message: 'second', clientNonce: 'nonce-f', clientSeq: 0 })

    adapter.emit({ type: 'agent_start', turnId: 'turn-1' } as unknown as AgentSessionEvent)
    adapter.emit(assistantMessageEnd({ id: 'a1' }))
    // Production: pi consumes the queued follow-up and emits a user message
    // WITHOUT clientNonce/clientSeq — enrichEvent recovers them by text match.
    adapter.emit({
      type: 'message_start',
      message: { id: 'u2', role: 'user', content: [{ type: 'text', text: 'second' }] },
    } as unknown as AgentSessionEvent)
    adapter.emit(assistantMessageEnd({ id: 'a2' }))
    adapter.emit(agentEnd('stop'))
    await service.flushMetering()

    expect(calls.usage).toEqual([
      expect.objectContaining({ usageId: 'pi-usage:s1:message:a1', runId: 'pi-run:s1:prompt:nonce-p' }),
      expect.objectContaining({ usageId: 'pi-usage:s1:message:a2', runId: 'pi-run:s1:followup:nonce-f:0' }),
    ])
    expect(calls.settled).toEqual([
      expect.objectContaining({ runId: 'pi-run:s1:prompt:nonce-p', status: 'ok' }),
      expect.objectContaining({ runId: 'pi-run:s1:followup:nonce-f:0', status: 'ok' }),
    ])
    expect(calls.released).toEqual([])
  })

  it('releases queued follow-up reservations on selector clear, full clear, and stop', async () => {
    const adapter = createAdapter()
    const { sink, calls } = createSink()
    const { service } = createService(adapter, sink)

    await service.followUp(ctx, 's1', { message: 'q1', clientNonce: 'nonce-q1', clientSeq: 0 })
    await service.followUp(ctx, 's1', { message: 'q2', clientNonce: 'nonce-q2', clientSeq: 1 })
    await service.followUp(ctx, 's1', { message: 'q3', clientNonce: 'nonce-q3', clientSeq: 2 })

    await service.clearQueue(ctx, 's1', { clientNonce: 'nonce-q1' })
    await service.flushMetering()
    expect(calls.released).toEqual([
      expect.objectContaining({ runId: 'pi-run:s1:followup:nonce-q1:0', reason: 'queue-cleared' }),
    ])

    await service.stop(ctx, 's1', {})
    await service.flushMetering()
    expect(calls.released).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ runId: 'pi-run:s1:followup:nonce-q2:1', reason: 'queue-cleared' }),
        expect.objectContaining({ runId: 'pi-run:s1:followup:nonce-q3:2', reason: 'queue-cleared' }),
      ]),
    )
    expect(calls.released).toHaveLength(3)
    expect(calls.settled).toEqual([])
  })

  it('suppresses a duplicate prompt nonce that retries mid-stream after message-start', async () => {
    const adapter = createAdapter()
    const { sink, calls } = createSink()
    const { service } = createService(adapter, sink)

    await service.prompt(ctx, 's1', { message: 'go', clientNonce: 'nonce-mid' })
    adapter.emit({ type: 'agent_start', turnId: 'turn-1' } as unknown as AgentSessionEvent)
    // The prompt's user message-start is consumed (reconciler metadata cleared),
    // but the run is still active mid-stream.
    adapter.emit({
      type: 'message_start',
      message: { id: 'u1', role: 'user', content: [{ type: 'text', text: 'go' }], clientNonce: 'nonce-mid' },
    } as unknown as AgentSessionEvent)

    // Client retries the same nonce now — must be suppressed, not re-executed.
    const retry = await service.prompt(ctx, 's1', { message: 'go', clientNonce: 'nonce-mid' })
    expect(retry).toMatchObject({ duplicate: true })
    expect(adapter.prompt).toHaveBeenCalledTimes(1)

    adapter.emit(assistantMessageEnd({ id: 'a1' }))
    adapter.emit(agentEnd('stop'))
    await service.flushMetering()

    expect(calls.reserved).toHaveLength(1)
    expect(calls.usage).toEqual([
      expect.objectContaining({ runId: 'pi-run:s1:prompt:nonce-mid', usageId: 'pi-usage:s1:message:a1' }),
    ])
    expect(calls.settled).toEqual([expect.objectContaining({ status: 'ok' })])
    expect(calls.released).toEqual([])
  })

  it('harvests billable usage from a willRetry agent_end final assistant', async () => {
    const adapter = createAdapter()
    const { sink, calls } = createSink()
    const { service } = createService(adapter, sink)

    await service.prompt(ctx, 's1', { message: 'flaky', clientNonce: 'nonce-rt' })
    adapter.emit({ type: 'agent_start', turnId: 'turn-1' } as unknown as AgentSessionEvent)
    // Failed attempt carries real usage and rides on a willRetry agent_end.
    adapter.emit(agentEnd('error', 'overloaded', {
      willRetry: true,
      messages: [{ id: 'a-failed', role: 'assistant', content: [], stopReason: 'error', usage: USAGE, provider: 'ollama', model: 'kimi-k2:1t' }],
    }))
    adapter.emit({ type: 'auto_retry_start', attempt: 1, maxAttempts: 3, delayMs: 0, errorMessage: 'overloaded' } as unknown as AgentSessionEvent)
    adapter.emit({ type: 'auto_retry_end', success: true, attempt: 1 } as unknown as AgentSessionEvent)
    adapter.emit(assistantMessageEnd({ id: 'a-ok' }))
    adapter.emit(agentEnd('stop'))
    await service.flushMetering()

    // Both the failed attempt's usage and the retried completion are billed.
    expect(calls.usage).toEqual([
      expect.objectContaining({ usageId: 'pi-usage:s1:message:a-failed' }),
      expect.objectContaining({ usageId: 'pi-usage:s1:message:a-ok' }),
    ])
    expect(calls.settled).toEqual([expect.objectContaining({ status: 'ok' })])
    expect(calls.released).toEqual([])
  })

  it('does not bill a willRetry agent_end that carries no usage', async () => {
    const adapter = createAdapter()
    const { sink, calls } = createSink()
    const { service } = createService(adapter, sink)

    await service.prompt(ctx, 's1', { message: 'flaky', clientNonce: 'nonce-rt2' })
    adapter.emit({ type: 'agent_start', turnId: 'turn-1' } as unknown as AgentSessionEvent)
    adapter.emit(agentEnd('error', 'overloaded', { willRetry: true }))
    adapter.emit(assistantMessageEnd({ id: 'a-ok' }))
    adapter.emit(agentEnd('stop'))
    await service.flushMetering()

    expect(calls.usage).toEqual([expect.objectContaining({ usageId: 'pi-usage:s1:message:a-ok' })])
  })

  it('suppresses a duplicate follow-up retry (same nonce/seq) while queued', async () => {
    const adapter = createAdapter()
    const { sink, calls } = createSink()
    const { service } = createService(adapter, sink)

    await service.followUp(ctx, 's1', { message: 'q', clientNonce: 'nonce-fu', clientSeq: 0 })
    const retry = await service.followUp(ctx, 's1', { message: 'q', clientNonce: 'nonce-fu', clientSeq: 0 })

    expect(retry).toMatchObject({ duplicate: true, queued: true })
    expect(calls.reserved).toHaveLength(1)
    expect(adapter.followUp).toHaveBeenCalledTimes(1)
  })

  it('releases a queued follow-up reservation cleared by clientSeq alone', async () => {
    const adapter = createAdapter()
    const { sink, calls } = createSink()
    const { service } = createService(adapter, sink)

    await service.followUp(ctx, 's1', { message: 'q', clientNonce: 'nonce-seq', clientSeq: 3 })
    // clearQueue may target by seq only, even though the run was reserved with
    // both nonce and seq.
    await service.clearQueue(ctx, 's1', { clientSeq: 3 })
    await service.flushMetering()

    expect(calls.released).toEqual([
      expect.objectContaining({ runId: 'pi-run:s1:followup:nonce-seq:3', reason: 'queue-cleared' }),
    ])
  })

  it('releases an aborted run without usage as cancelled', async () => {
    const adapter = createAdapter()
    const { sink, calls } = createSink()
    const { service } = createService(adapter, sink)

    await service.prompt(ctx, 's1', { message: 'stop me', clientNonce: 'nonce-abort' })
    adapter.emit({ type: 'agent_start', turnId: 'turn-1' } as unknown as AgentSessionEvent)
    adapter.emit(agentEnd('aborted'))
    await service.flushMetering()

    expect(calls.settled).toEqual([])
    expect(calls.released).toEqual([
      expect.objectContaining({ runId: 'pi-run:s1:prompt:nonce-abort', reason: 'cancelled' }),
    ])
  })

  it('keeps the run alive across pi auto-retry and bills the retried completion', async () => {
    const adapter = createAdapter()
    const { sink, calls } = createSink()
    const { service } = createService(adapter, sink)

    await service.prompt(ctx, 's1', { message: 'flaky', clientNonce: 'nonce-retry' })
    adapter.emit({ type: 'agent_start', turnId: 'turn-1' } as unknown as AgentSessionEvent)
    // Transient provider error: pi ends the turn with willRetry and continues
    // the SAME run after auto_retry_* — no new agent_start.
    adapter.emit(agentEnd('error', 'overloaded', { willRetry: true }))
    adapter.emit({ type: 'auto_retry_start', attempt: 1, maxAttempts: 3, delayMs: 0, errorMessage: 'overloaded' } as unknown as AgentSessionEvent)
    adapter.emit({ type: 'auto_retry_end', success: true, attempt: 1 } as unknown as AgentSessionEvent)
    adapter.emit(assistantMessageEnd({ id: 'a-retried' }))
    adapter.emit(agentEnd('stop'))
    await service.flushMetering()

    expect(calls.released).toEqual([])
    expect(calls.usage).toEqual([
      expect.objectContaining({ usageId: 'pi-usage:s1:message:a-retried', runId: 'pi-run:s1:prompt:nonce-retry' }),
    ])
    expect(calls.settled).toEqual([expect.objectContaining({ status: 'ok' })])
  })

  it('harvests usage riding only on agent_end final assistant messages', async () => {
    const adapter = createAdapter()
    const { sink, calls } = createSink()
    const { service } = createService(adapter, sink)

    await service.prompt(ctx, 's1', { message: 'abrupt', clientNonce: 'nonce-final' })
    adapter.emit({ type: 'agent_start', turnId: 'turn-1' } as unknown as AgentSessionEvent)
    // No message_end at all; the final (errored) assistant message with usage
    // only rides on agent_end.
    adapter.emit(agentEnd('error', 'tool crashed', {
      messages: [{ role: 'assistant', content: [], stopReason: 'error', errorMessage: 'tool crashed', usage: USAGE, provider: 'ollama', model: 'kimi-k2:1t' }],
    }))
    await service.flushMetering()

    expect(calls.usage).toEqual([
      // id-less fallback usage id: pi-usage:<runId>:<instanceId>:<n>
      expect.objectContaining({ usageId: 'pi-usage:pi-run:s1:prompt:nonce-final:1:1', runId: 'pi-run:s1:prompt:nonce-final' }),
    ])
    // Usage was billable, so the errored run settles instead of releasing.
    expect(calls.settled).toEqual([expect.objectContaining({ status: 'error' })])
    expect(calls.released).toEqual([])
  })

  it('does not double-record when the message_end usage reappears on agent_end', async () => {
    const adapter = createAdapter()
    const { sink, calls } = createSink()
    const { service } = createService(adapter, sink)

    await service.prompt(ctx, 's1', { message: 'both paths', clientNonce: 'nonce-both' })
    adapter.emit({ type: 'agent_start', turnId: 'turn-1' } as unknown as AgentSessionEvent)
    adapter.emit(assistantMessageEnd({ id: 'a1' }))
    adapter.emit(agentEnd('stop', undefined, {
      messages: [{ id: 'a1', role: 'assistant', content: [], stopReason: 'stop', usage: USAGE }],
    }))
    await service.flushMetering()

    expect(calls.usage).toHaveLength(1)
  })

  it('suppresses a duplicate in-flight prompt nonce: one reservation, one execution', async () => {
    const adapter = createAdapter()
    const { sink, calls } = createSink()
    const { service } = createService(adapter, sink)

    const first = await service.prompt(ctx, 's1', { message: 'retry me', clientNonce: 'nonce-same' })
    const second = await service.prompt(ctx, 's1', { message: 'retry me', clientNonce: 'nonce-same' })

    // The duplicate is acknowledged without a second reservation or model run.
    expect(first).not.toHaveProperty('duplicate', true)
    expect(second).toMatchObject({ accepted: true, clientNonce: 'nonce-same', duplicate: true })
    expect(calls.reserved).toHaveLength(1)
    expect(adapter.prompt).toHaveBeenCalledTimes(1)
    expect(calls.released).toEqual([])

    adapter.emit({ type: 'agent_start', turnId: 'turn-1' } as unknown as AgentSessionEvent)
    adapter.emit(assistantMessageEnd())
    adapter.emit(agentEnd('stop'))
    await service.flushMetering()

    expect(calls.usage).toHaveLength(1)
    expect(calls.settled).toHaveLength(1)
  })

  it('bills overlapping prompts in acceptance order without dropping either', async () => {
    const adapter = createAdapter()
    const { sink, calls } = createSink()
    const { service } = createService(adapter, sink)

    // Prompt B accepted before prompt A's agent_start was observed.
    await service.prompt(ctx, 's1', { message: 'first', clientNonce: 'nonce-a' })
    await service.prompt(ctx, 's1', { message: 'second', clientNonce: 'nonce-b' })
    expect(calls.released).toEqual([])

    adapter.emit({ type: 'agent_start', turnId: 'turn-1' } as unknown as AgentSessionEvent)
    adapter.emit(assistantMessageEnd({ id: 'a1' }))
    adapter.emit(agentEnd('stop'))
    adapter.emit({ type: 'agent_start', turnId: 'turn-2' } as unknown as AgentSessionEvent)
    adapter.emit(assistantMessageEnd({ id: 'a2' }))
    adapter.emit(agentEnd('stop'))
    await service.flushMetering()

    expect(calls.usage).toEqual([
      expect.objectContaining({ usageId: 'pi-usage:s1:message:a1', runId: 'pi-run:s1:prompt:nonce-a' }),
      expect.objectContaining({ usageId: 'pi-usage:s1:message:a2', runId: 'pi-run:s1:prompt:nonce-b' }),
    ])
    expect(calls.settled).toEqual([
      expect.objectContaining({ runId: 'pi-run:s1:prompt:nonce-a', status: 'ok' }),
      expect.objectContaining({ runId: 'pi-run:s1:prompt:nonce-b', status: 'ok' }),
    ])
  })

  it('rejects the prompt (fail closed) when the sink refuses the reservation', async () => {
    const adapter = createAdapter()
    const refusal = Object.assign(new Error('demo credit exhausted'), { statusCode: 402 })
    const { sink, calls } = createSink({
      reserveRun: async () => {
        throw refusal
      },
    })
    const { service } = createService(adapter, sink)

    await expect(service.prompt(ctx, 's1', { message: 'no funds', clientNonce: 'nonce-x' })).rejects.toBe(refusal)
    expect(adapter.prompt).not.toHaveBeenCalled()
    expect(calls.usage).toEqual([])

    await expect(service.followUp(ctx, 's1', { message: 'still none', clientNonce: 'nonce-y', clientSeq: 0 })).rejects.toBe(refusal)
    expect(adapter.followUp).not.toHaveBeenCalled()
  })

  it('releases the follow-up reservation when the adapter rejects queuing', async () => {
    const adapter = createAdapter()
    adapter.followUp = vi.fn(async () => {
      throw new Error('queue full')
    })
    const { sink, calls } = createSink()
    const { service } = createService(adapter, sink)

    await expect(service.followUp(ctx, 's1', { message: 'nope', clientNonce: 'nonce-q', clientSeq: 0 })).rejects.toThrow('queue full')
    await service.flushMetering()
    expect(calls.released).toEqual([
      expect.objectContaining({ runId: 'pi-run:s1:followup:nonce-q:0', reason: 'run-rejected' }),
    ])
  })

  it('releases all reservations when the session is deleted', async () => {
    const adapter = createAdapter()
    const { sink, calls } = createSink()
    const { service } = createService(adapter, sink)

    await service.prompt(ctx, 's1', { message: 'live', clientNonce: 'nonce-live' })
    adapter.emit({ type: 'agent_start', turnId: 'turn-1' } as unknown as AgentSessionEvent)
    await service.followUp(ctx, 's1', { message: 'queued', clientNonce: 'nonce-fq', clientSeq: 0 })

    await service.deleteSession(ctx, 's1')
    await service.flushMetering()

    expect(calls.released).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ runId: 'pi-run:s1:followup:nonce-fq:0', reason: 'cancelled' }),
        expect.objectContaining({ runId: 'pi-run:s1:prompt:nonce-live', reason: 'cancelled' }),
      ]),
    )
  })

  it('releases (not settles) a run whose usage write failed, so no paid hold closes without a ledger row', async () => {
    const adapter = createAdapter()
    const { sink, calls } = createSink({
      recordUsage: async () => {
        throw new Error('ledger insert failed')
      },
    })
    const { service } = createService(adapter, sink)

    await service.prompt(ctx, 's1', { message: 'lossy', clientNonce: 'nonce-loss' })
    adapter.emit({ type: 'agent_start', turnId: 'turn-1' } as unknown as AgentSessionEvent)
    adapter.emit(assistantMessageEnd())
    adapter.emit(agentEnd('stop'))
    await service.flushMetering()

    expect(calls.settled).toEqual([])
    expect(calls.released).toEqual([
      expect.objectContaining({ runId: 'pi-run:s1:prompt:nonce-loss', reason: 'usage-write-failed' }),
    ])
  })

  it('still settles when usage persisted even though a later settle attempt retries', async () => {
    const adapter = createAdapter()
    const { sink, calls } = createSink()
    const { service } = createService(adapter, sink)

    await service.prompt(ctx, 's1', { message: 'ok', clientNonce: 'nonce-ok' })
    adapter.emit({ type: 'agent_start', turnId: 'turn-1' } as unknown as AgentSessionEvent)
    adapter.emit(assistantMessageEnd())
    adapter.emit(agentEnd('stop'))
    await service.flushMetering()

    expect(calls.usage).toHaveLength(1)
    expect(calls.settled).toEqual([expect.objectContaining({ status: 'ok' })])
    expect(calls.released).toEqual([])
  })

  it('keeps publishing chat events when sink usage/settle calls fail', async () => {
    const adapter = createAdapter()
    const failures: unknown[] = []
    const { sink } = createSink({
      recordUsage: async () => {
        throw new Error('db down')
      },
      // A failed usage write makes finishRun release (not settle); fail that
      // too to prove the pipeline survives both.
      releaseRun: async () => {
        throw new Error('db still down')
      },
    })
    const harness: AgentHarness & { getPiSessionAdapter: (input: SendMessageInput, ctx: RunContext) => Promise<PiAgentSessionAdapter> } = {
      id: 'fake-pi',
      placement: 'server',
      sessions: sessionStore,
      getPiSessionAdapter: vi.fn(async () => adapter),
    }
    const service = new HarnessPiChatService({
      harness,
      sessionStore,
      workdir: '/workspace',
      metering: sink,
      meteringLogger: (_message, error) => failures.push(error),
    })
    const events: unknown[] = []
    const subscription = await service.subscribe(ctx, 's1', 0, (event) => events.push(event))
    expect(subscription.type).toBe('ok')

    await service.prompt(ctx, 's1', { message: 'resilient', clientNonce: 'nonce-r' })
    adapter.emit({ type: 'agent_start', turnId: 'turn-1' } as unknown as AgentSessionEvent)
    adapter.emit(assistantMessageEnd())
    adapter.emit(agentEnd('stop'))
    await service.flushMetering()

    expect(events.length).toBeGreaterThan(0)
    expect(failures).toHaveLength(2)
    if (subscription.type === 'ok') subscription.unsubscribe()
  })
})

describe('normalizeMeteringUsage', () => {
  it('normalizes a full native usage object', () => {
    expect(normalizeMeteringUsage(USAGE)).toEqual({
      input: 1200,
      output: 340,
      cacheRead: 90,
      cacheWrite: 10,
      cost: { input: 0.0012, output: 0.0034, cacheRead: 0.00001, cacheWrite: 0.00002, total: 0.00463 },
    })
  })

  it('zero-fills partial objects and rejects non-objects', () => {
    expect(normalizeMeteringUsage({ input: 7 })).toEqual({
      input: 7,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    })
    expect(normalizeMeteringUsage(undefined)).toBeUndefined()
    expect(normalizeMeteringUsage('usage')).toBeUndefined()
  })
})

describe('PiChatMeteringCoordinator promoted follow-up failure', () => {
  function coordinatorSink() {
    const calls: SinkCalls = { reserved: [], usage: [], settled: [], released: [] }
    const sink: AgentMeteringSink = {
      reserveRun: async (input) => { calls.reserved.push(input); return {} },
      recordUsage: async (input) => { calls.usage.push(input) },
      settleRun: async (input) => { calls.settled.push(input) },
      releaseRun: async (input) => { calls.released.push(input) },
    }
    return { sink, calls }
  }

  const scope = { workspaceId: 'ws', userId: 'user-a', sessionId: 's1' }

  it('creates only one run for two concurrent same-nonce reserves racing the async sink', async () => {
    const calls: SinkCalls = { reserved: [], usage: [], settled: [], released: [] }
    const gate = deferred<void>()
    const sink: AgentMeteringSink = {
      reserveRun: async (input) => {
        calls.reserved.push(input)
        await gate.promise // hold both reserves open to force the race
        return {}
      },
      recordUsage: async (input) => { calls.usage.push(input) },
      settleRun: async (input) => { calls.settled.push(input) },
      releaseRun: async (input) => { calls.released.push(input) },
    }
    const coordinator = new PiChatMeteringCoordinator(sink, () => {})

    const first = coordinator.reservePrompt({ ...scope, clientNonce: 'n', message: 'a' })
    const second = coordinator.reservePrompt({ ...scope, clientNonce: 'n', message: 'b' })
    gate.resolve()
    const [firstNew, secondNew] = await Promise.all([first, second])

    // Exactly one new run; the loser is told it's a duplicate.
    expect([firstNew, secondNew].filter(Boolean)).toHaveLength(1)

    coordinator.observe('s1', { type: 'agent_start', turnId: 't' }, [
      { type: 'agent-start', seq: 1, turnId: 't' } as never,
    ])
    coordinator.observe('s1', { type: 'message_end', message: { id: 'a1', role: 'assistant', usage: USAGE } }, [])
    coordinator.observe('s1', { type: 'agent_end', messages: [{ role: 'assistant', stopReason: 'stop' }] }, [
      { type: 'agent-end', seq: 2, turnId: 't', status: 'ok' } as never,
    ])
    await coordinator.flush()

    expect(calls.usage).toHaveLength(1)
    expect(calls.settled).toEqual([expect.objectContaining({ status: 'ok' })])
    expect(calls.released).toEqual([])
  })

  it('gives id-less usage distinct ids across run instances that reuse a run id', async () => {
    const { sink, calls } = coordinatorSink()
    const coordinator = new PiChatMeteringCoordinator(sink, () => {})
    const idlessUsage = { type: 'message_end', message: { role: 'assistant', usage: USAGE } }

    for (const turn of ['t1', 't2']) {
      // Same client nonce → same runId; a fresh run instance each completion.
      await coordinator.reservePrompt({ ...scope, clientNonce: 'n', message: turn })
      coordinator.observe('s1', { type: 'agent_start', turnId: turn }, [
        { type: 'agent-start', seq: 1, turnId: turn } as never,
      ])
      coordinator.observe('s1', idlessUsage, [])
      coordinator.observe('s1', { type: 'agent_end', messages: [{ role: 'assistant', stopReason: 'stop' }] }, [
        { type: 'agent-end', seq: 2, turnId: turn, status: 'ok' } as never,
      ])
    }
    await coordinator.flush()

    expect(calls.usage).toHaveLength(2)
    expect(calls.usage[0]?.usageId).toBe('pi-usage:pi-run:s1:prompt:n:1:1')
    expect(calls.usage[1]?.usageId).toBe('pi-usage:pi-run:s1:prompt:n:2:1')
  })

  it('failFollowUpRun releases a queued run by selector and no-ops once it is consumed', async () => {
    const { sink, calls } = coordinatorSink()
    const coordinator = new PiChatMeteringCoordinator(sink, () => {})

    await coordinator.reserveFollowUp({ ...scope, clientNonce: 'nonce-f', clientSeq: 0, message: 'queued' })
    // continueQueuedFollowUp rejected before consumption → release the hold.
    coordinator.failFollowUpRun('s1', { clientNonce: 'nonce-f', clientSeq: 0 })
    await coordinator.flush()
    expect(calls.released).toEqual([
      expect.objectContaining({ runId: 'pi-run:s1:followup:nonce-f:0', reason: 'run-rejected' }),
    ])

    // After consumption the queued lookup is empty, so a late failure is a no-op.
    await coordinator.reserveFollowUp({ ...scope, clientNonce: 'nonce-g', clientSeq: 1, message: 'queued2' })
    coordinator.observe('s1', { type: 'message_start', message: {} }, [
      { type: 'message-start', seq: 1, messageId: 'u', role: 'user', clientNonce: 'nonce-g', clientSeq: 1 } as never,
    ])
    coordinator.failFollowUpRun('s1', { clientNonce: 'nonce-g', clientSeq: 1 })
    await coordinator.flush()
    expect(calls.released).toHaveLength(1)
  })

  it('releases a promoted follow-up that fails before agent-start and never binds it to a later run', async () => {
    const { sink, calls } = coordinatorSink()
    const coordinator = new PiChatMeteringCoordinator(sink, () => {})

    await coordinator.reserveFollowUp({ ...scope, clientNonce: 'nonce-f', clientSeq: 0, message: 'queued' })
    coordinator.promoteQueuedToPrompt('s1', { clientNonce: 'nonce-f', clientSeq: 0 })
    // The fallback repost rejected before agent-start.
    coordinator.failPromotedFollowUp('s1', { clientNonce: 'nonce-f', clientSeq: 0 })

    // A later, unrelated prompt run must not inherit the released follow-up.
    await coordinator.reservePrompt({ ...scope, clientNonce: 'nonce-p', message: 'next' })
    coordinator.observe('s1', { type: 'agent_start', turnId: 't' }, [
      { type: 'agent-start', seq: 1, turnId: 't' } as never,
    ])
    coordinator.observe('s1', { type: 'message_end', message: { id: 'a1', role: 'assistant', usage: USAGE } }, [])
    coordinator.observe('s1', { type: 'agent_end', messages: [{ role: 'assistant', stopReason: 'stop' }] }, [
      { type: 'agent-end', seq: 2, turnId: 't', status: 'ok' } as never,
    ])
    await coordinator.flush()

    expect(calls.released).toEqual([
      expect.objectContaining({ runId: 'pi-run:s1:followup:nonce-f:0', reason: 'run-rejected' }),
    ])
    expect(calls.usage).toEqual([
      expect.objectContaining({ runId: 'pi-run:s1:prompt:nonce-p', usageId: 'pi-usage:s1:message:a1' }),
    ])
    expect(calls.settled).toEqual([
      expect.objectContaining({ runId: 'pi-run:s1:prompt:nonce-p', status: 'ok' }),
    ])
  })
})
