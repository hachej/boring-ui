import { describe, expect, it } from 'vitest'
import type { AgentSessionEvent } from '@mariozechner/pi-coding-agent'
import type { AgentHarnessFactoryInput } from '../../shared/harness'
import type { Agent } from '../../shared/events'
import { sessionStreamPath, type AgentEvent } from '../../shared/events'
import type { PiChatEvent } from '../../shared/chat'
import { ErrorCode } from '../../shared/error-codes'
import type { SessionCtx, SessionDetail, SessionStore, SessionSummary } from '../../shared/session'
import { createAgentRuntimeBridge } from '../createAgent'
import { formatOffset, SqliteEventStreamStore, type EventStreamStore } from '../events/eventStreamStore'
import { openDatabase } from '../events/sqlStorage'
import type { PiAgentPromptInput, PiAgentSessionAdapter, PiAgentSessionSnapshot } from '../pi-chat/PiAgentSessionAdapter'

const CTX: SessionCtx = { workspaceId: 'workspace-test', userId: 'user-test' }

describe('agent.stream durable replay', () => {
  it('replays the full log and tails from a startIndex', async () => {
    const harness = createDurableAgent(['s1'])
    await seedEvents(harness.store, 's1', 3)

    await expect(takeEvents(harness.agent.stream('s1', { startIndex: 0, ctx: CTX }), 3))
      .resolves.toMatchObject([
        { eventIndex: 0, chunk: { seq: 0 } },
        { eventIndex: 1, chunk: { seq: 1 } },
        { eventIndex: 2, chunk: { seq: 2 } },
      ])

    await expect(takeEvents(harness.agent.stream('s1', { startIndex: 1, ctx: CTX }), 2))
      .resolves.toMatchObject([
        { eventIndex: 1, chunk: { seq: 1 } },
        { eventIndex: 2, chunk: { seq: 2 } },
      ])

    harness.close()
  })

  it('yields nothing for unknown sessions', async () => {
    const harness = createDurableAgent(['empty'])

    await expect(nextEvent(harness.agent.stream('missing', { startIndex: 0, ctx: CTX }))).resolves.toEqual({
      value: undefined,
      done: true,
    })

    harness.close()
  })

  it('rejects durable stream startIndex values ahead of the session tail', async () => {
    const harness = createDurableAgent(['ahead'])
    await seedEvents(harness.store, 'ahead', 2)

    await expect(nextEvent(harness.agent.stream('ahead', { startIndex: 3, ctx: CTX }))).rejects.toMatchObject({
      code: ErrorCode.enum.CURSOR_OUT_OF_RANGE,
      details: { startIndex: 3, latestIndex: 2 },
    })

    harness.close()
  })

  it('live tails an authorized empty session before its durable stream row exists', async () => {
    const harness = createDurableAgent(['empty'])
    const streamPath = sessionStreamPath('empty')
    const iterator = harness.agent.stream('empty', { startIndex: 0, ctx: CTX })[Symbol.asyncIterator]()

    const pending = nextWithTimeout(iterator.next())
    await waitFor(async () => {
      await expect(harness.store.getStreamMeta(streamPath)).resolves.toMatchObject({ closed: false })
    })
    await harness.store.appendAgentEvent('empty', piEvent(0))

    await expect(pending).resolves.toMatchObject({
      done: false,
      value: { eventIndex: 0, chunk: { seq: 0 } },
    })
    await iterator.return?.()
    harness.close()
  })

  it('live tails an open durable stream after replay reaches the tail', async () => {
    const harness = createDurableAgent(['live'])
    await harness.store.createStream(sessionStreamPath('live'))
    const iterator = harness.agent.stream('live', { startIndex: 0, ctx: CTX })[Symbol.asyncIterator]()

    const pending = nextWithTimeout(iterator.next())
    await harness.store.appendAgentEvent('live', piEvent(0))

    await expect(pending).resolves.toMatchObject({
      done: false,
      value: { eventIndex: 0, chunk: { seq: 0 } },
    })
    await iterator.return?.()
    harness.close()
  })

  it('terminates durable tailers on stop and reopens the stream on the next start', async () => {
    const adapter = new PromptingAdapter('restart')
    const harness = createDurableAgent(['restart'], { adapter })
    await seedEvents(harness.store, 'restart', 1)
    const iterator = harness.agent.stream('restart', { startIndex: 1, ctx: CTX })[Symbol.asyncIterator]()
    const pending = nextWithTimeout(iterator.next())

    await harness.agent.stop('restart', CTX)

    await expect(pending).resolves.toEqual({ value: undefined, done: true })
    await expect(harness.store.getStreamMeta(sessionStreamPath('restart'))).resolves.toMatchObject({ closed: true })

    const receipt = await harness.agent.start({ sessionId: 'restart', content: 'second', ctx: CTX })
    expect(receipt.startIndex).toBe(1)
    await expect(nextEvent(harness.agent.stream('restart', { startIndex: receipt.startIndex, ctx: CTX }))).resolves
      .toMatchObject({
        done: false,
        value: {
          eventIndex: 1,
          chunk: { type: 'agent-start' },
        },
      })
    await expect(harness.store.getStreamMeta(sessionStreamPath('restart'))).resolves.toMatchObject({ closed: false })
    harness.close()
  })

  it('terminates durable tailers when the agent is disposed', async () => {
    const adapter = new PromptingAdapter('dispose')
    const harness = createDurableAgent(['dispose'], { adapter })
    const receipt = await harness.agent.start({ sessionId: 'dispose', content: 'first', ctx: CTX })
    const iterator = harness.agent.stream('dispose', { startIndex: receipt.startIndex + 1, ctx: CTX })[Symbol.asyncIterator]()
    const pending = nextWithTimeout(iterator.next())

    await harness.agent.dispose()

    await expect(pending).resolves.toEqual({ value: undefined, done: true })
    await expect(harness.store.getStreamMeta(sessionStreamPath('dispose'))).resolves.toMatchObject({ closed: true })
    harness.close()
  })
})

