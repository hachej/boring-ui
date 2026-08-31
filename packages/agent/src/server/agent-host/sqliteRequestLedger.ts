import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import type { DatabaseSync } from 'node:sqlite'
import { AgentGatewayError, AgentGatewayErrorCode } from '../../shared/index'

const require = createRequire(import.meta.url)
import type {
  AgentRequestFailure,
  AgentRequestKey,
  AgentRequestLedger,
  AgentRequestLedgerPrepareResult,
  AgentRequestLedgerRecord,
  AgentAttentionLedgerChange,
  AgentAttentionLedgerRecord,
  AgentAttentionStatus,
  AgentEffectLedgerRecord,
  AgentLedgerNonTerminalFilter,
  AgentLedgerNonTerminalRecord,
  AgentLedgerRestartReconciliation,
  AgentTurnLedgerRecord,
} from './types'

const LEDGER_SCHEMA_VERSION = 1

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
  private incarnation = 'unclaimed'
  private readonly attentionListeners = new Set<(change: AgentAttentionLedgerChange) => void>()

  readonly attention = {
    create: async (record: AgentAttentionLedgerRecord) => this.createAttention(record),
    get: async (attentionId: string) => this.readAttention(attentionId),
    list: async (input?: { sessionId?: string; statuses?: readonly AgentAttentionStatus[] }) => this.listAttention(input),
    transition: async (
      attentionId: string,
      expected: readonly AgentAttentionStatus[],
      update: (record: AgentAttentionLedgerRecord) => AgentAttentionLedgerRecord,
    ) => this.transitionAttention(attentionId, expected, update),
    appendTranscriptEventIfMissing: async (
      attentionId: string,
      event: import('../../shared/index').JsonValue,
      matches: (event: import('../../shared/index').JsonValue) => boolean,
    ) => this.appendAttentionTranscriptEventIfMissing(attentionId, event, matches),
    resolveLegacySession: async (sessionId: string) => this.resolveLegacySession(sessionId),
    importOnce: async (records: readonly AgentAttentionLedgerRecord[]) => this.importAttentionOnce(records),
    subscribe: (listener: (change: AgentAttentionLedgerChange) => void) => {
      this.attentionListeners.add(listener)
      return () => this.attentionListeners.delete(listener)
    },
  }

  constructor(path: string) {
    const { DatabaseSync: SqliteDatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
    this.database = new SqliteDatabaseSync(path)
    this.database.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;')
    this.migrate()
  }

  async prepare(key: AgentRequestKey, digest: string, replayPayload?: import('../../shared/index').JsonValue): Promise<AgentRequestLedgerPrepareResult> {
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
        (request_key, digest, state, operation, workspace_scope_id, incarnation, lease_until, replay_payload_json, record_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
    `).run(
      id,
      digest,
      record.state,
      key.operation,
      key.workspaceScopeId,
      this.incarnation,
      replayPayload === undefined ? null : JSON.stringify(replayPayload),
      JSON.stringify({ ...record, incarnation: this.incarnation }),
      record.updatedAt,
    )
    const current = this.readSync(key)
    if (!current) conflict('request ledger ownership claim was not persisted')
    if (current.digest !== digest) {
      conflict('requestId was already used with a different payload')
    }
    return { ownership: inserted.changes === 1 ? 'created' : 'existing', record: current }
  }

  async readReplayPayload(key: AgentRequestKey): Promise<import('../../shared/index').JsonValue | undefined> {
    const row = this.database.prepare(`SELECT replay_payload_json FROM agent_request_ledger WHERE request_key = ?`)
      .get(keyString(key)) as { replay_payload_json: string | null } | undefined
    return row?.replay_payload_json ? JSON.parse(row.replay_payload_json) as import('../../shared/index').JsonValue : undefined
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
    this.transition(key, [
      ...(failure.kind === 'gateway' ? ['pending-admission', 'admission-accepted'] as const : []),
      'in-flight',
    ], (record) => ({
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

  async claimIncarnation(): Promise<string> {
    const incarnation = randomUUID()
    this.database.prepare(`
      INSERT INTO ledger_meta (key, value) VALUES ('current_incarnation', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(incarnation)
    this.incarnation = incarnation
    return incarnation
  }

  async reconcileAfterRestart(incarnation: string): Promise<AgentLedgerRestartReconciliation> {
    const result: AgentLedgerRestartReconciliation = {
      requestsOutcomeUnknown: 0,
      requestsReset: 0,
      turnsOutcomeUnknown: 0,
      effectsOutcomeUnknown: 0,
      parked: 0,
    }
    this.transaction(() => {
      const requests = this.database.prepare(`
        SELECT request_key, state, record_json
        FROM agent_request_ledger
        WHERE incarnation <> ? AND state IN ('pending-admission', 'admission-accepted', 'in-flight')
      `).all(incarnation) as Array<{ request_key: string; state: string; record_json: string }>
      for (const row of requests) {
        if (row.state === 'pending-admission') continue
        if (row.state === 'admission-accepted') {
          const record = JSON.parse(row.record_json) as AgentRequestLedgerRecord
          const next = { key: record.key, digest: record.digest, state: 'pending-admission' as const, updatedAt: Date.now() }
          this.database.prepare(`
            UPDATE agent_request_ledger
            SET state = 'pending-admission', incarnation = ?, lease_until = NULL, record_json = ?, updated_at = ?
            WHERE request_key = ? AND state = 'admission-accepted'
          `).run(incarnation, JSON.stringify({ ...next, incarnation }), next.updatedAt, row.request_key)
          ;(result as { requestsReset: number }).requestsReset += 1
          continue
        }
        const parked = this.database.prepare(`
          SELECT 1 FROM agent_effect_ledger effect
          JOIN agent_attention_ledger attention ON attention.run_key = effect.run_key
          WHERE effect.run_key = ? AND effect.effect_class = 'pause' AND effect.state = 'paused'
            AND attention.status IN ('ready', 'answered')
          LIMIT 1
        `).get(row.request_key)
        if (parked) {
          ;(result as { parked: number }).parked += 1
          continue
        }
        const record = JSON.parse(row.record_json) as AgentRequestLedgerRecord
        const error = new AgentGatewayError(
          AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN,
          'effect outcome could not be safely replayed after host restart',
        ).toJSON()
        const next = { key: record.key, digest: record.digest, state: 'outcome-unknown' as const, error, updatedAt: Date.now() }
        this.database.prepare(`
          UPDATE agent_request_ledger SET state = ?, record_json = ?, updated_at = ?
          WHERE request_key = ? AND state = 'in-flight'
        `).run(next.state, JSON.stringify({ ...next, incarnation }), next.updatedAt, row.request_key)
        ;(result as { requestsOutcomeUnknown: number }).requestsOutcomeUnknown += 1
      }

      const turns = this.database.prepare(`
        SELECT run_key, session_key, record_json FROM agent_turn_ledger
        WHERE incarnation <> ? AND state = 'started'
      `).all(incarnation) as Array<{ run_key: string; session_key: string; record_json: string }>
      for (const row of turns) {
        const record = JSON.parse(row.record_json) as AgentTurnLedgerRecord
        const next = { ...record, state: 'outcome-unknown' as const, updatedAt: Date.now() }
        const changed = this.database.prepare(`
          UPDATE agent_turn_ledger SET state = ?, record_json = ?, updated_at = ?
          WHERE run_key = ? AND session_key = ? AND state = 'started'
        `).run(next.state, JSON.stringify(next), next.updatedAt, row.run_key, row.session_key)
        if (changed.changes === 1) (result as { turnsOutcomeUnknown: number }).turnsOutcomeUnknown += 1
      }

      const effects = this.database.prepare(`
        SELECT run_key, effect_id, record_json FROM agent_effect_ledger
        WHERE state IN ('admitted', 'in-flight')
      `).all() as Array<{ run_key: string; effect_id: string; record_json: string }>
      for (const row of effects) {
        const record = JSON.parse(row.record_json) as AgentEffectLedgerRecord
        const next = record.idempotent
          ? { ...record, state: 'admitted' as const, updatedAt: Date.now() }
          : { ...record, state: 'outcome-unknown' as const, updatedAt: Date.now() }
        this.database.prepare(`
          UPDATE agent_effect_ledger SET state = ?, record_json = ?, updated_at = ?
          WHERE run_key = ? AND effect_id = ? AND state IN ('admitted', 'in-flight')
        `).run(next.state, JSON.stringify(next), next.updatedAt, row.run_key, row.effect_id)
        if (!record.idempotent) (result as { effectsOutcomeUnknown: number }).effectsOutcomeUnknown += 1
      }
    })
    return result
  }

  async listNonTerminal(filter: AgentLedgerNonTerminalFilter): Promise<AgentLedgerNonTerminalRecord[]> {
    const states = new Set(filter.states)
    const operations = new Set(filter.operations)
    const output: AgentLedgerNonTerminalRecord[] = []
    const requests = this.database.prepare(`SELECT record_json FROM agent_request_ledger ORDER BY updated_at`).all() as Array<{ record_json: string }>
    for (const row of requests) {
      const record = JSON.parse(row.record_json) as AgentRequestLedgerRecord
      if (states.has(record.state) && operations.has(record.key.operation)
        && (!filter.workspaceScopeId || record.key.workspaceScopeId === filter.workspaceScopeId)) {
        output.push({ kind: 'request', record })
      }
    }
    const turns = this.database.prepare(`SELECT record_json FROM agent_turn_ledger ORDER BY updated_at`).all() as Array<{ record_json: string }>
    for (const row of turns) {
      const record = JSON.parse(row.record_json) as AgentTurnLedgerRecord
      if (states.has(record.state) && operations.has(record.runRequestKey.operation)
        && (!filter.workspaceScopeId || record.runRequestKey.workspaceScopeId === filter.workspaceScopeId)) {
        output.push({ kind: 'turn', record })
      }
    }
    const effects = this.database.prepare(`SELECT record_json FROM agent_effect_ledger ORDER BY updated_at`).all() as Array<{ record_json: string }>
    for (const row of effects) {
      const record = JSON.parse(row.record_json) as AgentEffectLedgerRecord
      if (states.has(record.state) && operations.has(record.runRequestKey.operation)
        && (!filter.workspaceScopeId || record.runRequestKey.workspaceScopeId === filter.workspaceScopeId)) {
        output.push({ kind: 'effect', record })
      }
    }
    return output
  }

  async startTurn(record: Omit<AgentTurnLedgerRecord, 'state' | 'startedAt' | 'updatedAt'>): Promise<void> {
    const now = Date.now()
    const next: AgentTurnLedgerRecord = { ...record, state: 'started', startedAt: now, updatedAt: now }
    this.database.prepare(`
      INSERT INTO agent_turn_ledger
        (run_key, session_key, operation, workspace_scope_id, incarnation, state, record_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_key, session_key) DO NOTHING
    `).run(
      keyString(record.runRequestKey),
      sessionKey(record.sessionRef),
      record.runRequestKey.operation,
      record.runRequestKey.workspaceScopeId,
      record.incarnation,
      next.state,
      JSON.stringify(next),
      now,
    )
  }

  async finishTurn(
    runRequestKey: AgentRequestKey,
    sessionRef: import('../../shared/index').AgentSessionRef,
    input: { state: 'ended' | 'error'; endedSeq: number },
  ): Promise<void> {
    const runKey = keyString(runRequestKey)
    const id = sessionKey(sessionRef)
    const row = this.database.prepare(`
      SELECT record_json FROM agent_turn_ledger WHERE run_key = ? AND session_key = ?
    `).get(runKey, id) as { record_json: string } | undefined
    if (!row) conflict('turn ledger record is missing')
    const record = JSON.parse(row.record_json) as AgentTurnLedgerRecord
    const next = { ...record, state: input.state, endedSeq: input.endedSeq, updatedAt: Date.now() }
    const changed = this.database.prepare(`
      UPDATE agent_turn_ledger SET state = ?, record_json = ?, updated_at = ?
      WHERE run_key = ? AND session_key = ? AND state = 'started'
    `).run(next.state, JSON.stringify(next), next.updatedAt, runKey, id)
    if (changed.changes !== 1) conflict('turn ledger transition lost its compare-and-swap race')
  }

  async admitEffect(record: Omit<AgentEffectLedgerRecord, 'state' | 'updatedAt'>): Promise<void> {
    const now = Date.now()
    const next: AgentEffectLedgerRecord = { ...record, state: 'admitted', updatedAt: now }
    const inserted = this.database.prepare(`
      INSERT OR IGNORE INTO agent_effect_ledger
        (run_key, effect_id, operation, workspace_scope_id, effect_class, idempotent, state, record_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      keyString(record.runRequestKey), record.effectId, record.runRequestKey.operation,
      record.runRequestKey.workspaceScopeId, record.effectClass, record.idempotent ? 1 : 0,
      next.state, JSON.stringify(next), now,
    )
    if (inserted.changes === 0) {
      const existing = this.readEffect(record.runRequestKey, record.effectId)
      if (!existing || existing.effectClass !== record.effectClass || existing.idempotent !== record.idempotent) {
        conflict('effectId was already used with different semantics')
      }
    }
  }

  async beginChildEffect(runRequestKey: AgentRequestKey, effectId: string): Promise<void> {
    this.transitionEffect(runRequestKey, effectId, ['admitted'], (record) => ({ ...record, state: 'in-flight', updatedAt: Date.now() }))
  }

  async pauseChildEffect(runRequestKey: AgentRequestKey, effectId: string): Promise<void> {
    this.transitionEffect(runRequestKey, effectId, ['admitted'], (record) => ({ ...record, state: 'paused', updatedAt: Date.now() }))
  }

  async settleChildEffect(
    runRequestKey: AgentRequestKey,
    effectId: string,
    outcomeDigest: string,
    receipt: import('../../shared/index').JsonValue,
  ): Promise<void> {
    const existing = this.readEffect(runRequestKey, effectId)
    if (existing?.state === 'settled') {
      if (existing.outcomeDigest !== outcomeDigest) conflict('effect settled with a conflicting outcome digest')
      return
    }
    this.transitionEffect(runRequestKey, effectId, ['in-flight'], (record) => ({
      ...record, state: 'settled', outcomeDigest, receipt, updatedAt: Date.now(),
    }))
  }

  async markChildEffectOutcomeUnknown(runRequestKey: AgentRequestKey, effectId: string): Promise<void> {
    this.transitionEffect(runRequestKey, effectId, ['in-flight'], (record) => ({ ...record, state: 'outcome-unknown', updatedAt: Date.now() }))
  }

  async countEffects(): Promise<number> {
    const row = this.database.prepare(`SELECT COUNT(*) AS count FROM agent_effect_ledger`).get() as { count: number }
    return Number(row.count)
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
      SET state = ?, incarnation = ?, lease_until = ?, record_json = ?, updated_at = ?
      WHERE request_key = ? AND digest = ? AND state IN (${placeholders})
    `).run(
      next.state,
      this.incarnation,
      next.state === 'in-flight' ? Date.now() + 60_000 : null,
      JSON.stringify({ ...next, incarnation: this.incarnation }),
      next.updatedAt,
      keyString(key),
      current.digest,
      ...expectedStates,
    )
    if (result.changes !== 1) conflict('request ledger transition lost its compare-and-swap race')
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS ledger_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)
    `)
    const versionRow = this.database.prepare(`SELECT value FROM ledger_meta WHERE key = 'schema_version'`).get() as { value: string } | undefined
    let version = versionRow ? Number(versionRow.value) : 0
    if (!Number.isInteger(version) || version < 0) throw new Error('request ledger schema version is invalid')
    if (version > LEDGER_SCHEMA_VERSION) throw new Error(`request ledger schema version ${version} is newer than supported version ${LEDGER_SCHEMA_VERSION}`)
    const ladder = new Map<number, () => void>([[0, () => this.migrateLegacyRequestTable()]])
    while (version < LEDGER_SCHEMA_VERSION) {
      const step = ladder.get(version)
      if (!step) throw new Error(`request ledger migration ${version} -> ${version + 1} is unavailable`)
      step()
      version += 1
    }
    this.createAdditiveTables()
  }

  private migrateLegacyRequestTable(): void {
    const exists = this.database.prepare(`
      SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'agent_request_ledger'
    `).get()
    this.transaction(() => {
      this.database.exec(`
        CREATE TABLE agent_request_ledger_shadow (
          request_key TEXT PRIMARY KEY,
          digest TEXT NOT NULL,
          state TEXT NOT NULL,
          operation TEXT NOT NULL,
          workspace_scope_id TEXT NOT NULL,
          incarnation TEXT NOT NULL,
          lease_until INTEGER,
          replay_payload_json TEXT,
          record_json TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `)
      let sourceCount = 0
      if (exists) {
        const rows = this.database.prepare(`SELECT request_key, digest, state, record_json, updated_at FROM agent_request_ledger`).all() as Array<{
          request_key: string; digest: string; state: string; record_json: string; updated_at: number
        }>
        sourceCount = rows.length
        for (const row of rows) {
          const record = JSON.parse(row.record_json) as AgentRequestLedgerRecord
          if (keyString(record.key) !== row.request_key || record.digest !== row.digest || record.state !== row.state) {
            throw new Error('request ledger migration validation failed')
          }
          this.database.prepare(`
            INSERT INTO agent_request_ledger_shadow
              (request_key, digest, state, operation, workspace_scope_id, incarnation, lease_until, replay_payload_json, record_json, updated_at)
            VALUES (?, ?, ?, ?, ?, 'legacy', NULL, NULL, ?, ?)
          `).run(row.request_key, row.digest, row.state, record.key.operation, record.key.workspaceScopeId, row.record_json, row.updated_at)
        }
      }
      const shadowCount = Number((this.database.prepare(`SELECT COUNT(*) AS count FROM agent_request_ledger_shadow`).get() as { count: number }).count)
      if (shadowCount !== sourceCount) throw new Error('request ledger migration row-count validation failed')
      if (exists) this.database.exec(`DROP TABLE agent_request_ledger`)
      this.database.exec(`ALTER TABLE agent_request_ledger_shadow RENAME TO agent_request_ledger`)
      this.database.prepare(`INSERT INTO ledger_meta (key, value) VALUES ('schema_version', ?)`)
        .run(String(LEDGER_SCHEMA_VERSION))
    })
  }

  private createAdditiveTables(): void {
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS agent_request_ledger_nonterminal_idx
        ON agent_request_ledger (workspace_scope_id, operation, state, updated_at);
      CREATE TABLE IF NOT EXISTS agent_turn_ledger (
        run_key TEXT NOT NULL,
        session_key TEXT NOT NULL,
        operation TEXT NOT NULL,
        workspace_scope_id TEXT NOT NULL,
        incarnation TEXT NOT NULL,
        state TEXT NOT NULL,
        record_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (run_key, session_key)
      );
      CREATE INDEX IF NOT EXISTS agent_turn_ledger_nonterminal_idx
        ON agent_turn_ledger (workspace_scope_id, operation, state, updated_at);
      CREATE TABLE IF NOT EXISTS agent_effect_ledger (
        run_key TEXT NOT NULL,
        effect_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        workspace_scope_id TEXT NOT NULL,
        effect_class TEXT NOT NULL,
        idempotent INTEGER NOT NULL,
        state TEXT NOT NULL,
        record_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (run_key, effect_id)
      );
      CREATE INDEX IF NOT EXISTS agent_effect_ledger_nonterminal_idx
        ON agent_effect_ledger (workspace_scope_id, operation, state, updated_at);
      CREATE TABLE IF NOT EXISTS agent_attention_ledger (
        attention_id TEXT PRIMARY KEY,
        run_key TEXT,
        workspace_scope_id TEXT,
        agent_type_id TEXT,
        session_id TEXT,
        status TEXT NOT NULL,
        record_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS agent_attention_session_status_idx
        ON agent_attention_ledger (session_id, status, updated_at);
    `)
  }

  private transaction<T>(run: () => T): T {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const result = run()
      this.database.exec('COMMIT')
      return result
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  private readEffect(runRequestKey: AgentRequestKey, effectId: string): AgentEffectLedgerRecord | undefined {
    const row = this.database.prepare(`
      SELECT record_json FROM agent_effect_ledger WHERE run_key = ? AND effect_id = ?
    `).get(keyString(runRequestKey), effectId) as { record_json: string } | undefined
    return row ? JSON.parse(row.record_json) as AgentEffectLedgerRecord : undefined
  }

  private transitionEffect(
    runRequestKey: AgentRequestKey,
    effectId: string,
    expected: readonly AgentEffectLedgerRecord['state'][],
    update: (record: AgentEffectLedgerRecord) => AgentEffectLedgerRecord,
  ): void {
    const current = this.readEffect(runRequestKey, effectId)
    if (!current || !expected.includes(current.state)) conflict(`effect ledger cannot transition from ${current?.state ?? 'missing'}`)
    const next = update(current)
    const placeholders = expected.map(() => '?').join(', ')
    const changed = this.database.prepare(`
      UPDATE agent_effect_ledger SET state = ?, record_json = ?, updated_at = ?
      WHERE run_key = ? AND effect_id = ? AND state IN (${placeholders})
    `).run(next.state, JSON.stringify(next), next.updatedAt, keyString(runRequestKey), effectId, ...expected)
    if (changed.changes !== 1) conflict('effect ledger transition lost its compare-and-swap race')
  }

  private createAttention(record: AgentAttentionLedgerRecord): void {
    const inserted = this.database.prepare(`
      INSERT OR IGNORE INTO agent_attention_ledger
        (attention_id, run_key, workspace_scope_id, agent_type_id, session_id, status, record_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.attentionId,
      record.runRequestKey ? keyString(record.runRequestKey) : null,
      record.workspaceScopeId ?? record.runRequestKey?.workspaceScopeId ?? null,
      record.sessionRef?.agentTypeId ?? null,
      record.sessionRef?.sessionId ?? null,
      record.status,
      JSON.stringify(record),
      record.updatedAt,
    )
    if (inserted.changes !== 1) conflict('attentionId already exists')
    this.emitAttention({ sessionId: record.sessionRef?.sessionId ?? '', attentionId: record.attentionId, reason: 'create' })
  }

  private readAttention(attentionId: string): AgentAttentionLedgerRecord | undefined {
    const row = this.database.prepare(`SELECT record_json FROM agent_attention_ledger WHERE attention_id = ?`).get(attentionId) as { record_json: string } | undefined
    return row ? JSON.parse(row.record_json) as AgentAttentionLedgerRecord : undefined
  }

  private listAttention(input?: { sessionId?: string; statuses?: readonly AgentAttentionStatus[] }): AgentAttentionLedgerRecord[] {
    const rows = this.database.prepare(`SELECT record_json FROM agent_attention_ledger ORDER BY updated_at`).all() as Array<{ record_json: string }>
    return rows.map((row) => JSON.parse(row.record_json) as AgentAttentionLedgerRecord)
      .filter((record) => (!input?.sessionId || record.sessionRef?.sessionId === input.sessionId)
        && (!input?.statuses || input.statuses.includes(record.status)))
  }

  private transitionAttention(
    attentionId: string,
    expected: readonly AgentAttentionStatus[],
    update: (record: AgentAttentionLedgerRecord) => AgentAttentionLedgerRecord,
  ): boolean {
    return this.transaction(() => {
      const current = this.readAttention(attentionId)
      if (!current || !expected.includes(current.status)) return false
      const next = update(current)
      const placeholders = expected.map(() => '?').join(', ')
      const changed = this.database.prepare(`
        UPDATE agent_attention_ledger SET status = ?, record_json = ?, updated_at = ?
        WHERE attention_id = ? AND status IN (${placeholders})
      `).run(next.status, JSON.stringify(next), next.updatedAt, attentionId, ...expected)
      if (changed.changes !== 1) return false
      const reason = next.status === 'answered' ? 'answer'
        : next.status === 'ready' ? 'restore'
          : next.status === 'expired' ? 'expire'
            : next.status === 'superseded' ? 'supersede'
              : 'cancel'
      this.emitAttention({ sessionId: next.sessionRef?.sessionId ?? '', attentionId, reason })
      return true
    })
  }

  private appendAttentionTranscriptEventIfMissing(
    attentionId: string,
    event: import('../../shared/index').JsonValue,
    matches: (event: import('../../shared/index').JsonValue) => boolean,
  ): boolean {
    return this.transaction(() => {
      const current = this.readAttention(attentionId)
      if (!current) conflict('attention record is missing')
      if (current.transcriptEvents.some(matches)) return false
      const next = { ...current, transcriptEvents: [...current.transcriptEvents, event], updatedAt: Date.now() }
      const changed = this.database.prepare(`
        UPDATE agent_attention_ledger SET record_json = ?, updated_at = ? WHERE attention_id = ? AND updated_at = ?
      `).run(JSON.stringify(next), next.updatedAt, attentionId, current.updatedAt)
      if (changed.changes !== 1) conflict('attention transcript append lost its compare-and-swap race')
      this.emitAttention({ sessionId: next.sessionRef?.sessionId ?? '', attentionId, reason: 'transcript' })
      return true
    })
  }

  private resolveLegacySession(sessionId: string): Array<{ workspaceScopeId: string; agentTypeId: string }> {
    const routes = new Map<string, { workspaceScopeId: string; agentTypeId: string }>()
    const rows = this.database.prepare(`SELECT record_json FROM agent_request_ledger`).all() as Array<{ record_json: string }>
    for (const row of rows) {
      const record = JSON.parse(row.record_json) as AgentRequestLedgerRecord
      if (record.key.target.kind !== 'session' || record.key.target.ref.sessionId !== sessionId) continue
      const route = { workspaceScopeId: record.key.workspaceScopeId, agentTypeId: record.key.target.ref.agentTypeId }
      routes.set(JSON.stringify(route), route)
    }
    return [...routes.values()]
  }

  private importAttentionOnce(records: readonly AgentAttentionLedgerRecord[]): number {
    return this.transaction(() => {
      const marker = this.database.prepare(`SELECT value FROM ledger_meta WHERE key = 'ask_user_import_v1'`).get()
      if (marker) return 0
      let imported = 0
      for (const record of records) {
        const changed = this.database.prepare(`
          INSERT OR IGNORE INTO agent_attention_ledger
            (attention_id, run_key, workspace_scope_id, agent_type_id, session_id, status, record_json, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          record.attentionId,
          record.runRequestKey ? keyString(record.runRequestKey) : null,
          record.workspaceScopeId ?? null,
          record.sessionRef?.agentTypeId ?? null,
          record.sessionRef?.sessionId ?? null,
          record.status,
          JSON.stringify(record),
          record.updatedAt,
        )
        imported += Number(changed.changes)
      }
      this.database.prepare(`INSERT INTO ledger_meta (key, value) VALUES ('ask_user_import_v1', ?)`)
        .run(new Date().toISOString())
      return imported
    })
  }

  private emitAttention(change: AgentAttentionLedgerChange): void {
    for (const listener of this.attentionListeners) {
      try { listener(change) } catch { /* Store observers cannot fail the committed transition. */ }
    }
  }
}

function sessionKey(ref: import('../../shared/index').AgentSessionRef): string {
  return JSON.stringify([ref.agentTypeId, ref.sessionId])
}
