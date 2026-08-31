import {
  AgentGatewayError,
  AgentGatewayErrorCode,
  type AgentGatewayErrorDTO,
  type JsonValue,
  type VerifiedAgentScopeClaim,
} from '../../shared/index'
import { canonicalDigest } from './canonical'
import type { AgentHostRuntime } from './createAgentHost'
import type {
  AgentRequestFailure,
  AgentRequestKey,
} from './types'

type EffectSerializer = <T>(effect: () => Promise<T>) => Promise<T>
type EffectClassification =
  | { readonly kind: 'execute' }
  | { readonly kind: 'reject'; readonly error: AgentGatewayErrorDTO }
type EffectClassifier = () => Promise<EffectClassification>
export type SafeActionFailureClassifier = (error: unknown) => AgentRequestFailure | undefined

export interface RunAcceptedEffectOptions {
  readonly runtime: AgentHostRuntime
  readonly claim: VerifiedAgentScopeClaim
  readonly key: AgentRequestKey
  readonly payload: JsonValue
  readonly action: () => Promise<JsonValue>
  readonly duplicateReceipt?: boolean
  readonly serialize?: EffectSerializer
  readonly guard?: () => Promise<AgentGatewayErrorDTO | undefined>
  readonly classify?: EffectClassifier
  readonly serializedClassify?: EffectClassifier
  readonly preflight?: () => Promise<void>
  readonly classifySafeActionFailure?: SafeActionFailureClassifier
  /** Revalidates the addressed Agent authorization before ownership and mutation. */
  readonly authorize?: () => Promise<void>
}

type ReceiptObject = Readonly<Record<string, JsonValue>>

function gatewayError(dto: AgentGatewayErrorDTO): AgentGatewayError {
  return new AgentGatewayError(dto.code, dto.message, dto.details)
}

function replayReceipt(receipt: JsonValue, duplicate: boolean): JsonValue {
  if (!duplicate || receipt === null || Array.isArray(receipt) || typeof receipt !== 'object') return receipt
  return { ...(receipt as ReceiptObject), duplicate: true }
}

function failure(value: AgentRequestFailure): Error {
  if (value.kind === 'gateway') return gatewayError(value.error)
  return Object.assign(new Error(value.error.error.message), {
    code: value.error.error.code,
    statusCode: value.error.statusCode,
    ...(value.error.error.retryable === undefined ? {} : { retryable: value.error.error.retryable }),
  })
}

async function applyClassification(
  runtime: AgentHostRuntime,
  key: AgentRequestKey,
  classify: EffectClassifier,
): Promise<void> {
  let classification: EffectClassification
  try {
    classification = await classify()
  } catch (error) {
    const classifiedError = error instanceof AgentGatewayError
      ? error
      : new AgentGatewayError(
          AgentGatewayErrorCode.AGENT_COMMAND_INVALID_STATE,
          error instanceof Error ? error.message : 'effect classification failed',
        )
    await runtime.ledger.reject(key, { kind: 'gateway', error: classifiedError.toJSON() })
    throw classifiedError
  }
  if (classification.kind === 'reject') {
    await runtime.ledger.reject(key, { kind: 'gateway', error: classification.error })
    throw gatewayError(classification.error)
  }
}

