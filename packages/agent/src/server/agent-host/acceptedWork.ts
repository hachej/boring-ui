import type {
  AcceptedWorkContext,
  AgentRequestKey,
  AgentRequestTarget,
  VerifiedSeatParticipation,
} from './types'

/** Canonical, collision-safe projection. The complete request key is the run identity. */
export function projectAgentRequestRunId(key: AgentRequestKey): string {
  return JSON.stringify([
    1,
    key.workspaceScopeId,
    key.authSubjectId,
    key.operation,
    projectTarget(key.target),
    key.requestId,
  ])
}

function projectTarget(target: AgentRequestTarget): readonly unknown[] {
  return target.kind === 'agent'
    ? ['agent', target.agentTypeId]
    : ['session', target.ref.agentTypeId, target.ref.sessionId]
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

export function createAcceptedWorkContext(input: {
  readonly key: AgentRequestKey
  readonly admittedAgentTypeId: string
  readonly seat?: VerifiedSeatParticipation
}): AcceptedWorkContext {
  const key = structuredClone(input.key)
  if (input.admittedAgentTypeId !== (
    key.target.kind === 'agent' ? key.target.agentTypeId : key.target.ref.agentTypeId
  )) throw new TypeError('accepted work agent identity must match its request target')
  const context: AcceptedWorkContext = {
    version: 1,
    identity: {
      runId: projectAgentRequestRunId(key),
      requestKey: key,
      agent: { agentTypeId: input.admittedAgentTypeId },
      ...(input.seat ? { participation: structuredClone(input.seat) } : {}),
    },
    operation: key.operation,
    target: structuredClone(key.target),
    authority: {
      workspaceScopeId: key.workspaceScopeId,
      authSubjectId: key.authSubjectId,
    },
    delegation: { lineage: [] },
  }
  return deepFreeze(context) as AcceptedWorkContext
}

export function cloneFrozenAcceptedWork(context: AcceptedWorkContext): AcceptedWorkContext {
  if (context.version !== 1 || context.identity.runId !== projectAgentRequestRunId(context.identity.requestKey)) {
    throw new TypeError('invalid accepted work identity projection')
  }
  return deepFreeze(structuredClone(context)) as AcceptedWorkContext
}
