import { describe, expect, it, vi } from 'vitest'
import type { AgentSessionEvent } from '@mariozechner/pi-coding-agent'

import {
  AGENT_NOT_IMPLEMENTED_UNTIL_T1,
  AgentNotImplementedError,
  createAgent as createCoreAgent,
} from '@hachej/boring-agent/core'
import type {
  AgentCoreRuntimeFactory,
  AgentCoreSessionService,
  PiChatEventSubscriber,
  PiSessionCreateInit,
  PiSessionRequestContext,
} from '@hachej/boring-agent/core'
import type { AgentHarness, AgentHarnessFactoryInput, AgentSendInput, RunContext } from '../../shared/harness'
import type { AgentRuntimeAdapter } from '../../shared/events'
import type { SessionCtx, SessionDetail, SessionStore, SessionSummary } from '../../shared/session'
import type { FollowUpPayload, PiChatEvent, PromptPayload } from '../../shared/chat'
import type { PiAgentPromptInput, PiAgentSessionAdapter, PiAgentSessionSnapshot } from '../pi-chat/PiAgentSessionAdapter'
import { ErrorCode } from '../../shared/error-codes'
import { createAgent } from '../createAgent'

const CTX: SessionCtx = { workspaceId: 'workspace-test', userId: 'user-test' }

