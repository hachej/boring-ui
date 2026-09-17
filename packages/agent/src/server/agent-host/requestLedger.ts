import { randomUUID } from 'node:crypto'
import { AgentGatewayError, AgentGatewayErrorCode } from '../../shared/index'
import { cloneFrozenAcceptedWork, projectAgentRequestRunId } from './acceptedWork'
import { canonicalDigest, canonicalJson, canonicalJsonValue } from './canonical'
import type {
  AcceptedWorkContext,
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

function safeBase(record: AgentRequestLedgerRecord) {
  return {
    key: record.key,
    acceptedWork: record.acceptedWork,
    digest: record.digest,
    ...(record.queuedRequest === undefined ? {} : { queuedRequest: record.queuedRequest }),
    updatedAt: Date.now(),
  }
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
  private readonly claimTokens = new Map<string, string>()

  async prepare(
    key: AgentRequestKey,
    digest: string,
    acceptedWork: AcceptedWorkContext,
    queuedRequest?: import('../../shared/index').JsonValue,
  ): Promise<AgentRequestLedgerPrepareResult> {
    validateTarget(key)
    const frozenContext = cloneFrozenAcceptedWork(acceptedWork)
    const canonicalRequest = queuedRequest === undefined ? undefined : canonicalJsonValue(queuedRequest)
    if (canonicalRequest !== undefined && canonicalDigest(canonicalRequest) !== digest) conflict()
    if (projectAgentRequestRunId(key) !== frozenContext.identity.runId) conflict()
    const id = keyString(key)
    const existing = this.records.get(id)
    if (existing) {
      if (existing.digest !== digest) conflict()
      if (existing.state === 'pending-admission' && existing.retryable) {
        if (canonicalJson(existing.acceptedWork as unknown as import('../../shared/index').JsonValue) !== canonicalJson(frozenContext as unknown as import('../../shared/index').JsonValue)) conflict()
        const record: AgentRequestLedgerRecord = {
          key: existing.key,
          acceptedWork: existing.acceptedWork,
          digest,
          ...(existing.queuedRequest === undefined ? {} : { queuedRequest: existing.queuedRequest }),
          state: 'pending-admission',
          updatedAt: Date.now(),
        }
        const claimToken = randomUUID()
        this.records.set(id, record)
        this.claimTokens.set(id, claimToken)
        return { ownership: 'reclaimed', claimToken, record }
      }
      return { ownership: 'existing', record: existing }
    }
    const record: AgentRequestLedgerRecord = {
      key: structuredClone(key),
      acceptedWork: frozenContext,
      digest,
      ...(canonicalRequest === undefined ? {} : { queuedRequest: canonicalRequest }),
      state: 'pending-admission',
      updatedAt: Date.now(),
    }
    const claimToken = randomUUID()
    this.records.set(id, record)
    this.claimTokens.set(id, claimToken)
    return { ownership: 'created', claimToken, record }
  }

  async heartbeat(key: AgentRequestKey, claimToken: string): Promise<void> {
    const id = keyString(key)
    const record = this.records.get(id)
    if (!record || this.claimTokens.get(id) !== claimToken || !['pending-admission', 'admission-accepted', 'in-flight'].includes(record.state)) {
      invalidTransition(record ?? ({ state: 'missing' } as never), 'heartbeat')
    }
  }

  async markAdmissionRetryable(key: AgentRequestKey, claimToken: string): Promise<void> {
    this.transition(key, claimToken, 'retry admission', (record) => {
      if (record.state !== 'pending-admission' || record.retryable) invalidTransition(record, 'retry admission')
      return { ...safeBase(record), state: 'pending-admission', retryable: true }
    }, true)
  }

  async acceptAdmission(key: AgentRequestKey, claimToken: string, admissionReceipt: string): Promise<void> {
    this.transition(key, claimToken, 'accept admission', (record) => {
      if (record.state !== 'pending-admission' || record.retryable) invalidTransition(record, 'accept admission')
      return { ...safeBase(record), state: 'admission-accepted', admissionReceipt }
    })
  }

  async beginEffect(key: AgentRequestKey, claimToken: string): Promise<void> {
    this.transition(key, claimToken, 'begin effect', (record) => {
      if (record.state !== 'admission-accepted') invalidTransition(record, 'begin effect')
      return { ...safeBase(record), state: 'in-flight' }
    })
  }

  async reject(key: AgentRequestKey, claimToken: string, failure: AgentRequestFailure): Promise<void> {
    const digest = canonicalDigest({ state: 'rejected', value: failure } as unknown as import('../../shared/index').JsonValue)
    if (this.sameSettlement(key, digest)) return
    this.transition(key, claimToken, 'reject', (record) => {
      const allowed = failure.kind === 'gateway'
        ? record.state === 'pending-admission'
          || record.state === 'admission-accepted'
          || record.state === 'in-flight'
        : record.state === 'in-flight'
      if (!allowed) invalidTransition(record, 'reject')
      return { ...safeBase(record), state: 'rejected', failure, settlementDigest: digest }
    }, true)
  }

  async complete(key: AgentRequestKey, claimToken: string, receipt: import('../../shared/index').JsonValue): Promise<void> {
    const canonicalReceipt = canonicalJsonValue(receipt)
    const digest = canonicalDigest({ state: 'completed', value: canonicalReceipt })
    if (this.sameSettlement(key, digest)) return
    this.transition(key, claimToken, 'complete', (record) => {
      if (record.state !== 'in-flight') invalidTransition(record, 'complete')
      return { ...safeBase(record), state: 'completed', receipt: canonicalReceipt, settlementDigest: digest }
    }, true)
  }

  async markOutcomeUnknown(
    key: AgentRequestKey,
    claimToken: string,
    error: import('../../shared/index').AgentGatewayErrorDTO,
  ): Promise<void> {
    const digest = canonicalDigest({ state: 'outcome-unknown', value: error } as unknown as import('../../shared/index').JsonValue)
    if (this.sameSettlement(key, digest)) return
    this.transition(key, claimToken, 'mark outcome unknown', (record) => {
      if (record.state !== 'in-flight') invalidTransition(record, 'mark outcome unknown')
      return { ...safeBase(record), state: 'outcome-unknown', error, settlementDigest: digest }
    }, true)
  }

  async read(key: AgentRequestKey): Promise<AgentRequestLedgerRecord | undefined> {
    return this.records.get(keyString(key))
  }

  private sameSettlement(key: AgentRequestKey, digest: string): boolean {
    const current = this.records.get(keyString(key))
    if (!current || !['rejected', 'completed', 'outcome-unknown'].includes(current.state)) return false
    if ((current as Extract<AgentRequestLedgerRecord, { state: 'rejected' | 'completed' | 'outcome-unknown' }>).settlementDigest === digest) return true
    conflict()
  }

  private transition(
    key: AgentRequestKey,
    claimToken: string,
    operation: string,
    update: (record: AgentRequestLedgerRecord) => AgentRequestLedgerRecord,
    release = false,
  ): void {
    const id = keyString(key)
    const record = this.records.get(id)
    if (!record || this.claimTokens.get(id) !== claimToken) {
      throw new AgentGatewayError(
        AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT,
        `request ledger cannot ${operation} before prepare`,
      )
    }
    this.records.set(id, update(record))
    if (release) this.claimTokens.delete(id)
  }
}
