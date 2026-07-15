import path from 'node:path'

import { assertRealPathWithinWorkspace, createNodeWorkspace, resolveWorkspaceRoot, validatePath } from '@hachej/boring-agent/server'

import { createD1ActiveCollectionReader, type D1ImmutableRevisionReader } from './activeCollectionReader.js'
import { createD1CollectionController, D1_V1_COLLECTION_LIMITS, type D1CollectionController } from './bootCollection.js'
import { loadD1ValidatedAgentArtifactRecipe } from './d1AgentRuntimeRecipe.js'
import { D1HostError, D1HostErrorCode, strictD1HostId } from './d1Plan.js'
import { readD1PendingPublication, type D1PendingPublicationV1, type D1PublicationControlAuthority, type D1PublicationStatusV1 } from './d1PublicationControl.js'
import { canonicalizeD1RuntimeInputsIdentity } from './d1RuntimeInputs.js'
import { createD1UserNeutralCandidatePreloader, type D1UserNeutralCandidateInput, type D1UserNeutralCandidatePreloader } from './d1UserNeutralPreloader.js'
import type { D1StoredCandidateV1 } from './hostRevisionStore.js'

const APP_GID = 10001
const STATE_ROOT = '/var/lib/boring/d1'

function unavailable(field: string): never {
  throw new D1HostError(D1HostErrorCode.COLLECTION_NOT_READY, { field })
}
function failed(): never {
  throw new D1HostError(D1HostErrorCode.PUBLICATION_FAILED, { field: 'agentArtifacts' })
}

/**
 * The D1 core's only retained preparation is an immutable recipe and a validated
 * workspace allocation. It deliberately does not create a user/session runtime.
 */
export interface D1ProductionAuthority extends D1PublicationControlAuthority {
  readonly servedCollection: D1CollectionController
  readonly candidatePreloader: D1UserNeutralCandidatePreloader
  recover(): Promise<void>
}

