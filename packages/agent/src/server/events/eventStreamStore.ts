import type { PiChatEvent } from '../../shared/chat'
import type { AgentEvent } from '../../shared/events'
import { sessionStreamPath } from '../../shared/events'
import { migrateEventStreamSqlSchema } from './schemaVersion'
import type { RunTransaction, SqlStorage } from './sqlStorage'

const COMPONENT_PAD = 16
const ZERO_COMPONENT = '0'.repeat(COMPONENT_PAD)

export const DEFAULT_READ_LIMIT = 100
export const MAX_READ_LIMIT = 1000

export interface EventStreamReadResult {
  events: Array<{ data: unknown; offset: string }>
  nextOffset: string
  upToDate: boolean
  closed: boolean
}

export interface EventStreamMeta {
  nextOffset: string
  closed: boolean
}

export interface EventStreamStore {
  createStream(path: string): Promise<void>
  appendEvent(path: string, event: unknown): Promise<string>
  appendEventOnce(path: string, key: string, event: unknown): Promise<string>
  appendAgentEvent(sessionId: string, chunk: PiChatEvent, opts?: { idempotencyKey?: string }): Promise<string>
  readEvents(path: string, opts?: { offset?: string; limit?: number }): Promise<EventStreamReadResult>
  closeStream(path: string): Promise<void>
  getStreamMeta(path: string): Promise<EventStreamMeta | null>
  subscribe(path: string, listener: () => void): () => void
}

export class EventStreamStoreError extends Error {
  readonly code = 'INTERNAL_ERROR'

  constructor(message: string) {
    super(message)
    this.name = 'EventStreamStoreError'
  }
}

export function formatOffset(seq: number): string {
  if (seq === -1) return '-1'
  if (!Number.isInteger(seq) || seq < -1) {
    throw new EventStreamStoreError(`Invalid event stream sequence: ${seq}.`)
  }
  return `${ZERO_COMPONENT}_${String(seq).padStart(COMPONENT_PAD, '0')}`
}

export function parseOffset(offset: string): number {
  if (offset === '-1') return -1
  const match = /^\d+_(\d+)$/.exec(offset)
  const sequence = match?.[1]
  if (!sequence) {
    throw new EventStreamStoreError(`Invalid event stream offset: "${offset}".`)
  }
  return parseInt(sequence, 10)
}

const CREATE_STREAMS_TABLE = `
CREATE TABLE IF NOT EXISTS boring_event_streams (
  path TEXT PRIMARY KEY,
  next_offset INTEGER NOT NULL DEFAULT 0,
  closed INTEGER NOT NULL DEFAULT 0
)`

const CREATE_ENTRIES_TABLE = `
CREATE TABLE IF NOT EXISTS boring_event_stream_entries (
  path TEXT NOT NULL,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (path, seq)
)`

const CREATE_EVENT_KEYS_TABLE = `
CREATE TABLE IF NOT EXISTS boring_event_stream_keys (
  path TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (path, idempotency_key),
  UNIQUE (path, seq)
)`

export class SqliteEventStreamStore implements EventStreamStore {
  private readonly listeners = new Map<string, Set<() => void>>()

  constructor(
    private readonly sql: SqlStorage,
    private readonly runTransaction: RunTransaction,
  ) {
    migrateEventStreamSqlSchema(sql, () => {
      sql.exec(CREATE_STREAMS_TABLE)
      sql.exec(CREATE_ENTRIES_TABLE)
      sql.exec(CREATE_EVENT_KEYS_TABLE)
    })
  }

  async createStream(path: string): Promise<void> {
    this.sql.exec(`INSERT OR IGNORE INTO boring_event_streams (path) VALUES (?)`, path)
  }

  async appendEvent(path: string, event: unknown): Promise<string> {
    const data = JSON.stringify(event)
    const offset = this.runTransaction(() => this.appendSerializedEvent(path, data))
    this.notifyListeners(path)
    return offset
  }

