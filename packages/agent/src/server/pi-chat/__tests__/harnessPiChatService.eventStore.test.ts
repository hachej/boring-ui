import { describe, expect, it, vi } from 'vitest'
import type { AgentSessionEvent } from '@mariozechner/pi-coding-agent'
import type { AgentHarness, AgentSendInput, RunContext } from '../../../shared/harness'
import type { PiChatEvent } from '../../../shared/chat'
import { sessionStreamPath, type AgentEvent } from '../../../shared/events'
import type { SessionStore } from '../../../shared/session'
import {
  type EventStreamIdempotencyKey,
  type EventStreamMeta,
  type EventStreamReadResult,
  type EventStreamReplacementEvent,
  type EventStreamStore,
  formatOffset,
  SqliteEventStreamStore,
} from '../../events/eventStreamStore'
import { openDatabase } from '../../events/sqlStorage'
import type { PiAgentSessionAdapter, PiAgentSessionSnapshot } from '../PiAgentSessionAdapter'
import { HarnessPiChatService } from '../harnessPiChatService'
import type { PiSessionRequestContext } from '../piSessionIdentity'

const ctx: PiSessionRequestContext = {
  workspaceId: 'workspace-a',
  storageScope: 'scope-a',
  authSubject: 'user-a',
  requestId: 'request-a',
}

const sessionStore: SessionStore = {
  list: vi.fn(async () => []),
  create: vi.fn(async () => ({ id: 's1', title: 'New session', createdAt: '', updatedAt: '', turnCount: 0 })),
  rename: vi.fn(async (_ctx, sessionId, title) => ({ id: sessionId, title, createdAt: '', updatedAt: '', turnCount: 0 })),
  load: vi.fn(async () => ({ id: 's1', title: 'New session', createdAt: '', updatedAt: '', turnCount: 0 })),
  delete: vi.fn(async () => {}),
}

type FakeAdapter = PiAgentSessionAdapter & {
  emit(event: AgentSessionEvent): void
  emitOnUnsubscribe(event: AgentSessionEvent): void
}

function createAdapter(): FakeAdapter {
  const listeners = new Set<(event: AgentSessionEvent) => void>()
  let unsubscribeEvent: AgentSessionEvent | undefined
  const snapshot: PiAgentSessionSnapshot = {
    state: {},
    messages: [],
    isStreaming: false,
    isRetrying: false,
    retryAttempt: 0,
    pendingMessageCount: 0,
    steeringMessages: [],
    followUpMessages: [],
    followUpMode: 'one-at-a-time',
    sessionId: 's1',
  }
  return {
    readSnapshot: vi.fn(() => snapshot),
    subscribe: vi.fn((listener: (event: AgentSessionEvent) => void) => {
      listeners.add(listener)
      return () => {
        if (unsubscribeEvent) listener(unsubscribeEvent)
        listeners.delete(listener)
      }
    }),
    prompt: vi.fn(async () => {}),
    followUp: vi.fn(async () => {}),
    clearFollowUp: vi.fn(),
    abort: vi.fn(async () => {}),
    abortRetry: vi.fn(),
    emit(event: AgentSessionEvent) {
      for (const listener of listeners) listener(event)
    },
    emitOnUnsubscribe(event: AgentSessionEvent) {
      unsubscribeEvent = event
    },
  }
}

function createHarness(adapter: PiAgentSessionAdapter): AgentHarness & {
  getPiSessionAdapter(input: AgentSendInput, ctx: RunContext): Promise<PiAgentSessionAdapter>
  hasPiSession(sessionId: string): boolean
} {
  return {
    id: 'fake-pi',
    placement: 'server',
    sessions: sessionStore,
    hasPiSession: vi.fn(() => false),
    getPiSessionAdapter: vi.fn(async () => adapter),
  }
}

function createService(eventStore: EventStreamStore, adapter = createAdapter(), store: SessionStore = sessionStore) {
  const service = new HarnessPiChatService({
    harness: createHarness(adapter),
    sessionStore: store,
    workdir: '/workspace',
    eventStore,
  })
  return { service, adapter }
}

