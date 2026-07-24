import type {
  AgentGatewayErrorDTO,
  AgentSessionRef,
  AuthSubjectId,
  JsonValue,
  VerifiedAgentScopeClaim,
  WorkspaceScopeId,
} from '../../shared/index'

export type AgentGatewayEffect =
  | 'session.create'
  | 'session.rename'
  | 'session.delete'
  | 'session.prompt'
  | 'session.followup'
  | 'session.interrupt'
  | 'session.stop'
  | 'session.queue.clear'

export type AgentRequestTarget =
  | { readonly kind: 'agent'; readonly agentTypeId: string }
  | { readonly kind: 'session'; readonly ref: AgentSessionRef }

export interface AgentRequestKey {
  readonly workspaceScopeId: WorkspaceScopeId
  readonly authSubjectId: AuthSubjectId
  readonly operation: AgentGatewayEffect
  readonly target: AgentRequestTarget
  readonly requestId: string
}

export type AgentRequestFailure =
  | { readonly kind: 'gateway'; readonly error: AgentGatewayErrorDTO }
  | {
      /** Server-only compatibility envelope; never returned by AgentGateway. */
      readonly kind: 'legacy-admission'
      readonly code: string
      readonly statusCode: 500
      readonly message: string
      readonly details?: JsonValue
    }

export interface AgentRequestLedgerRecordBase {
  readonly key: AgentRequestKey
  readonly digest: string
  readonly updatedAt: number
}

export type AgentRequestLedgerRecord =
  | (AgentRequestLedgerRecordBase & { readonly state: 'pending-admission' })
  | (AgentRequestLedgerRecordBase & {
      readonly state: 'admission-accepted'
      readonly admissionReceipt: string
    })
  | (AgentRequestLedgerRecordBase & { readonly state: 'in-flight' })
  | (AgentRequestLedgerRecordBase & {
      readonly state: 'rejected'
      readonly failure: AgentRequestFailure
    })
  | (AgentRequestLedgerRecordBase & {
      readonly state: 'completed'
      readonly receipt: JsonValue
    })
  | (AgentRequestLedgerRecordBase & {
      readonly state: 'outcome-unknown'
      readonly error: AgentGatewayErrorDTO
    })

export interface AgentRequestLedger {
  prepare(key: AgentRequestKey, digest: string): Promise<AgentRequestLedgerRecord>
  acceptAdmission(key: AgentRequestKey, admissionReceipt: string): Promise<void>
  beginEffect(key: AgentRequestKey): Promise<void>
  reject(key: AgentRequestKey, failure: AgentRequestFailure): Promise<void>
  complete(key: AgentRequestKey, receipt: JsonValue): Promise<void>
  markOutcomeUnknown(key: AgentRequestKey, error: AgentGatewayErrorDTO): Promise<void>
  read(key: AgentRequestKey): Promise<AgentRequestLedgerRecord | undefined>
}

export type AgentEffectAdmissionResult =
  | { readonly type: 'accepted'; readonly admissionReceipt: string }
  | { readonly type: 'rejected'; readonly error: AgentGatewayErrorDTO }
  | { readonly type: 'retryable'; readonly error: AgentGatewayErrorDTO }

export interface AgentEffectAdmission {
  /** Must be idempotent and reconcilable on the complete ledger key. */
  admit(input: {
    readonly key: AgentRequestKey
    readonly digest: string
    readonly scope: VerifiedAgentScopeClaim
    readonly operation: AgentGatewayEffect
    readonly target: AgentRequestTarget
  }): Promise<AgentEffectAdmissionResult>
}
