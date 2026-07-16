import type { Sha256Digest } from '@hachej/boring-agent/shared'

import type { AgentHostActiveCollection, AgentHostActiveCollectionReader } from './activeCollectionReader.js'
import type { WorkspaceAgentRuntimeRecipe } from './agentHostAgentRuntimeRecipe.js'
import type { AgentHostUserNeutralCandidateInput } from './agentHostUserNeutralPreloader.js'
import type { AgentHostDesiredResolver } from './agentHostCommand.js'
import { AgentHostError, AgentHostErrorCode, type AgentHostPlanV1, type AgentHostSiteBindingV1 } from './agentHostPlan.js'
import {
  canonicalizeAgentHostActiveEnvelope,
  canonicalizeAgentHostDesiredSnapshot,
  canonicalizeAgentHostObservation,
  createAgentHostCompleteEnvelope,
  digestAgentHostDesired,
  type AgentHostActiveEnvelopeV1,
  type AgentHostObservationV1,
  type AgentHostPersistedPlanV1,
  type AgentHostResolvedBindingV1,
} from './agentHostRevisionCodec.js'
import type { AgentHostRuntimeInputsIdentityV1 } from './agentHostRuntimeInputs.js'
import type { AgentHostStoredCandidateV1, AgentHostStoredCompleteV1 } from './hostRevisionStore.js'
import { normalizeAgentHostDestructivePublicationIdentity, type AgentHostDestructivePublicationIdentity } from './destructivePublicationJournal.js'

export interface AgentHostCollectionLimits {
  readonly maxBindings: number
  readonly maxBundleBytes: number
  readonly maxTotalBundleBytes: number
  readonly maxConcurrentPreloads: number
}
export const AGENT_HOST_V1_COLLECTION_LIMITS: AgentHostCollectionLimits = Object.freeze({
  maxBindings: 20, maxBundleBytes: 64 * 1024 * 1024, maxTotalBundleBytes: 1024 * 1024 * 1024, maxConcurrentPreloads: 4,
})
export interface AgentHostResolvedBundleV1 {
  readonly resolved: AgentHostResolvedBindingV1
  readonly bundleBytes: number
}
export interface AgentHostPreparedBindingHandle {
  readonly recipe: WorkspaceAgentRuntimeRecipe
  dispose(): Promise<void>
}
export interface AgentHostServedBinding {
  readonly resolvedDigest: Sha256Digest
}
export interface AgentHostServedCollectionSnapshot {
  readonly revisionId: string
  readonly desiredStateDigest: Sha256Digest
  readonly bindingIds: readonly string[]
  lookup(bindingId: string): AgentHostServedBinding | undefined
}
export interface AgentHostServedCollectionAuthority extends AgentHostActiveCollectionReader {
  readRecipe(workspaceId: string, activeRevision?: string): Promise<WorkspaceAgentRuntimeRecipe>
}
export interface AgentHostCollectionController extends AgentHostServedCollectionAuthority {
  readonly resolver: AgentHostDesiredResolver
  preload(candidate: AgentHostStoredCandidateV1, runtimeInputs: readonly AgentHostRuntimeInputsIdentityV1[]): Promise<AgentHostObservationV1>
  serve(active: AgentHostActiveEnvelopeV1, transition?: Readonly<{ kind: 'rollback'; authorization: AgentHostDestructivePublicationIdentity }>): Promise<Readonly<{ revisionId: string; desiredStateDigest: Sha256Digest }>>
  settleRetirement(): Promise<void>
  discardPrepared(active: AgentHostActiveEnvelopeV1): Promise<void>
  snapshot(): AgentHostServedCollectionSnapshot | null
}
type AgentHostRollbackTransition = Readonly<{ kind: 'rollback'; authorization: AgentHostDestructivePublicationIdentity }>