describe('HarnessPiChatService event store tap', () => {
  it.each(['dispose', 'delete'] as const)('awaits the final native event published during %s unsubscribe', async (operation) => {
    const db = openDatabase(':memory:')
    try {
      const inner = new SqliteEventStreamStore(db.sql, db.runTransaction)
      const appendGate = deferred<void>()
      const store = new DelayedEventStreamStore(inner, new Map([[1, appendGate.promise]]))
      const { service, adapter } = createService(store)
      await service.subscribe(ctx, 's1', 0, () => {})
      adapter.emitOnUnsubscribe({ type: 'agent_start', turnId: 'late-turn' } as unknown as AgentSessionEvent)

      let settled = false
      const terminal = (operation === 'dispose' ? service.dispose() : service.deleteSession(ctx, 's1'))
        .then(() => { settled = true })
      await waitFor(() => expect(store.appendStarted).toEqual([1]))
      expect(settled).toBe(false)

      appendGate.resolve()
      await terminal
      const result = await inner.readEvents(streamPathFor(ctx, 's1'), { offset: '-1' })
      expect((result.events[0]?.data as AgentEvent).chunk).toMatchObject({ type: 'agent-start', turnId: 'late-turn' })
    } finally {
      db.db.close()
    }
  })

  it('preserves durable construction failure and reports late-adapter cleanup failure during disposal', async () => {
    const db = openDatabase(':memory:')
    try {
      const createStarted = deferred<void>()
      const createGate = deferred<void>()
      const primaryError = new Error('stream creation failed')
      const cleanupError = new Error('late adapter abort failed')
      const inner = new SqliteEventStreamStore(db.sql, db.runTransaction)
      const store = new DelayedEventStreamStore(inner, new Map(), new Set(), {
        started: createStarted.resolve,
        gate: createGate.promise,
        error: primaryError,
      })
      const adapter = createAdapter()
      adapter.abort = vi.fn(async () => { throw cleanupError })
      const { service } = createService(store, adapter)

      const subscription = service.subscribe(ctx, 's1', 0, () => {})
      await createStarted.promise
      const disposal = service.dispose()
      createGate.resolve()

      await expect(subscription).rejects.toBe(primaryError)
      await expect(disposal).rejects.toBe(cleanupError)
      expect(adapter.abortRetry).toHaveBeenCalledOnce()
      expect(adapter.clearFollowUp).toHaveBeenCalledOnce()
      expect(adapter.abort).toHaveBeenCalledOnce()
    } finally {
      db.db.close()
    }
  })

  it('appends AgentEvent envelopes before live delivery and preserves contiguous eventIndex order', async () => {
    const db = openDatabase(':memory:')
    try {
      const inner = new SqliteEventStreamStore(db.sql, db.runTransaction)
      const gate = deferred<void>()
      const store = new DelayedEventStreamStore(inner, new Map([[1, gate.promise]]))
      const { service, adapter } = createService(store)
      const live: PiChatEvent[] = []
      const subscription = await service.subscribe(ctx, 's1', 0, (event) => live.push(event))
      expect(subscription.type).toBe('ok')
      if (subscription.type !== 'ok' || !subscription.closed) throw new Error('expected closed hook')

      adapter.emit({ type: 'agent_start', turnId: 'turn-1' } as unknown as AgentSessionEvent)
      adapter.emit({ type: 'queue_update', followUp: ['next'] } as unknown as AgentSessionEvent)
      adapter.emit({ type: 'agent_end', status: 'ok', messages: [], willRetry: false } as unknown as AgentSessionEvent)

      await waitFor(() => expect(store.appendStarted).toEqual([1]))
      expect(live).toHaveLength(0)
      await expect(inner.readEvents(streamPathFor(ctx, 's1'), { offset: '-1' })).resolves.toMatchObject({ events: [] })

      gate.resolve()
      await waitFor(() => expect(live).toHaveLength(3))
      expect(store.appendStarted).toEqual([1, 2, 3])

      const result = await inner.readEvents(streamPathFor(ctx, 's1'), { offset: '-1' })
      const envelopes = result.events.map((event) => event.data as AgentEvent)
      expect(envelopes.map((event) => event.eventIndex)).toEqual([0, 1, 2])
      expect(envelopes.map((event) => event.sessionId)).toEqual(['s1', 's1', 's1'])
      expect(envelopes.map((event) => event.chunk)).toEqual(live)

      if (subscription.type === 'ok') subscription.unsubscribe()
    } finally {
      db.db.close()
    }
  })

  it('isolates durable event streams by workspace and auth subject for the same public session id', async () => {
    const db = openDatabase(':memory:')
    try {
      const store = new SqliteEventStreamStore(db.sql, db.runTransaction)
      const adapterA = createAdapter()
      const adapterB = createAdapter()
      const ctxB: PiSessionRequestContext = { ...ctx, workspaceId: 'workspace-b', storageScope: 'scope-b', authSubject: 'user-b' }
      const harness: AgentHarness & {
        getPiSessionAdapter(input: AgentSendInput, ctx: RunContext): Promise<PiAgentSessionAdapter>
        hasPiSession(sessionId: string): boolean
      } = {
        id: 'fake-pi',
        placement: 'server',
        sessions: sessionStore,
        hasPiSession: vi.fn(() => false),
        getPiSessionAdapter: vi.fn(async (_input, runCtx) => runCtx.workspaceId === ctxB.workspaceId ? adapterB : adapterA),
      }
      const service = new HarnessPiChatService({ harness, sessionStore, workdir: '/workspace', eventStore: store })

      const liveA: PiChatEvent[] = []
      const liveB: PiChatEvent[] = []
      const subA = await service.subscribe(ctx, 's1', 0, (event) => liveA.push(event))
      const subB = await service.subscribe(ctxB, 's1', 0, (event) => liveB.push(event))
      expect(subA.type).toBe('ok')
      expect(subB.type).toBe('ok')

      adapterA.emit({ type: 'agent_start', turnId: 'turn-a' } as unknown as AgentSessionEvent)
      adapterB.emit({ type: 'agent_start', turnId: 'turn-b' } as unknown as AgentSessionEvent)
      await waitFor(() => expect(liveA).toHaveLength(1))
      await waitFor(() => expect(liveB).toHaveLength(1))

      const streamA = await store.readEvents(streamPathFor(ctx, 's1'), { offset: '-1' })
      const streamB = await store.readEvents(streamPathFor(ctxB, 's1'), { offset: '-1' })
      await expect(store.readEvents(sessionStreamPath('s1'), { offset: '-1' })).resolves.toMatchObject({ events: [] })
      expect(streamA.events.map((event) => ((event.data as AgentEvent).chunk as { turnId?: string }).turnId)).toEqual(['turn-a'])
      expect(streamB.events.map((event) => ((event.data as AgentEvent).chunk as { turnId?: string }).turnId)).toEqual(['turn-b'])

      if (subA.type === 'ok') subA.unsubscribe()
      if (subB.type === 'ok') subB.unsubscribe()
    } finally {
      db.db.close()
    }
  })

  it('does not fan out an event when the durable append fails', async () => {
    const db = openDatabase(':memory:')
    try {
      const inner = new SqliteEventStreamStore(db.sql, db.runTransaction)
      const store = new DelayedEventStreamStore(inner, new Map(), new Set([1]))
      const { service, adapter } = createService(store)
      const live: PiChatEvent[] = []
      const subscription = await service.subscribe(ctx, 's1', 0, (event) => live.push(event))
      if (subscription.type !== 'ok' || !subscription.closed) throw new Error('expected ok subscription with closed hook')
      const closed = subscription.closed

      adapter.emit({ type: 'agent_start', turnId: 'turn-1' } as unknown as AgentSessionEvent)

      await waitFor(() => expect(store.appendStarted).toEqual([1]))
      await expect(closed).rejects.toThrow('append failed for seq 1')
      await flushAsync()
      expect(live).toEqual([])
      await expect(inner.readEvents(streamPathFor(ctx, 's1'), { offset: '-1' })).resolves.toMatchObject({ events: [] })

      if (subscription.type === 'ok') subscription.unsubscribe()
    } finally {
      db.db.close()
    }
  })

  it('serializes metadata enrichment with durable publishing', async () => {
    const db = openDatabase(':memory:')
    try {
      const inner = new SqliteEventStreamStore(db.sql, db.runTransaction)
      const gate = deferred<void>()
      const store = new DelayedEventStreamStore(inner, new Map([[1, gate.promise]]))
      const { service, adapter } = createService(store)
      const live: PiChatEvent[] = []
      const subscription = await service.subscribe(ctx, 's1', 0, (event) => live.push(event))
      expect(subscription.type).toBe('ok')

      await service.prompt(ctx, 's1', {
        message: 'same text',
        clientNonce: 'prompt-nonce',
      })
      adapter.emit({
        type: 'message_start',
        message: { id: 'u1', role: 'user', content: [{ type: 'text', text: 'same text' }] },
      } as unknown as AgentSessionEvent)

      const followUp = service.followUp(ctx, 's1', {
        message: 'same text',
        clientNonce: 'follow-nonce',
        clientSeq: 7,
      })
      await waitFor(() => expect(adapter.followUp).toHaveBeenCalledTimes(1))
      adapter.emit({
        type: 'message_start',
        message: { id: 'u2', role: 'user', content: [{ type: 'text', text: 'same text' }] },
      } as unknown as AgentSessionEvent)

      await waitFor(() => expect(store.appendStarted).toEqual([1]))
      expect(live).toHaveLength(0)
      gate.resolve()
      await waitFor(() => expect(live).toHaveLength(2))
      await followUp

      expect(live[0]).toMatchObject({ type: 'message-start', messageId: 'u1', clientNonce: 'prompt-nonce' })
      expect(live[1]).toMatchObject({ type: 'message-start', messageId: 'u2', clientNonce: 'follow-nonce', clientSeq: 7 })

      if (subscription.type === 'ok') subscription.unsubscribe()
    } finally {
      db.db.close()
    }
  })

  it('continues PiChatEvent seq from the durable tail after service restart', async () => {
    const db = openDatabase(':memory:')
    try {
      const store = new SqliteEventStreamStore(db.sql, db.runTransaction)

      const first = createService(store)
      const firstLive: PiChatEvent[] = []
      const firstSub = await first.service.subscribe(ctx, 's1', 0, (event) => firstLive.push(event))
      emitSimpleTurn(first.adapter)
      await waitFor(() => expect(firstLive).toHaveLength(2))
      if (firstSub.type === 'ok') firstSub.unsubscribe()

      const second = createService(store)
      const secondLive: PiChatEvent[] = []
      const secondSub = await second.service.subscribe(ctx, 's1', 2, (event) => secondLive.push(event))
      emitSimpleTurn(second.adapter, 'turn-2')
      await waitFor(() => expect(secondLive).toHaveLength(2))
      if (secondSub.type === 'ok') secondSub.unsubscribe()

      const result = await store.readEvents(streamPathFor(ctx, 's1'), { offset: '-1' })
      const envelopes = result.events.map((event) => event.data as AgentEvent)
      expect(envelopes).toHaveLength(4)
      expect(envelopes.map((event) => event.eventIndex)).toEqual([0, 1, 2, 3])
      expect(envelopes.map((event) => event.chunk.seq)).toEqual([1, 2, 3, 4])
      expect(envelopes.slice(0, 2).map((event) => event.chunk)).toEqual(firstLive)
      expect(envelopes.slice(2).map((event) => event.chunk)).toEqual(secondLive)
    } finally {
      db.db.close()
    }
  })

  it('migrates legacy durable event streams without storageScope into the scoped stream path', async () => {
    const db = openDatabase(':memory:')
    try {
      const store = new SqliteEventStreamStore(db.sql, db.runTransaction)
      await store.createStream(legacyStreamPathFor(ctx, 's1'))
      await store.appendAgentEvent('s1', { type: 'agent-start', seq: 9, turnId: 'legacy-turn' }, { streamPath: legacyStreamPathFor(ctx, 's1') })

      const restarted = createService(store)
      const live: PiChatEvent[] = []
      const subscription = await restarted.service.subscribe(ctx, 's1', 9, (event) => live.push(event))
      expect(subscription.type).toBe('ok')
      emitSimpleTurn(restarted.adapter, 'turn-10')
      await waitFor(() => expect(live).toHaveLength(2))
      if (subscription.type === 'ok') subscription.unsubscribe()

      const scoped = await store.readEvents(streamPathFor(ctx, 's1'), { offset: '-1' })
      const legacy = await store.readEvents(legacyStreamPathFor(ctx, 's1'), { offset: '-1' })
      const envelopes = scoped.events.map((event) => event.data as AgentEvent)
      expect(legacy.events).toHaveLength(1)
      expect(envelopes.map((event) => event.chunk.seq)).toEqual([9, 10, 11])
      expect((envelopes[0]?.chunk as { turnId?: string } | undefined)?.turnId).toBe('legacy-turn')
    } finally {
      db.db.close()
    }
  })

  it('resumes an interrupted legacy durable event stream migration without duplicating copied events', async () => {
    const db = openDatabase(':memory:')
    try {
      const store = new SqliteEventStreamStore(db.sql, db.runTransaction)
      const legacyPath = legacyStreamPathFor(ctx, 's1')
      const scopedPath = streamPathFor(ctx, 's1')
      await store.createStream(legacyPath)
      await store.appendAgentEvent('s1', { type: 'agent-start', seq: 9, turnId: 'legacy-turn' }, { streamPath: legacyPath })
      await store.appendAgentEvent('s1', { type: 'agent-end', seq: 10, turnId: 'legacy-turn', status: 'ok' }, { streamPath: legacyPath })
      await store.appendAgentEvent('s1', { type: 'agent-start', seq: 11, turnId: 'legacy-turn-2' }, { streamPath: legacyPath })
      await store.closeStream(legacyPath)
      const legacy = await store.readEvents(legacyPath, { offset: '-1' })

      await store.createStream(scopedPath)
      await store.appendEvent(scopedPath, legacy.events[0]?.data)

      const restarted = createService(store)
      const firstSubscription = await restarted.service.subscribe(ctx, 's1', 11, () => {})
      expect(firstSubscription.type).toBe('ok')
      if (firstSubscription.type === 'ok') firstSubscription.unsubscribe()

      const rerun = createService(store)
      const secondSubscription = await rerun.service.subscribe(ctx, 's1', 11, () => {})
      expect(secondSubscription.type).toBe('ok')
      if (secondSubscription.type === 'ok') secondSubscription.unsubscribe()

      const scoped = await store.readEvents(scopedPath, { offset: '-1' })
      expect(scoped.events.map((event) => event.data)).toEqual(legacy.events.map((event) => event.data))
      expect(scoped.events).toHaveLength(3)
      await expect(store.getStreamMeta(scopedPath)).resolves.toMatchObject({ closed: true })
    } finally {
      db.db.close()
    }
  })

  it('rebuilds idempotency keys when an interrupted migration already copied all legacy events', async () => {
    const db = openDatabase(':memory:')
    try {
      const store = new SqliteEventStreamStore(db.sql, db.runTransaction)
      const legacyPath = legacyStreamPathFor(ctx, 's1')
      const scopedPath = streamPathFor(ctx, 's1')
      await store.createStream(legacyPath)
      await store.appendAgentEvent('s1', { type: 'agent-start', seq: 9, turnId: 'legacy-turn' }, { streamPath: legacyPath })
      await store.appendAgentEvent('s1', { type: 'agent-end', seq: 10, turnId: 'legacy-turn', status: 'ok' }, { streamPath: legacyPath })
      const legacy = await store.readEvents(legacyPath, { offset: '-1' })

      await store.createStream(scopedPath)
      for (const event of legacy.events) await store.appendEvent(scopedPath, event.data)

      const restarted = createService(store)
      const subscription = await restarted.service.subscribe(ctx, 's1', 10, () => {})
      expect(subscription.type).toBe('ok')
      if (subscription.type === 'ok') subscription.unsubscribe()

      const legacySecond = legacy.events[1]?.data as AgentEvent
      await expect(store.appendAgentEvent('s1', legacySecond.chunk, {
        idempotencyKey: String(legacySecond.chunk.seq),
        streamPath: scopedPath,
      })).resolves.toBe(formatOffset(1))
      await expect(store.readEvents(scopedPath, { offset: '-1' })).resolves.toMatchObject({ events: legacy.events })
    } finally {
      db.db.close()
    }
  })

  it('leaves authoritative scoped streams untouched when they are not interrupted legacy copies', async () => {
    const db = openDatabase(':memory:')
    try {
      const store = new SqliteEventStreamStore(db.sql, db.runTransaction)
      const legacyPath = legacyStreamPathFor(ctx, 's1')
      const scopedPath = streamPathFor(ctx, 's1')
      await store.createStream(legacyPath)
      await store.appendAgentEvent('s1', { type: 'agent-start', seq: 1, turnId: 'legacy-turn' }, { streamPath: legacyPath })
      await store.createStream(scopedPath)
      await store.appendAgentEvent('s1', { type: 'agent-start', seq: 20, turnId: 'scoped-turn' }, { streamPath: scopedPath })
      const before = await store.readEvents(scopedPath, { offset: '-1' })

      const restarted = createService(store)
      const subscription = await restarted.service.subscribe(ctx, 's1', 20, () => {})
      expect(subscription.type).toBe('ok')
      if (subscription.type === 'ok') subscription.unsubscribe()

      const after = await store.readEvents(scopedPath, { offset: '-1' })
      expect(after.events.map((event) => event.data)).toEqual(before.events.map((event) => event.data))
    } finally {
      db.db.close()
    }
  })

  it('rebuilds interrupted migration state with newer scoped events after legacy replay', async () => {
    const db = openDatabase(':memory:')
    try {
      const store = new SqliteEventStreamStore(db.sql, db.runTransaction)
      const legacyPath = legacyStreamPathFor(ctx, 's1')
      const scopedPath = streamPathFor(ctx, 's1')
      await store.createStream(legacyPath)
      await store.appendAgentEvent('s1', { type: 'agent-start', seq: 9, turnId: 'legacy-turn' }, { streamPath: legacyPath })
      await store.appendAgentEvent('s1', { type: 'agent-end', seq: 10, turnId: 'legacy-turn', status: 'ok' }, { streamPath: legacyPath })
      const legacy = await store.readEvents(legacyPath, { offset: '-1' })

      await store.createStream(scopedPath)
      await store.appendEvent(scopedPath, legacy.events[0]?.data)
      await store.appendAgentEvent('s1', { type: 'agent-start', seq: 10, turnId: 'newer-scoped-turn' }, { streamPath: scopedPath })
      const newerScoped = (await store.readEvents(scopedPath, { offset: '-1' })).events[1]?.data as AgentEvent

      const restarted = createService(store)
      const subscription = await restarted.service.subscribe(ctx, 's1', 11, () => {})
      expect(subscription.type).toBe('ok')
      if (subscription.type === 'ok') subscription.unsubscribe()

      const scoped = await store.readEvents(scopedPath, { offset: '-1' })
      const scopedEnvelopes = scoped.events.map((event) => event.data as AgentEvent)
      expect(scopedEnvelopes.map((event) => event.eventIndex)).toEqual([0, 1, 2])
      expect(scopedEnvelopes.map((event) => event.chunk)).toEqual([
        ...(legacy.events.map((event) => event.data as AgentEvent).map((event) => event.chunk)),
        { ...newerScoped.chunk, seq: 11 },
      ])
      await expect(store.appendAgentEvent('s1', newerScoped.chunk, {
        idempotencyKey: String(newerScoped.chunk.seq),
        streamPath: scopedPath,
      })).resolves.toBe(formatOffset(2))
      await expect(store.readEvents(scopedPath, { offset: '-1' })).resolves.toMatchObject({ events: scoped.events })
    } finally {
      db.db.close()
    }
  })

  it('preserves a resequenced scoped extra retry key when migration reruns after legacy growth', async () => {
    const db = openDatabase(':memory:')
    try {
      const store = new SqliteEventStreamStore(db.sql, db.runTransaction)
      const legacyPath = legacyStreamPathFor(ctx, 's1')
      const scopedPath = streamPathFor(ctx, 's1')
      await store.createStream(legacyPath)
      await store.appendAgentEvent('s1', { type: 'agent-start', seq: 9, turnId: 'legacy-turn' }, { streamPath: legacyPath })
      await store.appendAgentEvent('s1', { type: 'agent-end', seq: 10, turnId: 'legacy-turn', status: 'ok' }, { streamPath: legacyPath })
      const legacy = await store.readEvents(legacyPath, { offset: '-1' })

      await store.createStream(scopedPath)
      await store.appendEvent(scopedPath, legacy.events[0]?.data)
      await store.appendAgentEvent('s1', { type: 'agent-start', seq: 10, turnId: 'newer-scoped-turn' }, { streamPath: scopedPath })
      const newerScoped = (await store.readEvents(scopedPath, { offset: '-1' })).events[1]?.data as AgentEvent

      const first = createService(store)
      const firstSubscription = await first.service.subscribe(ctx, 's1', 11, () => {})
      expect(firstSubscription.type).toBe('ok')
      if (firstSubscription.type === 'ok') firstSubscription.unsubscribe()

      await store.appendAgentEvent('s1', { type: 'agent-start', seq: 12, turnId: 'legacy-turn-2' }, { streamPath: legacyPath })
      const second = createService(store)
      const secondSubscription = await second.service.subscribe(ctx, 's1', 13, () => {})
      expect(secondSubscription.type).toBe('ok')
      if (secondSubscription.type === 'ok') secondSubscription.unsubscribe()

      const scoped = await store.readEvents(scopedPath, { offset: '-1' })
      expect(scoped.events.map((event) => (event.data as AgentEvent).chunk.seq)).toEqual([9, 10, 12, 13])
      await expect(store.appendAgentEvent('s1', newerScoped.chunk, {
        idempotencyKey: String(newerScoped.chunk.seq),
        streamPath: scopedPath,
      })).resolves.toBe(formatOffset(3))
      await expect(store.appendAgentEvent('s1', { type: 'agent-end', seq: 14, turnId: 'future-turn', status: 'ok' }, {
        idempotencyKey: '14',
        streamPath: scopedPath,
      })).resolves.toBe(formatOffset(4))
    } finally {
      db.db.close()
    }
  })

  it('preserves high scoped extra seqs so restored idempotency keys stay behind the durable tail', async () => {
    const db = openDatabase(':memory:')
    try {
      const store = new SqliteEventStreamStore(db.sql, db.runTransaction)
      const legacyPath = legacyStreamPathFor(ctx, 's1')
      const scopedPath = streamPathFor(ctx, 's1')
      await store.createStream(legacyPath)
      await store.appendAgentEvent('s1', { type: 'agent-start', seq: 9, turnId: 'legacy-turn' }, { streamPath: legacyPath })
      await store.appendAgentEvent('s1', { type: 'agent-end', seq: 10, turnId: 'legacy-turn', status: 'ok' }, { streamPath: legacyPath })
      const legacy = await store.readEvents(legacyPath, { offset: '-1' })

      await store.createStream(scopedPath)
      await store.appendEvent(scopedPath, legacy.events[0]?.data)
      await store.appendAgentEvent('s1', { type: 'agent-start', seq: 100, turnId: 'newer-scoped-turn' }, { streamPath: scopedPath })
      const newerScoped = (await store.readEvents(scopedPath, { offset: '-1' })).events[1]?.data as AgentEvent

      const restarted = createService(store)
      const subscription = await restarted.service.subscribe(ctx, 's1', 100, () => {})
      expect(subscription.type).toBe('ok')
      if (subscription.type === 'ok') subscription.unsubscribe()

      const scoped = await store.readEvents(scopedPath, { offset: '-1' })
      const scopedEnvelopes = scoped.events.map((event) => event.data as AgentEvent)
      expect(scopedEnvelopes.map((event) => event.chunk.seq)).toEqual([9, 10, 100])
      await expect(store.appendAgentEvent('s1', newerScoped.chunk, {
        idempotencyKey: String(newerScoped.chunk.seq),
        streamPath: scopedPath,
      })).resolves.toBe(formatOffset(2))
      await expect(store.appendAgentEvent('s1', { type: 'agent-end', seq: 101, turnId: 'future-turn', status: 'ok' }, {
        idempotencyKey: '101',
        streamPath: scopedPath,
      })).resolves.toBe(formatOffset(3))
    } finally {
      db.db.close()
    }
  })

  it('coalesces concurrent legacy durable event stream migrations', async () => {
    const db = openDatabase(':memory:')
    try {
      const store = new SqliteEventStreamStore(db.sql, db.runTransaction)
      await store.createStream(legacyStreamPathFor(ctx, 's1'))
      await store.appendAgentEvent('s1', { type: 'agent-start', seq: 9, turnId: 'legacy-turn' }, { streamPath: legacyStreamPathFor(ctx, 's1') })
      const appendEventSpy = vi.spyOn(store, 'replaceStreamEvents')
      const persistedStore: SessionStore & {
        loadEntries(ctx: { workspaceId?: string; userId?: string }, sessionId: string): Promise<{ id: string; messages: unknown[] }>
      } = {
        ...sessionStore,
        loadEntries: vi.fn(async () => ({ id: 's1', messages: [] })),
      }
      const { service } = createService(store, createAdapter(), persistedStore)

      await Promise.all([
        service.readState(ctx, 's1'),
        service.readState(ctx, 's1'),
      ])

      expect(appendEventSpy).toHaveBeenCalledTimes(1)
      const scoped = await store.readEvents(streamPathFor(ctx, 's1'), { offset: '-1' })
      expect(scoped.events).toHaveLength(1)
    } finally {
      db.db.close()
    }
  })

  it('seeds restart PiChatEvent seq from the durable tail chunk instead of eventIndex', async () => {
    const db = openDatabase(':memory:')
    try {
      const store = new SqliteEventStreamStore(db.sql, db.runTransaction)
      await store.createStream(streamPathFor(ctx, 's1'))
      await store.appendAgentEvent('s1', { type: 'agent-start', seq: 9, turnId: 'old-turn' }, { streamPath: streamPathFor(ctx, 's1') })

      const restarted = createService(store)
      const live: PiChatEvent[] = []
      const subscription = await restarted.service.subscribe(ctx, 's1', 9, (event) => live.push(event))
      expect(subscription.type).toBe('ok')
      emitSimpleTurn(restarted.adapter, 'turn-10')
      await waitFor(() => expect(live).toHaveLength(2))
      if (subscription.type === 'ok') subscription.unsubscribe()

      const result = await store.readEvents(streamPathFor(ctx, 's1'), { offset: '-1' })
      const envelopes = result.events.map((event) => event.data as AgentEvent)
      expect(envelopes.map((event) => event.eventIndex)).toEqual([0, 1, 2])
      expect(envelopes.map((event) => event.chunk.seq)).toEqual([9, 10, 11])
    } finally {
      db.db.close()
    }
  })

  it('reports durable latest seq from cold persisted state', async () => {
    const db = openDatabase(':memory:')
    try {
      const store = new SqliteEventStreamStore(db.sql, db.runTransaction)
      await store.createStream(streamPathFor(ctx, 's1'))
      await store.appendAgentEvent('s1', { type: 'agent-start', seq: 9, turnId: 'old-turn' }, { streamPath: streamPathFor(ctx, 's1') })

      const persistedStore: SessionStore & {
        loadEntries(ctx: { workspaceId?: string; userId?: string }, sessionId: string): Promise<{ id: string; messages: unknown[] }>
      } = {
        ...sessionStore,
        loadEntries: vi.fn(async () => ({ id: 's1', messages: [] })),
      }
      const { service } = createService(store, createAdapter(), persistedStore)

      await expect(service.readState(ctx, 's1')).resolves.toMatchObject({
        sessionId: 's1',
        seq: 9,
      })
    } finally {
      db.db.close()
    }
  })
})