function createDurableAgent(seedSessions: string[], options: { adapter?: PiAgentSessionAdapter } = {}): {
  agent: Agent
  store: EventStreamStore
  close(): void
} {
  const database = openDatabase(':memory:')
  const store = new SqliteEventStreamStore(database.sql, database.runTransaction)
  const sessions = new MemorySessionStore()
  for (const sessionId of seedSessions) sessions.seed(sessionId, CTX)
  const bridge = createAgentRuntimeBridge({
    runtime: 'none',
    harnessFactory: async (_input: AgentHarnessFactoryInput) => ({
      id: 'stream-test',
      placement: 'server',
      sessions,
      async getPiSessionAdapter() {
        if (!options.adapter) throw new Error('not needed')
        return options.adapter
      },
    }),
  }, {
    service: {
      eventStore: store,
    },
  })

  return {
    agent: bridge.agent,
    store,
    close() {
      database.db.close()
    },
  }
}

async function seedEvents(store: EventStreamStore, sessionId: string, count: number): Promise<void> {
  await store.createStream(sessionStreamPath(sessionId))
  for (let seq = 0; seq < count; seq++) {
    await expect(store.appendAgentEvent(sessionId, piEvent(seq))).resolves.toBe(formatOffset(seq))
  }
}

function piEvent(seq: number): PiChatEvent {
  return { type: 'agent-start', seq, turnId: `turn-${seq}` }
}

class PromptingAdapter implements PiAgentSessionAdapter {
  private readonly listeners = new Set<(event: AgentSessionEvent) => void>()

  constructor(private readonly sessionId: string) {}

  readSnapshot(): PiAgentSessionSnapshot {
    return {
      state: {},
      messages: [],
      isStreaming: false,
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
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async prompt(_input: PiAgentPromptInput): Promise<void> {
    this.emit({ type: 'agent_start', turnId: 'turn-restarted' } as AgentSessionEvent)
  }

  async followUp(): Promise<void> {}

  clearFollowUp(): void {}

  async abort(): Promise<void> {}

  private emit(event: AgentSessionEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}

async function takeEvents(iterable: AsyncIterable<AgentEvent>, count: number): Promise<AgentEvent[]> {
  const iterator = iterable[Symbol.asyncIterator]()
  const events: AgentEvent[] = []
  try {
    while (events.length < count) {
      const next = await nextWithTimeout(iterator.next())
      if (next.done) break
      events.push(next.value)
    }
    return events
  } finally {
    await iterator.return?.()
  }
}

async function nextEvent(iterable: AsyncIterable<AgentEvent>): Promise<IteratorResult<AgentEvent>> {
  const iterator = iterable[Symbol.asyncIterator]()
  try {
    return await nextWithTimeout(iterator.next())
  } finally {
    await iterator.return?.()
  }
}

async function nextWithTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timed out waiting for durable stream')), 1_000)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function waitFor(assertion: () => void | Promise<void>): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await assertion()
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  throw lastError
}

class MemorySessionStore implements SessionStore {
  private readonly records = new Map<string, SessionSummary>()
  private readonly owners = new Map<string, SessionCtx>()

  seed(sessionId: string, ctx: SessionCtx): void {
    this.records.set(sessionId, {
      id: sessionId,
      title: sessionId,
      createdAt: '2026-07-06T00:00:00.000Z',
      updatedAt: '2026-07-06T00:00:00.000Z',
      turnCount: 0,
    })
    this.owners.set(sessionId, ctx)
  }

  async list(ctx: SessionCtx, options?: { includeId?: string }): Promise<SessionSummary[]> {
    const visible = [...this.records.values()].filter((record) => sameCtx(this.owners.get(record.id), ctx))
    if (!options?.includeId || visible.some((record) => record.id === options.includeId)) return visible
    const included = this.records.get(options.includeId)
    return included && sameCtx(this.owners.get(included.id), ctx) ? [...visible, included] : visible
  }

  async create(ctx: SessionCtx): Promise<SessionSummary> {
    const id = `session-${this.records.size + 1}`
    this.seed(id, ctx)
    return this.records.get(id) as SessionSummary
  }

  async load(ctx: SessionCtx, sessionId: string): Promise<SessionDetail> {
    const record = this.records.get(sessionId)
    if (!record) throw Object.assign(new Error('session not found'), { code: ErrorCode.enum.SESSION_NOT_FOUND })
    if (!sameCtx(this.owners.get(sessionId), ctx)) {
      throw Object.assign(new Error('session context mismatch'), { code: ErrorCode.enum.UNAUTHORIZED })
    }
    return record
  }

  async delete(_ctx: SessionCtx, sessionId: string): Promise<void> {
    this.records.delete(sessionId)
    this.owners.delete(sessionId)
  }
}

function sameCtx(left: SessionCtx | undefined, right: SessionCtx): boolean {
  return (left?.workspaceId ?? '') === (right.workspaceId ?? '') && (left?.userId ?? '') === (right.userId ?? '')
}