describe('createAgent', () => {
  it('exposes exactly the nine-member facade without Fastify', () => {
    const agent = createCoreAgent({
      runtimeFactory: createCoreRuntimeFactory(),
    })

    expect(Object.keys(agent).sort()).toEqual([
      'dispose',
      'interrupt',
      'readiness',
      'resolveInput',
      'send',
      'sessions',
      'start',
      'stop',
      'stream',
    ])
  })

  it('runs through the injected core runtime without the server wrapper', async () => {
    const sessions = new MemorySessionStore()
    const agent = createCoreAgent({
      runtimeFactory: createCoreRuntimeFactory(sessions),
    })

    const seeded = sessions.seed('runtime-seeded', CTX)
    await expect(agent.sessions.list(CTX)).resolves.toContainEqual(seeded)
    const created = await agent.sessions.create(CTX, { title: 'injected store' })
    await expect(sessions.list(CTX)).resolves.toContainEqual(created)
    await agent.sessions.delete(CTX, created.id)
    expect(sessions.deleted).toContain(created.id)
    const events = await collectEvents(agent.send({ content: 'hello from core', ctx: CTX }))

    expect(events.map((event) => event.chunk.type)).toEqual(['agent-start', 'agent-end'])
    await agent.dispose()
  })

  it('rejects sessions override with the default harness to avoid split persistence', () => {
    expect(() => createAgent({
      runtime: { id: 'test-runtime' },
      sessions: new MemorySessionStore(),
    })).toThrow('sessions override requires a harnessFactory')
  })

  it('rejects a missing or non-adapter runtime with a stable config error', () => {
    const invalidConfigs = [
      {},
      { runtime: 'none' },
      { runtime: { id: '' } },
      { runtime: { id: 'test-runtime', dispose: true } },
    ]

    for (const config of invalidConfigs) {
      let error: unknown
      try {
        createAgent(config as unknown as Parameters<typeof createAgent>[0])
      } catch (cause) {
        error = cause
      }
      expect(error).toMatchObject({
        code: ErrorCode.enum.CONFIG_INVALID,
      })
    }
  })

  it('constructs the supplied runtime lazily with the default harness', () => {
    const agent = createAgent({
      runtime: createTestRuntime(),
    })

    expect(agent.readiness.requirements).toEqual([])
  })

  it('does not report configured readiness requirements as ready without a tracker', async () => {
    const agent = createAgent({
      runtime: createTestRuntime(),
      harnessFactory: createFakeHarnessFactory(),
      readinessRequirements: ['workspace-fs'],
    })

    await expect(agent.readiness.status()).resolves.toEqual([{
      key: 'workspace-fs',
      ready: false,
      message: 'readiness status is not available in the core facade',
    }])
  })

  it('start returns an accepted receipt and send live-tails a harness turn', async () => {
    const agent = createAgent({
      runtime: createTestRuntime(),
      harnessFactory: createFakeHarnessFactory({ autoCompletePrompt: true }),
    })

    const receipt = await agent.start({ content: 'hello', ctx: CTX })
    expect(receipt).toEqual({ sessionId: 'session-1', startIndex: 0 })

    const stream = agent.send({ content: 'hello again', ctx: CTX })[Symbol.asyncIterator]()
    const first = await nextWithTimeout(stream.next())
    expect(first.done).toBe(false)
    expect(first.value).toMatchObject({
      v: 1,
      sessionId: 'session-2',
      eventIndex: expect.any(Number),
      chunk: { type: 'agent-start' },
    })
    const terminal = await nextWithTimeout(stream.next())
    expect(terminal.done).toBe(false)
    expect(terminal.value).toMatchObject({
      sessionId: 'session-2',
      chunk: { type: 'agent-end', status: 'ok' },
    })
    const done = await nextWithTimeout(stream.next())
    expect(done).toEqual({ value: undefined, done: true })
    await agent.dispose()
  })

  it('authorizes explicit session ids through the session store before starting', async () => {
    const fake = createFakeHarnessFactory()
    const agent = createAgent({
      runtime: createTestRuntime(),
      harnessFactory: fake.factory,
    })

    await expect(agent.start({ sessionId: 'missing', content: 'not allowed', ctx: CTX })).rejects.toMatchObject({
      code: ErrorCode.enum.SESSION_NOT_FOUND,
    })
    expect(fake.contexts('missing')).toEqual([])
    await agent.dispose()
  })

  it('does not synthesize a workspace id when input ctx is omitted', async () => {
    const fake = createFakeHarnessFactory()
    const agent = createAgent({
      runtime: createTestRuntime(),
      harnessFactory: fake.factory,
    })

    await agent.start({ content: 'headless' })

    expect(fake.sessions.createContexts).toHaveLength(1)
    expect(fake.sessions.createContexts[0]).toMatchObject({ userId: undefined })
    expect((fake.sessions.createContexts[0] as { workspaceId?: string }).workspaceId).toBeUndefined()
    await agent.dispose()
  })


  it('throws the T1 stub error for historical offsets older than the live buffer', async () => {
    const agent = createAgent({
      runtime: createTestRuntime(),
      harnessFactory: createFakeHarnessFactory({ eventsPerPrompt: 1_002, seedSessions: ['historical'] }),
    })
    const receipt = await agent.start({ sessionId: 'historical', content: 'fill buffer', ctx: CTX })

    const stream = agent.stream(receipt.sessionId, { startIndex: 0, ctx: CTX })[Symbol.asyncIterator]()
    await expect(stream.next()).rejects.toBeInstanceOf(AgentNotImplementedError)
    await expect(agent.stream(receipt.sessionId, { startIndex: 0, ctx: CTX })[Symbol.asyncIterator]().next()).rejects.toMatchObject({ code: AGENT_NOT_IMPLEMENTED_UNTIL_T1 })
    await agent.dispose()
  })

  it('throws stable cursor errors for invalid live stream offsets', async () => {
    const agent = createAgent({
      runtime: createTestRuntime(),
      harnessFactory: createFakeHarnessFactory({ seedSessions: ['cursor'] }),
    })

    await expect(agent.stream('cursor', { startIndex: -1, ctx: CTX })[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      code: ErrorCode.enum.CURSOR_OUT_OF_RANGE,
    })
    await expect(agent.stream('cursor', { startIndex: 1, ctx: CTX })[Symbol.asyncIterator]().next()).rejects.toMatchObject({
        code: ErrorCode.enum.CURSOR_OUT_OF_RANGE,
        details: { startIndex: 1, latestIndex: 0 },
    })
    await agent.dispose()
  })

  it('assigns live event indexes per session', async () => {
    const agent = createAgent({
      runtime: createTestRuntime(),
      harnessFactory: createFakeHarnessFactory({ autoCompletePrompt: true, seedSessions: ['other', 'sparse'] }),
    })

    const other = collectEvents(agent.send({ sessionId: 'other', content: 'first other event', ctx: CTX }))
    const sparse = collectEvents(agent.send({ sessionId: 'sparse', content: 'first sparse event', ctx: CTX }))

    expect((await other).map((event) => event.eventIndex)).toEqual([0, 1])
    expect((await sparse).map((event) => event.eventIndex)).toEqual([0, 1])
    await agent.dispose()
  })

  it('single-flights bridge subscription for concurrent starts on a cold session', async () => {
    const agent = createAgent({
      runtime: createTestRuntime(),
      harnessFactory: createFakeHarnessFactory({ autoCompletePrompt: true, seedSessions: ['race'] }),
    })

    await Promise.all([
      agent.start({ sessionId: 'race', content: 'first', ctx: CTX }),
      agent.start({ sessionId: 'race', content: 'second', ctx: CTX }),
    ])

    const stream = agent.stream('race', { startIndex: 0, ctx: CTX })[Symbol.asyncIterator]()
    const first = await nextWithTimeout(stream.next())
    const second = await nextWithTimeout(stream.next())
    const third = await nextWithTimeout(stream.next())
    const fourth = await nextWithTimeout(stream.next())
    expect(first.done).toBe(false)
    expect(second.done).toBe(false)
    expect(third.done).toBe(false)
    expect(fourth.done).toBe(false)
    expect([first.value?.eventIndex, second.value?.eventIndex, third.value?.eventIndex, fourth.value?.eventIndex]).toEqual([0, 1, 2, 3])
    expect([first.value?.chunk.type, second.value?.chunk.type, third.value?.chunk.type, fourth.value?.chunk.type]).toEqual([
      'agent-start',
      'agent-end',
      'agent-start',
      'agent-end',
    ])
    await stream.return?.()
    await agent.dispose()
  })

  it('allows quiet sessions to live-tail from their own current cursor', async () => {
    const agent = createAgent({
      runtime: createTestRuntime(),
      harnessFactory: createFakeHarnessFactory({ autoCompletePrompt: true, seedSessions: ['other', 'quiet'] }),
    })

    await agent.start({ sessionId: 'other', content: 'advance other counter', ctx: CTX })
    const stream = agent.stream('quiet', { startIndex: 0, ctx: CTX })[Symbol.asyncIterator]()
    await agent.start({ sessionId: 'quiet', content: 'first quiet event', ctx: CTX })
    const first = await nextWithTimeout(stream.next())
    expect(first.done).toBe(false)
    expect(first.value).toMatchObject({
      eventIndex: 0,
      sessionId: 'quiet',
      chunk: { type: 'agent-start' },
    })
    await stream.return?.()
    await agent.dispose()
  })

  it('resolveInput is a typed T1 stub', async () => {
    const agent = createAgent({
      runtime: createTestRuntime(),
      harnessFactory: createFakeHarnessFactory(),
    })

    await expect(agent.resolveInput('session-1', 'request-1', { approved: true })).rejects.toMatchObject({
      code: AGENT_NOT_IMPLEMENTED_UNTIL_T1,
    })
  })

  it('interrupt and stop abort through the pi-chat service control methods', async () => {
    const fake = createFakeHarnessFactory({ seedSessions: ['control', 'control-stop'] })
    const agent = createAgent({
      runtime: createTestRuntime(),
      harnessFactory: fake.factory,
    })

    await agent.start({ sessionId: 'control', content: 'long running', ctx: CTX })
    const adapter = fake.adapter('control')
    expect(adapter.abortCount).toBe(0)

    await agent.interrupt('control', CTX)
    expect(adapter.abortCount).toBe(1)
    expect(adapter.closed).toBe(false)
    expect(fake.contexts('control').at(-1)?.userId).toBe('user-test')

    await agent.start({ sessionId: 'control-stop', content: 'long running', ctx: CTX })
    const stopAdapter = fake.adapter('control-stop')
    await agent.stop('control-stop', CTX)
    expect(stopAdapter.abortCount).toBe(1)
    expect(stopAdapter.closed).toBe(false)
    expect(fake.contexts('control-stop').at(-1)?.userId).toBe('user-test')
    await agent.dispose()
  })

  it('stream, interrupt, and stop reject scoped sessions without caller ctx', async () => {
    const fake = createFakeHarnessFactory({ seedSessions: ['scoped'] })
    const agent = createAgent({
      runtime: createTestRuntime(),
      harnessFactory: fake.factory,
    })

    await agent.start({ sessionId: 'scoped', content: 'long running', ctx: CTX })
    const authorizedContextCount = fake.contexts('scoped').length

    await expect(agent.start({ sessionId: 'scoped', content: 'wrong context' })).rejects.toMatchObject({
      code: ErrorCode.enum.UNAUTHORIZED,
    })
    await expect(agent.stream('scoped', { startIndex: 0 })[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      code: ErrorCode.enum.UNAUTHORIZED,
    })
    await expect(agent.interrupt('scoped')).rejects.toMatchObject({
      code: ErrorCode.enum.UNAUTHORIZED,
    })
    await expect(agent.stop('scoped')).rejects.toMatchObject({
      code: ErrorCode.enum.UNAUTHORIZED,
    })
    await expect(agent.sessions.delete({ workspaceId: 'other', userId: 'attacker' }, 'scoped')).rejects.toMatchObject({
      code: ErrorCode.enum.UNAUTHORIZED,
    })
    await expect(agent.sessions.load({ workspaceId: 'other', userId: 'attacker' }, 'scoped')).rejects.toMatchObject({
      code: ErrorCode.enum.UNAUTHORIZED,
    })
    await expect(agent.sessions.list({ workspaceId: 'other', userId: 'attacker' })).resolves.toEqual([])
    expect(fake.contexts('scoped')).toHaveLength(authorizedContextCount)
    expect(fake.adapter('scoped').abortCount).toBe(0)
    await agent.dispose()
  })

  it('serializes concurrent send calls on the same explicit session', async () => {
    const agent = createAgent({
      runtime: createTestRuntime(),
      harnessFactory: createFakeHarnessFactory({ autoCompletePrompt: true, seedSessions: ['send-lock'] }),
    })

    const [first, second] = await Promise.all([
      collectEvents(agent.send({ sessionId: 'send-lock', content: 'first', ctx: CTX })),
      collectEvents(agent.send({ sessionId: 'send-lock', content: 'second', ctx: CTX })),
    ])

    expect(first.map((event) => event.eventIndex)).toEqual([0, 1])
    expect(second.map((event) => event.eventIndex)).toEqual([2, 3])
    expect(first.map((event) => event.chunk.type)).toEqual(['agent-start', 'agent-end'])
    expect(second.map((event) => event.chunk.type)).toEqual(['agent-start', 'agent-end'])
    await agent.dispose()
  })

  it('does not let a scoped caller claim an unscoped persisted session after a ctx-cache miss', async () => {
    const fake = createFakeHarnessFactory()
    fake.sessions.seed('unscoped')
    const agent = createAgent({
      runtime: createTestRuntime(),
      harnessFactory: fake.factory,
    })

    await expect(agent.start({ sessionId: 'unscoped', content: 'claim', ctx: CTX })).rejects.toMatchObject({
      code: ErrorCode.enum.UNAUTHORIZED,
    })
    expect(fake.contexts('unscoped')).toEqual([])

    await expect(agent.start({ sessionId: 'unscoped', content: 'headless' })).resolves.toMatchObject({
      sessionId: 'unscoped',
      startIndex: 0,
    })
    await agent.dispose()
  })

  it('interrupt and stop reject missing sessions without creating adapters', async () => {
    const fake = createFakeHarnessFactory()
    const agent = createAgent({
      runtime: createTestRuntime(),
      harnessFactory: fake.factory,
    })

    await expect(agent.interrupt('typo')).rejects.toMatchObject({
      code: ErrorCode.enum.SESSION_NOT_FOUND,
    })
    await expect(agent.stop('typo')).rejects.toMatchObject({
      code: ErrorCode.enum.SESSION_NOT_FOUND,
    })
    expect(fake.contexts('typo')).toEqual([])
    await agent.dispose()
  })

  it('sessions.delete cleans up the live pi-chat session', async () => {
    const fake = createFakeHarnessFactory({ seedSessions: ['delete-me'] })
    const agent = createAgent({
      runtime: createTestRuntime(),
      harnessFactory: fake.factory,
    })

    await agent.start({ sessionId: 'delete-me', content: 'long running', ctx: CTX })
    const adapter = fake.adapter('delete-me')

    await agent.sessions.delete(CTX, 'delete-me')

    expect(adapter.abortCount).toBe(1)
    expect(fake.sessions.deleted).toContain('delete-me')
    await agent.dispose()
  })

  it('sessions.delete cleans up live sessions when a custom store is supplied', async () => {
    const fake = createFakeHarnessFactory()
    const sessions = new MemorySessionStore()
    sessions.seed('custom-delete', CTX)
    const agent = createAgent({
      runtime: createTestRuntime(),
      harnessFactory: fake.factory,
      sessions,
    })

    await agent.start({ sessionId: 'custom-delete', content: 'long running', ctx: CTX })
    const adapter = fake.adapter('custom-delete')

    await agent.sessions.delete(CTX, 'custom-delete')

    expect(adapter.abortCount).toBe(1)
    expect(sessions.deleted).toContain('custom-delete')
    await agent.dispose()
  })

  it('sessions.delete authorizes with the caller ctx before cleaning up a live session', async () => {
    const fake = createFakeHarnessFactory()
    const sessions = new ScopedSessionStore()
    sessions.seedOwned('owned', CTX)
    const agent = createAgent({
      runtime: createTestRuntime(),
      harnessFactory: fake.factory,
      sessions,
    })

    await agent.start({ sessionId: 'owned', content: 'long running', ctx: CTX })
    const adapter = fake.adapter('owned')

    await expect(agent.sessions.delete({ workspaceId: 'other', userId: 'attacker' }, 'owned')).rejects.toMatchObject({
      code: ErrorCode.enum.UNAUTHORIZED,
    })
    expect(adapter.abortCount).toBe(0)
    expect(sessions.deleted).toEqual([])

    await agent.sessions.delete(CTX, 'owned')
    expect(adapter.abortCount).toBe(1)
    expect(sessions.deleted).toEqual(['owned'])
    await agent.dispose()
  })

  it('dispose is terminal, idempotent, and stops active producers without disposing the host adapter', async () => {
    const fake = createFakeHarnessFactory({ seedSessions: ['dispose-me'] })
    const runtime = createTestRuntime()
    const agent = createAgent({
      runtime,
      harnessFactory: fake.factory,
    })

    await agent.start({ sessionId: 'dispose-me', content: 'long running', ctx: CTX })
    const adapter = fake.adapter('dispose-me')

    await Promise.all([agent.dispose(), agent.dispose()])

    expect(adapter.abortCount).toBe(1)
    expect(runtime.dispose).not.toHaveBeenCalled()
    await expect(agent.start({ sessionId: 'dispose-me', content: 'retained', ctx: CTX })).rejects.toMatchObject({
      code: ErrorCode.enum.AGENT_BINDING_DISPOSED,
    })
    await expect(agent.sessions.list(CTX)).rejects.toMatchObject({
      code: ErrorCode.enum.AGENT_BINDING_DISPOSED,
    })
    await expect(agent.readiness.status()).rejects.toMatchObject({
      code: ErrorCode.enum.AGENT_BINDING_DISPOSED,
    })
    let streamError: unknown
    try {
      agent.stream('dispose-me', { startIndex: 0, ctx: CTX })
    } catch (error) {
      streamError = error
    }
    expect(streamError).toMatchObject({ code: ErrorCode.enum.AGENT_BINDING_DISPOSED })
  })

  it('disposes the runtime service once after stop attempts and preserves the stop error', async () => {
    const sessions = new MemorySessionStore()
    sessions.seed('service-dispose', CTX)
    const stopError = new Error('stop failed first')
    const serviceDisposeError = new Error('service dispose failed second')
    const unsubscribeError = new Error('bridge unsubscribe failed third')
    const teardownEvents: string[] = []
    const service = new InjectedCorePiChatService(sessions, { stopError, disposeError: serviceDisposeError, unsubscribeError, teardownEvents })
    const agent = createCoreAgent({ runtimeFactory: createCoreRuntimeFactory(sessions, service) })
    await agent.start({ sessionId: 'service-dispose', content: 'accepted', ctx: CTX })

    await expect(Promise.all([agent.dispose(), agent.dispose()])).rejects.toBe(stopError)

    expect(teardownEvents).toEqual(['stop', 'dispose'])
    expect(service.disposeCount).toBe(1)
    expect(service.unsubscribeCount).toBe(1)
  })

  it.each(['stop', 'delete'] as const)('%s failure preserves producer ownership so dispose retries it', async (operation) => {
    const sessionId = `${operation}-retry`
    const fake = createFakeHarnessFactory({ seedSessions: [sessionId], abortFailures: 1 })
    const agent = createAgent({ runtime: createTestRuntime(), harnessFactory: fake.factory })

    await agent.start({ sessionId, content: 'long running', ctx: CTX })
    if (operation === 'stop') {
      await expect(agent.stop(sessionId, CTX)).rejects.toThrow('abort failed')
    } else {
      await expect(agent.sessions.delete(CTX, sessionId)).rejects.toThrow('abort failed')
    }
    await agent.dispose()

    expect(fake.adapter(sessionId).abortCount).toBe(2)
  })

  it.each(['stop', 'delete'] as const)('%s closes a session whose subscription resolves late', async (operation) => {
    const sessions = new MemorySessionStore()
    sessions.seed('deferred-subscribe', CTX)
    let releaseSubscribe!: () => void
    const subscribeGate = new Promise<void>((resolve) => { releaseSubscribe = resolve })
    let markSubscribeStarted!: () => void
    const subscribeStarted = new Promise<void>((resolve) => { markSubscribeStarted = resolve })
    const service = new InjectedCorePiChatService(sessions, { subscribeGate, onSubscribe: markSubscribeStarted })
    const agent = createCoreAgent({ runtimeFactory: createCoreRuntimeFactory(sessions, service) })

    const start = agent.start({ sessionId: 'deferred-subscribe', content: 'pending', ctx: CTX })
    await subscribeStarted
    const teardown = operation === 'stop'
      ? agent.stop('deferred-subscribe', CTX)
      : agent.sessions.delete(CTX, 'deferred-subscribe')
    await teardown
    releaseSubscribe()

    await expect(start).rejects.toMatchObject({ code: ErrorCode.enum.ABORTED })
    expect(service.unsubscribeCount).toBe(1)
    await agent.dispose()
  })

  it('reopens the live stream when a stopped session is started again', async () => {
    const fake = createFakeHarnessFactory({ seedSessions: ['restart'] })
    const agent = createAgent({
      runtime: createTestRuntime(),
      harnessFactory: fake.factory,
    })

    await agent.start({ sessionId: 'restart', content: 'first', ctx: CTX })
    await agent.stop('restart', CTX)

    await expect(agent.start({ sessionId: 'restart', content: 'missing ctx' })).rejects.toMatchObject({
      code: ErrorCode.enum.UNAUTHORIZED,
    })
    const receipt = await agent.start({ sessionId: 'restart', content: 'second', ctx: CTX })
    const stream = agent.stream('restart', { startIndex: receipt.startIndex, ctx: CTX })[Symbol.asyncIterator]()
    const next = await nextWithTimeout(stream.next())

    expect(next.done).toBe(false)
    expect(next.value).toMatchObject({
      sessionId: 'restart',
      chunk: { type: 'agent-start' },
    })
    await stream.return?.()
    await agent.dispose()
  })
})