class DelayedEventStreamStore implements EventStreamStore {
  readonly appendStarted: number[] = []

  constructor(
    private readonly inner: EventStreamStore,
    private readonly gates: Map<number, Promise<void>>,
    private readonly failingSeqs = new Set<number>(),
    private readonly creationFailure?: { started: () => void; gate: Promise<void>; error: Error },
  ) {}

  async createStream(path: string): Promise<void> {
    if (this.creationFailure) {
      this.creationFailure.started()
      await this.creationFailure.gate
      throw this.creationFailure.error
    }
    return this.inner.createStream(path)
  }

  appendEvent(path: string, event: unknown): Promise<string> {
    return this.inner.appendEvent(path, event)
  }

  appendEventOnce(path: string, key: string, event: unknown): Promise<string> {
    return this.inner.appendEventOnce(path, key, event)
  }

  async appendAgentEvent(sessionId: string, chunk: PiChatEvent, opts?: { idempotencyKey?: string; streamPath?: string }): Promise<string> {
    this.appendStarted.push(chunk.seq)
    await this.gates.get(chunk.seq)
    if (this.failingSeqs.has(chunk.seq)) throw new Error(`append failed for seq ${chunk.seq}`)
    return this.inner.appendAgentEvent(sessionId, chunk, opts)
  }

