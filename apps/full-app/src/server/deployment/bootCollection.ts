import type { Sha256Digest } from '@hachej/boring-agent/shared'

import type { D1ActiveCollection, D1ActiveCollectionReader } from './activeCollectionReader.js'
import type { WorkspaceAgentRuntimeRecipe } from './d1AgentRuntimeRecipe.js'
import type { D1DesiredResolver } from './d1Command.js'
import { D1HostError, D1HostErrorCode, type D1HostPlanV1, type D1SiteBindingV1 } from './d1Plan.js'
import {
  canonicalizeD1ActiveEnvelope,
  canonicalizeD1DesiredSnapshot,
  canonicalizeD1Observation,
  createD1CompleteEnvelope,
  digestD1Desired,
  type D1ActiveEnvelopeV1,
  type D1ObservationV1,
  type D1PersistedPlanV1,
  type D1ResolvedBindingV1,
} from './d1RevisionCodec.js'
import type { D1RuntimeInputsIdentityV1 } from './d1RuntimeInputs.js'
import type { D1StoredCandidateV1, D1StoredCompleteV1 } from './hostRevisionStore.js'
import { normalizeD1DestructivePublicationIdentity, type D1DestructivePublicationIdentity } from './destructivePublicationJournal.js'

export interface D1CollectionLimits {
  readonly maxBindings: number
  readonly maxBundleBytes: number
  readonly maxTotalBundleBytes: number
  readonly maxConcurrentPreloads: number
}
export const D1_V1_COLLECTION_LIMITS: D1CollectionLimits = Object.freeze({
  maxBindings: 20, maxBundleBytes: 64 * 1024 * 1024, maxTotalBundleBytes: 1024 * 1024 * 1024, maxConcurrentPreloads: 4,
})
export interface D1ResolvedBundleV1 {
  readonly resolved: D1ResolvedBindingV1
  readonly bundleBytes: number
}
export interface D1PreparedBindingHandle {
  readonly recipe: WorkspaceAgentRuntimeRecipe
  dispose(): Promise<void>
}
export interface D1ServedBinding {
  readonly resolvedDigest: Sha256Digest
}
export interface D1ServedCollectionSnapshot {
  readonly revisionId: string
  readonly desiredStateDigest: Sha256Digest
  readonly bindingIds: readonly string[]
  lookup(bindingId: string): D1ServedBinding | undefined
}
export interface D1ServedCollectionAuthority extends D1ActiveCollectionReader {
  readRecipe(workspaceId: string, activeRevision?: string): Promise<WorkspaceAgentRuntimeRecipe>
}
export interface D1CollectionController extends D1ServedCollectionAuthority {
  readonly resolver: D1DesiredResolver
  preload(candidate: D1StoredCandidateV1, runtimeInputs: readonly D1RuntimeInputsIdentityV1[]): Promise<D1ObservationV1>
  serve(active: D1ActiveEnvelopeV1, transition?: Readonly<{ kind: 'rollback'; authorization: D1DestructivePublicationIdentity }>): Promise<Readonly<{ revisionId: string; desiredStateDigest: Sha256Digest }>>
  settleRetirement(): Promise<void>
  discardPrepared(active: D1ActiveEnvelopeV1): Promise<void>
  snapshot(): D1ServedCollectionSnapshot | null
}
type D1RollbackTransition = Readonly<{ kind: 'rollback'; authorization: D1DestructivePublicationIdentity }>

interface PreparedBinding extends D1ServedBinding {
  readonly recipe?: WorkspaceAgentRuntimeRecipe
  readonly dispose: () => Promise<void>
  readonly candidateOnly: boolean
  readonly runtimeInputs: D1RuntimeInputsIdentityV1
  readonly binding: D1SiteBindingV1
}
interface PreparedCollection {
  readonly state: 'ready' | 'cleanup'
  readonly revisionId: string
  readonly desiredStateDigest: Sha256Digest
  readonly bindings: ReadonlyMap<string, PreparedBinding>
  readonly removed: ReadonlyMap<string, PreparedBinding>
  readonly desired: D1StoredCandidateV1['desired']
  readonly observation: D1ObservationV1
}
interface ServedState {
  readonly collection: D1ActiveCollection
  readonly bindings: ReadonlyMap<string, PreparedBinding>
  readonly snapshot: D1ServedCollectionSnapshot
}
interface PendingRetirement {
  readonly prior: D1ActiveEnvelopeV1
  readonly next: D1ActiveEnvelopeV1
  readonly removals: readonly Readonly<{ bindingId: string; dispose(): Promise<void> }>[]
}
type D1RollbackCommit = (authorization: D1DestructivePublicationIdentity, commitOnce: () => void) => Promise<void>

