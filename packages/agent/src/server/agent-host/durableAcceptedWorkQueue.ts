import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import type { DatabaseSync } from 'node:sqlite'
import type { JsonValue } from '../../shared/index'
import { cloneFrozenAcceptedWork } from './acceptedWork'
import type { AcceptedWorkContext } from './types'

const require = createRequire(import.meta.url)
/** In-memory membership distinguishes restart or abandoned handles from live handles. */
const liveOwnerIds = new Set<string>()

export type DurableAcceptedWorkState = 'queued' | 'claimed' | 'completed' | 'rejected' | 'outcome-unknown'

export interface DurableAcceptedWorkRecord {
  readonly id: string
  /** Audit provenance only. This value is never sufficient to execute work. */
  readonly acceptedWork: AcceptedWorkContext
  readonly request: JsonValue
  readonly admissionFingerprint: string
  readonly state: DurableAcceptedWorkState
  readonly updatedAt: number
  readonly terminalReason?: string
}

export interface FreshAcceptedWorkAdmission {
  readonly acceptedWork: AcceptedWorkContext
  readonly admissionFingerprint: string
}

/**
 * Internal durable queue for accepted work. Claiming always invokes the Host's
 * current authority resolver; persisted provenance is deliberately never used
 * as a bearer capability.
 */
export class DurableAcceptedWorkQueue {
  private readonly db: DatabaseSync
  private readonly ownerId = randomUUID()

