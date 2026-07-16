import { createHash } from 'node:crypto'
import path from 'node:path'

import { createAgentAssetDigest } from '@hachej/boring-agent/shared'
import { resolveAgentDeployment } from '@hachej/boring-agent/server'

import { loadAgentHostAgentArtifactInputs, validateAgentHostAgentArtifact } from './agentHostAgentArtifactSnapshot.js'
import type { AgentHostCollectionLimits } from './bootCollection.js'
import type { AgentHostDesiredResolver } from './agentHostCommand.js'
import { AgentHostError, AgentHostErrorCode, assertAgentHostExactKeys, strictAgentHostId, strictAgentHostRef, type AgentHostPlanV1, type AgentHostSiteBindingV1 } from './agentHostPlan.js'
import { openAgentHostSecureRoot, readAgentHostSecureFile } from './agentHostFileRuntimeInputsProvider.js'
import { createAgentHostDesiredSnapshot, type AgentHostDesiredSnapshotV1, type AgentHostResolvedBindingV1 } from './agentHostRevisionCodec.js'
import { canonicalizeWorkspaceCompositionSnapshot } from './workspaceComposition.js'
import type { AgentHostRevisionStore, AgentHostStoredCompleteV1 } from './hostRevisionStore.js'

export const AGENT_HOST_ALLOCATION_INPUT_ROOT = '/etc/boring/agent-host/workspace-allocations'
export const agentHostAllocationFileName = (hostId: string, bindingId: string) => `${createHash('sha256').update(`${hostId}\0${bindingId}`).digest('hex')}.json`
function failed(): never { throw new AgentHostError(AgentHostErrorCode.PUBLICATION_FAILED, { field: 'resolver' }) }
export async function canonicalizeAgentHostWorkspaceAllocation(raw: unknown, hostId: string, binding: AgentHostSiteBindingV1, index = 0): Promise<AgentHostResolvedBindingV1['composition']> {
  assertAgentHostExactKeys(raw, ['schemaVersion', 'domain', 'hostId', 'bindingId', 'workspaceAllocationRef', 'composition'], `allocations[${index}]`)
  if (raw.schemaVersion !== 1 || raw.domain !== 'boring-agent-host-workspace-allocation:v1' || strictAgentHostId(raw.hostId, 'hostId') !== hostId
    || strictAgentHostRef(raw.bindingId, 'bindingId') !== binding.bindingId || strictAgentHostRef(raw.workspaceAllocationRef, 'workspaceAllocationRef') !== binding.workspaceAllocationRef) failed()
  assertAgentHostExactKeys(raw.composition, ['snapshot', 'workspaceCompositionDigest'], `allocations[${index}].composition`)
  const snapshot = canonicalizeWorkspaceCompositionSnapshot(raw.composition.snapshot); const digest = await createAgentAssetDigest(JSON.stringify(snapshot))
  if (raw.composition.workspaceCompositionDigest !== digest || snapshot.workspaceId !== binding.workspaceId) failed()
  return Object.freeze({ snapshot, digest })
}

export function createAgentHostRootDesiredResolver(options: {
  readonly hostId: string; readonly ownerUid: number; readonly limits: AgentHostCollectionLimits; readonly root?: string
  readonly revisionStore: Pick<AgentHostRevisionStore, 'readAgentArtifact'>
}): AgentHostDesiredResolver {
  const validate = async (desired: AgentHostDesiredSnapshotV1, storedRevision?: string) => {
    const artifacts = storedRevision ? await Promise.all(desired.plan.bindings.map(async (binding) => {
      const envelope = await options.revisionStore.readAgentArtifact(options.hostId, storedRevision, binding.bindingId); if (!envelope) failed(); return { envelope }
    })) : await loadAgentHostAgentArtifactInputs({ hostId: options.hostId, ownerUid: options.ownerUid, limits: options.limits,
      inputs: desired.plan.bindings.map((binding, index) => ({ binding, compositionDigest: desired.resolvedBindings[index]!.composition.digest })) })
    await Promise.all(artifacts.map(({ envelope }, index) => validateAgentHostAgentArtifact(envelope, desired.plan.bindings[index]!, desired.resolvedBindings[index]!)))
    return desired
  }
  const resolve = async (plan: AgentHostPlanV1) => {
    let root
    try {
      root = await openAgentHostSecureRoot(options.root ?? AGENT_HOST_ALLOCATION_INPUT_ROOT, { uid: options.ownerUid, gid: process.getegid!() }, false)
      const allocations = await Promise.all(plan.bindings.map(async (binding, index): Promise<{ composition: AgentHostResolvedBindingV1['composition'] }> => {
        const bytes = await readAgentHostSecureFile(path.join(root!.path, agentHostAllocationFileName(options.hostId, binding.bindingId)), root!,
          { uid: options.ownerUid, gid: process.getegid!() }, 1024 * 1024)
        try {
          return { composition: await canonicalizeAgentHostWorkspaceAllocation(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), options.hostId, binding, index) }
        } finally { bytes.fill(0) }
      }))
      const artifacts = await loadAgentHostAgentArtifactInputs({ hostId: options.hostId, ownerUid: options.ownerUid, limits: options.limits,
        inputs: plan.bindings.map((binding, index) => ({ binding, compositionDigest: allocations[index]!.composition.digest })) })
      const resolved = await Promise.all(artifacts.map(async ({ envelope }, index) => {
        const binding = plan.bindings[index]!; const composition = allocations[index]!.composition
        const value = await resolveAgentDeployment(envelope.bundle, envelope.deployment, { workspaceId: binding.workspaceId,
          defaultDeploymentId: binding.defaultDeploymentId, workspaceCompositionDigest: composition.digest })
        return Object.freeze({ schemaVersion: 1 as const, bindingId: binding.bindingId, composition, workspace: value.workspace,
          deployment: value.deployment, definition: value.definition, resolvedDigest: value.resolvedDigest })
      }))
      return createAgentHostDesiredSnapshot(plan, resolved)
    } catch { failed() } finally { await root?.handle.close() }
  }
  return Object.freeze({ resolvePlan: resolve, async reproduce(target: AgentHostStoredCompleteV1) {
    return validate(await createAgentHostDesiredSnapshot({ ...target.desired.plan, expectedHostRevision: null }, target.desired.resolvedBindings), target.revisionId)
  } })
}
