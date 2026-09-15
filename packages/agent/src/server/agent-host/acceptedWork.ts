import type {
  AcceptedWorkContext,
  AgentRequestKey,
  AgentRequestTarget,
  VerifiedSeatParticipation,
} from './types'
import { AGENT_GATEWAY_EFFECTS } from './types'

const operations: ReadonlySet<string> = new Set(AGENT_GATEWAY_EFFECTS)
const MAX_ID_LENGTH = 1_024

/** Canonical, collision-safe projection. The complete request key is the run identity. */
export function projectAgentRequestRunId(key: AgentRequestKey): string {
  return JSON.stringify([1, key.workspaceScopeId, key.authSubjectId, key.operation, projectTarget(key.target), key.requestId])
}

function projectTarget(target: AgentRequestTarget): readonly unknown[] {
  return target.kind === 'agent' ? ['agent', target.agentTypeId] : ['session', target.ref.agentTypeId, target.ref.sessionId]
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function object(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`invalid accepted work ${label}`)
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== keys.length || keys.some((key) => !(key in record))) {
    throw new TypeError(`invalid accepted work ${label}`)
  }
  return record
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_LENGTH) throw new TypeError(`invalid accepted work ${label}`)
  return value
}
function parseTarget(value: unknown): AgentRequestTarget {
  const rough = object(value, ['kind', ...(typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'agent' ? ['agentTypeId'] : ['ref'])], 'target')
  if (rough.kind === 'agent') return { kind: 'agent', agentTypeId: text(rough.agentTypeId, 'target.agentTypeId') }
  if (rough.kind !== 'session') throw new TypeError('invalid accepted work target.kind')
  const ref = object(rough.ref, ['agentTypeId', 'sessionId'], 'target.ref')
  return { kind: 'session', ref: { agentTypeId: text(ref.agentTypeId, 'target.ref.agentTypeId'), sessionId: text(ref.sessionId, 'target.ref.sessionId') } }
}
function parseKey(value: unknown): AgentRequestKey {
  const key = object(value, ['workspaceScopeId', 'authSubjectId', 'operation', 'target', 'requestId'], 'requestKey')
  const operation = text(key.operation, 'operation')
  if (!operations.has(operation)) throw new TypeError('invalid accepted work operation')
  return { workspaceScopeId: text(key.workspaceScopeId, 'workspaceScopeId'), authSubjectId: text(key.authSubjectId, 'authSubjectId'), operation: operation as AgentRequestKey['operation'], target: parseTarget(key.target), requestId: text(key.requestId, 'requestId') }
}

/** Strict storage-boundary parser. It rejects additions as well as malformed or forged projections. */
export function parseAcceptedWorkContext(value: unknown): AcceptedWorkContext {
  const root = object(value, ['version', 'identity', 'operation', 'target', 'authority', 'delegation'], 'context')
  if (root.version !== 1) throw new TypeError('invalid accepted work version')
  const identityKeys = typeof root.identity === 'object' && root.identity !== null && 'participation' in root.identity
    ? ['runId', 'requestKey', 'agent', 'participation'] : ['runId', 'requestKey', 'agent']
  const identity = object(root.identity, identityKeys, 'identity')
  const requestKey = parseKey(identity.requestKey)
  const agent = object(identity.agent, ['agentTypeId'], 'identity.agent')
  const authority = object(root.authority, ['workspaceScopeId', 'authSubjectId'], 'authority')
  const delegation = object(root.delegation, ['lineage'], 'delegation')
  // Slice 8 has no verified lineage producer. Reject rather than persist speculative provenance.
  if (!Array.isArray(delegation.lineage) || delegation.lineage.length !== 0) throw new TypeError('invalid accepted work delegation')
  const target = parseTarget(root.target)
  const participation = identity.participation === undefined ? undefined : object(identity.participation, ['seatId'], 'identity.participation')
  const expectedAgent = requestKey.target.kind === 'agent' ? requestKey.target.agentTypeId : requestKey.target.ref.agentTypeId
  const canonical = createGatewayAcceptedWorkContext({ key: requestKey, admittedAgentTypeId: text(agent.agentTypeId, 'identity.agent.agentTypeId'), ...(participation ? { seat: { seatId: text(participation.seatId, 'identity.participation.seatId') } } : {}) })
  if (identity.runId !== canonical.identity.runId || root.operation !== canonical.operation || JSON.stringify(target) !== JSON.stringify(canonical.target) || authority.workspaceScopeId !== canonical.authority.workspaceScopeId || authority.authSubjectId !== canonical.authority.authSubjectId || expectedAgent !== canonical.identity.agent.agentTypeId) throw new TypeError('invalid accepted work redundant projection')
  return canonical
}

/** Trusted gateway constructor; this value records identity/provenance and is not authorization. */
/** @internal Trusted gateway/storage migration construction funnel. Not part of the package API. */
export function createGatewayAcceptedWorkContext(input: { readonly key: AgentRequestKey; readonly admittedAgentTypeId: string; readonly seat?: VerifiedSeatParticipation }): AcceptedWorkContext {
  const key = structuredClone(input.key)
  const expected = key.target.kind === 'agent' ? key.target.agentTypeId : key.target.ref.agentTypeId
  if (input.admittedAgentTypeId !== expected) throw new TypeError('accepted work agent identity must match its request target')
  return deepFreeze({ version: 1, identity: { runId: projectAgentRequestRunId(key), requestKey: key, agent: { agentTypeId: input.admittedAgentTypeId }, ...(input.seat ? { participation: structuredClone(input.seat) } : {}) }, operation: key.operation, target: structuredClone(key.target), authority: { workspaceScopeId: key.workspaceScopeId, authSubjectId: key.authSubjectId }, delegation: { lineage: [] } }) as AcceptedWorkContext
}

export function cloneFrozenAcceptedWork(context: unknown): AcceptedWorkContext {
  return parseAcceptedWorkContext(structuredClone(context))
}