export function createD1ProductionAuthority(options: {
  readonly hostId: string
  readonly ownerUid: number
  readonly appGid?: number
  readonly stateRoot?: string
  readonly pendingRoot?: string
  /** Trusted test seam; production always constructs the fixed adapters below. */
  readonly dependencies?: Readonly<{ store: D1ImmutableRevisionReader; servedCollection: D1CollectionController
    candidatePreloader: D1UserNeutralCandidatePreloader; readPending(): Promise<D1PendingPublicationV1 | null> }>
}): D1ProductionAuthority {
  const hostId = strictD1HostId(options.hostId, 'hostId'); const appGid = options.appGid ?? APP_GID
  const store = options.dependencies?.store ?? createD1ActiveCollectionReader({
    hostRoot: path.join(options.stateRoot ?? STATE_ROOT, hostId), hostId, ownerUid: options.ownerUid, appGid,
  })
  const readPending = options.dependencies?.readPending ?? (() => readD1PendingPublication({
    root: options.pendingRoot ?? path.join(options.stateRoot ?? STATE_ROOT, hostId), ownerUid: options.ownerUid, appGid,
  }))
  let target: D1StoredCandidateV1 | undefined; let controlTail: Promise<unknown> = Promise.resolve()
  const serialized = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = controlTail.then(operation, operation); controlTail = result.then(() => undefined, () => undefined); return result
  }
  const preloader = options.dependencies?.candidatePreloader ?? createD1UserNeutralCandidatePreloader({
    async loadValidatedRecipe(input) {
      try {
        const artifact = await store.readRevisionAgentArtifact(input.revisionId, input.binding)
        if (!artifact) failed()
        return await loadD1ValidatedAgentArtifactRecipe(artifact, input.binding, input.resolved)
      } catch (error) {
        if (error instanceof D1HostError) throw error
        failed()
      }
    },
    async prepareWorkspaceAllocation(input) {
      try {
        if (input.runtimeInputs.workspaceAllocation.ref !== input.binding.workspaceAllocationRef) failed()
        const root = resolveWorkspaceRoot()
        const allocationPath = validatePath(root, input.binding.workspaceId)
        await assertRealPathWithinWorkspace(root, allocationPath)
        const workspace = createNodeWorkspace(allocationPath)
        await workspace.stat('.')
        return Object.freeze({
          workspaceId: input.binding.workspaceId,
          ref: input.runtimeInputs.workspaceAllocation.ref,
          versionFingerprint: input.runtimeInputs.workspaceAllocation.versionFingerprint,
          async dispose() {},
        })
      } catch (error) {
        if (error instanceof D1HostError) throw error
        unavailable('workspaceAllocation')
      }
    },
  })
  const servedCollection = options.dependencies?.servedCollection ?? createD1CollectionController({
    limits: D1_V1_COLLECTION_LIMITS,
    // Child 2 supplies the root-controlled immutable target artifact handoff.
    // Until then, only recovery may resolve a persisted immutable revision.
    resolveBinding: async (binding, plan) => {
      try {
        const selected = target
        if (!selected || JSON.stringify(plan) !== JSON.stringify(selected.desired.plan)) unavailable('resolver')
        const resolved = selected.desired.resolvedBindings.find((value) => value.bindingId === binding.bindingId)
        const artifact = await store.readRevisionAgentArtifact(selected.revisionId, binding)
        if (!resolved || !artifact) failed()
        await loadD1ValidatedAgentArtifactRecipe(artifact, binding, resolved)
        return Object.freeze({
          resolved,
          bundleBytes: artifact.bundle.assets.reduce((total, asset) => total + new TextEncoder().encode(asset.content).byteLength, 0),
        })
      } catch (error) {
        if (error instanceof D1HostError) throw error
        unavailable('resolver')
      }
    },
    preloadBinding: async (input: D1UserNeutralCandidateInput) => {
      const prepared = await preloader.prepare(input)
      return Object.freeze({ recipe: prepared.recipe, dispose: prepared.dispose })
    },
  })
  const same = (revision: string | null, digest: string | null, actual = servedCollection.snapshot()) =>
    (actual?.revisionId ?? null) === revision && (actual?.desiredStateDigest ?? null) === digest
  const pendingFor = async (operationId?: string) => {
    const pending = await readPending()
    if (!pending || operationId !== undefined && pending.operationId !== operationId) failed()
    return pending
  }
  const status = async (pending?: D1PendingPublicationV1 | null): Promise<D1PublicationStatusV1> => {
    const durable = await store.readActive(); const served = servedCollection.snapshot()
    return Object.freeze({ durableRevision: durable?.revisionId ?? null, servedRevision: served?.revisionId ?? null,
      pendingOperation: pending?.operationId ?? null })
  }
  const prepare = async (pending: D1PendingPublicationV1) => {
    if (same(pending.targetRevision, pending.targetDigest)) return status(pending)
    if (!same(pending.expectedRevision, pending.expectedDigest)) failed()
    const candidate = await store.readCandidate(pending.targetRevision)
    if (!candidate || candidate.desiredStateDigest !== pending.targetDigest) failed()
    target = candidate
    try {
      const desired = await servedCollection.resolver.resolvePlan({ ...candidate.desired.plan, expectedHostRevision: pending.expectedRevision })
      if (JSON.stringify(desired) !== JSON.stringify(candidate.desired)) failed()
      const inputs = await Promise.all(pending.runtimeInputs.map((value, index) => {
        const binding = candidate.desired.plan.bindings[index]
        if (!binding) unavailable('runtimeInputs')
        return canonicalizeD1RuntimeInputsIdentity(value, binding)
      }))
      if (inputs.length !== candidate.desired.plan.bindings.length) unavailable('runtimeInputs')
      await servedCollection.preload(candidate, inputs)
      return status(pending)
    } finally { target = undefined }
  }
  const recoverActive = async () => {
    const active = await store.readActive()
    if (!active) return
    const complete = await store.readComplete(active.revisionId)
    if (!complete || complete.desiredStateDigest !== active.desiredStateDigest) failed()
    target = complete
    try {
      const reproduced = await servedCollection.resolver.reproduce(complete)
      if (JSON.stringify(reproduced) !== JSON.stringify(complete.desired)) failed()
      await servedCollection.preload(complete, complete.observation.bindings.map((binding) => binding.runtimeInputs))
      await servedCollection.serve(active)
    } finally { target = undefined }
  }
  return Object.freeze({
    servedCollection, candidatePreloader: preloader,
    prepare: (operationId: string) => serialized(async () => prepare(await pendingFor(operationId))),
    commit: (operationId: string) => serialized(async () => {
      const pending = await pendingFor(operationId); const durable = await store.readActive()
      if (!durable || durable.revisionId !== pending.targetRevision || durable.desiredStateDigest !== pending.targetDigest) failed()
      if (!same(pending.targetRevision, pending.targetDigest)) await servedCollection.serve(durable)
      return status(pending)
    }),
    status: () => serialized(async () => status(await readPending())),
    recover: () => serialized(async () => {
      try {
        const pending = await readPending(); const durable = await store.readActive()
        if (pending && !((durable?.revisionId ?? null) === pending.expectedRevision && (durable?.desiredStateDigest ?? null) === pending.expectedDigest)
          && !(durable?.revisionId === pending.targetRevision && durable.desiredStateDigest === pending.targetDigest)) failed()
        await recoverActive()
        if (pending && (durable?.revisionId ?? null) === pending.expectedRevision) await prepare(pending)
      } catch (error) { if (error instanceof D1HostError) throw error; unavailable('recovery') }
    }),
  })
}