function createTestRuntime() {
  return { id: 'test-runtime', dispose: vi.fn<() => void>() } satisfies AgentRuntimeAdapter
}

function createCoreRuntimeFactory(
  sessions = new MemorySessionStore(),
  service = new InjectedCorePiChatService(sessions),
): AgentCoreRuntimeFactory {
  return async () => ({
    harness: {
      id: 'core-injected',
      placement: 'server',
      sessions,
    },
    sessionStore: sessions,
    service,
  })
}

function createFakeHarnessFactory(options: { autoCompletePrompt?: boolean; eventsPerPrompt?: number; seedSessions?: string[]; abortFailures?: number } = {}) {
  const sessions = new MemorySessionStore()
  for (const sessionId of options.seedSessions ?? []) sessions.seed(sessionId, CTX)
  const adapters = new Map<string, FakePiSessionAdapter>()
  const contextsBySession = new Map<string, RunContext[]>()
  const adapter = (sessionId: string) => {
    let existing = adapters.get(sessionId)
    if (!existing) {
      existing = new FakePiSessionAdapter(
        sessionId,
        options.eventsPerPrompt ?? 1,
        options.autoCompletePrompt === true,
        options.abortFailures ?? 0,
      )
      adapters.set(sessionId, existing)
    }
    return existing
  }
  const factory = async (_input: AgentHarnessFactoryInput): Promise<AgentHarness & {
    getPiSessionAdapter(input: AgentSendInput, ctx: RunContext): Promise<PiAgentSessionAdapter>
  }> => ({
    id: 'fake-pi',
    placement: 'server',
    sessions,
    async getPiSessionAdapter(input, ctx) {
      if (!input.sessionId) throw new Error('sessionId is required')
      const contexts = contextsBySession.get(input.sessionId) ?? []
      contexts.push(ctx)
      contextsBySession.set(input.sessionId, contexts)
      await sessions.ensure(input.sessionId)
      return adapter(input.sessionId)
    },
  })

  return Object.assign(factory, {
    factory,
    adapter,
    sessions,
    contexts(sessionId: string) {
      return contextsBySession.get(sessionId) ?? []
    },
  })
}