interface PreparedBinding extends AgentHostServedBinding {
  readonly recipe?: WorkspaceAgentRuntimeRecipe
  readonly dispose: () => Promise<void>
  readonly candidateOnly: boolean
  readonly runtimeInputs: AgentHostRuntimeInputsIdentityV1
  readonly binding: AgentHostSiteBindingV1
}
interface PreparedCollection {
  readonly state: 'ready' | 'cleanup'
  readonly revisionId: string
  readonly desiredStateDigest: Sha256Digest
  readonly bindings: ReadonlyMap<string, PreparedBinding>
  readonly removed: ReadonlyMap<string, PreparedBinding>
  readonly desired: AgentHostStoredCandidateV1['desired']
  readonly observation: AgentHostObservationV1
}
interface ServedState {
  readonly collection: AgentHostActiveCollection
  readonly bindings: ReadonlyMap<string, PreparedBinding>
  readonly snapshot: AgentHostServedCollectionSnapshot
}
interface PendingRetirement {
  readonly prior: AgentHostActiveEnvelopeV1
  readonly next: AgentHostActiveEnvelopeV1
  readonly removals: readonly Readonly<{ bindingId: string; dispose(): Promise<void> }>[]
}
type AgentHostRollbackCommit = (authorization: AgentHostDestructivePublicationIdentity, commitOnce: () => void) => Promise<void>

function fail(code: AgentHostErrorCode = AgentHostErrorCode.COLLECTION_NOT_READY, field = 'collection'): never {
  throw new AgentHostError(code, { field })
}
function captureTransition(raw: AgentHostRollbackTransition | undefined): AgentHostRollbackTransition | undefined {
  if (raw === undefined) return undefined
  try {
    if (typeof raw !== 'object' || raw === null || Object.keys(raw).sort().join(',') !== 'authorization,kind') throw new Error()
    const kind = Object.getOwnPropertyDescriptor(raw, 'kind'); const authorization = Object.getOwnPropertyDescriptor(raw, 'authorization')
    if (!kind || !('value' in kind) || kind.value !== 'rollback' || !authorization || !('value' in authorization)) throw new Error()
    return Object.freeze({ kind: 'rollback' as const, authorization: normalizeAgentHostDestructivePublicationIdentity(authorization.value) })
  }
  catch { fail(AgentHostErrorCode.ROLLBACK_TARGET_INVALID, 'publicationIdentity') }
}
function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) fail(AgentHostErrorCode.PLAN_INVALID, field)
  return value
}
function persisted(plan: AgentHostPlanV1): AgentHostPersistedPlanV1 {
  const { expectedHostRevision: _expected, ...value } = plan
  return value
}
function sameExecutionBinding(left: AgentHostSiteBindingV1, right: AgentHostSiteBindingV1): boolean {
  return left.bindingId === right.bindingId && left.hostname === right.hostname && left.workspaceId === right.workspaceId
    && left.defaultDeploymentId === right.defaultDeploymentId && left.bundleRef === right.bundleRef && left.deploymentRef === right.deploymentRef
    && left.workspaceAllocationRef === right.workspaceAllocationRef && left.sessionAllocationRef === right.sessionAllocationRef
    && left.ownerPrincipalRef === right.ownerPrincipalRef && left.environmentRef === right.environmentRef
    && left.secretRefs.length === right.secretRefs.length && left.secretRefs.every((value, index) => value === right.secretRefs[index])
}
function sameHostExecution(left: AgentHostPersistedPlanV1, right: AgentHostPersistedPlanV1): boolean {
  return left.hostId === right.hostId && left.hostAppImageDigest === right.hostAppImageDigest
    && left.runtimeProfileRef === right.runtimeProfileRef && left.databaseRef === right.databaseRef
    && left.workspaceRootPolicyRef === right.workspaceRootPolicyRef && left.sessionRootPolicyRef === right.sessionRootPolicyRef
}
function dataProperty(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  if (!descriptor || !('value' in descriptor)) fail()
  return descriptor.value
}
function captureRecipe(raw: unknown, binding: AgentHostResolvedBindingV1): WorkspaceAgentRuntimeRecipe {
  if (typeof raw !== 'object' || raw === null || Object.keys(raw).sort().join(',') !== 'defaultDeploymentId,instructions,resolvedDigest,workspaceId') fail()
  const instructions = dataProperty(raw, 'instructions')
  if (typeof instructions !== 'object' || instructions === null || Object.keys(instructions).sort().join(',') !== 'content,ref') fail()
  const recipe = Object.freeze({ workspaceId: dataProperty(raw, 'workspaceId'), defaultDeploymentId: dataProperty(raw, 'defaultDeploymentId'),
    resolvedDigest: dataProperty(raw, 'resolvedDigest'), instructions: Object.freeze({ ref: dataProperty(instructions, 'ref'), content: dataProperty(instructions, 'content') }) })
  if (recipe.workspaceId !== binding.workspace.workspaceId || recipe.defaultDeploymentId !== binding.workspace.defaultDeploymentId
    || recipe.resolvedDigest !== binding.resolvedDigest || typeof recipe.instructions.ref !== 'string' || typeof recipe.instructions.content !== 'string') fail()
  return recipe as WorkspaceAgentRuntimeRecipe
}
async function disposeCandidateOnly(collection: PreparedCollection | undefined): Promise<PreparedCollection | undefined> {
  if (!collection) return undefined
  const candidates = [...collection.bindings].filter(([, value]) => value.candidateOnly)
  const results = await Promise.allSettled(candidates.map(([, value]) => value.dispose()))
  const failed = new Map(candidates.filter((_, index) => results[index]!.status === 'rejected'))
  return failed.size === 0 ? undefined : { ...collection, state: 'cleanup', bindings: failed }
}

