import type postgres from 'postgres'
import type { Sha256Digest } from '@hachej/boring-agent/shared'

import { d1Digest, strictD1HostId, strictD1Ref } from './d1Plan.js'

const REVISION_RE = /^r\d{10}$/
const STATES = ['prepared', 'committed', 'aborted'] as const
export type D1DestructivePublicationState = typeof STATES[number]

export interface D1DestructivePublicationIdentity {
  readonly operationId: string
  readonly hostId: string
  readonly expectedRevision: string
  readonly expectedDigest: Sha256Digest
  readonly targetRevision: string
  readonly targetDigest: Sha256Digest
  readonly sourceRevision?: string | null
  readonly sourceDigest?: Sha256Digest | null
  readonly removalBindingIds: readonly string[]
}

export interface D1DestructivePublicationEvent extends D1DestructivePublicationIdentity {
  readonly sequence: bigint
  readonly state: D1DestructivePublicationState
  readonly recordedAt: Date
}

interface JournalRow {
  sequence: string | number | bigint
  operationId: string
  state: string
  hostId: string
  expectedRevision: string
  expectedDigest: string
  targetRevision: string
  targetDigest: string
  sourceRevision: string | null
  sourceDigest: string | null
  removalBindingIds: string[]
  recordedAt: Date
}
export interface D1DestructivePublicationOperation {
  readonly prepared: D1DestructivePublicationEvent
  readonly terminal?: D1DestructivePublicationEvent
}
export interface D1DestructivePublicationJournalStore {
  appendPrepared(sql: postgres.ReservedSql, identity: D1DestructivePublicationIdentity): Promise<D1DestructivePublicationEvent>
  appendTerminal(sql: postgres.ReservedSql, identity: D1DestructivePublicationIdentity, state: 'committed' | 'aborted'): Promise<D1DestructivePublicationEvent>
  readOperation(sql: postgres.ReservedSql, operationId: string): Promise<D1DestructivePublicationOperation | null>
  readPending(sql: postgres.ReservedSql, hostId: string): Promise<readonly D1DestructivePublicationEvent[]>
}
const STORE_ERROR_CODE = 'D1_DESTRUCTIVE_PUBLICATION_JOURNAL_STORE_FAILED'
class JournalStoreError extends Error { readonly code = STORE_ERROR_CODE }
function failed(): JournalStoreError { return new JournalStoreError(STORE_ERROR_CODE) }
function revision(value: unknown): string {
  if (typeof value !== 'string' || !REVISION_RE.test(value)) throw failed()
  return value
}
export function normalizeD1DestructivePublicationIdentity(raw: D1DestructivePublicationIdentity): D1DestructivePublicationIdentity {
  try {
    const expectedRevision = revision(raw.expectedRevision)
    const targetRevision = revision(raw.targetRevision)
    const sourceRevision = raw.sourceRevision ?? null
    const sourceDigest = raw.sourceDigest ?? null
    if (Number(targetRevision.slice(1)) <= Number(expectedRevision.slice(1))) throw failed()
    if ((sourceRevision === null) !== (sourceDigest === null)) throw failed()
    if (sourceRevision !== null && Number(revision(sourceRevision).slice(1)) >= Number(expectedRevision.slice(1))) throw failed()
    if (!Array.isArray(raw.removalBindingIds) || raw.removalBindingIds.length === 0) throw failed()
    const removalBindingIds = raw.removalBindingIds.map((value) => strictD1Ref(value, 'removalBindingIds'))
    const sorted = [...removalBindingIds].sort()
    if (new Set(removalBindingIds).size !== removalBindingIds.length || sorted.some((value, index) => value !== removalBindingIds[index])) throw failed()
    return Object.freeze({
      operationId: strictD1Ref(raw.operationId, 'operationId'), hostId: strictD1HostId(raw.hostId, 'hostId'),
      expectedRevision, expectedDigest: d1Digest(raw.expectedDigest, 'expectedDigest'),
      targetRevision, targetDigest: d1Digest(raw.targetDigest, 'targetDigest'),
      sourceRevision, sourceDigest: sourceDigest === null ? null : d1Digest(sourceDigest, 'sourceDigest'),
      removalBindingIds: Object.freeze(removalBindingIds),
    })
  } catch { throw failed() }
}
function parseRow(raw: JournalRow | undefined): D1DestructivePublicationEvent {
  if (!raw || !STATES.includes(raw.state as D1DestructivePublicationState) || !(raw.recordedAt instanceof Date)
    || !Number.isFinite(raw.recordedAt.getTime())) throw failed()
  let sequence: bigint
  try { sequence = BigInt(raw.sequence) } catch { throw failed() }
  if (sequence <= 0n) throw failed()
  const value = normalizeD1DestructivePublicationIdentity(raw as D1DestructivePublicationIdentity)
  return Object.freeze({ ...value, sequence, state: raw.state as D1DestructivePublicationState, recordedAt: new Date(raw.recordedAt) })
}
function same(left: D1DestructivePublicationIdentity, right: D1DestructivePublicationIdentity): boolean {
  return left.operationId === right.operationId && left.hostId === right.hostId
    && left.expectedRevision === right.expectedRevision && left.expectedDigest === right.expectedDigest
    && left.targetRevision === right.targetRevision && left.targetDigest === right.targetDigest
    && (left.sourceRevision ?? null) === (right.sourceRevision ?? null) && (left.sourceDigest ?? null) === (right.sourceDigest ?? null)
    && left.removalBindingIds.length === right.removalBindingIds.length
    && left.removalBindingIds.every((value, index) => value === right.removalBindingIds[index])
}
function operation(events: readonly D1DestructivePublicationEvent[]): D1DestructivePublicationOperation | null {
  if (events.length === 0) return null
  if (events.length > 2 || events[0]?.state !== 'prepared' || events[1]?.state === 'prepared'
    || events[1] && !same(events[0], events[1])) throw failed()
  return Object.freeze({ prepared: events[0]!, ...(events[1] ? { terminal: events[1] } : {}) })
}