function fail(code: D1HostErrorCode = D1HostErrorCode.COLLECTION_NOT_READY, field = 'collection'): never {
  throw new D1HostError(code, { field })
}
function captureTransition(raw: D1RollbackTransition | undefined): D1RollbackTransition | undefined {
  if (raw === undefined) return undefined
  try {
    if (typeof raw !== 'object' || raw === null || Object.keys(raw).sort().join(',') !== 'authorization,kind') throw new Error()
    const kind = Object.getOwnPropertyDescriptor(raw, 'kind'); const authorization = Object.getOwnPropertyDescriptor(raw, 'authorization')
    if (!kind || !('value' in kind) || kind.value !== 'rollback' || !authorization || !('value' in authorization)) throw new Error()
    return Object.freeze({ kind: 'rollback' as const, authorization: normalizeD1DestructivePublicationIdentity(authorization.value) })
  }
  catch { fail(D1HostErrorCode.ROLLBACK_TARGET_INVALID, 'publicationIdentity') }
}
function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) fail(D1HostErrorCode.PLAN_INVALID, field)
  return value
}
function persisted(plan: D1HostPlanV1): D1PersistedPlanV1 {
  const { expectedHostRevision: _expected, ...value } = plan
  return value
}
function sameExecutionBinding(left: D1SiteBindingV1, right: D1SiteBindingV1): boolean {
  return left.bindingId === right.bindingId && left.hostname === right.hostname && left.workspaceId === right.workspaceId
    && left.defaultDeploymentId === right.defaultDeploymentId && left.bundleRef === right.bundleRef && left.deploymentRef === right.deploymentRef
    && left.workspaceAllocationRef === right.workspaceAllocationRef && left.sessionAllocationRef === right.sessionAllocationRef
    && left.ownerPrincipalRef === right.ownerPrincipalRef && left.environmentRef === right.environmentRef
    && left.secretRefs.length === right.secretRefs.length && left.secretRefs.every((value, index) => value === right.secretRefs[index])
}
function sameHostExecution(left: D1PersistedPlanV1, right: D1PersistedPlanV1): boolean {
  return left.hostId === right.hostId && left.hostAppImageDigest === right.hostAppImageDigest
    && left.runtimeProfileRef === right.runtimeProfileRef && left.databaseRef === right.databaseRef
    && left.workspaceRootPolicyRef === right.workspaceRootPolicyRef && left.sessionRootPolicyRef === right.sessionRootPolicyRef
}
function dataProperty(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  if (!descriptor || !('value' in descriptor)) fail()
  return descriptor.value
}
function captureRecipe(raw: unknown, binding: D1ResolvedBindingV1): WorkspaceAgentRuntimeRecipe {
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

export function createD1CollectionController(options: {
  readonly limits: D1CollectionLimits
  readonly resolveBinding: (binding: D1SiteBindingV1, plan: D1PersistedPlanV1) => Promise<D1ResolvedBundleV1>
  readonly preloadBinding: (resolved: D1ResolvedBindingV1, runtimeInputs: D1RuntimeInputsIdentityV1) => Promise<D1PreparedBindingHandle>
  readonly retireRemoved?: (retirement: PendingRetirement) => Promise<void>
  readonly commitRollback?: D1RollbackCommit
}): D1CollectionController {
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
    if (!options.retireRemoved) fail(D1HostErrorCode.PUBLICATION_FAILED, 'retirement')
    const pending = retirement
    try { await options.retireRemoved(pending) } catch { fail(D1HostErrorCode.PUBLICATION_FAILED, 'retirement') }
    if (retirement === pending) retirement = undefined
  }

  const resolve = async (plan: D1PersistedPlanV1) => {
    if (plan.bindings.length > limits.maxBindings) fail(D1HostErrorCode.COLLECTION_LIMIT_EXCEEDED, 'bindings')
    const values = await Promise.all(plan.bindings.map((binding) => options.resolveBinding(binding, plan)))
    let total = 0
    for (const [index, value] of values.entries()) {
      if (value.resolved.bindingId !== plan.bindings[index]!.bindingId || !Number.isSafeInteger(value.bundleBytes) || value.bundleBytes < 0) fail()
      total += value.bundleBytes
      if (value.bundleBytes > limits.maxBundleBytes || total > limits.maxTotalBundleBytes) fail(D1HostErrorCode.COLLECTION_LIMIT_EXCEEDED, 'bundleBytes')
    }
    const nextSizes = new Map(bundleSizes)
    for (const value of values) {
      const prior = nextSizes.get(value.resolved.resolvedDigest)
      if (prior !== undefined && prior !== value.bundleBytes) fail()
      nextSizes.set(value.resolved.resolvedDigest, value.bundleBytes)
    }
    const desired = await canonicalizeD1DesiredSnapshot({ schemaVersion: 1, domain: 'boring-d1-desired:v1', plan, resolvedBindings: values.map((value) => value.resolved) })
    bundleSizes = nextSizes
    return desired
  }
  const resolver: D1DesiredResolver = Object.freeze({
    resolvePlan: (plan: D1HostPlanV1) => serialized(() => resolve(persisted(plan))),
    reproduce: (target: D1StoredCompleteV1) => serialized(() => resolve(target.desired.plan)),
  })

  const preload = async (candidate: D1StoredCandidateV1, runtimeInputs: readonly D1RuntimeInputsIdentityV1[]): Promise<D1ObservationV1> => {
    try {
      if (retirement) fail(D1HostErrorCode.PUBLICATION_FAILED, 'retirement')
      const identity = canonicalizeD1ActiveEnvelope({ schemaVersion: 1, revisionId: candidate.revisionId, desiredStateDigest: candidate.desiredStateDigest })
      const desired = await canonicalizeD1DesiredSnapshot(candidate.desired)
      if (await digestD1Desired(desired) !== identity.desiredStateDigest) fail()
      if (desired.plan.bindings.length > limits.maxBindings || desired.resolvedBindings.some((value) => !bundleSizes.has(value.resolvedDigest))) fail()
      const total = desired.resolvedBindings.reduce((sum, value) => sum + bundleSizes.get(value.resolvedDigest)!, 0)
      if (desired.resolvedBindings.some((value) => bundleSizes.get(value.resolvedDigest)! > limits.maxBundleBytes) || total > limits.maxTotalBundleBytes) fail(D1HostErrorCode.COLLECTION_LIMIT_EXCEEDED, 'bundleBytes')
      const observation = await canonicalizeD1Observation({
        schemaVersion: 1, domain: 'boring-d1-observed:v1', bindings: desired.resolvedBindings.map((binding) => ({
          bindingId: binding.bindingId, ready: true, resolvedDigest: binding.resolvedDigest,
          runtimeInputs: runtimeInputs.find((value) => value.bindingId === binding.bindingId),
        })),
      }, desired).catch(() => fail())
      if (runtimeInputs.length !== observation.bindings.length || new Set(runtimeInputs.map((value) => value.bindingId)).size !== observation.bindings.length) fail()
      const inputs = new Map(observation.bindings.map((value) => [value.bindingId, value.runtimeInputs]))
      const activeBindings = served?.bindings ?? new Map<string, PreparedBinding>()
      if (served && !sameHostExecution(desired.plan, served.collection.desired.plan)) fail(D1HostErrorCode.ACTIVE_BINDING_RESTART_REQUIRED, 'plan')
      const removed = new Map<string, PreparedBinding>()
      for (const [bindingId, value] of activeBindings) {
        const next = desired.resolvedBindings.find((binding) => binding.bindingId === bindingId)
        const binding = desired.plan.bindings.find((candidate) => candidate.bindingId === bindingId)
        if (!next || !binding) { removed.set(bindingId, value); continue }
        if (next.resolvedDigest !== value.resolvedDigest || !sameExecutionBinding(binding, value.binding)
          || inputs.get(bindingId)?.digest !== value.runtimeInputs.digest) fail(D1HostErrorCode.ACTIVE_BINDING_RESTART_REQUIRED, 'bindingId')
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
            const handle = await options.preloadBinding(binding, input)
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
      if (error instanceof D1HostError) throw error
      fail()
    }
  }
  const exactPrepared = (active: D1ActiveEnvelopeV1): PreparedCollection => {
    if (!prepared || prepared.state !== 'ready' || prepared.revisionId !== active.revisionId || prepared.desiredStateDigest !== active.desiredStateDigest) fail()
    return prepared
  }
  return Object.freeze({
    resolver, preload: (candidate: D1StoredCandidateV1, runtimeInputs: readonly D1RuntimeInputsIdentityV1[]) => {
      let capturedCandidate: D1StoredCandidateV1; let capturedInputs: readonly D1RuntimeInputsIdentityV1[]
      try { capturedCandidate = structuredClone(candidate); capturedInputs = structuredClone(runtimeInputs) }
      catch { return Promise.reject(new D1HostError(D1HostErrorCode.COLLECTION_NOT_READY, { field: 'collection' })) }
      return serialized(() => preload(capturedCandidate, capturedInputs))
    },
    serve: (rawActive: D1ActiveEnvelopeV1, rawTransition: D1RollbackTransition | undefined) => {
      let active: D1ActiveEnvelopeV1; let transition: D1RollbackTransition | undefined
      try { active = canonicalizeD1ActiveEnvelope(rawActive); transition = captureTransition(rawTransition) }
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
          fail(D1HostErrorCode.ROLLBACK_TARGET_INVALID, 'removalBindingIds')
        }
      } else if (transition !== undefined) fail(D1HostErrorCode.ROLLBACK_TARGET_INVALID, 'removalBindingIds')
      const completion = await createD1CompleteEnvelope(active.revisionId, next.desired, next.observation)
      if (completion.desiredStateDigest !== active.desiredStateDigest) fail(D1HostErrorCode.PUBLICATION_FAILED, 'completion')
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
            if (!open || committed) fail(D1HostErrorCode.PUBLICATION_FAILED, 'rollbackCommit')
            retirement = pending; served = state; committed = true
          })
        } catch { coordinatorFailed = true } finally { open = false }
        if (!committed) fail(D1HostErrorCode.PUBLICATION_FAILED, 'rollbackCommit')
        prepared = undefined
        await settleRetirement()
        if (coordinatorFailed) fail(D1HostErrorCode.PUBLICATION_FAILED, 'rollbackCommit')
      } else {
        served = state
        prepared = undefined
      }
      return Object.freeze({ revisionId: active.revisionId, desiredStateDigest: active.desiredStateDigest })
      })
    },
    settleRetirement: () => serialized(settleRetirement),
    discardPrepared: (active: D1ActiveEnvelopeV1) => serialized(async () => {
      if (prepared?.state === 'cleanup') {
        if (prepared.revisionId !== active.revisionId || prepared.desiredStateDigest !== active.desiredStateDigest) fail()
      } else exactPrepared(active)
      await clearPrepared()
    }),
    snapshot: () => served?.snapshot ?? null,
    async read() { return served?.collection ?? null },
    async readRecipe(workspaceId: string, activeRevision?: string) {
      const current = served
      if (!current || activeRevision !== undefined && current.collection.active.revisionId !== activeRevision) fail(D1HostErrorCode.PUBLICATION_FAILED, 'agentArtifacts')
      const matches = [...current.bindings.values()].filter((value) => value.binding.workspaceId === workspaceId)
      if (matches.length !== 1) fail(D1HostErrorCode.PUBLICATION_FAILED, 'agentArtifacts')
      const recipe = matches[0]!.recipe
      if (!recipe) fail(D1HostErrorCode.PUBLICATION_FAILED, 'agentArtifacts')
      return recipe
    },
  })
}
