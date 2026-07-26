import { AgentGatewayError, AgentGatewayErrorCode } from '../../shared/index'
import type {
  AgentRequestFailure,
  AgentRequestKey,
  AgentRequestLedger,
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

/** Process-lifetime Level-B ledger with the exact published state machine. */
export class InMemoryAgentRequestLedger implements AgentRequestLedger {
  private readonly records = new Map<string, AgentRequestLedgerRecord>()

  async prepare(key: AgentRequestKey, digest: string): Promise<AgentRequestLedgerRecord> {
    const id = keyString(key)
    const existing = this.records.get(id)
    if (existing) {
      if (existing.digest !== digest) conflict()
      return existing
    }
    const record: AgentRequestLedgerRecord = {
      key,
      digest,
      state: 'pending-admission',
      updatedAt: Date.now(),
    }
    this.records.set(id, record)
    return record
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
}
