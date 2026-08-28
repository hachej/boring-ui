import { createHash } from 'node:crypto'

import {
  AgentGatewayError,
  AgentGatewayErrorCode,
  type JsonValue,
  type VerifiedAgentScopeClaim,
} from '../../shared/index'
import type { RunContext } from '../../shared/harness'
import type { AgentTool, ToolExecContext, ToolResult } from '../../shared/tool'
import { canonicalDigest } from './canonical'
import type { AgentHostRuntime } from './createAgentHost'
import type { AgentRequestKey } from './types'
import { runAcceptedEffect, type SafeActionFailureClassifier } from './runAcceptedEffect'

const acceptedWorkProvenance = Symbol('boring.acceptedWorkProvenance')
const acceptedExternalEffectTool = Symbol('boring.acceptedExternalEffectTool')

export interface AcceptedWorkProvenance {
  readonly parentKey: AgentRequestKey
  readonly claim: VerifiedAgentScopeClaim
}

type ProvenanceCarrier = {
  [acceptedWorkProvenance]?: AcceptedWorkProvenance
}

export function attachAcceptedWorkProvenance<T extends object>(
  value: T,
  provenance: AcceptedWorkProvenance,
): T {
  Object.defineProperty(value, acceptedWorkProvenance, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: provenance,
  })
  return value
}

export function readAcceptedWorkProvenance(value: object | undefined): AcceptedWorkProvenance | undefined {
  return (value as ProvenanceCarrier | undefined)?.[acceptedWorkProvenance]
}

export interface AcceptedExternalEffectInvocation {
  readonly provenance: AcceptedWorkProvenance
  readonly toolCallId: string
}

type AcceptedExternalEffectDispatch = (
  params: Record<string, unknown>,
  ctx: ToolExecContext,
  invocation: AcceptedExternalEffectInvocation,
) => Promise<ToolResult>

interface AcceptedExternalEffectDefinition {
  readonly execute: AcceptedExternalEffectDispatch
  readonly requiresAcceptedWork: (params: Record<string, unknown>) => boolean
}

export interface AcceptedExternalEffectTool extends AgentTool {
  readonly [acceptedExternalEffectTool]: AcceptedExternalEffectDefinition
}

export function defineAcceptedExternalEffectTool(
  tool: AgentTool,
  executeAccepted: AcceptedExternalEffectDispatch,
  requiresAcceptedWork: (params: Record<string, unknown>) => boolean = () => true,
): AcceptedExternalEffectTool {
  return Object.assign({ ...tool }, {
    [acceptedExternalEffectTool]: { execute: executeAccepted, requiresAcceptedWork },
  })
}

export function acceptedExternalEffectExecutor(
  tool: AgentTool,
  params?: Record<string, unknown>,
): AcceptedExternalEffectDispatch | undefined {
  const definition = (tool as Partial<AcceptedExternalEffectTool>)[acceptedExternalEffectTool]
  if (!definition || (params && !definition.requiresAcceptedWork(params))) return undefined
  return definition.execute
}

function unavailable(): AgentGatewayError {
  return new AgentGatewayError(
    AgentGatewayErrorCode.AGENT_ACCEPTED_WORK_UNAVAILABLE,
    'accepted work is unavailable for this tool invocation',
  )
}

function validateProvenance(
  provenance: AcceptedWorkProvenance,
  expected: { workspaceScopeId: string; agentTypeId: string; sessionId: string },
): void {
  const { parentKey, claim } = provenance
  if (
    !['session.prompt', 'session.followup', 'session.command.execute'].includes(parentKey.operation)
    || claim.workspaceScopeId !== expected.workspaceScopeId
    || parentKey.workspaceScopeId !== expected.workspaceScopeId
    || parentKey.authSubjectId !== claim.authSubjectId
    || parentKey.target.kind !== 'session'
    || parentKey.target.ref.agentTypeId !== expected.agentTypeId
    || parentKey.target.ref.sessionId !== expected.sessionId
  ) throw unavailable()
}

function childRequestId(parentKey: AgentRequestKey, toolCallId: string): string {
  return `tool:${createHash('sha256').update(canonicalDigest({
    parentKey: parentKey as unknown as JsonValue,
    toolCallId,
  })).digest('hex')}`
}

export interface AcceptedToolEffectExecutorOptions {
  readonly runtime: AgentHostRuntime
  readonly workspaceScopeId: string
  readonly agentTypeId: string
  readonly sessionId: string
  /** In-memory ledgers are permitted only in deterministic tests. */
  readonly allowInMemoryLedgerForTests?: boolean
}

export function createAcceptedToolEffectExecutor(options: AcceptedToolEffectExecutorOptions) {
  if (options.runtime.ledger.durability !== 'durable-transactional' && !options.allowInMemoryLedgerForTests) {
    throw unavailable()
  }
  return async function executeAcceptedToolEffect(input: {
    readonly provenance: AcceptedWorkProvenance
    readonly toolCallId: string
    readonly tool: string
    readonly op: string
    readonly sandbox?: string
    /** Validation/quota checks proven to precede provider dispatch. */
    readonly preflight?: () => Promise<void>
    /** Classifies only failures that are proven not to have crossed the provider boundary. */
    readonly classifySafeActionFailure?: SafeActionFailureClassifier
    readonly action: () => Promise<JsonValue>
  }): Promise<JsonValue> {
    validateProvenance(input.provenance, options)
    if (!input.toolCallId.trim() || !input.tool.trim() || !input.op.trim()) throw unavailable()
    const key: AgentRequestKey = {
      workspaceScopeId: options.workspaceScopeId,
      authSubjectId: input.provenance.claim.authSubjectId,
      operation: 'session.tool.external-effect',
      target: {
        kind: 'session',
        ref: { agentTypeId: options.agentTypeId, sessionId: options.sessionId },
      },
      requestId: childRequestId(input.provenance.parentKey, input.toolCallId),
    }
    return await runAcceptedEffect({
      runtime: options.runtime,
      claim: input.provenance.claim,
      key,
      payload: {
        tool: input.tool,
        op: input.op,
        ...(input.sandbox === undefined ? {} : { sandbox: input.sandbox }),
      },
      preflight: input.preflight,
      classifySafeActionFailure: input.classifySafeActionFailure,
      action: input.action,
    })
  }
}

export function acceptedWorkForRunContext(ctx: RunContext | undefined): AcceptedWorkProvenance {
  const provenance = readAcceptedWorkProvenance(ctx)
  if (!provenance) throw unavailable()
  return provenance
}