async function nextWithTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timed out waiting for agent event')), 1_000)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function nextOrTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function collectEvents(iterable: AsyncIterable<import('../../shared/events').AgentEvent>): Promise<Array<import('../../shared/events').AgentEvent>> {
  const events: Array<import('../../shared/events').AgentEvent> = []
  for await (const event of iterable) events.push(event)
  return events
}

class MemorySessionStore implements SessionStore {
  private readonly records = new Map<string, SessionSummary>()
  private readonly owners = new Map<string, SessionCtx | undefined>()
  private created = 0
  readonly createContexts: SessionCtx[] = []
  readonly deleted: string[] = []

  seed(sessionId: string, ctx?: SessionCtx): SessionSummary {
    const existing = this.records.get(sessionId)
    if (existing) return existing
    const record = this.record(sessionId, sessionId)
    this.records.set(record.id, record)
    this.owners.set(record.id, normalizeTestCtx(ctx))
    return record
  }

  async ensure(sessionId: string): Promise<SessionSummary> {
    return this.seed(sessionId)
  }

  async list(ctx: SessionCtx, options?: { includeId?: string }): Promise<SessionSummary[]> {
    const visible = [...this.records.values()].filter((record) => sameTestCtx(this.owners.get(record.id), ctx))
    if (!options?.includeId || visible.some((record) => record.id === options.includeId)) return visible
    const included = this.records.get(options.includeId)
    return included && sameTestCtx(this.owners.get(included.id), ctx) ? [...visible, included] : visible
  }

