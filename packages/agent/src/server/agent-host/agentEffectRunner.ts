import {
  AgentGatewayError,
  AgentGatewayErrorCode,
  type AgentGatewayErrorDTO,
  type JsonValue,
  type VerifiedAgentScopeClaim,
} from '../../shared/index'
import type { AgentHostRuntime } from './createAgentHost'
import { canonicalDigest } from './canonical'
import type {
  AgentGatewayEffect,
  AgentRequestFailure,
  AgentRequestKey,
  AgentRequestLedgerRecord,
  AgentRequestTarget,
} from './types'

const PENDING = Symbol('pending-agent-effect')
const ADMISSION_ACCEPTED = Symbol('accepted-agent-effect')

type ReceiptObject = Readonly<Record<string, JsonValue>>

export type AgentEffectPreparation<TContext> =
  | { readonly kind: 'ready'; readonly context: TContext }
  | { readonly kind: 'retryable'; readonly error: AgentGatewayErrorDTO }
  | { readonly kind: 'reject'; readonly error: AgentGatewayErrorDTO }

export interface AgentEffectPlan<TContext, TReceipt> {
  readonly replay: 'exact' | 'mark-duplicate'
  readonly runExclusive: <T>(effect: () => Promise<T>) => Promise<T>
  /** Post-admission preparation. Resource acquisition is allowed here. */
  readonly prepare: () => Promise<AgentEffectPreparation<TContext>>
  readonly execute: (context: TContext) => Promise<TReceipt>
  /** Opt-in only when a rejected action promise proves no provider mutation began. */
  readonly classifySafeFailure?: (error: unknown) => AgentRequestFailure | undefined
}

export interface RunAgentEffectInput<TContext, TReceipt> {
  readonly claim: VerifiedAgentScopeClaim
  readonly operation: AgentGatewayEffect
  readonly target: AgentRequestTarget
  readonly requestId: string
  readonly payload: JsonValue
  readonly plan: AgentEffectPlan<TContext, TReceipt>
}

function gatewayError(dto: AgentGatewayErrorDTO): AgentGatewayError {
  return new AgentGatewayError(dto.code, dto.message, dto.details)
}

function requestInProgress(key: AgentRequestKey): AgentGatewayError {
  return new AgentGatewayError(
    AgentGatewayErrorCode.AGENT_REQUEST_IN_PROGRESS,
    'request is already in progress',
    {
      operation: key.operation,
      target: key.target.kind === 'agent'
        ? { kind: 'agent', agentTypeId: key.target.agentTypeId }
        : {
            kind: 'session',
            ref: {
              agentTypeId: key.target.ref.agentTypeId,
              sessionId: key.target.ref.sessionId,
            },
          },
      requestId: key.requestId,
    },
  )
}

function unavailableRecord(): AgentGatewayError {
  return new AgentGatewayError(
    AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN,
    'request ledger record was unavailable',
  )
}

function failure(failed: AgentRequestFailure): Error {
  if (failed.kind === 'gateway') return gatewayError(failed.error)
  return Object.assign(new Error(failed.error.error.message), {
    code: failed.error.error.code,
    statusCode: failed.error.statusCode,
    ...(failed.error.error.retryable === undefined
      ? {}
      : { retryable: failed.error.error.retryable }),
  })
}

function replayReceipt<TReceipt>(
  receipt: JsonValue,
  replay: AgentEffectPlan<unknown, unknown>['replay'],
): TReceipt {
  if (
    replay === 'exact'
    || receipt === null
    || Array.isArray(receipt)
    || typeof receipt !== 'object'
  ) return receipt as unknown as TReceipt
  return { ...(receipt as ReceiptObject), duplicate: true } as unknown as TReceipt
}