  async appendEventOnce(path: string, key: string, event: unknown): Promise<string> {
    const data = JSON.stringify(event)
    let inserted = false
    try {
      const offset = this.runTransaction(() => {
        const existing = this.readIdempotencyKey(path, key)
        if (existing) {
          if (existing.data !== data) {
            throw new EventStreamStoreError(`Event key "${key}" already has a conflicting payload.`)
          }
          return formatOffset(existing.seq)
        }

        const seq = this.allocateSeq(path)
        this.sql.exec(
          `INSERT INTO boring_event_stream_entries (path, seq, data) VALUES (?, ?, ?)`,
          path,
          seq,
          data,
        )
        this.sql.exec(
          `INSERT INTO boring_event_stream_keys (path, idempotency_key, seq, data) VALUES (?, ?, ?, ?)`,
          path,
          key,
          seq,
          data,
        )
        inserted = true
        return formatOffset(seq)
      })
      if (inserted) this.notifyListeners(path)
      return offset
    } catch (error) {
      const existing = this.readIdempotencyKey(path, key)
      if (existing) {
        if (existing.data !== data) {
          throw new EventStreamStoreError(`Event key "${key}" already has a conflicting payload.`)
        }
        return formatOffset(existing.seq)
      }
      throw error
    }
  }

  async appendAgentEvent(sessionId: string, chunk: PiChatEvent, opts: { idempotencyKey?: string } = {}): Promise<string> {
    const path = sessionStreamPath(sessionId)
    let inserted = false
    try {
      const offset = this.runTransaction(() => {
        if (opts.idempotencyKey !== undefined) {
          const existing = this.readIdempotencyKey(path, opts.idempotencyKey)
          if (existing) {
            this.assertSameAgentIdempotencyPayload(opts.idempotencyKey, existing.data, chunk)
            return formatOffset(existing.seq)
          }
        }

        const seq = this.allocateSeq(path)
        const envelope: AgentEvent = {
          v: 1,
          eventIndex: seq,
          timestamp: Date.now(),
          sessionId,
          chunk,
        }
        const data = JSON.stringify(envelope)
        const keyData = opts.idempotencyKey === undefined ? undefined : JSON.stringify(chunk)
        this.sql.exec(
          `INSERT INTO boring_event_stream_entries (path, seq, data) VALUES (?, ?, ?)`,
          path,
          seq,
          data,
        )
        if (opts.idempotencyKey !== undefined) {
          this.sql.exec(
            `INSERT INTO boring_event_stream_keys (path, idempotency_key, seq, data) VALUES (?, ?, ?, ?)`,
            path,
            opts.idempotencyKey,
            seq,
            keyData,
          )
        }
        inserted = true
        return formatOffset(seq)
      })
      if (inserted) this.notifyListeners(path)
      return offset
    } catch (error) {
      if (opts.idempotencyKey !== undefined) {
        const existing = this.readIdempotencyKey(path, opts.idempotencyKey)
        if (existing) {
          this.assertSameAgentIdempotencyPayload(opts.idempotencyKey, existing.data, chunk)
          return formatOffset(existing.seq)
        }
      }
      throw error
    }
  }

  async readEvents(path: string, opts: { offset?: string; limit?: number } = {}): Promise<EventStreamReadResult> {
    const meta = this.getStreamMetaSync(path)
    if (!meta) {
      return { events: [], nextOffset: formatOffset(-1), upToDate: true, closed: false }
    }

    const rawOffset = opts.offset ?? '-1'
    const limit = clampLimit(opts.limit, DEFAULT_READ_LIMIT, MAX_READ_LIMIT)
    let startAfter: number
    if (rawOffset === '-1') {
      startAfter = -1
    } else if (rawOffset === 'now') {
      return {
        events: [],
        nextOffset: meta.nextOffset,
        upToDate: true,
        closed: meta.closed,
      }
    } else {
      startAfter = parseOffset(rawOffset)
    }
    const tailSeq = parseOffset(meta.nextOffset)
    if (startAfter > tailSeq) startAfter = tailSeq

    const rows = this.sql.exec(`
      SELECT seq, data FROM boring_event_stream_entries
      WHERE path = ? AND seq > ?
      ORDER BY seq ASC
      LIMIT ?
    `, path, startAfter, limit + 1).toArray()
    const page = rows.slice(0, limit)
    const events = page.map((row) => ({
      data: JSON.parse(row.data as string) as unknown,
      offset: formatOffset(row.seq as number),
    }))
    const lastRow = page.at(-1)
    const lastSeq = lastRow ? lastRow.seq as number : startAfter

    return {
      events,
      nextOffset: formatOffset(lastSeq),
      upToDate: rows.length <= limit,
      closed: meta.closed,
    }
  }

