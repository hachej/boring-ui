import path from 'node:path'

import { validateD1AgentArtifact } from './d1AgentArtifactSnapshot.js'
import { loadD1AgentArtifactInputs } from './d1AgentArtifactSnapshot.js'
import type { D1CollectionLimits } from './bootCollection.js'
import type { D1DesiredResolver } from './d1Command.js'
import { D1HostError, D1HostErrorCode, type D1HostPlanV1 } from './d1Plan.js'
import { openD1SecureRoot, readD1SecureFile } from './d1FileRuntimeInputsProvider.js'
import { canonicalizeD1DesiredSnapshot, type D1DesiredSnapshotV1 } from './d1RevisionCodec.js'
import type { D1HostRevisionStore, D1StoredCompleteV1 } from './hostRevisionStore.js'

export const D1_RESOLVED_INPUT_ROOT = '/etc/boring/d1/resolved-hosts'
function failed(): never { throw new D1HostError(D1HostErrorCode.PUBLICATION_FAILED, { field: 'resolver' }) }
function persisted(plan: D1HostPlanV1) { const { expectedHostRevision: _expected, ...value } = plan; return value }
function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right) }

export function createD1RootDesiredResolver(options: {
  readonly hostId: string; readonly ownerUid: number; readonly limits: D1CollectionLimits; readonly root?: string
  readonly revisionStore: Pick<D1HostRevisionStore, 'readAgentArtifact'>
}): D1DesiredResolver {
  const validate = async (desired: D1DesiredSnapshotV1, storedRevision?: string) => {
    const artifacts = storedRevision ? await Promise.all(desired.plan.bindings.map(async (binding) => {
      const envelope = await options.revisionStore.readAgentArtifact(options.hostId, storedRevision, binding.bindingId); if (!envelope) failed(); return { envelope }
    })) : await loadD1AgentArtifactInputs({ hostId: options.hostId, ownerUid: options.ownerUid, limits: options.limits,
      inputs: desired.plan.bindings.map((binding, index) => ({ binding, compositionDigest: desired.resolvedBindings[index]!.composition.digest })) })
    if (artifacts.length !== desired.plan.bindings.length) failed()
    await Promise.all(artifacts.map(({ envelope }, index) => validateD1AgentArtifact(envelope, desired.plan.bindings[index]!, desired.resolvedBindings[index]!)))
    return desired
  }
  const load = async () => {
    let root
    try {
      root = await openD1SecureRoot(options.root ?? D1_RESOLVED_INPUT_ROOT, { uid: options.ownerUid, gid: process.getegid!() }, false)
      const bytes = await readD1SecureFile(path.join(root.path, `${options.hostId}.json`), root, { uid: options.ownerUid, gid: process.getegid!() }, 4 * 1024 * 1024)
      try { return await canonicalizeD1DesiredSnapshot(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown) }
      finally { bytes.fill(0) }
    } catch { failed() } finally { await root?.handle.close() }
  }
  return Object.freeze({
    async resolvePlan(plan: D1HostPlanV1) { const desired = await load(); if (!same(desired.plan, persisted(plan))) failed(); return validate(desired) },
    async reproduce(target: D1StoredCompleteV1) { return validate(await canonicalizeD1DesiredSnapshot(target.desired), target.revisionId) },
  })
}