export function createD1DestructivePublicationJournalStore(): D1DestructivePublicationJournalStore {
  const readOperation = async (sql: postgres.ReservedSql, rawOperationId: string) => {
    try {
      const operationId = strictD1Ref(rawOperationId, 'operationId')
      const rows = await sql<JournalRow[]>`
      SELECT sequence, operation_id AS "operationId", state, host_id AS "hostId",
        expected_revision AS "expectedRevision", expected_digest AS "expectedDigest",
        target_revision AS "targetRevision", target_digest AS "targetDigest",
        source_revision AS "sourceRevision", source_digest AS "sourceDigest",
        removal_binding_ids AS "removalBindingIds", recorded_at AS "recordedAt"
      FROM d1_destructive_publication_events WHERE operation_id = ${operationId} ORDER BY sequence
      `
      return operation(rows.map(parseRow))
    } catch { throw failed() }
  }
  const append = async (sql: postgres.ReservedSql, value: D1DestructivePublicationIdentity, state: D1DestructivePublicationState) => {
    await sql`
      INSERT INTO d1_destructive_publication_events
        (operation_id, state, host_id, expected_revision, expected_digest, target_revision, target_digest, source_revision, source_digest, removal_binding_ids)
      VALUES (${value.operationId}, ${state}, ${value.hostId}, ${value.expectedRevision}, ${value.expectedDigest},
        ${value.targetRevision}, ${value.targetDigest}, ${value.sourceRevision ?? null}, ${value.sourceDigest ?? null}, ${value.removalBindingIds as string[]})
      ON CONFLICT DO NOTHING
    `
  }
  const appendPrepared = async (sql: postgres.ReservedSql, raw: D1DestructivePublicationIdentity) => {
    try {
      const value = normalizeD1DestructivePublicationIdentity(raw); await append(sql, value, 'prepared')
      const existing = await readOperation(sql, value.operationId)
      if (!existing || !same(existing.prepared, value)) throw failed()
      return existing.prepared
    } catch { throw failed() }
  }
  const appendTerminal = async (sql: postgres.ReservedSql, raw: D1DestructivePublicationIdentity, state: 'committed' | 'aborted') => {
    try {
      const value = normalizeD1DestructivePublicationIdentity(raw); const before = await readOperation(sql, value.operationId)
      if (!before || !same(before.prepared, value)) throw failed()
      if (before.terminal) {
        if (before.terminal.state !== state) throw failed()
        return before.terminal
      }
      await append(sql, value, state)
      const after = await readOperation(sql, value.operationId)
      if (!after?.terminal || after.terminal.state !== state || !same(after.terminal, value)) throw failed()
      return after.terminal
    } catch { throw failed() }
  }
  const readPending = async (sql: postgres.ReservedSql, rawHostId: string) => {
    try {
      const hostId = strictD1HostId(rawHostId, 'hostId')
      const rows = await sql<JournalRow[]>`
        SELECT sequence, operation_id AS "operationId", state, host_id AS "hostId",
          expected_revision AS "expectedRevision", expected_digest AS "expectedDigest",
          target_revision AS "targetRevision", target_digest AS "targetDigest",
          source_revision AS "sourceRevision", source_digest AS "sourceDigest",
          removal_binding_ids AS "removalBindingIds", recorded_at AS "recordedAt"
        FROM d1_destructive_publication_events WHERE operation_id IN (
          SELECT operation_id FROM d1_destructive_publication_events WHERE host_id = ${hostId}
        ) ORDER BY sequence
      `
      const grouped = new Map<string, D1DestructivePublicationEvent[]>()
      for (const row of rows) {
        const event = parseRow(row); const events = grouped.get(event.operationId) ?? []
        events.push(event); grouped.set(event.operationId, events)
      }
      const pending: D1DestructivePublicationEvent[] = []
      for (const events of grouped.values()) {
        const current = operation(events)
        if (!current) throw failed()
        if (!current.terminal) pending.push(current.prepared)
      }
      return Object.freeze(pending)
    } catch { throw failed() }
  }
  return Object.freeze({ appendPrepared, appendTerminal, readOperation, readPending })
}
