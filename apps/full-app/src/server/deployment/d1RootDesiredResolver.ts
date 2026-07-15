import { createHash } from 'node:crypto'
import path from 'node:path'

import { createAgentAssetDigest } from '@hachej/boring-agent/shared'
import { resolveAgentDeployment } from '@hachej/boring-agent/server'

import { loadD1AgentArtifactInputs, validateD1AgentArtifact } from './d1AgentArtifactSnapshot.js'
import type { D1CollectionLimits } from './bootCollection.js'
import type { D1DesiredResolver } from './d1Command.js'
import { D1HostError, D1HostErrorCode, assertD1ExactKeys, strictD1HostId, strictD1Ref, type D1HostPlanV1, type D1SiteBindingV1 } from './d1Plan.js'
import { openD1SecureRoot, readD1SecureFile } from './d1FileRuntimeInputsProvider.js'
import { createD1DesiredSnapshot, type D1DesiredSnapshotV1, type D1ResolvedBindingV1 } from './d1RevisionCodec.js'
import { canonicalizeWorkspaceCompositionSnapshot } from './workspaceComposition.js'
import type { D1HostRevisionStore, D1StoredCompleteV1 } from './hostRevisionStore.js'

export const D1_ALLOCATION_INPUT_ROOT = '/etc/boring/d1/workspace-allocations'
export const d1AllocationFileName = (hostId: string, bindingId: string) => `${createHash('sha256').update(`${hostId}\0${bindingId}`).digest('hex')}.json`
function failed(): never { throw new D1HostError(D1HostErrorCode.PUBLICATION_FAILED, { field: 'resolver' }) }
export async function canonicalizeD1WorkspaceAllocation(raw: unknown, hostId: string, binding: D1SiteBindingV1, index = 0): Promise<D1ResolvedBindingV1['composition']> {
  assertD1ExactKeys(raw, ['schemaVersion', 'domain', 'hostId', 'bindingId', 'workspaceAllocationRef', 'composition'], `allocations[${index}]`)
  if (raw.schemaVersion !== 1 || raw.domain !== 'boring-d1-workspace-allocation:v1' || strictD1HostId(raw.hostId, 'hostId') !== hostId
    || strictD1Ref(raw.bindingId, 'bindingId') !== binding.bindingId || strictD1Ref(raw.workspaceAllocationRef, 'workspaceAllocationRef') !== binding.workspaceAllocationRef) failed()
  assertD1ExactKeys(raw.composition, ['snapshot', 'workspaceCompositionDigest'], `allocations[${index}].composition`)
  const snapshot = canonicalizeWorkspaceCompositionSnapshot(raw.composition.snapshot); const digest = await createAgentAssetDigest(JSON.stringify(snapshot))
  if (raw.composition.workspaceCompositionDigest !== digest || snapshot.workspaceId !== binding.workspaceId) failed()
  return Object.freeze({ snapshot, digest })
}

export function createD1RootDesiredResolver(options: {
  readonly hostId: string; readonly ownerUid: number; readonly limits: D1CollectionLimits; readonly root?: string
  readonly revisionStore: Pick<D1HostRevisionStore, 'readAgentArtifact'>
}): D1DesiredResolver {
  const validate = async (desired: D1DesiredSnapshotV1, storedRevision?: string) => {
    const artifacts = storedRevision ? await Promise.all(desired.plan.bindings.map(async (binding) => {
      const envelope = await options.revisionStore.readAgentArtifact(options.hostId, storedRevision, binding.bindingId); if (!envelope) failed(); return { envelope }
    })) : await loadD1AgentArtifactInputs({ hostId: options.hostId, ownerUid: options.ownerUid, limits: options.limits,
      inputs: desired.plan.bindings.map((binding, index) => ({ binding, compositionDigest: desired.resolvedBindings[index]!.composition.digest })) })
    await Promise.all(artifacts.map(({ envelope }, index) => validateD1AgentArtifact(envelope, desired.plan.bindings[index]!, desired.resolvedBindings[index]!)))
    return desired
  }
  const resolve = async (plan: D1HostPlanV1) => {
    let root
    try {
      root = await openD1SecureRoot(options.root ?? D1_ALLOCATION_INPUT_ROOT, { uid: options.ownerUid, gid: process.getegid!() }, false)
      const allocations = await Promise.all(plan.bindings.map(async (binding, index): Promise<{ composition: D1ResolvedBindingV1['composition'] }> => {
        const bytes = await readD1SecureFile(path.join(root!.path, d1AllocationFileName(options.hostId, binding.bindingId)), root!,
          { uid: options.ownerUid, gid: process.getegid!() }, 1024 * 1024)
        try {
          return { composition: await canonicalizeD1WorkspaceAllocation(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), options.hostId, binding, index) }
        } finally { bytes.fill(0) }
      }))
      const artifacts = await loadD1AgentArtifactInputs({ hostId: options.hostId, ownerUid: options.ownerUid, limits: options.limits,
        inputs: plan.bindings.map((binding, index) => ({ binding, compositionDigest: allocations[index]!.composition.digest })) })
      const resolved = await Promise.all(artifacts.map(async ({ envelope }, index) => {
        const binding = plan.bindings[index]!; const composition = allocations[index]!.composition
        const value = await resolveAgentDeployment(envelope.bundle, envelope.deployment, { workspaceId: binding.workspaceId,
          defaultDeploymentId: binding.defaultDeploymentId, workspaceCompositionDigest: composition.digest })
        return Object.freeze({ schemaVersion: 1 as const, bindingId: binding.bindingId, composition, workspace: value.workspace,
          deployment: value.deployment, definition: value.definition, resolvedDigest: value.resolvedDigest })
      }))
      return createD1DesiredSnapshot(plan, resolved)
    } catch { failed() } finally { await root?.handle.close() }
  }
  return Object.freeze({ resolvePlan: resolve, async reproduce(target: D1StoredCompleteV1) {
    return validate(await createD1DesiredSnapshot({ ...target.desired.plan, expectedHostRevision: null }, target.desired.resolvedBindings), target.revisionId)
  } })
}
