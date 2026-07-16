import type { Sha256Digest } from '@hachej/boring-agent/shared'

import type { WorkspaceAgentRuntimeRecipe } from './agentHostAgentRuntimeRecipe.js'
import { AgentHostError, AgentHostErrorCode, strictAgentHostRef, type AgentHostSiteBindingV1 } from './agentHostPlan.js'
import type { AgentHostResolvedBindingV1 } from './agentHostRevisionCodec.js'
import { canonicalizeAgentHostRuntimeInputsIdentity, type AgentHostRuntimeInputsIdentityV1 } from './agentHostRuntimeInputs.js'

export interface AgentHostPreparedWorkspaceAllocation {
  readonly workspaceId: string
  readonly ref: string
  readonly versionFingerprint: Sha256Digest
  dispose(): Promise<void>
}
export interface AgentHostUserNeutralCandidateInput {
  readonly revisionId: string
  readonly binding: AgentHostSiteBindingV1
  readonly resolved: AgentHostResolvedBindingV1
  readonly runtimeInputs: AgentHostRuntimeInputsIdentityV1
}
export interface AgentHostPreparedUserNeutralCandidate extends AgentHostUserNeutralCandidateInput {
  readonly recipe: WorkspaceAgentRuntimeRecipe
  readonly workspaceAllocation: Readonly<Pick<AgentHostPreparedWorkspaceAllocation, 'workspaceId' | 'ref' | 'versionFingerprint'>>
  dispose(): Promise<void>
}
export interface AgentHostUserNeutralCandidatePreloader {
  prepare(input: AgentHostUserNeutralCandidateInput): Promise<AgentHostPreparedUserNeutralCandidate>
}

interface RetainedPreparation {
  readonly signature: string
  holders: number
  prepared: Promise<Readonly<{ recipe: WorkspaceAgentRuntimeRecipe; workspaceAllocation: Readonly<Pick<AgentHostPreparedWorkspaceAllocation, 'workspaceId' | 'ref' | 'versionFingerprint'>> }>>
  workspaceAllocation?: AgentHostPreparedWorkspaceAllocation
  release?: Promise<void>
}

function failed(): never {
  throw new AgentHostError(AgentHostErrorCode.PUBLICATION_FAILED, { field: 'preload' })
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

export function createAgentHostUserNeutralCandidatePreloader(options: {
  readonly loadValidatedRecipe: (input: AgentHostUserNeutralCandidateInput) => Promise<WorkspaceAgentRuntimeRecipe>
  readonly prepareWorkspaceAllocation: (input: AgentHostUserNeutralCandidateInput) => Promise<AgentHostPreparedWorkspaceAllocation>
}): AgentHostUserNeutralCandidatePreloader {
  const retained = new Map<string, RetainedPreparation>()
  const release = async (key: string, entry: RetainedPreparation): Promise<void> => {
    if (!entry.workspaceAllocation) return
    entry.release ??= entry.workspaceAllocation.dispose().then(() => {
      if (retained.get(key) === entry) retained.delete(key)
    }, (error) => { entry.release = undefined; throw error })
    await entry.release
  }
  const prepare = async (raw: AgentHostUserNeutralCandidateInput): Promise<AgentHostPreparedUserNeutralCandidate> => {
      const snapshot = immutableCopy(raw)
      const revisionId = strictAgentHostRef(snapshot.revisionId, 'preload.revisionId')
      const runtimeInputs = await canonicalizeAgentHostRuntimeInputsIdentity(snapshot.runtimeInputs, snapshot.binding)
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
          let owned: AgentHostPreparedWorkspaceAllocation | undefined
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