  readEvents(path: string, opts?: { offset?: string; limit?: number }): Promise<EventStreamReadResult> {
    return this.inner.readEvents(path, opts)
  }

  replaceStreamEvents(path: string, events: readonly EventStreamReplacementEvent[], opts?: { closed?: boolean; expectedNextOffset?: string; expectedClosed?: boolean }): Promise<void> {
    return this.inner.replaceStreamEvents(path, events, opts)
  }

  closeStream(path: string): Promise<void> {
    return this.inner.closeStream(path)
  }

  getStreamMeta(path: string): Promise<EventStreamMeta | null> {
    return this.inner.getStreamMeta(path)
  }

  readEventIdempotencyKeys(path: string): Promise<EventStreamIdempotencyKey[]> {
    return this.inner.readEventIdempotencyKeys?.(path) ?? Promise.resolve([])
  }

  subscribe(path: string, listener: () => void): () => void {
    return this.inner.subscribe(path, listener)
  }
}

function streamPathFor(ctx: PiSessionRequestContext, sessionId: string): string {
  return sessionStreamPath(JSON.stringify([sessionId, ctx.workspaceId ?? '', ctx.authSubject ?? '', ctx.storageScope ?? '']))
}

function legacyStreamPathFor(ctx: PiSessionRequestContext, sessionId: string): string {
  return sessionStreamPath(JSON.stringify([sessionId, ctx.workspaceId ?? '', ctx.authSubject ?? '']))
}

function emitSimpleTurn(adapter: FakeAdapter, turnId = 'turn-1'): void {
  adapter.emit({ type: 'agent_start', turnId } as unknown as AgentSessionEvent)
  adapter.emit({ type: 'agent_end', status: 'ok', messages: [], willRetry: false } as unknown as AgentSessionEvent)
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

async function waitFor(assertion: () => void | Promise<void>): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await assertion()
      return
    } catch (error) {
      lastError = error
      await flushAsync()
    }
  }
  throw lastError
}

async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}