export function createAgentHostCollectionController(options: {
  readonly limits: AgentHostCollectionLimits
  readonly resolveBinding: (binding: AgentHostSiteBindingV1, plan: AgentHostPersistedPlanV1) => Promise<AgentHostResolvedBundleV1>
  readonly preloadBinding: (input: AgentHostUserNeutralCandidateInput & AgentHostResolvedBindingV1) => Promise<AgentHostPreparedBindingHandle>
  readonly retireRemoved?: (retirement: PendingRetirement) => Promise<void>
  readonly commitRollback?: AgentHostRollbackCommit
}): AgentHostCollectionController {
  const limits = Object.freeze({
    maxBindings: positiveInteger(options.limits.maxBindings, 'limits.maxBindings'),
    maxBundleBytes: positiveInteger(options.limits.maxBundleBytes, 'limits.maxBundleBytes'),
    maxTotalBundleBytes: positiveInteger(options.limits.maxTotalBundleBytes, 'limits.maxTotalBundleBytes'),
    maxConcurrentPreloads: positiveInteger(options.limits.maxConcurrentPreloads, 'limits.maxConcurrentPreloads'),
  })
  let bundleSizes = new Map<Sha256Digest, number>()
  let prepared: PreparedCollection | undefined
  let served: ServedState | null = null
  let retirement: PendingRetirement | undefined
  let tail: Promise<unknown> = Promise.resolve()

  const serialized = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation, operation)
    tail = result.then(() => undefined, () => undefined)
    return result
  }
  const clearPrepared = async (): Promise<void> => {
    prepared = await disposeCandidateOnly(prepared)
    if (prepared) fail()
  }
  const settleRetirement = async (): Promise<void> => {
    if (!retirement) return
    if (!options.retireRemoved) fail(AgentHostErrorCode.PUBLICATION_FAILED, 'retirement')
    const pending = retirement
    try { await options.retireRemoved(pending) } catch { fail(AgentHostErrorCode.PUBLICATION_FAILED, 'retirement') }
    if (retirement === pending) retirement = undefined
  }

  const resolve = async (plan: AgentHostPersistedPlanV1) => {
    if (plan.bindings.length > limits.maxBindings) fail(AgentHostErrorCode.COLLECTION_LIMIT_EXCEEDED, 'bindings')
    const values = await Promise.all(plan.bindings.map((binding) => options.resolveBinding(binding, plan)))
    let total = 0
    for (const [index, value] of values.entries()) {
      if (value.resolved.bindingId !== plan.bindings[index]!.bindingId || !Number.isSafeInteger(value.bundleBytes) || value.bundleBytes < 0) fail()
      total += value.bundleBytes
      if (value.bundleBytes > limits.maxBundleBytes || total > limits.maxTotalBundleBytes) fail(AgentHostErrorCode.COLLECTION_LIMIT_EXCEEDED, 'bundleBytes')
    }
    const nextSizes = new Map(bundleSizes)
    for (const value of values) {
      const prior = nextSizes.get(value.resolved.resolvedDigest)
      if (prior !== undefined && prior !== value.bundleBytes) fail()
      nextSizes.set(value.resolved.resolvedDigest, value.bundleBytes)
    }
    const desired = await canonicalizeAgentHostDesiredSnapshot({ schemaVersion: 1, domain: 'boring-agent-host-desired:v1', plan, resolvedBindings: values.map((value) => value.resolved) })
    bundleSizes = nextSizes
    return desired
  }
  const resolver: AgentHostDesiredResolver = Object.freeze({
    resolvePlan: (plan: AgentHostPlanV1) => serialized(() => resolve(persisted(plan))),
    reproduce: (target: AgentHostStoredCompleteV1) => serialized(() => resolve(target.desired.plan)),
  })

  const preload = async (candidate: AgentHostStoredCandidateV1, runtimeInputs: readonly AgentHostRuntimeInputsIdentityV1[]): Promise<AgentHostObservationV1> => {
    try {
      if (retirement) fail(AgentHostErrorCode.PUBLICATION_FAILED, 'retirement')
      const identity = canonicalizeAgentHostActiveEnvelope({ schemaVersion: 1, revisionId: candidate.revisionId, desiredStateDigest: candidate.desiredStateDigest })
      const desired = await canonicalizeAgentHostDesiredSnapshot(candidate.desired)
      if (await digestAgentHostDesired(desired) !== identity.desiredStateDigest) fail()
      if (desired.plan.bindings.length > limits.maxBindings || desired.resolvedBindings.some((value) => !bundleSizes.has(value.resolvedDigest))) fail()
      const total = desired.resolvedBindings.reduce((sum, value) => sum + bundleSizes.get(value.resolvedDigest)!, 0)
      if (desired.resolvedBindings.some((value) => bundleSizes.get(value.resolvedDigest)! > limits.maxBundleBytes) || total > limits.maxTotalBundleBytes) fail(AgentHostErrorCode.COLLECTION_LIMIT_EXCEEDED, 'bundleBytes')
      const observation = await canonicalizeAgentHostObservation({
        schemaVersion: 1, domain: 'boring-agent-host-observed:v1', bindings: desired.resolvedBindings.map((binding) => ({
          bindingId: binding.bindingId, ready: true, resolvedDigest: binding.resolvedDigest,
          runtimeInputs: runtimeInputs.find((value) => value.bindingId === binding.bindingId),
        })),
      }, desired).catch(() => fail())
      if (runtimeInputs.length !== observation.bindings.length || new Set(runtimeInputs.map((value) => value.bindingId)).size !== observation.bindings.length) fail()
      const inputs = new Map(observation.bindings.map((value) => [value.bindingId, value.runtimeInputs]))
      const activeBindings = served?.bindings ?? new Map<string, PreparedBinding>()
      if (served && !sameHostExecution(desired.plan, served.collection.desired.plan)) fail(AgentHostErrorCode.ACTIVE_BINDING_RESTART_REQUIRED, 'plan')
      const removed = new Map<string, PreparedBinding>()
      for (const [bindingId, value] of activeBindings) {
        const next = desired.resolvedBindings.find((binding) => binding.bindingId === bindingId)
        const binding = desired.plan.bindings.find((candidate) => candidate.bindingId === bindingId)
        if (!next || !binding) { removed.set(bindingId, value); continue }
        if (next.resolvedDigest !== value.resolvedDigest || !sameExecutionBinding(binding, value.binding)
          || inputs.get(bindingId)?.digest !== value.runtimeInputs.digest) fail(AgentHostErrorCode.ACTIVE_BINDING_RESTART_REQUIRED, 'bindingId')
      }
      await clearPrepared()
      const bindings = new Map<string, PreparedBinding>()
      for (const [bindingId, value] of activeBindings) {
        if (!removed.has(bindingId)) bindings.set(bindingId, { ...value, candidateOnly: false })
      }
      const additions = desired.resolvedBindings.filter((value) => !bindings.has(value.bindingId))
      let cursor = 0; let failure: unknown
      const workers = Array.from({ length: Math.min(limits.maxConcurrentPreloads, additions.length) }, async () => {
        while (cursor < additions.length && !failure) {
          const binding = additions[cursor++]!
          const input = inputs.get(binding.bindingId)
          if (!input) { failure = new Error(); return }
          try {
            const handle = await options.preloadBinding(Object.freeze({ ...binding, revisionId: identity.revisionId, binding: desired.plan.bindings.find((item) => item.bindingId === binding.bindingId)!, resolved: binding, runtimeInputs: input }))
            if (!handle || typeof handle !== 'object') throw new Error()
            const dispose = dataProperty(handle, 'dispose')
            if (typeof dispose !== 'function') throw new Error()
            const capturedDispose = dispose.bind(handle) as () => Promise<void>
            const value = { resolvedDigest: binding.resolvedDigest, runtimeInputs: input, binding: desired.plan.bindings.find((item) => item.bindingId === binding.bindingId)!, dispose: capturedDispose, candidateOnly: true }
            bindings.set(binding.bindingId, value)
            bindings.set(binding.bindingId, { ...value, recipe: captureRecipe(dataProperty(handle, 'recipe'), binding) })
          } catch (error) { failure = error }
        }
      })
      await Promise.all(workers)
      if (failure || bindings.size !== desired.resolvedBindings.length) {
        prepared = { state: 'cleanup', revisionId: identity.revisionId, desiredStateDigest: identity.desiredStateDigest, bindings, removed, desired, observation }
        await clearPrepared(); fail()
      }
      prepared = { state: 'ready', revisionId: identity.revisionId, desiredStateDigest: identity.desiredStateDigest, bindings, removed, desired, observation }
      return observation
    } catch (error) {
      if (error instanceof AgentHostError) throw error
      fail()
    }
  }
  const exactPrepared = (active: AgentHostActiveEnvelopeV1): PreparedCollection => {
    if (!prepared || prepared.state !== 'ready' || prepared.revisionId !== active.revisionId || prepared.desiredStateDigest !== active.desiredStateDigest) fail()
    return prepared
  }
  return Object.freeze({
    resolver, preload: (candidate: AgentHostStoredCandidateV1, runtimeInputs: readonly AgentHostRuntimeInputsIdentityV1[]) => {
      let capturedCandidate: AgentHostStoredCandidateV1; let capturedInputs: readonly AgentHostRuntimeInputsIdentityV1[]
      try { capturedCandidate = structuredClone(candidate); capturedInputs = structuredClone(runtimeInputs) }
      catch { return Promise.reject(new AgentHostError(AgentHostErrorCode.COLLECTION_NOT_READY, { field: 'collection' })) }
      return serialized(() => preload(capturedCandidate, capturedInputs))
    },
    serve: (rawActive: AgentHostActiveEnvelopeV1, rawTransition: AgentHostRollbackTransition | undefined) => {
      let active: AgentHostActiveEnvelopeV1; let transition: AgentHostRollbackTransition | undefined
      try { active = canonicalizeAgentHostActiveEnvelope(rawActive); transition = captureTransition(rawTransition) }
      catch (error) { return Promise.reject(error) }
      return serialized(async () => {
      if (prepared?.state === 'cleanup') { await clearPrepared(); fail() }
      const next = exactPrepared(active)
      const removalBindingIds = [...next.removed.keys()].sort()
      if (removalBindingIds.length > 0) {
        const authorization = transition?.authorization
        if (transition?.kind !== 'rollback' || !authorization || !served || !options.retireRemoved || !options.commitRollback
          || authorization.hostId !== next.desired.plan.hostId
          || authorization.expectedRevision !== served.collection.active.revisionId
          || authorization.expectedDigest !== served.collection.active.desiredStateDigest
          || authorization.targetRevision !== active.revisionId || authorization.targetDigest !== active.desiredStateDigest
          || authorization.removalBindingIds.length !== removalBindingIds.length
          || authorization.removalBindingIds.some((id, index) => id !== removalBindingIds[index])
          || [...next.bindings.values()].some((value) => value.candidateOnly)) {
          fail(AgentHostErrorCode.ROLLBACK_TARGET_INVALID, 'removalBindingIds')
        }
      } else if (transition !== undefined) fail(AgentHostErrorCode.ROLLBACK_TARGET_INVALID, 'removalBindingIds')
      const completion = await createAgentHostCompleteEnvelope(active.revisionId, next.desired, next.observation)
      if (completion.desiredStateDigest !== active.desiredStateDigest) fail(AgentHostErrorCode.PUBLICATION_FAILED, 'completion')
      const bindings = new Map([...next.bindings].map(([id, value]) => [id, Object.freeze({ resolvedDigest: value.resolvedDigest })]))
      const snapshot = Object.freeze({
        revisionId: active.revisionId, desiredStateDigest: active.desiredStateDigest,
        bindingIds: Object.freeze([...bindings.keys()].sort()), lookup: (bindingId: string) => bindings.get(bindingId),
      })
      const state = Object.freeze({
        collection: Object.freeze({ active: Object.freeze({ ...active }), desired: next.desired, observation: next.observation, completion }),
        bindings: next.bindings, snapshot,
      })
      const prior = served
      if (next.removed.size > 0) {
        const pending = Object.freeze({ prior: prior!.collection.active, next: state.collection.active,
          removals: Object.freeze([...next.removed].map(([bindingId, value]) => {
            let disposed = false
            return Object.freeze({ bindingId, async dispose() { if (!disposed) { await value.dispose(); disposed = true } } })
          })) })
        let open = true; let committed = false; let coordinatorFailed = false
        try {
          await options.commitRollback!(transition!.authorization, () => {
            if (!open || committed) fail(AgentHostErrorCode.PUBLICATION_FAILED, 'rollbackCommit')
            retirement = pending; served = state; committed = true
          })
        } catch { coordinatorFailed = true } finally { open = false }
        if (!committed) fail(AgentHostErrorCode.PUBLICATION_FAILED, 'rollbackCommit')
        prepared = undefined
        await settleRetirement()
        if (coordinatorFailed) fail(AgentHostErrorCode.PUBLICATION_FAILED, 'rollbackCommit')
      } else {
        served = state
        prepared = undefined
      }
      return Object.freeze({ revisionId: active.revisionId, desiredStateDigest: active.desiredStateDigest })
      })
    },
    settleRetirement: () => serialized(settleRetirement),
    discardPrepared: (active: AgentHostActiveEnvelopeV1) => serialized(async () => {
      if (prepared?.state === 'cleanup') {
        if (prepared.revisionId !== active.revisionId || prepared.desiredStateDigest !== active.desiredStateDigest) fail()
      } else exactPrepared(active)
      await clearPrepared()
    }),
    snapshot: () => served?.snapshot ?? null,
    async read() { return served?.collection ?? null },
    async readRecipe(workspaceId: string, activeRevision?: string) {
      const current = served
      if (!current || activeRevision !== undefined && current.collection.active.revisionId !== activeRevision) fail(AgentHostErrorCode.PUBLICATION_FAILED, 'agentArtifacts')
      const matches = [...current.bindings.values()].filter((value) => value.binding.workspaceId === workspaceId)
      if (matches.length !== 1) fail(AgentHostErrorCode.PUBLICATION_FAILED, 'agentArtifacts')
      const recipe = matches[0]!.recipe
      if (!recipe) fail(AgentHostErrorCode.PUBLICATION_FAILED, 'agentArtifacts')
      return recipe
    },
  })
}
