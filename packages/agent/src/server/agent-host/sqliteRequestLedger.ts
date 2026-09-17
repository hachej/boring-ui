import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import type { DatabaseSync } from 'node:sqlite'
import { AgentGatewayError, AgentGatewayErrorCode, type JsonValue } from '../../shared/index'
import { cloneFrozenAcceptedWork, createGatewayAcceptedWorkContext, projectAgentRequestRunId } from './acceptedWork'
import { canonicalDigest, canonicalJson, canonicalJsonValue } from './canonical'
import type {
  AcceptedWorkContext,
  AgentRequestFailure,
  AgentRequestKey,
  AgentRequestLedger,
  AgentRequestLedgerPrepareResult,
  AgentRequestLedgerRecord,
} from './types'

const require = createRequire(import.meta.url)
const SCHEMA_VERSION = 3
const DEFAULT_CLAIM_LEASE_MS = 30_000
const TERMINAL_STATES = ['rejected', 'completed', 'outcome-unknown'] as const

function keyString(key: AgentRequestKey): string {
  return JSON.stringify([
    key.workspaceScopeId,
    key.authSubjectId,
    key.operation,
    key.target.kind,
    key.target.kind === 'agent'
      ? key.target.agentTypeId
      : [key.target.ref.agentTypeId, key.target.ref.sessionId],
    key.requestId,
  ])
}

function conflict(message: string): never {
  throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT, message)
}

function safeBase(record: AgentRequestLedgerRecord, updatedAt: number) {
  return {
    key: record.key,
    acceptedWork: record.acceptedWork,
    digest: record.digest,
    ...(record.queuedRequest === undefined ? {} : { queuedRequest: record.queuedRequest }),
    updatedAt,
  }
}

function validateTarget(key: AgentRequestKey): void {
  const requiresAgent = key.operation === 'session.create' || key.operation === 'agent.reload'
  if ((requiresAgent && key.target.kind !== 'agent') || (!requiresAgent && key.target.kind !== 'session')) {
    throw new TypeError('request ledger effect/target mismatch')
  }
}

function sameAcceptedWork(left: AcceptedWorkContext, right: AcceptedWorkContext): boolean {
  return canonicalJson(left as unknown as JsonValue) === canonicalJson(right as unknown as JsonValue)
}

function settlementDigest(state: typeof TERMINAL_STATES[number], value: JsonValue): string {
  return canonicalDigest({ state, value })
}

export const MIN_REQUEST_RETENTION_MS = 24 * 60 * 60 * 1_000

export interface SqliteAgentRequestLedgerOptions {
  /** Terminal payload retention. Values below 24 hours are raised to the minimum. */
  readonly retentionMs?: number
  /** Injectable clock for deterministic storage tests. */
  readonly now?: () => number
  /** Claim expiry. Consumers heartbeat at one third of this duration. */
  readonly claimLeaseMs?: number
}

interface ActiveRow {
  readonly record_json: string
  readonly claim_owner: string | null
  readonly claim_token: string | null
  readonly lease_expires_at: number | null
  readonly settlement_digest: string | null
}

/** SQLite-backed atomic ownership, durable queue material, leasing, and settlement ledger. */
export class SqliteAgentRequestLedger implements AgentRequestLedger {
  readonly durability = 'durable-transactional' as const
  readonly claimLeaseMs: number
  private readonly database: DatabaseSync
  private readonly now: () => number
  private readonly retentionMs: number | undefined
  private readonly ownerId = randomUUID()