  async create(ctx: SessionCtx, init?: { title?: string }): Promise<SessionSummary> {
    this.createContexts.push(ctx)
    this.created += 1
    const id = `session-${this.created}`
    const record = this.record(id, init?.title ?? id)
    this.records.set(id, record)
    this.owners.set(id, normalizeTestCtx(ctx))
    return record
  }

  async load(ctx: SessionCtx, sessionId: string): Promise<SessionDetail> {
    const record = this.records.get(sessionId)
    if (!record) throw new Error(`missing session ${sessionId}`)
    this.assertOwner(ctx, sessionId)
    return record
  }

  async delete(ctx: SessionCtx, sessionId: string): Promise<void> {
    this.assertOwner(ctx, sessionId)
    this.deleted.push(sessionId)
    this.records.delete(sessionId)
    this.owners.delete(sessionId)
  }

  private record(id: string, title: string): SessionSummary {
    return {
      id,
      title,
      createdAt: '2026-07-05T00:00:00.000Z',
      updatedAt: '2026-07-05T00:00:00.000Z',
      turnCount: 0,
    }
  }

  protected assertOwner(ctx: SessionCtx, sessionId: string): void {
    if (!sameTestCtx(this.owners.get(sessionId), ctx)) {
      throw Object.assign(new Error(`forbidden session ${sessionId}`), { code: ErrorCode.enum.UNAUTHORIZED })
    }
  }
}