  async closeStream(path: string): Promise<void> {
    this.sql.exec(`UPDATE boring_event_streams SET closed = 1 WHERE path = ?`, path)
    this.notifyListeners(path)
  }

  async getStreamMeta(path: string): Promise<EventStreamMeta | null> {
    return this.getStreamMetaSync(path)
  }

  subscribe(path: string, listener: () => void): () => void {
    let bucket = this.listeners.get(path)
    if (!bucket) {
      bucket = new Set()
      this.listeners.set(path, bucket)
    }
    bucket.add(listener)

    return () => {
      bucket.delete(listener)
      if (bucket.size === 0) this.listeners.delete(path)
    }
  }

  private appendSerializedEvent(path: string, data: string | undefined): string {
    const seq = this.allocateSeq(path)
    this.sql.exec(
      `INSERT INTO boring_event_stream_entries (path, seq, data) VALUES (?, ?, ?)`,
      path,
      seq,
      data,
    )
    return formatOffset(seq)
  }

  private allocateSeq(path: string): number {
    const updated = this.sql.exec(`
      UPDATE boring_event_streams
      SET next_offset = next_offset + 1
      WHERE path = ? AND closed = 0
      RETURNING next_offset
    `, path).toArray()

    if (updated.length === 0) this.throwMissingOrClosed(path)
    const row = updated[0]
    if (!row) throw new EventStreamStoreError(`Event stream "${path}" could not be updated.`)
    return (row.next_offset as number) - 1
  }

  private readIdempotencyKey(path: string, key: string): { seq: number; data: string } | null {
    const existing = this.sql.exec(
      `SELECT seq, data FROM boring_event_stream_keys WHERE path = ? AND idempotency_key = ?`,
      path,
      key,
    ).toArray()[0]
    if (!existing) return null
    return { seq: existing.seq as number, data: existing.data as string }
  }

  private assertSameAgentIdempotencyPayload(key: string, existingData: string, chunk: PiChatEvent): void {
    if (existingData !== JSON.stringify(chunk)) {
      throw new EventStreamStoreError(`Agent event key "${key}" already has a conflicting payload.`)
    }
  }

  private throwMissingOrClosed(path: string): never {
    const meta = this.getStreamMetaSync(path)
    if (!meta) throw new EventStreamStoreError(`Event stream "${path}" does not exist.`)
    throw new EventStreamStoreError(`Event stream "${path}" is closed.`)
  }

  private getStreamMetaSync(path: string): EventStreamMeta | null {
    const row = this.sql.exec(
      `SELECT next_offset, closed FROM boring_event_streams WHERE path = ?`,
      path,
    ).toArray()[0]
    if (!row) return null
    return {
      nextOffset: formatOffset((row.next_offset as number) - 1),
      closed: (row.closed as number) === 1,
    }
  }

  private notifyListeners(path: string): void {
    const bucket = this.listeners.get(path)
    if (!bucket) return
    for (const listener of [...bucket]) {
      try {
        listener()
      } catch {
        // Listener failures must not make committed writes appear failed.
      }
    }
  }
}

function clampLimit(value: number | undefined, defaultValue: number, maxValue: number): number {
  if (value === undefined) return defaultValue
  const normalized = Math.floor(value)
  if (!Number.isFinite(normalized) || normalized < 1) return defaultValue
  return Math.min(normalized, maxValue)
}