function replayRecord<TReceipt>(
  record: AgentRequestLedgerRecord | undefined,
  key: AgentRequestKey,
  replay: AgentEffectPlan<unknown, unknown>['replay'],
): TReceipt | typeof PENDING | typeof ADMISSION_ACCEPTED {
  if (!record) throw unavailableRecord()
  if (record.state === 'pending-admission') return PENDING
  if (record.state === 'admission-accepted') return ADMISSION_ACCEPTED
  if (record.state === 'completed') return replayReceipt<TReceipt>(record.receipt, replay)
  if (record.state === 'rejected') throw failure(record.failure)
  if (record.state === 'outcome-unknown') throw gatewayError(record.error)
  throw requestInProgress(key)
}

async function rejectAndReplay(
  runtime: AgentHostRuntime,
  key: AgentRequestKey,
  rejected: AgentRequestFailure,
): Promise<never> {
  try {
    await runtime.ledger.reject(key, rejected)
    throw failure(rejected)
  } catch (error) {
    const winner = await runtime.ledger.read(key).catch(() => undefined)
    if (winner?.state === 'rejected') throw failure(winner.failure)
    if (winner?.state === 'outcome-unknown') throw gatewayError(winner.error)
    throw error
  }
}

function preEffectFailure(error: unknown, fallback: string): AgentRequestFailure {
  const stable = error instanceof AgentGatewayError
    ? error
    : new AgentGatewayError(
        AgentGatewayErrorCode.AGENT_COMMAND_INVALID_STATE,
        error instanceof Error ? error.message : fallback,
      )
  return { kind: 'gateway', error: stable.toJSON() }
}

async function markOutcomeUnknown(
  runtime: AgentHostRuntime,
  key: AgentRequestKey,
): Promise<never> {
  const unknown = new AgentGatewayError(
    AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN,
    'effect outcome could not be safely replayed',
  )
  try {
    await runtime.ledger.markOutcomeUnknown(key, unknown.toJSON())
    throw unknown
  } catch (error) {
    const winner = await runtime.ledger.read(key).catch(() => undefined)
    if (winner?.state === 'rejected') throw failure(winner.failure)
    if (winner?.state === 'outcome-unknown') throw gatewayError(winner.error)
    throw error
  }
}

async function recoverTransition<TReceipt>(
  runtime: AgentHostRuntime,
  key: AgentRequestKey,
  replay: AgentEffectPlan<unknown, unknown>['replay'],
  transitionError: unknown,
): Promise<TReceipt | typeof PENDING | typeof ADMISSION_ACCEPTED> {
  const winner = await runtime.ledger.read(key).catch(() => undefined)
  const replayed = replayRecord<TReceipt>(winner, key, replay)
  if (replayed === PENDING) throw transitionError
  return replayed
}