class ScopedSessionStore extends MemorySessionStore {
  seedOwned(sessionId: string, ctx: SessionCtx): SessionSummary {
    return this.seed(sessionId, ctx)
  }
}

class InjectedCorePiChatService implements AgentCoreSessionService {
  private readonly subscribers = new Map<string, Set<PiChatEventSubscriber>>()
  private readonly latestSeq = new Map<string, number>()
  private turns = 0
  unsubscribeCount = 0
  disposeCount = 0

  constructor(
    private readonly sessions: MemorySessionStore,
    private readonly options: {
      subscribeGate?: Promise<void>
      onSubscribe?: () => void
      stopError?: Error
      disposeError?: Error
      unsubscribeError?: Error
      teardownEvents?: string[]
    } = {},
  ) {}

  async createSession(ctx: PiSessionRequestContext, init?: PiSessionCreateInit) {
    return this.sessions.create(toTestSessionCtx(ctx), init)
  }

  async deleteSession(ctx: PiSessionRequestContext, sessionId: string): Promise<void> {
    await this.sessions.delete(toTestSessionCtx(ctx), sessionId)
    this.subscribers.delete(sessionId)
    this.latestSeq.delete(sessionId)
  }

  async readState(_ctx: PiSessionRequestContext, sessionId: string) {
    return {
      protocolVersion: 1 as const,
      sessionId,
      seq: this.latestSeq.get(sessionId) ?? 0,
      status: 'idle' as const,
      messages: [],
      queue: { followUps: [] },
      followUpMode: 'one-at-a-time' as const,
    }
  }