  constructor(path: string) {
    liveOwnerIds.add(this.ownerId)
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
    this.db = new DatabaseSync(path)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS accepted_work_queue (
        id TEXT PRIMARY KEY,
        record_json TEXT NOT NULL,
        state TEXT NOT NULL,
        claim_token TEXT,
        claim_owner TEXT,
        updated_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS accepted_work_queue_state ON accepted_work_queue(state, updated_at, id);
    `)
    // Support databases created before claim ownership was recorded.
    const columns = this.db.prepare(`PRAGMA table_info(accepted_work_queue)`).all() as { name: string }[]
    if (!columns.some(({ name }) => name === 'claim_owner')) {
      this.db.exec(`ALTER TABLE accepted_work_queue ADD COLUMN claim_owner TEXT`)
    }
    // A prior process may have dispatched a claimed item before dying. Its
    // effect outcome cannot be inferred, so restart must never execute it again.
    // A second handle in this process must not mistake a live claim for restart.
    const claimed = this.db.prepare(`SELECT id, record_json, claim_owner FROM accepted_work_queue WHERE state = 'claimed'`).all() as
      { id: string; record_json: string; claim_owner: string | null }[]
    for (const row of claimed) {
      if (row.claim_owner && liveOwnerIds.has(row.claim_owner)) continue
      const current = parse(row.record_json)
      const now = Date.now()
      const unknown = { ...current, state: 'outcome-unknown' as const, updatedAt: now, terminalReason: 'process restarted while work was claimed' }
      this.db.prepare(`UPDATE accepted_work_queue SET record_json = ?, state = 'outcome-unknown', claim_token = NULL, claim_owner = NULL, updated_at = ? WHERE id = ? AND state = 'claimed' AND claim_owner IS ?`)
        .run(JSON.stringify(unknown), now, row.id, row.claim_owner)
    }
  }

  enqueue(input: {
    id: string
    acceptedWork: AcceptedWorkContext
    request: JsonValue
    admissionFingerprint: string
  }): DurableAcceptedWorkRecord {
    const id = required(input.id, 'queue id')
    const fingerprint = required(input.admissionFingerprint, 'admission fingerprint')
    const now = Date.now()
    const record: DurableAcceptedWorkRecord = deepFreeze({
      id,
      acceptedWork: cloneFrozenAcceptedWork(input.acceptedWork),
      request: structuredClone(input.request),
      admissionFingerprint: fingerprint,
      state: 'queued',
      updatedAt: now,
    })
    const result = this.db.prepare(`
      INSERT INTO accepted_work_queue(id, record_json, state, updated_at)
      VALUES (?, ?, 'queued', ?)
      ON CONFLICT(id) DO NOTHING
    `).run(id, JSON.stringify(record), now)
    if (result.changes === 0) {
      const existing = this.read(id)
      if (!existing || JSON.stringify(base(existing)) !== JSON.stringify(base(record))) {
        throw new Error('accepted-work queue id conflicts with different immutable request material')
      }
      return existing
    }
    return record
  }

  read(id: string): DurableAcceptedWorkRecord | undefined {
    const row = this.db.prepare('SELECT record_json FROM accepted_work_queue WHERE id = ?').get(id) as
      | { record_json: string }
      | undefined
    return row ? parse(row.record_json) : undefined
  }

  async claimNext(
    readmit: (record: DurableAcceptedWorkRecord) => Promise<FreshAcceptedWorkAdmission>,
  ): Promise<{ record: DurableAcceptedWorkRecord; claimToken: string } | undefined> {
    const candidate = this.db.prepare(`
      SELECT id, record_json FROM accepted_work_queue WHERE state = 'queued' ORDER BY updated_at, id LIMIT 1
    `).get() as { id: string; record_json: string } | undefined
    if (!candidate) return undefined
    const historical = parse(candidate.record_json)
    let fresh: FreshAcceptedWorkAdmission
    try {
      fresh = await readmit(historical)
      assertSameAuthority(historical, fresh)
    } catch (error) {
      this.terminal(candidate.id, 'rejected', safeReason(error))
      return undefined
    }
    const token = randomUUID()
    const now = Date.now()
    const claimed = { ...historical, state: 'claimed' as const, updatedAt: now }
    const changed = this.db.prepare(`
      UPDATE accepted_work_queue SET record_json = ?, state = 'claimed', claim_token = ?, claim_owner = ?, updated_at = ?
      WHERE id = ? AND state = 'queued'
    `).run(JSON.stringify(claimed), token, this.ownerId, now, candidate.id)
    return changed.changes === 1 ? { record: deepFreeze(claimed), claimToken: token } : undefined
  }

  complete(id: string, claimToken: string): void {
    this.finishClaim(id, claimToken, 'completed')
  }

  markOutcomeUnknown(id: string, claimToken: string, reason: string): void {
    this.finishClaim(id, claimToken, 'outcome-unknown', required(reason, 'outcome reason'))
  }

  /** Requeues only before execution begins; claimed work is otherwise fail-closed. */
  releaseBeforeExecution(id: string, claimToken: string): void {
    const record = this.requireClaim(id, claimToken)
    const now = Date.now()
    const queued = { ...record, state: 'queued' as const, updatedAt: now }
    this.db.prepare(`UPDATE accepted_work_queue SET record_json = ?, state = 'queued', claim_token = NULL, claim_owner = NULL, updated_at = ? WHERE id = ? AND claim_token = ? AND state = 'claimed'`)
      .run(JSON.stringify(queued), now, id, claimToken)
  }

  close(): void {
    // Closing a handle with dispatched work has the same uncertainty as process
    // loss. Record it before releasing the database connection.
    const claimed = this.db.prepare(`SELECT id, record_json FROM accepted_work_queue WHERE state = 'claimed' AND claim_owner = ?`)
      .all(this.ownerId) as { id: string; record_json: string }[]
    for (const row of claimed) {
      const current = parse(row.record_json)
      const now = Date.now()
      const unknown = { ...current, state: 'outcome-unknown' as const, updatedAt: now, terminalReason: 'queue closed while work was claimed' }
      this.db.prepare(`UPDATE accepted_work_queue SET record_json = ?, state = 'outcome-unknown', claim_token = NULL, claim_owner = NULL, updated_at = ? WHERE id = ? AND state = 'claimed' AND claim_owner = ?`)
        .run(JSON.stringify(unknown), now, row.id, this.ownerId)
    }
    this.db.close()
    liveOwnerIds.delete(this.ownerId)
  }

  private finishClaim(id: string, token: string, state: 'completed' | 'outcome-unknown', reason?: string): void {
    const record = this.requireClaim(id, token)
    const now = Date.now()
    const terminal = { ...record, state, updatedAt: now, ...(reason ? { terminalReason: reason } : {}) }
    const result = this.db.prepare(`UPDATE accepted_work_queue SET record_json = ?, state = ?, claim_token = NULL, claim_owner = NULL, updated_at = ? WHERE id = ? AND claim_token = ? AND state = 'claimed'`)
      .run(JSON.stringify(terminal), state, now, id, token)
    if (result.changes !== 1) throw new Error('accepted-work queue claim is stale')
  }

  private requireClaim(id: string, token: string): DurableAcceptedWorkRecord {
    const row = this.db.prepare(`SELECT record_json FROM accepted_work_queue WHERE id = ? AND claim_token = ? AND state = 'claimed'`).get(id, token) as { record_json: string } | undefined
    if (!row) throw new Error('accepted-work queue claim is stale')
    return parse(row.record_json)
  }

  private terminal(id: string, state: 'rejected', reason: string): void {
    const current = this.read(id)
    if (!current || current.state !== 'queued') return
    const now = Date.now()
    const record = { ...current, state, updatedAt: now, terminalReason: reason }
    this.db.prepare(`UPDATE accepted_work_queue SET record_json = ?, state = ?, updated_at = ? WHERE id = ? AND state = 'queued'`)
      .run(JSON.stringify(record), state, now, id)
  }
}

function assertSameAuthority(historical: DurableAcceptedWorkRecord, fresh: FreshAcceptedWorkAdmission): void {
  const current = cloneFrozenAcceptedWork(fresh.acceptedWork)
  const old = historical.acceptedWork
  // Readmission must reproduce the complete canonical accepted-work reference.
  // Comparing only the principal would allow operation, target, or request-key
  // drift to authorize different work.
  const same = JSON.stringify(current) === JSON.stringify(old)
    && fresh.admissionFingerprint === historical.admissionFingerprint
  if (!same) throw new Error('current host authority no longer matches accepted work')
}

function parse(json: string): DurableAcceptedWorkRecord {
  const value = JSON.parse(json) as DurableAcceptedWorkRecord
  return deepFreeze({ ...value, acceptedWork: cloneFrozenAcceptedWork(value.acceptedWork) })
}
function base(record: DurableAcceptedWorkRecord) {
  return { id: record.id, acceptedWork: record.acceptedWork, request: record.request, admissionFingerprint: record.admissionFingerprint }
}
function required(value: string, name: string): string {
  const normalized = value.trim()
  if (!normalized) throw new TypeError(`${name} is required`)
  return normalized
}
function safeReason(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 512) : 'fresh host readmission failed'
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}
