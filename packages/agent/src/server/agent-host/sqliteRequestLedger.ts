import { DatabaseSync } from 'node:sqlite'
import { AgentGatewayError, AgentGatewayErrorCode } from '../../shared/index'
import type {
  AgentRequestFailure,
  AgentRequestKey,
  AgentRequestLedger,
  AgentRequestLedgerPrepareResult,
  AgentRequestLedgerRecord,
} from './types'

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

function validateTarget(key: AgentRequestKey): void {
  const requiresAgent = key.operation === 'session.create' || key.operation === 'agent.reload'
  if ((requiresAgent && key.target.kind !== 'agent') || (!requiresAgent && key.target.kind !== 'session')) {
    throw new TypeError('request ledger effect/target mismatch')
  }
}

/** SQLite-backed atomic ownership/CAS ledger for direct and production projections. */
export class SqliteAgentRequestLedger implements AgentRequestLedger {
  readonly durability = 'durable-transactional' as const
  private readonly database: DatabaseSync

  constructor(path: string) {
    this.database = new DatabaseSync(path)
    this.database.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;')
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS agent_request_ledger (
        request_key TEXT PRIMARY KEY,
        digest TEXT NOT NULL,
        state TEXT NOT NULL,
        record_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)
  }

  async prepare(key: AgentRequestKey, digest: string): Promise<AgentRequestLedgerPrepareResult> {
    validateTarget(key)
    const id = keyString(key)
    const record: AgentRequestLedgerRecord = {
      key,
      digest,
      state: 'pending-admission',
      updatedAt: Date.now(),
    }
    const inserted = this.database.prepare(`
      INSERT OR IGNORE INTO agent_request_ledger
        (request_key, digest, state, record_json, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, digest, record.state, JSON.stringify(record), record.updatedAt)
    const current = this.readSync(key)
    if (!current) conflict('request ledger ownership claim was not persisted')
    if (current.digest !== digest) {
      conflict('requestId was already used with a different payload')
    }
    return { ownership: inserted.changes === 1 ? 'created' : 'existing', record: current }
  }

  async acceptAdmission(key: AgentRequestKey, admissionReceipt: string): Promise<void> {
    this.transition(key, ['pending-admission'], (record) => ({
      ...record,
      state: 'admission-accepted',
      admissionReceipt,
      updatedAt: Date.now(),
    }))
  }

  async beginEffect(key: AgentRequestKey): Promise<void> {
    this.transition(key, ['admission-accepted'], (record) => ({
      key: record.key,
      digest: record.digest,
      state: 'in-flight',
      updatedAt: Date.now(),
    }))
  }

  async reject(key: AgentRequestKey, failure: AgentRequestFailure): Promise<void> {
    this.transition(key, [failure.kind === 'gateway' ? 'pending-admission' : 'in-flight'], (record) => ({
      key: record.key,
      digest: record.digest,
      state: 'rejected',
      failure,
      updatedAt: Date.now(),
    }))
  }

  async complete(key: AgentRequestKey, receipt: import('../../shared/index').JsonValue): Promise<void> {
    this.transition(key, ['in-flight'], (record) => ({
      key: record.key,
      digest: record.digest,
      state: 'completed',
      receipt,
      updatedAt: Date.now(),
    }))
  }

  async markOutcomeUnknown(
    key: AgentRequestKey,
    error: import('../../shared/index').AgentGatewayErrorDTO,
  ): Promise<void> {
    this.transition(key, ['in-flight'], (record) => ({
      key: record.key,
      digest: record.digest,
      state: 'outcome-unknown',
      error,
      updatedAt: Date.now(),
    }))
  }

  async read(key: AgentRequestKey): Promise<AgentRequestLedgerRecord | undefined> {
    return this.readSync(key)
  }

  close(): void {
    this.database.close()
  }

  private readSync(key: AgentRequestKey): AgentRequestLedgerRecord | undefined {
    const row = this.database.prepare(`
      SELECT record_json FROM agent_request_ledger WHERE request_key = ?
    `).get(keyString(key)) as { record_json: string } | undefined
    return row ? JSON.parse(row.record_json) as AgentRequestLedgerRecord : undefined
  }

  private transition(
    key: AgentRequestKey,
    expectedStates: readonly AgentRequestLedgerRecord['state'][],
    update: (record: AgentRequestLedgerRecord) => AgentRequestLedgerRecord,
  ): void {
    const current = this.readSync(key)
    if (!current || !expectedStates.includes(current.state)) {
      conflict(`request ledger cannot transition from ${current?.state ?? 'missing'}`)
    }
    const next = update(current)
    const placeholders = expectedStates.map(() => '?').join(', ')
    const result = this.database.prepare(`
      UPDATE agent_request_ledger
      SET state = ?, record_json = ?, updated_at = ?
      WHERE request_key = ? AND digest = ? AND state IN (${placeholders})
    `).run(
      next.state,
      JSON.stringify(next),
      next.updatedAt,
      keyString(key),
      current.digest,
      ...expectedStates,
    )
    if (result.changes !== 1) conflict('request ledger transition lost its compare-and-swap race')
  }
}