  async subscribe(ctx: PiSessionRequestContext, sessionId: string, _cursor: number, subscriber: PiChatEventSubscriber) {
    await this.sessions.load(toTestSessionCtx(ctx), sessionId)
    this.options.onSubscribe?.()
    await this.options.subscribeGate
    const subscribers = this.subscribers.get(sessionId) ?? new Set<PiChatEventSubscriber>()
    subscribers.add(subscriber)
    this.subscribers.set(sessionId, subscribers)
    return {
      type: 'ok' as const,
      unsubscribe: () => {
        this.unsubscribeCount += 1
        subscribers.delete(subscriber)
        if (this.options.unsubscribeError) throw this.options.unsubscribeError
      },
    }
  }

  async prompt(_ctx: PiSessionRequestContext, sessionId: string, payload: PromptPayload) {
    const turnId = `core-turn-${++this.turns}`
    this.publish(sessionId, { type: 'agent-start', seq: this.nextSeq(sessionId), turnId })
    this.publish(sessionId, { type: 'agent-end', seq: this.nextSeq(sessionId), turnId, status: 'ok' })
    return {
      accepted: true as const,
      cursor: this.latestSeq.get(sessionId) ?? 0,
      clientNonce: payload.clientNonce,
    }
  }

  async followUp(_ctx: PiSessionRequestContext, sessionId: string, payload: FollowUpPayload) {
    return {
      accepted: true as const,
      cursor: this.latestSeq.get(sessionId) ?? 0,
      clientNonce: payload.clientNonce,
      clientSeq: payload.clientSeq,
      queued: true as const,
    }
  }