export async function runAcceptedEffect(options: RunAcceptedEffectOptions): Promise<JsonValue> {
  const {
    runtime,
    claim,
    key,
    payload,
    action,
    duplicateReceipt = false,
    serialize,
    guard,
    classify,
    serializedClassify,
    preflight,
    classifySafeActionFailure,
    authorize,
  } = options
  runtime.assertOpen()
  await authorize?.()
  const digest = canonicalDigest(payload)
  const prepared = await runtime.ledger.prepare(key, digest)
  const authorizeOrReject = async () => {
    try {
      await authorize?.()
    } catch (error) {
      if (error instanceof AgentGatewayError) {
        await runtime.ledger.reject(key, { kind: 'gateway', error: error.toJSON() }).catch(() => {})
      }
      throw error
    }
  }
  const record = prepared.record
  if (record.state === 'completed') return replayReceipt(record.receipt, duplicateReceipt)
  if (record.state === 'rejected') throw failure(record.failure)
  if (record.state === 'outcome-unknown') throw gatewayError(record.error)
  const requestInProgress = () => new AgentGatewayError(
    AgentGatewayErrorCode.AGENT_REQUEST_IN_PROGRESS,
    'request is already in progress',
    {
      operation: key.operation,
      target: key.target as unknown as JsonValue,
      requestId: key.requestId,
    },
  )
  if (prepared.ownership === 'existing' && !guard) throw requestInProgress()

  let effect: Promise<JsonValue>
  try {
    effect = runtime.startPreparedEffect(key, async (): Promise<JsonValue> => {
      if (classify) await applyClassification(runtime, key, classify)

      const admitted = await runtime.ledger.read(key)
      let admissionReceipt: string | undefined
      if (admitted?.state === 'pending-admission') {
        await authorizeOrReject()
        const admission = await runtime.effectAdmission.admit({
          key,
          digest,
          scope: claim,
          operation: key.operation,
          target: key.target,
        })
        if (admission.type === 'retryable') throw gatewayError(admission.error)
        if (admission.type === 'rejected') {
          await runtime.ledger.reject(key, { kind: 'gateway', error: admission.error })
          throw gatewayError(admission.error)
        }
        admissionReceipt = admission.admissionReceipt
      }
      const runEffect = async (): Promise<JsonValue> => {
        const current = await runtime.ledger.read(key)
        if (current?.state === 'completed') return replayReceipt(current.receipt, duplicateReceipt)
        if (current?.state === 'rejected') throw failure(current.failure)
        if (current?.state === 'outcome-unknown') throw gatewayError(current.error)
        if (current?.state === 'admission-accepted' || current?.state === 'in-flight') throw requestInProgress()
        if (current?.state !== 'pending-admission' || admissionReceipt === undefined) {
          throw new AgentGatewayError(
            AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN,
            'request ledger record or admission receipt was unavailable',
          )
        }
        if (serializedClassify) await applyClassification(runtime, key, serializedClassify)
        const retryableGuardError = await guard?.()
        if (retryableGuardError) throw gatewayError(retryableGuardError)
        await authorizeOrReject()
        await runtime.ledger.acceptAdmission(key, admissionReceipt)
        if (preflight) {
          try {
            await preflight()
            runtime.assertOpen()
          } catch (error) {
            const safeFailure = classifySafeActionFailure?.(error)
            if (safeFailure) {
              await runtime.ledger.reject(key, safeFailure).catch(() => {})
              throw failure(safeFailure)
            }
            if (error instanceof AgentGatewayError) {
              await runtime.ledger.reject(key, { kind: 'gateway', error: error.toJSON() }).catch(() => {})
              throw error
            }
            const unknown = new AgentGatewayError(
              AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN,
              'effect outcome could not be safely replayed',
            )
            await runtime.ledger.beginEffect(key).catch(() => {})
            await runtime.ledger.markOutcomeUnknown(key, unknown.toJSON()).catch(() => {})
            throw unknown
          }
        }
        await runtime.ledger.beginEffect(key)
        let receipt: JsonValue
        try {
          receipt = await action()
        } catch (error) {
          const safeFailure = classifySafeActionFailure?.(error)
          if (safeFailure) {
            await runtime.ledger.reject(key, safeFailure)
            throw failure(safeFailure)
          }
          const unknown = new AgentGatewayError(
            AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN,
            'effect outcome could not be safely replayed',
          )
          await runtime.ledger.markOutcomeUnknown(key, unknown.toJSON()).catch(() => {})
          throw unknown
        }
        // Once the provider action returns, host drain must not downgrade a
        // potentially-completed external effect to a safe rejection. Settlement
        // remains available while finite effects drain; if it fails, the record
        // becomes outcome-unknown below.
        try {
          await runtime.ledger.complete(key, receipt)
          return receipt
        } catch {
          const unknown = new AgentGatewayError(
            AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN,
            'effect outcome could not be safely replayed',
          )
          await runtime.ledger.markOutcomeUnknown(key, unknown.toJSON()).catch(() => {})
          throw unknown
        }
      }
      return serialize ? serialize(runEffect) : runEffect()
    })
  } catch (error) {
    const closed = error instanceof AgentGatewayError
      ? error
      : new AgentGatewayError(AgentGatewayErrorCode.AGENT_GATEWAY_CLOSED, 'agent host is closing')
    await runtime.ledger.reject(key, { kind: 'gateway', error: closed.toJSON() }).catch(() => {})
    throw error
  }
  return await effect
}
