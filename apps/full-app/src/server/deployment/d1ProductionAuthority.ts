import { assertRealPathWithinWorkspace, createNodeWorkspace, resolveWorkspaceRoot, validatePath } from '@hachej/boring-agent/server'

import { createD1CollectionController, D1_V1_COLLECTION_LIMITS, type D1CollectionController } from './bootCollection.js'
import { loadD1ValidatedAgentArtifactRecipe } from './d1AgentRuntimeRecipe.js'
import { D1HostError, D1HostErrorCode, strictD1HostId } from './d1Plan.js'
import { createD1UserNeutralCandidatePreloader, type D1UserNeutralCandidateInput, type D1UserNeutralCandidatePreloader } from './d1UserNeutralPreloader.js'
import { createHostRevisionStore, type D1StoredCompleteV1 } from './hostRevisionStore.js'

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
export interface D1ProductionAuthority {
  readonly servedCollection: D1CollectionController
  readonly candidatePreloader: D1UserNeutralCandidatePreloader
  recover(): Promise<void>
}

export function createD1ProductionAuthority(options: {
  readonly hostId: string
  readonly ownerUid: number
  readonly appGid?: number
}): D1ProductionAuthority {
  const hostId = strictD1HostId(options.hostId, 'hostId')
  const store = createHostRevisionStore({ root: STATE_ROOT, ownerUid: options.ownerUid, appGid: options.appGid ?? APP_GID })
  let recovery: D1StoredCompleteV1 | undefined
  const preloader = createD1UserNeutralCandidatePreloader({
    async loadValidatedRecipe(input) {
      try {
        const artifact = await store.readAgentArtifact(hostId, input.revisionId, input.binding.bindingId)
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
  const servedCollection = createD1CollectionController({
    limits: D1_V1_COLLECTION_LIMITS,
    // Child 2 supplies the root-controlled immutable target artifact handoff.
    // Until then, only recovery may resolve a persisted immutable revision.
    resolveBinding: async (binding, plan) => {
      try {
        const target = recovery
        if (!target || JSON.stringify(plan) !== JSON.stringify(target.desired.plan)) unavailable('resolver')
        const resolved = target.desired.resolvedBindings.find((value) => value.bindingId === binding.bindingId)
        const artifact = await store.readAgentArtifact(hostId, target.revisionId, binding.bindingId)
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
  return Object.freeze({
    servedCollection,
    candidatePreloader: preloader,
    async recover() {
      try {
        const active = await store.readActive(hostId)
        if (!active) return
        const complete = await store.readComplete(hostId, active.revisionId)
        if (!complete || complete.desiredStateDigest !== active.desiredStateDigest) failed()
        const inputs = complete.observation.bindings.map((binding) => binding.runtimeInputs)
        recovery = complete
        try {
          const reproduced = await servedCollection.resolver.reproduce(complete)
          if (JSON.stringify(reproduced) !== JSON.stringify(complete.desired)) failed()
          await servedCollection.preload(complete, inputs)
          await servedCollection.serve(active)
        } finally { recovery = undefined }
      } catch (error) {
        if (error instanceof D1HostError) throw error
        unavailable('recovery')
      }
    },
  })
}