  async clearQueue(_ctx: PiSessionRequestContext, sessionId: string) {
    return { accepted: true as const, cursor: this.latestSeq.get(sessionId) ?? 0, cleared: 0 }
  }

  async interrupt(_ctx: PiSessionRequestContext, sessionId: string) {
    return { accepted: true as const, cursor: this.latestSeq.get(sessionId) ?? 0 }
  }

  async stop(_ctx: PiSessionRequestContext, sessionId: string) {
    this.options.teardownEvents?.push('stop')
    if (this.options.stopError) throw this.options.stopError
    return {
      accepted: true as const,
      cursor: this.latestSeq.get(sessionId) ?? 0,
      stopped: true as const,
      clearedQueue: [],
    }
  }

  async dispose(): Promise<void> {
    this.disposeCount += 1
    this.options.teardownEvents?.push('dispose')
    if (this.options.disposeError) throw this.options.disposeError
  }

  private nextSeq(sessionId: string): number {
    const next = (this.latestSeq.get(sessionId) ?? 0) + 1
    this.latestSeq.set(sessionId, next)
    return next
  }

  private publish(sessionId: string, event: PiChatEvent): void {
    for (const subscriber of this.subscribers.get(sessionId) ?? []) subscriber(event)
  }
}

function normalizeTestCtx(ctx: SessionCtx | undefined): SessionCtx | undefined {
  return !ctx?.workspaceId && !ctx?.userId ? undefined : { workspaceId: ctx.workspaceId, userId: ctx.userId }
}

function toTestSessionCtx(ctx: PiSessionRequestContext): SessionCtx {
  return {
    workspaceId: ctx.workspaceId,
    userId: ctx.authSubject,
  }
}

function sameTestCtx(a: SessionCtx | undefined, b: SessionCtx | undefined): boolean {
  return (a?.workspaceId ?? '') === (b?.workspaceId ?? '') && (a?.userId ?? '') === (b?.userId ?? '')
}

class FakePiSessionAdapter implements PiAgentSessionAdapter {
  private readonly subscribers = new Set<(event: AgentSessionEvent) => void>()
  private readonly activeResolves: Array<() => void> = []
  private streaming = false
  private turn = 0
  abortCount = 0
  closed = false

  constructor(
    private readonly sessionId: string,
    private readonly eventsPerPrompt: number,
    private readonly autoCompletePrompt: boolean,
    private abortFailures: number,
  ) {}

  readSnapshot(): PiAgentSessionSnapshot {
    return {
      state: {},
      messages: [],
      isStreaming: this.streaming,
      isRetrying: false,
      retryAttempt: 0,
      pendingMessageCount: 0,
      steeringMessages: [],
      followUpMessages: [],
      followUpMode: 'one-at-a-time',
      sessionId: this.sessionId,
    }
  }

  subscribe(listener: (event: AgentSessionEvent) => void): () => void {
    this.subscribers.add(listener)
    return () => this.subscribers.delete(listener)
  }

  prompt(_input: PiAgentPromptInput): Promise<void> {
    this.streaming = true
    this.turn += 1
    for (let index = 0; index < this.eventsPerPrompt; index += 1) {
      this.emit({ type: 'agent_start' } as AgentSessionEvent)
    }
    const promise = new Promise<void>((resolve) => {
      this.activeResolves.push(() => {
        this.streaming = false
        this.emit({ type: 'agent_end', messages: [], willRetry: false } as AgentSessionEvent)
        resolve()
      })
    })
    if (this.autoCompletePrompt) this.resolveActivePrompts()
    return promise
  }

  async followUp(): Promise<void> {}

  clearFollowUp(): void {}

  async abort(): Promise<void> {
    this.abortCount += 1
    if (this.abortFailures > 0) {
      this.abortFailures -= 1
      throw new Error('abort failed')
    }
    this.resolveActivePrompts()
  }

  private resolveActivePrompts(): void {
    const resolves = this.activeResolves.splice(0)
    for (const resolve of resolves) resolve()
  }

  private emit(event: AgentSessionEvent): void {
    for (const subscriber of this.subscribers) subscriber(event)
  }
}
