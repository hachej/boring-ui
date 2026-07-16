import type postgres from 'postgres'
import type { Sha256Digest } from '@hachej/boring-agent/shared'

import { agentHostDigest, strictAgentHostId, strictAgentHostRef } from './agentHostPlan.js'

const REVISION_RE = /^r\d{10}$/
const STATES = ['prepared', 'committed', 'aborted'] as const
export type AgentHostDestructivePublicationState = typeof STATES[number]

export interface AgentHostDestructivePublicationIdentity {
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

export interface AgentHostDestructivePublicationEvent extends AgentHostDestructivePublicationIdentity {
  readonly sequence: bigint
  readonly state: AgentHostDestructivePublicationState
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
export interface AgentHostDestructivePublicationOperation {
  readonly prepared: AgentHostDestructivePublicationEvent
  readonly terminal?: AgentHostDestructivePublicationEvent
}
export interface AgentHostDestructivePublicationJournalStore {
  appendPrepared(sql: postgres.ReservedSql, identity: AgentHostDestructivePublicationIdentity): Promise<AgentHostDestructivePublicationEvent>
  appendTerminal(sql: postgres.ReservedSql, identity: AgentHostDestructivePublicationIdentity, state: 'committed' | 'aborted'): Promise<AgentHostDestructivePublicationEvent>
  readOperation(sql: postgres.ReservedSql, operationId: string): Promise<AgentHostDestructivePublicationOperation | null>
  readPending(sql: postgres.ReservedSql, hostId: string): Promise<readonly AgentHostDestructivePublicationEvent[]>
}
const STORE_ERROR_CODE = 'AGENT_HOST_DESTRUCTIVE_PUBLICATION_JOURNAL_STORE_FAILED'
class JournalStoreError extends Error { readonly code = STORE_ERROR_CODE }
function failed(): JournalStoreError { return new JournalStoreError(STORE_ERROR_CODE) }
function revision(value: unknown): string {
  if (typeof value !== 'string' || !REVISION_RE.test(value)) throw failed()
  return value
}
export function normalizeAgentHostDestructivePublicationIdentity(raw: AgentHostDestructivePublicationIdentity): AgentHostDestructivePublicationIdentity {
  try {
    const expectedRevision = revision(raw.expectedRevision)
    const targetRevision = revision(raw.targetRevision)
    const sourceRevision = raw.sourceRevision ?? null
    const sourceDigest = raw.sourceDigest ?? null
    if (Number(targetRevision.slice(1)) <= Number(expectedRevision.slice(1))) throw failed()
    if ((sourceRevision === null) !== (sourceDigest === null)) throw failed()
    if (sourceRevision !== null && Number(revision(sourceRevision).slice(1)) >= Number(expectedRevision.slice(1))) throw failed()
    if (!Array.isArray(raw.removalBindingIds) || raw.removalBindingIds.length === 0) throw failed()
    const removalBindingIds = raw.removalBindingIds.map((value) => strictAgentHostRef(value, 'removalBindingIds'))
    const sorted = [...removalBindingIds].sort()
    if (new Set(removalBindingIds).size !== removalBindingIds.length || sorted.some((value, index) => value !== removalBindingIds[index])) throw failed()
    return Object.freeze({
      operationId: strictAgentHostRef(raw.operationId, 'operationId'), hostId: strictAgentHostId(raw.hostId, 'hostId'),
      expectedRevision, expectedDigest: agentHostDigest(raw.expectedDigest, 'expectedDigest'),
      targetRevision, targetDigest: agentHostDigest(raw.targetDigest, 'targetDigest'),
      sourceRevision, sourceDigest: sourceDigest === null ? null : agentHostDigest(sourceDigest, 'sourceDigest'),
      removalBindingIds: Object.freeze(removalBindingIds),
    })
  } catch { throw failed() }
}
function parseRow(raw: JournalRow | undefined): AgentHostDestructivePublicationEvent {
  if (!raw || !STATES.includes(raw.state as AgentHostDestructivePublicationState) || !(raw.recordedAt instanceof Date)
    || !Number.isFinite(raw.recordedAt.getTime())) throw failed()
  let sequence: bigint
  try { sequence = BigInt(raw.sequence) } catch { throw failed() }
  if (sequence <= 0n) throw failed()
  const value = normalizeAgentHostDestructivePublicationIdentity(raw as AgentHostDestructivePublicationIdentity)
  return Object.freeze({ ...value, sequence, state: raw.state as AgentHostDestructivePublicationState, recordedAt: new Date(raw.recordedAt) })
}
function same(left: AgentHostDestructivePublicationIdentity, right: AgentHostDestructivePublicationIdentity): boolean {
  return left.operationId === right.operationId && left.hostId === right.hostId
    && left.expectedRevision === right.expectedRevision && left.expectedDigest === right.expectedDigest
    && left.targetRevision === right.targetRevision && left.targetDigest === right.targetDigest
    && (left.sourceRevision ?? null) === (right.sourceRevision ?? null) && (left.sourceDigest ?? null) === (right.sourceDigest ?? null)
    && left.removalBindingIds.length === right.removalBindingIds.length
    && left.removalBindingIds.every((value, index) => value === right.removalBindingIds[index])
}
function operation(events: readonly AgentHostDestructivePublicationEvent[]): AgentHostDestructivePublicationOperation | null {
  if (events.length === 0) return null
  if (events.length > 2 || events[0]?.state !== 'prepared' || events[1]?.state === 'prepared'
    || events[1] && !same(events[0], events[1])) throw failed()
  return Object.freeze({ prepared: events[0]!, ...(events[1] ? { terminal: events[1] } : {}) })
}

export function createAgentHostDestructivePublicationJournalStore(): AgentHostDestructivePublicationJournalStore {
  const readOperation = async (sql: postgres.ReservedSql, rawOperationId: string) => {
    try {
      const operationId = strictAgentHostRef(rawOperationId, 'operationId')
      const rows = await sql<JournalRow[]>`
      SELECT sequence, operation_id AS "operationId", state, host_id AS "hostId",
        expected_revision AS "expectedRevision", expected_digest AS "expectedDigest",
        target_revision AS "targetRevision", target_digest AS "targetDigest",
        source_revision AS "sourceRevision", source_digest AS "sourceDigest",
        removal_binding_ids AS "removalBindingIds", recorded_at AS "recordedAt"
      FROM agent_host_destructive_publication_events WHERE operation_id = ${operationId} ORDER BY sequence
      `
      return operation(rows.map(parseRow))
    } catch { throw failed() }
  }
  const append = async (sql: postgres.ReservedSql, value: AgentHostDestructivePublicationIdentity, state: AgentHostDestructivePublicationState) => {
    await sql`
      INSERT INTO agent_host_destructive_publication_events
        (operation_id, state, host_id, expected_revision, expected_digest, target_revision, target_digest, source_revision, source_digest, removal_binding_ids)
      VALUES (${value.operationId}, ${state}, ${value.hostId}, ${value.expectedRevision}, ${value.expectedDigest},
        ${value.targetRevision}, ${value.targetDigest}, ${value.sourceRevision ?? null}, ${value.sourceDigest ?? null}, ${value.removalBindingIds as string[]})
      ON CONFLICT DO NOTHING
    `
  }
  const appendPrepared = async (sql: postgres.ReservedSql, raw: AgentHostDestructivePublicationIdentity) => {
    try {
      const value = normalizeAgentHostDestructivePublicationIdentity(raw); await append(sql, value, 'prepared')
      const existing = await readOperation(sql, value.operationId)
      if (!existing || !same(existing.prepared, value)) throw failed()
      return existing.prepared
    } catch { throw failed() }
  }
  const appendTerminal = async (sql: postgres.ReservedSql, raw: AgentHostDestructivePublicationIdentity, state: 'committed' | 'aborted') => {
    try {
      const value = normalizeAgentHostDestructivePublicationIdentity(raw); const before = await readOperation(sql, value.operationId)
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
      const hostId = strictAgentHostId(rawHostId, 'hostId')
      const rows = await sql<JournalRow[]>`
        SELECT sequence, operation_id AS "operationId", state, host_id AS "hostId",
          expected_revision AS "expectedRevision", expected_digest AS "expectedDigest",
          target_revision AS "targetRevision", target_digest AS "targetDigest",
          source_revision AS "sourceRevision", source_digest AS "sourceDigest",
          removal_binding_ids AS "removalBindingIds", recorded_at AS "recordedAt"
        FROM agent_host_destructive_publication_events WHERE operation_id IN (
          SELECT operation_id FROM agent_host_destructive_publication_events WHERE host_id = ${hostId}
        ) ORDER BY sequence
      `
      const grouped = new Map<string, AgentHostDestructivePublicationEvent[]>()
      for (const row of rows) {
        const event = parseRow(row); const events = grouped.get(event.operationId) ?? []
        events.push(event); grouped.set(event.operationId, events)
      }
      const pending: AgentHostDestructivePublicationEvent[] = []
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
