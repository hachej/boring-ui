import type { Sha256Digest } from '@hachej/boring-agent/shared'

import type { WorkspaceAgentRuntimeRecipe } from './d1AgentRuntimeRecipe.js'
import { D1HostError, D1HostErrorCode, strictD1Ref, type D1SiteBindingV1 } from './d1Plan.js'
import type { D1ResolvedBindingV1 } from './d1RevisionCodec.js'
import { canonicalizeD1RuntimeInputsIdentity, type D1RuntimeInputsIdentityV1 } from './d1RuntimeInputs.js'

export interface D1PreparedWorkspaceAllocation {
  readonly workspaceId: string
  readonly ref: string
  readonly versionFingerprint: Sha256Digest
  dispose(): Promise<void>
}
export interface D1UserNeutralCandidateInput {
  readonly revisionId: string
  readonly binding: D1SiteBindingV1
  readonly resolved: D1ResolvedBindingV1
  readonly runtimeInputs: D1RuntimeInputsIdentityV1
}
export interface D1PreparedUserNeutralCandidate extends D1UserNeutralCandidateInput {
  readonly recipe: WorkspaceAgentRuntimeRecipe
  readonly workspaceAllocation: Readonly<Pick<D1PreparedWorkspaceAllocation, 'workspaceId' | 'ref' | 'versionFingerprint'>>
  dispose(): Promise<void>
}
export interface D1UserNeutralCandidatePreloader {
  prepare(input: D1UserNeutralCandidateInput): Promise<D1PreparedUserNeutralCandidate>
}

interface RetainedPreparation {
  readonly signature: string
  holders: number
  prepared: Promise<Readonly<{ recipe: WorkspaceAgentRuntimeRecipe; workspaceAllocation: Readonly<Pick<D1PreparedWorkspaceAllocation, 'workspaceId' | 'ref' | 'versionFingerprint'>> }>>
  workspaceAllocation?: D1PreparedWorkspaceAllocation
  release?: Promise<void>
}

function failed(): never {
  throw new D1HostError(D1HostErrorCode.PUBLICATION_FAILED, { field: 'preload' })
}
function immutableCopy<T>(value: T): T {
  const copy = structuredClone(value)
  const freeze = (item: unknown): void => {
    if (typeof item !== 'object' || item === null || Object.isFrozen(item)) return
    for (const child of Object.values(item)) freeze(child)
    Object.freeze(item)
  }
  freeze(copy); return copy
}

export function createD1UserNeutralCandidatePreloader(options: {
  readonly loadValidatedRecipe: (input: D1UserNeutralCandidateInput) => Promise<WorkspaceAgentRuntimeRecipe>
  readonly prepareWorkspaceAllocation: (input: D1UserNeutralCandidateInput) => Promise<D1PreparedWorkspaceAllocation>
}): D1UserNeutralCandidatePreloader {
  const retained = new Map<string, RetainedPreparation>()
  const release = async (key: string, entry: RetainedPreparation): Promise<void> => {
    if (!entry.workspaceAllocation) return
    entry.release ??= entry.workspaceAllocation.dispose().then(() => {
      if (retained.get(key) === entry) retained.delete(key)
    }, (error) => { entry.release = undefined; throw error })
    await entry.release
  }
  const prepare = async (raw: D1UserNeutralCandidateInput): Promise<D1PreparedUserNeutralCandidate> => {
      const snapshot = immutableCopy(raw)
      const revisionId = strictD1Ref(snapshot.revisionId, 'preload.revisionId')
      const runtimeInputs = await canonicalizeD1RuntimeInputsIdentity(snapshot.runtimeInputs, snapshot.binding)
      if (snapshot.resolved.bindingId !== snapshot.binding.bindingId
        || snapshot.resolved.workspace.workspaceId !== snapshot.binding.workspaceId
        || snapshot.resolved.workspace.defaultDeploymentId !== snapshot.binding.defaultDeploymentId
        || snapshot.resolved.deployment.deploymentId !== snapshot.binding.defaultDeploymentId
        || runtimeInputs.workspaceAllocation.ref !== snapshot.binding.workspaceAllocationRef) failed()
      const input = immutableCopy({ ...snapshot, revisionId, runtimeInputs })
      const key = [revisionId, input.binding.workspaceId, input.binding.defaultDeploymentId, input.resolved.resolvedDigest,
        input.runtimeInputs.digest, input.runtimeInputs.workspaceAllocation.ref, input.runtimeInputs.workspaceAllocation.versionFingerprint].join('\0')
      const signature = JSON.stringify(input)
      let entry = retained.get(key)
      if (entry && entry.signature !== signature) failed()
      if (entry?.holders === 0 && entry.workspaceAllocation) {
        await release(key, entry).catch(() => failed())
        return prepare(raw)
      }
      if (!entry) {
        entry = { signature, holders: 0, prepared: undefined as never }
        const created = entry
        entry.prepared = (async () => {
          let owned: D1PreparedWorkspaceAllocation | undefined
          try {
            owned = await options.prepareWorkspaceAllocation(input)
            const recipe = await options.loadValidatedRecipe(input)
            if (owned.workspaceId !== input.binding.workspaceId
              || owned.ref !== input.runtimeInputs.workspaceAllocation.ref
              || owned.versionFingerprint !== input.runtimeInputs.workspaceAllocation.versionFingerprint
              || recipe.workspaceId !== input.binding.workspaceId
              || recipe.defaultDeploymentId !== input.binding.defaultDeploymentId
              || recipe.resolvedDigest !== input.resolved.resolvedDigest) failed()
            const workspaceAllocation = Object.freeze({ workspaceId: owned.workspaceId, ref: owned.ref, versionFingerprint: owned.versionFingerprint })
            created.workspaceAllocation = Object.freeze({ ...workspaceAllocation, dispose: () => owned!.dispose() })
            return Object.freeze({ recipe: immutableCopy(recipe), workspaceAllocation })
          } catch {
            if (owned && !created.workspaceAllocation) created.workspaceAllocation = Object.freeze({ workspaceId: owned.workspaceId,
              ref: owned.ref, versionFingerprint: owned.versionFingerprint, dispose: () => owned!.dispose() })
            await release(key, created).catch(() => {})
            failed()
          }
        })()
        retained.set(key, entry)
      }
      entry.holders += 1
      let prepared: Awaited<typeof entry.prepared>
      try { prepared = await entry.prepared } catch (error) {
        entry.holders -= 1
        if (entry.holders === 0 && entry.workspaceAllocation) await release(key, entry).catch(() => {})
        else if (entry.holders === 0 && retained.get(key) === entry) retained.delete(key)
        throw error
      }
      let disposed = false
      return Object.freeze({ ...input, ...prepared, async dispose() {
        if (!disposed) { disposed = true; entry!.holders -= 1 }
        if (entry!.holders === 0 && retained.get(key) === entry) await release(key, entry!)
      } })
  }
  return Object.freeze({ prepare })
}
