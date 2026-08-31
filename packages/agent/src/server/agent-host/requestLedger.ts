import { randomUUID } from 'node:crypto'
import { AgentGatewayError, AgentGatewayErrorCode } from '../../shared/index'
import type {
  AgentAttentionLedgerChange,
  AgentAttentionLedgerRecord,
  AgentAttentionStatus,
  AgentEffectLedgerRecord,
  AgentLedgerNonTerminalFilter,
  AgentLedgerNonTerminalRecord,
  AgentLedgerRestartReconciliation,
  AgentRequestFailure,
  AgentRequestKey,
  AgentRequestLedger,
  AgentRequestLedgerPrepareResult,
  AgentRequestLedgerRecord,
  AgentTurnLedgerRecord,
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

function conflict(): never {
  throw new AgentGatewayError(
    AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT,
    'requestId was already used with a different payload',
  )
}

function invalidTransition(record: AgentRequestLedgerRecord, operation: string): never {
  throw new AgentGatewayError(
    AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT,
    `request ledger cannot ${operation} from ${record.state}`,
  )
}

function validateTarget(key: AgentRequestKey): void {
  const requiresAgent = key.operation === 'session.create' || key.operation === 'agent.reload'
  if ((requiresAgent && key.target.kind !== 'agent') || (!requiresAgent && key.target.kind !== 'session')) {
    throw new TypeError('request ledger effect/target mismatch')
  }
}

/** Process-lifetime Level-B ledger with the exact published state machine. */
export class InMemoryAgentRequestLedger implements AgentRequestLedger {
  readonly durability = 'in-memory' as const
  private readonly records = new Map<string, AgentRequestLedgerRecord>()
  private readonly replayPayloads = new Map<string, import('../../shared/index').JsonValue>()
  private readonly turns = new Map<string, AgentTurnLedgerRecord>()
  private readonly effects = new Map<string, AgentEffectLedgerRecord>()
  private readonly attentionRecords = new Map<string, AgentAttentionLedgerRecord>()
  private readonly attentionListeners = new Set<(change: AgentAttentionLedgerChange) => void>()
  private imported = false

  readonly attention = {
    create: async (record: AgentAttentionLedgerRecord) => {
      if (this.attentionRecords.has(record.attentionId)) conflict()
      this.attentionRecords.set(record.attentionId, record)
      this.emitAttention({ sessionId: record.sessionRef?.sessionId ?? '', attentionId: record.attentionId, reason: 'create' })
    },
    get: async (attentionId: string) => this.attentionRecords.get(attentionId),
    list: async (input?: { sessionId?: string; statuses?: readonly AgentAttentionStatus[] }) => [...this.attentionRecords.values()]
      .filter((record) => (!input?.sessionId || record.sessionRef?.sessionId === input.sessionId)
        && (!input?.statuses || input.statuses.includes(record.status))),
    transition: async (
      attentionId: string,
      expected: readonly AgentAttentionStatus[],
      update: (record: AgentAttentionLedgerRecord) => AgentAttentionLedgerRecord,
    ) => {
      const current = this.attentionRecords.get(attentionId)
      if (!current || !expected.includes(current.status)) return false
      this.attentionRecords.set(attentionId, update(current))
      return true
    },
    appendTranscriptEventIfMissing: async (
      attentionId: string,
      event: import('../../shared/index').JsonValue,
      matches: (event: import('../../shared/index').JsonValue) => boolean,
    ) => {
      const current = this.attentionRecords.get(attentionId)
      if (!current) conflict()
      if (current.transcriptEvents.some(matches)) return false
      this.attentionRecords.set(attentionId, {
        ...current,
        transcriptEvents: [...current.transcriptEvents, event],
        updatedAt: Date.now(),
      })
      return true
    },
    resolveLegacySession: async (sessionId: string) => {
      const routes = new Map<string, { workspaceScopeId: string; agentTypeId: string }>()
      for (const record of this.records.values()) {
        if (record.key.target.kind !== 'session' || record.key.target.ref.sessionId !== sessionId) continue
        const route = { workspaceScopeId: record.key.workspaceScopeId, agentTypeId: record.key.target.ref.agentTypeId }
        routes.set(JSON.stringify(route), route)
      }
      return [...routes.values()]
    },
    importOnce: async (records: readonly AgentAttentionLedgerRecord[]) => {
      if (this.imported) return 0
      this.imported = true
      let imported = 0
      for (const record of records) {
        if (this.attentionRecords.has(record.attentionId)) continue
        this.attentionRecords.set(record.attentionId, record)
        imported += 1
      }
      return imported
    },
    subscribe: (listener: (change: AgentAttentionLedgerChange) => void) => {
      this.attentionListeners.add(listener)
      return () => this.attentionListeners.delete(listener)
    },
  }

  async prepare(key: AgentRequestKey, digest: string, replayPayload?: import('../../shared/index').JsonValue): Promise<AgentRequestLedgerPrepareResult> {
    validateTarget(key)
    const id = keyString(key)
    const existing = this.records.get(id)
    if (existing) {
      if (existing.digest !== digest) conflict()
      return { ownership: 'existing', record: existing }
    }
    const record: AgentRequestLedgerRecord = {
      key,
      digest,
      state: 'pending-admission',
      updatedAt: Date.now(),
    }
    this.records.set(id, record)
    if (replayPayload !== undefined) this.replayPayloads.set(id, structuredClone(replayPayload))
    return { ownership: 'created', record }
  }

  async readReplayPayload(key: AgentRequestKey): Promise<import('../../shared/index').JsonValue | undefined> {
    return this.replayPayloads.get(keyString(key))
  }

  async acceptAdmission(key: AgentRequestKey, admissionReceipt: string): Promise<void> {
    this.transition(key, 'accept admission', (record) => {
      if (record.state !== 'pending-admission') invalidTransition(record, 'accept admission')
      return { ...record, state: 'admission-accepted', admissionReceipt, updatedAt: Date.now() }
    })
  }

  async beginEffect(key: AgentRequestKey): Promise<void> {
    this.transition(key, 'begin effect', (record) => {
      if (record.state !== 'admission-accepted') invalidTransition(record, 'begin effect')
      return { key: record.key, digest: record.digest, state: 'in-flight', updatedAt: Date.now() }
    })
  }

  async reject(key: AgentRequestKey, failure: AgentRequestFailure): Promise<void> {
    this.transition(key, 'reject', (record) => {
      const allowed = failure.kind === 'gateway'
        ? record.state === 'pending-admission'
          || record.state === 'admission-accepted'
          || record.state === 'in-flight'
        : record.state === 'in-flight'
      if (!allowed) invalidTransition(record, 'reject')
      return { key: record.key, digest: record.digest, state: 'rejected', failure, updatedAt: Date.now() }
    })
  }

  async complete(key: AgentRequestKey, receipt: import('../../shared/index').JsonValue): Promise<void> {
    this.transition(key, 'complete', (record) => {
      if (record.state !== 'in-flight') invalidTransition(record, 'complete')
      return { key: record.key, digest: record.digest, state: 'completed', receipt, updatedAt: Date.now() }
    })
  }

  async markOutcomeUnknown(
    key: AgentRequestKey,
    error: import('../../shared/index').AgentGatewayErrorDTO,
  ): Promise<void> {
    this.transition(key, 'mark outcome unknown', (record) => {
      if (record.state !== 'in-flight') invalidTransition(record, 'mark outcome unknown')
      return { key: record.key, digest: record.digest, state: 'outcome-unknown', error, updatedAt: Date.now() }
    })
  }

  async read(key: AgentRequestKey): Promise<AgentRequestLedgerRecord | undefined> {
    return this.records.get(keyString(key))
  }

  async claimIncarnation(): Promise<string> {
    return randomUUID()
  }

  async reconcileAfterRestart(_incarnation: string): Promise<AgentLedgerRestartReconciliation> {
    return { requestsOutcomeUnknown: 0, requestsReset: 0, turnsOutcomeUnknown: 0, effectsOutcomeUnknown: 0, parked: 0 }
  }

  async listNonTerminal(filter: AgentLedgerNonTerminalFilter): Promise<AgentLedgerNonTerminalRecord[]> {
    const states = new Set(filter.states)
    const operations = new Set(filter.operations)
    return [
      ...[...this.records.values()].filter((record) => states.has(record.state) && operations.has(record.key.operation))
        .map((record) => ({ kind: 'request' as const, record })),
      ...[...this.turns.values()].filter((record) => states.has(record.state) && operations.has(record.runRequestKey.operation))
        .map((record) => ({ kind: 'turn' as const, record })),
      ...[...this.effects.values()].filter((record) => states.has(record.state) && operations.has(record.runRequestKey.operation))
        .map((record) => ({ kind: 'effect' as const, record })),
    ].filter((entry) => !filter.workspaceScopeId
      || (entry.kind === 'request' ? entry.record.key.workspaceScopeId : entry.record.runRequestKey.workspaceScopeId) === filter.workspaceScopeId)
  }

  async startTurn(record: Omit<AgentTurnLedgerRecord, 'state' | 'startedAt' | 'updatedAt'>): Promise<void> {
    const now = Date.now()
    this.turns.set(turnKey(record.runRequestKey, record.sessionRef), { ...record, state: 'started', startedAt: now, updatedAt: now })
  }

  async finishTurn(
    runRequestKey: AgentRequestKey,
    sessionRef: import('../../shared/index').AgentSessionRef,
    input: { state: 'ended' | 'error'; endedSeq: number },
  ): Promise<void> {
    const key = turnKey(runRequestKey, sessionRef)
    const current = this.turns.get(key)
    if (!current || current.state !== 'started') conflict()
    this.turns.set(key, { ...current, ...input, updatedAt: Date.now() })
  }

  async admitEffect(record: Omit<AgentEffectLedgerRecord, 'state' | 'updatedAt'>): Promise<void> {
    const id = effectKey(record.runRequestKey, record.effectId)
    const existing = this.effects.get(id)
    if (existing) {
      if (existing.effectClass !== record.effectClass || existing.idempotent !== record.idempotent) conflict()
      return
    }
    this.effects.set(id, { ...record, state: 'admitted', updatedAt: Date.now() })
  }

  async beginChildEffect(runRequestKey: AgentRequestKey, effectId: string): Promise<void> {
    this.transitionChildEffect(runRequestKey, effectId, ['admitted'], (record) => ({ ...record, state: 'in-flight', updatedAt: Date.now() }))
  }

  async pauseChildEffect(runRequestKey: AgentRequestKey, effectId: string): Promise<void> {
    this.transitionChildEffect(runRequestKey, effectId, ['admitted'], (record) => ({ ...record, state: 'paused', updatedAt: Date.now() }))
  }

  async settleChildEffect(
    runRequestKey: AgentRequestKey,
    effectId: string,
    outcomeDigest: string,
    receipt: import('../../shared/index').JsonValue,
  ): Promise<void> {
    const current = this.effects.get(effectKey(runRequestKey, effectId))
    if (current?.state === 'settled') {
      if (current.outcomeDigest !== outcomeDigest) conflict()
      return
    }
    this.transitionChildEffect(runRequestKey, effectId, ['in-flight'], (record) => ({
      ...record, state: 'settled', outcomeDigest, receipt, updatedAt: Date.now(),
    }))
  }

  async markChildEffectOutcomeUnknown(runRequestKey: AgentRequestKey, effectId: string): Promise<void> {
    this.transitionChildEffect(runRequestKey, effectId, ['in-flight'], (record) => ({ ...record, state: 'outcome-unknown', updatedAt: Date.now() }))
  }

  async countEffects(): Promise<number> {
    return this.effects.size
  }

  private transition(
    key: AgentRequestKey,
    operation: string,
    update: (record: AgentRequestLedgerRecord) => AgentRequestLedgerRecord,
  ): void {
    const id = keyString(key)
    const record = this.records.get(id)
    if (!record) {
      throw new AgentGatewayError(
        AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT,
        `request ledger cannot ${operation} before prepare`,
      )
    }
    this.records.set(id, update(record))
  }

  private transitionChildEffect(
    runRequestKey: AgentRequestKey,
    effectId: string,
    expected: readonly AgentEffectLedgerRecord['state'][],
    update: (record: AgentEffectLedgerRecord) => AgentEffectLedgerRecord,
  ): void {
    const id = effectKey(runRequestKey, effectId)
    const current = this.effects.get(id)
    if (!current || !expected.includes(current.state)) conflict()
    this.effects.set(id, update(current))
  }

  private emitAttention(change: AgentAttentionLedgerChange): void {
    for (const listener of this.attentionListeners) listener(change)
  }
}

function turnKey(key: AgentRequestKey, ref: import('../../shared/index').AgentSessionRef): string {
  return JSON.stringify([keyString(key), ref.agentTypeId, ref.sessionId])
}

function effectKey(key: AgentRequestKey, effectId: string): string {
  return JSON.stringify([keyString(key), effectId])
}
