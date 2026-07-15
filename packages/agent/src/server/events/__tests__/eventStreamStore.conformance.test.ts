import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PiChatEvent } from '../../../shared/chat'
import type { AgentEvent } from '../../../shared/events'
import {
  type EventStreamStore,
  formatOffset,
  parseOffset,
  SqliteEventStreamStore,
} from '../eventStreamStore'
import { openDatabase, type OpenDatabaseResult } from '../sqlStorage'

interface StoreHarness {
  store: EventStreamStore
  close?: () => void | Promise<void>
}

type StoreFactory = () => StoreHarness | Promise<StoreHarness>

export function runEventStreamStoreConformance(makeStore: StoreFactory): void {
  let harness: StoreHarness | undefined

  afterEach(async () => {
    await harness?.close?.()
    harness = undefined
  })

  async function useStore(): Promise<EventStreamStore> {
    harness = await makeStore()
    return harness.store
  }

  it('formats and parses Durable Streams offsets', () => {
    expect(formatOffset(-1)).toBe('-1')
    expect(formatOffset(0)).toBe('0000000000000000_0000000000000000')
    expect(formatOffset(42)).toBe('0000000000000000_0000000000000042')
    expect(parseOffset('0000000000000000_0000000000000042')).toBe(42)
    expect(() => parseOffset('42')).toThrow(/Invalid event stream offset/)
  })

  it('appends and reads strictly after offsets with correct metadata', async () => {
    const store = await useStore()
    const path = 'streams/monotonic'
    await store.createStream(path)

    expect(await store.getStreamMeta(path)).toEqual({ nextOffset: '-1', closed: false })

    const first = await store.appendEvent(path, { index: 0 })
    const second = await store.appendEvent(path, { index: 1 })

    expect(first).toBe(formatOffset(0))
    expect(second).toBe(formatOffset(1))

    await expect(store.readEvents(path, { offset: '-1' })).resolves.toEqual({
      events: [
        { data: { index: 0 }, offset: first },
        { data: { index: 1 }, offset: second },
      ],
      nextOffset: second,
      upToDate: true,
      closed: false,
    })

    await expect(store.readEvents(path, { offset: first })).resolves.toMatchObject({
      events: [{ data: { index: 1 }, offset: second }],
      nextOffset: second,
      upToDate: true,
    })

    await expect(store.readEvents(path, { offset: '-1', limit: 1 })).resolves.toMatchObject({
      events: [{ data: { index: 0 }, offset: first }],
      nextOffset: first,
      upToDate: false,
    })

    await expect(store.readEvents(path, { offset: 'now' })).resolves.toEqual({
      events: [],
      nextOffset: second,
      upToDate: true,
      closed: false,
    })

    await expect(store.readEvents(path, { offset: formatOffset(100) })).resolves.toMatchObject({
      events: [],
      nextOffset: second,
      upToDate: true,
    })

    const third = await store.appendEvent(path, { index: 2 })
    await expect(store.readEvents(path, { offset: second })).resolves.toMatchObject({
      events: [{ data: { index: 2 }, offset: third }],
      nextOffset: third,
    })
  })

  it('creates streams idempotently and rejects appends to missing or closed streams', async () => {
    const store = await useStore()
    const path = 'streams/lifecycle'

    await expect(store.appendEvent(path, { beforeCreate: true })).rejects.toThrow(/does not exist/)
    await store.createStream(path)
    await store.createStream(path)
    await store.closeStream(path)
    await store.closeStream(path)

    await expect(store.getStreamMeta(path)).resolves.toEqual({ nextOffset: '-1', closed: true })
    await expect(store.appendEvent(path, { afterClose: true })).rejects.toThrow(/is closed/)
  })

  it('replaces stream events with idempotency keys and rejects stale closure preconditions', async () => {
    const store = await useStore()
    const path = 'streams/replace'
    await store.createStream(path)
    const oldOffset = await store.appendEvent(path, { old: true })
    await store.closeStream(path)

    await expect(
      store.replaceStreamEvents(path, [{ data: { stale: true } }], { expectedNextOffset: oldOffset, expectedClosed: false }),
    ).rejects.toThrow(/changed during replacement/)
    await expect(store.readEvents(path, { offset: '-1' })).resolves.toMatchObject({
      events: [{ data: { old: true }, offset: oldOffset }],
      closed: true,
    })

    await store.replaceStreamEvents(
      path,
      [
        { data: { replaced: true }, idempotencyKey: 'retry', idempotencyData: { stable: true } },
        { data: { replacedNull: true }, idempotencyKey: 'retry-null', idempotencyData: null },
      ],
      { expectedNextOffset: oldOffset, expectedClosed: true, closed: true },
    )
    await expect(store.readEvents(path, { offset: '-1' })).resolves.toMatchObject({
      events: [
        { data: { replaced: true }, offset: formatOffset(0) },
        { data: { replacedNull: true }, offset: formatOffset(1) },
      ],
      closed: true,
    })
    await expect(store.appendEventOnce(path, 'retry', { stable: true })).resolves.toBe(formatOffset(0))
    await expect(store.appendEventOnce(path, 'retry-null', null)).resolves.toBe(formatOffset(1))
    await expect(store.appendEventOnce(path, 'retry', { stable: false })).rejects.toThrow(/conflicting payload/)
  })

  it('keeps appendEventOnce idempotent and rejects conflicting payload reuse', async () => {
    const store = await useStore()
    const path = 'streams/once'
    await store.createStream(path)

    const first = await store.appendEventOnce(path, 'key-1', { stable: true })
    const retry = await store.appendEventOnce(path, 'key-1', { stable: true })

    expect(retry).toBe(first)
    await expect(store.appendEventOnce(path, 'key-1', { stable: false })).rejects.toThrow(/conflicting payload/)
    await expect(store.readEvents(path, { offset: '-1' })).resolves.toMatchObject({
      events: [{ data: { stable: true }, offset: first }],
      nextOffset: first,
    })
  })

  it('deduplicates appendAgentEvent by idempotency key without allocating another eventIndex', async () => {
    const store = await useStore()
    await store.createStream('sessions/session-a')
    const chunk = piEvent(7)

    const first = await store.appendAgentEvent('session-a', chunk, { idempotencyKey: String(chunk.seq) })
    const retry = await store.appendAgentEvent('session-a', chunk, { idempotencyKey: String(chunk.seq) })
    const [concurrentA, concurrentB] = await Promise.all([
      store.appendAgentEvent('session-a', chunk, { idempotencyKey: String(chunk.seq) }),
      store.appendAgentEvent('session-a', chunk, { idempotencyKey: String(chunk.seq) }),
    ])

    expect(retry).toBe(first)
    expect(concurrentA).toBe(first)
    expect(concurrentB).toBe(first)
    await expect(
      store.appendAgentEvent('session-a', piEvent(8), { idempotencyKey: String(chunk.seq) }),
    ).rejects.toThrow(/conflicting payload/)

    const result = await store.readEvents('sessions/session-a', { offset: '-1' })
    expect(result.nextOffset).toBe(first)
    expect(result.events).toHaveLength(1)
    const envelope = result.events[0]?.data as AgentEvent
    expect(envelope).toMatchObject({
      v: 1,
      eventIndex: 0,
      sessionId: 'session-a',
      chunk,
    })
    expect(typeof envelope.timestamp).toBe('number')
    expect(await store.getStreamMeta('sessions/session-a')).toEqual({ nextOffset: first, closed: false })
  })

  it('rolls back appendAgentEvent when envelope serialization throws', async () => {
    const store = await useStore()
    await store.createStream('sessions/atomic')
    const badChunk = { ...piEvent(1), bad: 1n } as unknown as PiChatEvent

    await expect(store.appendAgentEvent('atomic', badChunk)).rejects.toThrow(/serialize a BigInt/)
    await expect(store.getStreamMeta('sessions/atomic')).resolves.toEqual({ nextOffset: '-1', closed: false })
    await expect(store.readEvents('sessions/atomic', { offset: '-1' })).resolves.toMatchObject({
      events: [],
      nextOffset: '-1',
    })

    const offset = await store.appendAgentEvent('atomic', piEvent(2))
    expect(offset).toBe(formatOffset(0))
    const result = await store.readEvents('sessions/atomic', { offset: '-1' })
    expect((result.events[0]?.data as AgentEvent).eventIndex).toBe(0)
  })

  it('fires subscribers on append and stops after unsubscribe', async () => {
    const store = await useStore()
    const path = 'streams/subscribers'
    const listener = vi.fn()
    await store.createStream(path)
    const unsubscribe = store.subscribe(path, listener)

    await store.appendEvent(path, { one: true })
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    await store.appendEvent(path, { two: true })
    expect(listener).toHaveBeenCalledTimes(1)
  })
}

describe('SqliteEventStreamStore (:memory:)', () => {
  runEventStreamStoreConformance(() => {
    const db = openDatabase(':memory:')
    return makeHarness(db)
  })
})

describe('SqliteEventStreamStore (file)', () => {
  runEventStreamStoreConformance(() => {
    const dir = mkdtempSync(join(tmpdir(), 'boring-event-stream-'))
    const db = openDatabase(join(dir, 'events.sqlite'))
    return makeHarness(db)
  })
})

function makeHarness(db: OpenDatabaseResult): StoreHarness {
  return {
    store: new SqliteEventStreamStore(db.sql, db.runTransaction),
    close: () => db.db.close(),
  }
}

function piEvent(seq: number): PiChatEvent {
  return { type: 'agent-start', seq, turnId: `turn-${seq}` }
}