  constructor(path: string, options: SqliteAgentRequestLedgerOptions = {}) {
    if (path === ':memory:' || path.trim() === '' || /^file:/i.test(path)) {
      throw new TypeError('durable request ledger requires a filesystem SQLite path, not a SQLite URI or memory/temp database')
    }
    if (options.retentionMs !== undefined && (!Number.isFinite(options.retentionMs) || options.retentionMs < 0)) {
      throw new TypeError('request ledger retention must be a finite non-negative duration')
    }
    if (options.claimLeaseMs !== undefined && (!Number.isFinite(options.claimLeaseMs) || options.claimLeaseMs <= 0)) {
      throw new TypeError('request ledger claim lease must be a finite positive duration')
    }
    this.now = options.now ?? Date.now
    this.claimLeaseMs = options.claimLeaseMs ?? DEFAULT_CLAIM_LEASE_MS
    this.retentionMs = options.retentionMs === undefined
      ? undefined
      : Math.max(MIN_REQUEST_RETENTION_MS, options.retentionMs)
    const { DatabaseSync: SqliteDatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
    this.database = new SqliteDatabaseSync(path)
    try {
      this.database.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;')
      this.migrateSchema()
      this.immediateTransaction(() => this.recoverExpiredClaims(this.now()))
    } catch (error) {
      this.database.close()
      throw error
    }
  }

  async prepare(
    key: AgentRequestKey,
    digest: string,
    acceptedWork: AcceptedWorkContext,
    queuedRequest?: JsonValue,
  ): Promise<AgentRequestLedgerPrepareResult> {
    validateTarget(key)
    const frozenContext = cloneFrozenAcceptedWork(acceptedWork)
    const runId = projectAgentRequestRunId(key)
    if (runId !== frozenContext.identity.runId) throw new TypeError('accepted work does not match request key')
    const canonicalRequest = queuedRequest === undefined ? undefined : canonicalJsonValue(queuedRequest)
    if (canonicalRequest !== undefined && canonicalDigest(canonicalRequest) !== digest) {
      conflict('request digest does not match canonical queued material')
    }

    return this.immediateTransaction(() => {
      const now = this.now()
      this.recoverExpiredClaims(now)
      this.pruneExpiredTerminalRows(now)
      const id = keyString(key)
      const tombstone = this.readTombstoneSync(key)
      if (tombstone) {
        if (tombstone.digest !== digest) conflict('requestId was already used with a different payload')
        return { ownership: 'existing', record: tombstone.record }
      }
      const claimToken = randomUUID()
      const record: AgentRequestLedgerRecord = {
        key: structuredClone(key),
        acceptedWork: frozenContext,
        digest,
        ...(canonicalRequest === undefined ? {} : { queuedRequest: canonicalRequest }),
        state: 'pending-admission',
        updatedAt: now,
      }
      const inserted = this.database.prepare(`
        INSERT OR IGNORE INTO agent_request_ledger
          (request_key, run_id, digest, state, record_json, updated_at, claim_owner, claim_token, lease_expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, runId, digest, record.state, JSON.stringify(record), now, this.ownerId, claimToken, now + this.claimLeaseMs)
      const current = this.readActiveRowSync(key)
      if (!current) conflict('request ledger ownership claim was not persisted')
      const currentRecord = this.parseRecord(current.record_json)
      if (currentRecord.digest !== digest) conflict('requestId was already used with a different payload')
      if (canonicalRequest !== undefined && currentRecord.queuedRequest !== undefined
        && canonicalJson(currentRecord.queuedRequest) !== canonicalJson(canonicalRequest)) {
        conflict('requestId was already used with different canonical queued material')
      }
      if (inserted.changes === 1) return { ownership: 'created', claimToken, record: currentRecord }

      const reclaimable = currentRecord.state === 'pending-admission'
        ? currentRecord.retryable === true || current.lease_expires_at === null || current.lease_expires_at <= now
        : currentRecord.state === 'admission-accepted'
          && (current.lease_expires_at === null || current.lease_expires_at <= now)
      if (!reclaimable) return { ownership: 'existing', record: currentRecord }
      if (!sameAcceptedWork(currentRecord.acceptedWork, frozenContext)) {
        conflict('fresh admission no longer matches retained accepted work')
      }
      const reclaimed: AgentRequestLedgerRecord = { ...safeBase(currentRecord, now), state: 'pending-admission' }
      const replacementToken = randomUUID()
      const claimed = this.database.prepare(`
        UPDATE agent_request_ledger
        SET record_json = ?, updated_at = ?, claim_owner = ?, claim_token = ?, lease_expires_at = ?
        WHERE request_key = ? AND digest = ? AND record_json = ?
          AND (lease_expires_at IS NULL OR lease_expires_at <= ? OR state = 'pending-admission')
      `).run(JSON.stringify(reclaimed), now, this.ownerId, replacementToken, now + this.claimLeaseMs, id, digest, current.record_json, now)
      if (claimed.changes === 1) return { ownership: 'reclaimed', claimToken: replacementToken, record: reclaimed }
      const winner = this.readActiveSync(key)
      if (!winner) conflict('request ledger ownership claim was not persisted')
      return { ownership: 'existing', record: winner }
    })
  }

  async heartbeat(key: AgentRequestKey, claimToken: string): Promise<void> {
    this.immediateTransaction(() => {
      const now = this.now()
      const result = this.database.prepare(`
        UPDATE agent_request_ledger SET lease_expires_at = ?, updated_at = updated_at
        WHERE request_key = ? AND claim_owner = ? AND claim_token = ?
          AND state IN ('pending-admission', 'admission-accepted', 'in-flight')
          AND lease_expires_at >= ?
      `).run(now + this.claimLeaseMs, keyString(key), this.ownerId, claimToken, now)
      if (result.changes !== 1) conflict('request ledger claim is stale')
    })
  }

  async markAdmissionRetryable(key: AgentRequestKey, claimToken: string): Promise<void> {
    this.transition(key, claimToken, ['pending-admission'], (record) => {
      if (record.state !== 'pending-admission' || record.retryable) conflict('request admission is already retryable')
      return { ...safeBase(record, this.now()), state: 'pending-admission', retryable: true }
    }, true)
  }

  async acceptAdmission(key: AgentRequestKey, claimToken: string, admissionReceipt: string): Promise<void> {
    this.transition(key, claimToken, ['pending-admission'], (record) => {
      if (record.state !== 'pending-admission' || record.retryable) conflict('request admission must be claimed before accepting')
      return { ...safeBase(record, this.now()), state: 'admission-accepted', admissionReceipt }
    })
  }

  async beginEffect(key: AgentRequestKey, claimToken: string): Promise<void> {
    this.transition(key, claimToken, ['admission-accepted'], (record) => ({
      ...safeBase(record, this.now()), state: 'in-flight',
    }))
  }

  async reject(key: AgentRequestKey, claimToken: string, failure: AgentRequestFailure): Promise<void> {
    const value = canonicalJsonValue(failure as unknown as JsonValue)
    this.settle(key, claimToken, failure.kind === 'gateway' ? ['pending-admission', 'admission-accepted', 'in-flight'] : ['in-flight'], 'rejected', value, (record, digest) => ({
      ...safeBase(record, this.now()), state: 'rejected', failure: value as unknown as AgentRequestFailure, settlementDigest: digest,
    }))
  }

  async complete(key: AgentRequestKey, claimToken: string, receipt: JsonValue): Promise<void> {
    const value = canonicalJsonValue(receipt)
    this.settle(key, claimToken, ['in-flight'], 'completed', value, (record, digest) => ({
      ...safeBase(record, this.now()), state: 'completed', receipt: value, settlementDigest: digest,
    }))
  }

  async markOutcomeUnknown(key: AgentRequestKey, claimToken: string, error: import('../../shared/index').AgentGatewayErrorDTO): Promise<void> {
    const value = canonicalJsonValue(error as unknown as JsonValue)
    this.settle(key, claimToken, ['in-flight'], 'outcome-unknown', value, (record, digest) => ({
      ...safeBase(record, this.now()), state: 'outcome-unknown', error: value as unknown as import('../../shared/index').AgentGatewayErrorDTO, settlementDigest: digest,
    }))
  }

  async read(key: AgentRequestKey): Promise<AgentRequestLedgerRecord | undefined> {
    return this.immediateTransaction(() => {
      const now = this.now()
      this.recoverExpiredClaims(now)
      this.pruneExpiredTerminalRows(now)
      return this.readSync(key)
    })
  }

  close(): void {
    this.database.close()
  }

  private migrateSchema(): void {
    this.immediateTransaction(() => {
      const version = (this.database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
      if (version > SCHEMA_VERSION) throw new Error(`request ledger schema ${version} is newer than supported schema ${SCHEMA_VERSION}`)
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS agent_request_ledger (
          request_key TEXT PRIMARY KEY,
          run_id TEXT,
          digest TEXT NOT NULL,
          state TEXT NOT NULL,
          record_json TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          claim_owner TEXT,
          claim_token TEXT,
          lease_expires_at INTEGER,
          settlement_digest TEXT
        );
        CREATE TABLE IF NOT EXISTS agent_request_tombstones (
          request_key TEXT PRIMARY KEY,
          digest TEXT NOT NULL,
          key_json TEXT NOT NULL,
          pruned_at INTEGER NOT NULL,
          settlement_digest TEXT
        );
      `)
      this.ensureColumns('agent_request_ledger', [
        ['run_id', 'TEXT'], ['claim_owner', 'TEXT'], ['claim_token', 'TEXT'], ['lease_expires_at', 'INTEGER'], ['settlement_digest', 'TEXT'],
      ])
      this.ensureColumns('agent_request_tombstones', [['settlement_digest', 'TEXT']])
      const active = this.database.prepare('SELECT request_key, record_json, settlement_digest FROM agent_request_ledger').all() as Array<{
        request_key: string
        record_json: string
        settlement_digest: string | null
      }>
      for (const row of active) {
        const decoded = JSON.parse(row.record_json) as Record<string, unknown> & { key: AgentRequestKey; state?: string; settlementDigest?: string }
        if (decoded.acceptedWork === undefined) {
          const agentTypeId = decoded.key.target.kind === 'agent' ? decoded.key.target.agentTypeId : decoded.key.target.ref.agentTypeId
          decoded.acceptedWork = createGatewayAcceptedWorkContext({ key: decoded.key, admittedAgentTypeId: agentTypeId })
        } else decoded.acceptedWork = cloneFrozenAcceptedWork(decoded.acceptedWork)
        if (decoded.queuedRequest !== undefined) decoded.queuedRequest = canonicalJsonValue(decoded.queuedRequest as JsonValue)
        let digest = row.settlement_digest
        if (decoded.state === 'completed' || decoded.state === 'rejected' || decoded.state === 'outcome-unknown') {
          const value = decoded.state === 'completed' ? decoded.receipt : decoded.state === 'rejected' ? decoded.failure : decoded.error
          const derived = settlementDigest(decoded.state, canonicalJsonValue(value as JsonValue))
          if ((digest !== null && digest !== derived) || (decoded.settlementDigest !== undefined && decoded.settlementDigest !== derived)) {
            throw new Error(`request ledger settlement digest mismatch for ${row.request_key}`)
          }
          digest = derived
          decoded.settlementDigest = derived
        }
        const migrated = JSON.stringify(decoded)
        this.database.prepare('UPDATE agent_request_ledger SET record_json = ?, run_id = ?, settlement_digest = ? WHERE request_key = ?')
          .run(migrated, projectAgentRequestRunId(decoded.key), digest, row.request_key)
      }
      const tombstones = this.database.prepare('SELECT request_key, key_json FROM agent_request_tombstones').all() as Array<{ request_key: string; key_json: string }>
      for (const row of tombstones) {
        const decoded = JSON.parse(row.key_json) as AgentRequestKey | { key: AgentRequestKey; acceptedWork?: unknown }
        const key = 'key' in decoded ? decoded.key : decoded
        const existing = 'key' in decoded ? decoded.acceptedWork : undefined
        const agentTypeId = key.target.kind === 'agent' ? key.target.agentTypeId : key.target.ref.agentTypeId
        const acceptedWork = existing === undefined ? createGatewayAcceptedWorkContext({ key, admittedAgentTypeId: agentTypeId }) : cloneFrozenAcceptedWork(existing)
        this.database.prepare('UPDATE agent_request_tombstones SET key_json = ? WHERE request_key = ?')
          .run(JSON.stringify({ key, acceptedWork }), row.request_key)
      }
      this.database.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS agent_request_ledger_run_id ON agent_request_ledger(run_id);
        PRAGMA user_version = ${SCHEMA_VERSION};
      `)
    })
  }

  private ensureColumns(table: string, columns: ReadonlyArray<readonly [string, string]>): void {
    const existing = new Set((this.database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(({ name }) => name))
    for (const [name, type] of columns) {
      if (!existing.has(name)) this.database.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`)
    }
  }

  private recoverExpiredClaims(now: number): void {
    const rows = this.database.prepare(`
      SELECT request_key, state, record_json FROM agent_request_ledger
      WHERE state IN ('pending-admission', 'admission-accepted', 'in-flight')
        AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
    `).all(now) as Array<{ request_key: string; state: 'pending-admission' | 'admission-accepted' | 'in-flight'; record_json: string }>
    for (const row of rows) {
      const current = this.parseRecord(row.record_json)
      if (row.state !== 'in-flight') {
        const record: AgentRequestLedgerRecord = {
          ...safeBase(current, now), state: 'pending-admission', retryable: true,
        }
        this.database.prepare(`
          UPDATE agent_request_ledger
          SET state = 'pending-admission', record_json = ?, updated_at = ?, claim_owner = NULL,
              claim_token = NULL, lease_expires_at = NULL, settlement_digest = NULL
          WHERE request_key = ? AND state = ? AND record_json = ?
            AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
        `).run(JSON.stringify(record), now, row.request_key, row.state, row.record_json, now)
        continue
      }
      const error = {
        code: AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN,
        message: 'request claim lease expired before its effect outcome was settled',
      }
      const digest = settlementDigest('outcome-unknown', error)
      const record: AgentRequestLedgerRecord = {
        ...safeBase(current, now), state: 'outcome-unknown', error, settlementDigest: digest,
      }
      this.database.prepare(`
        UPDATE agent_request_ledger
        SET state = 'outcome-unknown', record_json = ?, updated_at = ?, claim_owner = NULL,
            claim_token = NULL, lease_expires_at = NULL, settlement_digest = ?
        WHERE request_key = ? AND state = 'in-flight' AND record_json = ?
          AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
      `).run(JSON.stringify(record), now, digest, row.request_key, row.record_json, now)
    }
  }

  private readSync(key: AgentRequestKey): AgentRequestLedgerRecord | undefined {
    return this.readActiveSync(key) ?? this.readTombstoneSync(key)?.record
  }

  private readActiveRowSync(key: AgentRequestKey): ActiveRow | undefined {
    return this.database.prepare(`
      SELECT record_json, claim_owner, claim_token, lease_expires_at, settlement_digest FROM agent_request_ledger WHERE request_key = ?
    `).get(keyString(key)) as ActiveRow | undefined
  }

  private readActiveSync(key: AgentRequestKey): AgentRequestLedgerRecord | undefined {
    const row = this.readActiveRowSync(key)
    return row ? this.parseRecord(row.record_json) : undefined
  }

  private parseRecord(json: string): AgentRequestLedgerRecord {
    const record = JSON.parse(json) as AgentRequestLedgerRecord
    return Object.freeze({
      ...record,
      acceptedWork: cloneFrozenAcceptedWork(record.acceptedWork),
      ...(record.queuedRequest === undefined ? {} : { queuedRequest: canonicalJsonValue(record.queuedRequest) }),
    }) as AgentRequestLedgerRecord
  }

  private readTombstoneSync(key: AgentRequestKey): {
    readonly digest: string
    readonly settlementDigest: string | null
    readonly record: AgentRequestLedgerRecord
  } | undefined {
    const row = this.database.prepare(`
      SELECT digest, key_json, pruned_at, settlement_digest FROM agent_request_tombstones WHERE request_key = ?
    `).get(keyString(key)) as { digest: string; key_json: string; pruned_at: number; settlement_digest: string | null } | undefined
    if (!row) return undefined
    const retained = JSON.parse(row.key_json) as Pick<AgentRequestLedgerRecord, 'key' | 'acceptedWork'>
    return {
      digest: row.digest,
      settlementDigest: row.settlement_digest,
      record: {
        key: retained.key,
        acceptedWork: cloneFrozenAcceptedWork(retained.acceptedWork),
        digest: row.digest,
        state: 'outcome-unknown',
        error: {
          code: AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN,
          message: 'request result expired from the retention window',
        },
        ...(row.settlement_digest ? { settlementDigest: row.settlement_digest } : {}),
        updatedAt: row.pruned_at,
      },
    }
  }

  private pruneExpiredTerminalRows(now: number): void {
    if (this.retentionMs === undefined) return
    const cutoff = now - this.retentionMs
    const placeholders = TERMINAL_STATES.map(() => '?').join(', ')
    this.database.prepare(`
      INSERT OR IGNORE INTO agent_request_tombstones (request_key, digest, key_json, pruned_at, settlement_digest)
      SELECT request_key, digest, json_object(
        'key', json_extract(record_json, '$.key'),
        'acceptedWork', json_extract(record_json, '$.acceptedWork')
      ), ?, settlement_digest
      FROM agent_request_ledger
      WHERE state IN (${placeholders}) AND updated_at < ?
    `).run(now, ...TERMINAL_STATES, cutoff)
    this.database.prepare(`
      DELETE FROM agent_request_ledger
      WHERE state IN (${placeholders}) AND updated_at < ?
        AND EXISTS (
          SELECT 1 FROM agent_request_tombstones tombstone
          WHERE tombstone.request_key = agent_request_ledger.request_key
            AND tombstone.digest = agent_request_ledger.digest
        )
    `).run(...TERMINAL_STATES, cutoff)
  }

  private settle(
    key: AgentRequestKey,
    claimToken: string,
    expectedStates: readonly AgentRequestLedgerRecord['state'][],
    state: typeof TERMINAL_STATES[number],
    value: JsonValue,
    update: (record: AgentRequestLedgerRecord, digest: string) => AgentRequestLedgerRecord,
  ): void {
    this.immediateTransaction(() => {
      const now = this.now()
      this.recoverExpiredClaims(now)
      const digest = settlementDigest(state, value)
      const currentRow = this.readActiveRowSync(key)
      if (!currentRow) {
        const tombstone = this.readTombstoneSync(key)
        if (tombstone?.settlementDigest === digest) return
        conflict('request ledger settlement conflicts with retained outcome')
      }
      const current = this.parseRecord(currentRow.record_json)
      if (TERMINAL_STATES.includes(current.state as typeof TERMINAL_STATES[number])) {
        if ((current as Extract<AgentRequestLedgerRecord, { state: 'rejected' | 'completed' | 'outcome-unknown' }>).settlementDigest === digest) return
        conflict('request ledger settlement conflicts with existing outcome')
      }
      if (!expectedStates.includes(current.state)) conflict(`request ledger cannot transition from ${current.state}`)
      if (currentRow.claim_owner !== this.ownerId || currentRow.claim_token !== claimToken || currentRow.lease_expires_at === null || currentRow.lease_expires_at < now) {
        conflict('request ledger claim is stale')
      }
      const next = update(current, digest)
      const result = this.database.prepare(`
        UPDATE agent_request_ledger
        SET state = ?, record_json = ?, updated_at = ?, claim_owner = NULL, claim_token = NULL,
            lease_expires_at = NULL, settlement_digest = ?
        WHERE request_key = ? AND record_json = ? AND claim_owner = ? AND claim_token = ? AND lease_expires_at >= ?
      `).run(state, JSON.stringify(next), next.updatedAt, digest, keyString(key), currentRow.record_json, this.ownerId, claimToken, now)
      if (result.changes !== 1) conflict('request ledger settlement lost its compare-and-swap race')
    })
  }

  private immediateTransaction<T>(run: () => T): T {
    let attempts = 0
    while (true) {
      try {
        this.database.exec('BEGIN IMMEDIATE')
        break
      } catch (error) {
        if (!isBusy(error) || attempts >= 5) throw error
        attempts += 1
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, attempts * 10)
      }
    }
    try {
      const result = run()
      this.database.exec('COMMIT')
      return result
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  private transition(
    key: AgentRequestKey,
    claimToken: string,
    expectedStates: readonly AgentRequestLedgerRecord['state'][],
    update: (record: AgentRequestLedgerRecord) => AgentRequestLedgerRecord,
    release = false,
  ): void {
    this.immediateTransaction(() => {
      const now = this.now()
      this.recoverExpiredClaims(now)
      const row = this.readActiveRowSync(key)
      const current = row && this.parseRecord(row.record_json)
      if (!row || !current || !expectedStates.includes(current.state)) {
        conflict(`request ledger cannot transition from ${current?.state ?? 'missing'}`)
      }
      if (row.claim_owner !== this.ownerId || row.claim_token !== claimToken || row.lease_expires_at === null || row.lease_expires_at < now) {
        conflict('request ledger claim is stale')
      }
      const next = update(current)
      const result = this.database.prepare(`
        UPDATE agent_request_ledger
        SET state = ?, record_json = ?, updated_at = ?,
            claim_owner = ?, claim_token = ?, lease_expires_at = ?
        WHERE request_key = ? AND digest = ? AND record_json = ?
          AND claim_owner = ? AND claim_token = ? AND lease_expires_at >= ?
      `).run(
        next.state, JSON.stringify(next), next.updatedAt,
        release ? null : this.ownerId, release ? null : claimToken, release ? null : now + this.claimLeaseMs,
        keyString(key), current.digest, row.record_json, this.ownerId, claimToken, now,
      )
      if (result.changes !== 1) conflict('request ledger transition lost its compare-and-swap race')
    })
  }
}

function isBusy(error: unknown): boolean {
  return error instanceof Error && /SQLITE_BUSY|database is locked/i.test(`${(error as { code?: string }).code ?? ''} ${error.message}`)
}