/** Runs one durable Gateway effect from ledger ownership through publication. */
export async function runAgentEffect<TContext, TReceipt>(
  runtime: AgentHostRuntime,
  input: RunAgentEffectInput<TContext, TReceipt>,
): Promise<TReceipt> {
  runtime.assertOpen()
  const key: AgentRequestKey = {
    workspaceScopeId: input.claim.workspaceScopeId,
    authSubjectId: input.claim.authSubjectId,
    operation: input.operation,
    target: input.target,
    requestId: input.requestId,
  }
  const digest = canonicalDigest(input.payload)
  const prepared = await runtime.ledger.prepare(key, digest)
  const initial = replayRecord<TReceipt>(prepared.record, key, input.plan.replay)
  if (initial !== PENDING && initial !== ADMISSION_ACCEPTED) return initial

  let effect: Promise<TReceipt>
  try {
    effect = runtime.startPreparedEffect(key, async () => {
      let checkpoint: TReceipt | typeof PENDING | typeof ADMISSION_ACCEPTED = initial
      if (checkpoint === PENDING) {
        let policyError: AgentGatewayErrorDTO | undefined
        try {
          policyError = await runtime.effectPolicy.evaluate({
            key,
            digest,
            scope: input.claim,
            operation: input.operation,
            target: input.target,
          })
        } catch (error) {
          // Policy dependencies may fail transiently (for example, a Workspace
          // lookup during a database outage). Keep the request pending so the
          // same idempotency key can be retried after recovery.
          throw failure(preEffectFailure(error, 'effect policy evaluation failed'))
        }
        if (policyError) {
          return await rejectAndReplay(runtime, key, { kind: 'gateway', error: policyError })
        }

        checkpoint = replayRecord<TReceipt>(await runtime.ledger.read(key), key, input.plan.replay)
        if (checkpoint !== PENDING && checkpoint !== ADMISSION_ACCEPTED) return checkpoint
        if (checkpoint === PENDING) {
          try {
            runtime.assertOpen()
          } catch (error) {
            return await rejectAndReplay(runtime, key, preEffectFailure(error, 'agent host is closing'))
          }
          const admission = await runtime.effectAdmission.admit({
            key,
            digest,
            scope: input.claim,
            operation: input.operation,
            target: input.target,
          })
          if (admission.type === 'retryable') throw gatewayError(admission.error)
          if (admission.type === 'rejected') {
            return await rejectAndReplay(runtime, key, { kind: 'gateway', error: admission.error })
          }
          try {
            runtime.assertOpen()
            await runtime.ledger.acceptAdmission(key, admission.admissionReceipt)
            checkpoint = ADMISSION_ACCEPTED
          } catch (error) {
            checkpoint = await recoverTransition(runtime, key, input.plan.replay, error)
            if (checkpoint !== PENDING && checkpoint !== ADMISSION_ACCEPTED) return checkpoint
          }
        }
      }

      return await input.plan.runExclusive(async () => {
        const current = replayRecord<TReceipt>(await runtime.ledger.read(key), key, input.plan.replay)
        if (current !== ADMISSION_ACCEPTED) {
          if (current === PENDING) throw requestInProgress(key)
          return current
        }

        let preparation: AgentEffectPreparation<TContext>
        try {
          preparation = await input.plan.prepare()
          runtime.assertOpen()
        } catch (error) {
          return await rejectAndReplay(runtime, key, preEffectFailure(error, 'effect preparation failed'))
        }
        if (preparation.kind === 'retryable') throw gatewayError(preparation.error)
        if (preparation.kind === 'reject') {
          return await rejectAndReplay(runtime, key, { kind: 'gateway', error: preparation.error })
        }

        try {
          await runtime.ledger.beginEffect(key)
        } catch (error) {
          const recovered = await recoverTransition<TReceipt>(runtime, key, input.plan.replay, error)
          if (recovered === ADMISSION_ACCEPTED) throw error
          if (recovered === PENDING) throw requestInProgress(key)
          return recovered
        }

        let actionResult: Promise<TReceipt>
        try {
          actionResult = input.plan.execute(preparation.context)
        } catch {
          return await markOutcomeUnknown(runtime, key)
        }

        let receipt: TReceipt
        try {
          receipt = await actionResult
        } catch (error) {
          const safeFailure = input.plan.classifySafeFailure?.(error)
          if (safeFailure) return await rejectAndReplay(runtime, key, safeFailure)
          return await markOutcomeUnknown(runtime, key)
        }

        // Once the provider mutation has completed, its receipt must win over
        // a concurrent drain. Rejecting here would falsely advertise that the
        // mutation never happened and could induce a duplicate retry.
        try {
          // Public receipt interfaces are JSON DTOs but intentionally do not
          // carry index signatures. Convert only at the durable ledger seam.
          await runtime.ledger.complete(key, receipt as unknown as JsonValue)
          return receipt
        } catch (error) {
          const winner = await runtime.ledger.read(key).catch(() => undefined)
          if (winner?.state === 'completed') {
            return replayReceipt<TReceipt>(winner.receipt, input.plan.replay)
          }
          if (winner?.state === 'rejected') throw failure(winner.failure)
          if (winner?.state === 'outcome-unknown') throw gatewayError(winner.error)
          return await markOutcomeUnknown(runtime, key)
        }
      })
    })
  } catch (error) {
    const closed = error instanceof AgentGatewayError
      ? error
      : new AgentGatewayError(AgentGatewayErrorCode.AGENT_GATEWAY_CLOSED, 'agent host is closing')
    return await rejectAndReplay(runtime, key, { kind: 'gateway', error: closed.toJSON() })
  }
  return await effect
}
