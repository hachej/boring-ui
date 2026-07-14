import { createAgentAssetDigest, createAgentDeploymentDigest, type Sha256Digest } from '@hachej/boring-agent/shared'
import { createResolvedAgentDigest } from '@hachej/boring-agent/server'
import { describe, expect, it } from 'vitest'

import { createD1CollectionController, type D1PreparedBindingHandle } from '../bootCollection.js'
import { D1HostErrorCode, type D1HostPlanV1 } from '../d1Plan.js'
import { createD1DesiredSnapshot, deriveD1SecretRefsEnvelope, digestD1Desired, type D1DesiredSnapshotV1 } from '../d1RevisionCodec.js'
import { createD1RuntimeInputsIdentity } from '../d1RuntimeInputs.js'
import type { D1StoredCandidateV1 } from '../hostRevisionStore.js'
import { canonicalizeWorkspaceCompositionSnapshot } from '../workspaceComposition.js'

const sha = (value: string): Sha256Digest => `sha256:${value.repeat(64).slice(0, 64)}`
const limits = { maxBindings: 4, maxBundleBytes: 10, maxTotalBundleBytes: 24, maxConcurrentPreloads: 2 }

async function fixture(ids: readonly string[], variant = '1'): Promise<D1DesiredSnapshotV1> {
  const bindings = ids.map((id) => ({
    bindingId: id, hostname: `${id}.example.test`, workspaceId: `workspace:${id}`, defaultDeploymentId: `deployment:${id}`,
    bundleRef: `bundle-${id}`, deploymentRef: `deployment-${id}`, workspaceAllocationRef: `workspace-${id}`,
    sessionAllocationRef: `session-${id}`, ownerPrincipalRef: 'owner', landing: { title: id, summary: 'Summary.' },
    environmentRef: 'production', secretRefs: [`secret-${id}`],
  }))
  const resolvedBindings = await Promise.all(bindings.map(async (binding) => {
    const snapshot = canonicalizeWorkspaceCompositionSnapshot({
      schemaVersion: 1, domain: 'boring-workspace-composition:v1', workspaceId: binding.workspaceId,
      runtimeProfile: { ref: 'runsc-eu', id: 'runsc', version: '1', contentDigest: sha('a'), isolationAttestationDigest: sha('b'), workspaceRootPolicyRef: 'workspace-roots', sessionRootPolicyRef: 'session-roots' },
      hostAppImageDigest: sha('c'), serverPlugins: [], defaultPluginPackages: [], staticSystemPromptDigest: sha('d'),
      inventories: { capabilities: [], tools: [], skills: [], mcpServers: [] }, provisioning: [], filesystemBindings: [], policies: { externalPlugins: false, pluginAuthoring: false },
    })
    const compositionDigest = await createAgentAssetDigest(JSON.stringify(snapshot))
    const definition = { definitionId: `definition:${binding.bindingId}`, version: variant, digest: sha(variant), instructionsRef: 'instructions.md' }
    const deploymentInput = { deploymentId: binding.defaultDeploymentId, version: variant, agentId: 'default', definition: { definitionId: definition.definitionId, version: definition.version, digest: definition.digest } }
    const deploymentDigest = await createAgentDeploymentDigest(deploymentInput)
    return { schemaVersion: 1 as const, bindingId: binding.bindingId, composition: { snapshot, digest: compositionDigest }, workspace: { workspaceId: binding.workspaceId, defaultDeploymentId: binding.defaultDeploymentId, compositionDigest }, deployment: { deploymentId: deploymentInput.deploymentId, version: deploymentInput.version, agentId: deploymentInput.agentId, digest: deploymentDigest }, definition, resolvedDigest: await createResolvedAgentDigest({ workspaceId: binding.workspaceId, defaultDeploymentId: binding.defaultDeploymentId, workspaceCompositionDigest: compositionDigest, definitionDigest: definition.digest, deploymentDigest }) }
  }))
  return createD1DesiredSnapshot({ schemaVersion: 1, hostId: 'host-1', expectedHostRevision: null, hostAppImageDigest: sha('c'), runtimeProfileRef: 'runsc-eu', databaseRef: 'postgres-eu', workspaceRootPolicyRef: 'workspace-roots', sessionRootPolicyRef: 'session-roots', bindings }, resolvedBindings)
}
async function candidate(desired: D1DesiredSnapshotV1, revisionId: string): Promise<D1StoredCandidateV1> {
  return { revisionId, desired, desiredStateDigest: await digestD1Desired(desired), secretRefs: deriveD1SecretRefsEnvelope(desired) }
}
async function runtimeInputs(desired: D1DesiredSnapshotV1, environment = 'e') {
  return Promise.all(desired.plan.bindings.map((binding) => createD1RuntimeInputsIdentity(binding, {
    environment: { versionFingerprint: sha(environment) }, workspaceAllocation: { versionFingerprint: sha('f') },
    sessionAllocation: { versionFingerprint: sha('1') }, secrets: binding.secretRefs.map((secretRef) => ({ secretRef, providerVersionFingerprint: sha('2') })),
  })))
}
function plan(desired: D1DesiredSnapshotV1): D1HostPlanV1 { return { ...desired.plan, expectedHostRevision: null } }
function handle(id: string, disposed: string[]): D1PreparedBindingHandle & { ping(): string } {
  return { async dispose() { disposed.push(id) }, ping: () => `alive:${id}` }
}

describe('D1 collection controller', () => {
  it('resolves every binding independently in canonical order and rejects caps before runtime creation', async () => {
    const desired = await fixture(['b', 'a']); const resolved = new Map(desired.resolvedBindings.map((value) => [value.bindingId, value]))
    const calls: string[] = []; const preloads: string[] = []
    let size = 6
    const controller = createD1CollectionController({ limits, resolveBinding: async (binding) => { calls.push(binding.bindingId); return { resolved: resolved.get(binding.bindingId)!, bundleBytes: size } }, preloadBinding: async (binding) => { preloads.push(binding.bindingId); return handle(binding.bindingId, []) } })
    const output = await controller.resolver.resolvePlan(plan(desired))
    expect(calls).toEqual(['a', 'b']); expect(output.resolvedBindings.map((value) => value.bindingId)).toEqual(['a', 'b'])
    size = 7; await expect(controller.resolver.resolvePlan(plan(desired))).rejects.toMatchObject({ code: D1HostErrorCode.COLLECTION_NOT_READY }); size = 6
    await expect(createD1CollectionController({ limits: { ...limits, maxBindings: 1 }, resolveBinding: async () => { throw new Error('must not resolve') }, preloadBinding: async () => { throw new Error('must not preload') } }).resolver.resolvePlan(plan(desired)))
      .rejects.toMatchObject({ code: D1HostErrorCode.COLLECTION_LIMIT_EXCEEDED, details: { field: 'bindings' } })
    const over = createD1CollectionController({ limits: { ...limits, maxTotalBundleBytes: 11 }, resolveBinding: async (binding) => ({ resolved: resolved.get(binding.bindingId)!, bundleBytes: 6 }), preloadBinding: async (binding) => { preloads.push(binding.bindingId); return handle(binding.bindingId, []) } })
    await expect(over.resolver.resolvePlan(plan(desired))).rejects.toMatchObject({ code: D1HostErrorCode.COLLECTION_LIMIT_EXCEEDED })
    expect(preloads).toEqual([])
  })

  it('bounds concurrent preloads and disposes every candidate handle after partial failure', async () => {
    const desired = await fixture(['a', 'b', 'c']); const resolved = new Map(desired.resolvedBindings.map((value) => [value.bindingId, value]))
    const disposed: string[] = []; let active = 0; let peak = 0
    const controller = createD1CollectionController({ limits, resolveBinding: async (binding) => ({ resolved: resolved.get(binding.bindingId)!, bundleBytes: 2 }), preloadBinding: async (binding) => {
      active++; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 5)); active--
      if (binding.bindingId === 'c') throw new Error('/private/preload')
      return handle(binding.bindingId, disposed)
    } })
    const output = await controller.resolver.resolvePlan(plan(desired)); const value = await candidate(output, 'r0000000001')
    await expect(controller.preload(value, await runtimeInputs(output))).rejects.toMatchObject({ code: D1HostErrorCode.COLLECTION_NOT_READY })
    expect(peak).toBe(2); expect(disposed.sort()).toEqual(['a', 'b']); expect(controller.snapshot()).toBeNull()
  })

  it('rejects invalid observation identity before creating a runtime', async () => {
    const desired = await fixture(['a']); const resolved = desired.resolvedBindings[0]!; const loaded: string[] = []
    const controller = createD1CollectionController({ limits, resolveBinding: async () => ({ resolved, bundleBytes: 2 }), preloadBinding: async () => { loaded.push('a'); return handle('a', []) } })
    const output = await controller.resolver.resolvePlan(plan(desired)); const inputs = await runtimeInputs(output)
    const malformed = [{ ...inputs[0]!, environment: { ...inputs[0]!.environment, ref: 'wrong-environment' } }]
    await expect(controller.preload(await candidate(output, 'r0000000001'), malformed)).rejects.toMatchObject({ code: D1HostErrorCode.COLLECTION_NOT_READY })
    expect(loaded).toEqual([]); expect(controller.snapshot()).toBeNull()
  })

  it('atomically serves additive candidates while retained handles and prior snapshots stay live', async () => {
    const initial = await fixture(['a']); const additive = await fixture(['a', 'b'])
    const sources = new Map(additive.resolvedBindings.map((value) => [value.bindingId, value])); const disposed: string[] = []; const preloads: string[] = []
    const controller = createD1CollectionController({ limits, resolveBinding: async (binding) => ({ resolved: sources.get(binding.bindingId)!, bundleBytes: 4 }), preloadBinding: async (binding) => { preloads.push(binding.bindingId); return handle(binding.bindingId, disposed) } })
    const first = await controller.resolver.resolvePlan(plan(initial)); const firstCandidate = await candidate(first, 'r0000000001')
    await controller.preload(firstCandidate, await runtimeInputs(first)); await controller.serve({ schemaVersion: 1, revisionId: firstCandidate.revisionId, desiredStateDigest: firstCandidate.desiredStateDigest })
    const before = controller.snapshot()!; const captured = before.lookup('a')!.handle as ReturnType<typeof handle>
    const ownerChanged = await createD1DesiredSnapshot({ ...plan(initial), bindings: [{ ...initial.plan.bindings[0]!, ownerPrincipalRef: 'other-owner' }] }, initial.resolvedBindings)
    const changed = await controller.resolver.resolvePlan(plan(ownerChanged)); await expect(controller.preload(await candidate(changed, 'r0000000009'), await runtimeInputs(changed))).rejects.toMatchObject({ code: D1HostErrorCode.ACTIVE_BINDING_RESTART_REQUIRED })
    const next = await controller.resolver.resolvePlan(plan(additive)); const nextCandidate = await candidate(next, 'r0000000002')
    await controller.preload(nextCandidate, await runtimeInputs(next))
    await expect(controller.serve({ schemaVersion: 1, revisionId: 'r0000000003', desiredStateDigest: nextCandidate.desiredStateDigest })).rejects.toMatchObject({ code: D1HostErrorCode.COLLECTION_NOT_READY })
    const ack = await controller.serve({ schemaVersion: 1, revisionId: nextCandidate.revisionId, desiredStateDigest: nextCandidate.desiredStateDigest }); const after = controller.snapshot()!
    expect(ack).toEqual({ revisionId: 'r0000000002', desiredStateDigest: nextCandidate.desiredStateDigest }); expect(preloads).toEqual(['a', 'b'])
    expect(before.bindingIds).toEqual(['a']); expect(before.lookup('b')).toBeUndefined(); expect(after.bindingIds).toEqual(['a', 'b'])
    expect(after.lookup('a')!.handle).toBe(captured); expect(captured.ping()).toBe('alive:a'); expect(disposed).toEqual([])
  })

  it('rejects replacement/removal and discards only an unused candidate addition', async () => {
    const initial = await fixture(['a']); const additive = await fixture(['a', 'b']); const replacement = await fixture(['a'], '3'); const removal = await fixture(['b'])
    let sources = new Map(additive.resolvedBindings.map((value) => [value.bindingId, value])); const disposed: string[] = []
    const loaded: string[] = []; const controller = createD1CollectionController({ limits, resolveBinding: async (binding) => ({ resolved: sources.get(binding.bindingId)!, bundleBytes: 4 }), preloadBinding: async (binding) => { loaded.push(binding.bindingId); return handle(binding.bindingId, disposed) } })
    const first = await controller.resolver.resolvePlan(plan(initial)); const one = await candidate(first, 'r0000000001'); await controller.preload(one, await runtimeInputs(first)); await controller.serve({ schemaVersion: 1, revisionId: one.revisionId, desiredStateDigest: one.desiredStateDigest })
    const unchanged = await controller.resolver.resolvePlan(plan(initial)); await expect(controller.preload(await candidate(unchanged, 'r0000000002'), await runtimeInputs(unchanged, '9'))).rejects.toMatchObject({ code: D1HostErrorCode.ACTIVE_BINDING_RESTART_REQUIRED }); expect(loaded).toEqual(['a'])
    sources = new Map(replacement.resolvedBindings.map((value) => [value.bindingId, value])); const changed = await controller.resolver.resolvePlan(plan(replacement))
    await expect(controller.preload(await candidate(changed, 'r0000000002'), await runtimeInputs(changed))).rejects.toMatchObject({ code: D1HostErrorCode.ACTIVE_BINDING_RESTART_REQUIRED })
    sources = new Map(additive.resolvedBindings.map((value) => [value.bindingId, value])); const next = await controller.resolver.resolvePlan(plan(additive)); const pending = await candidate(next, 'r0000000003')
    await controller.preload(pending, await runtimeInputs(next)); await controller.discardPrepared({ schemaVersion: 1, revisionId: pending.revisionId, desiredStateDigest: pending.desiredStateDigest })
    expect(disposed).toEqual(['b']); expect(controller.snapshot()!.bindingIds).toEqual(['a'])
    sources = new Map(removal.resolvedBindings.map((value) => [value.bindingId, value])); const removed = await controller.resolver.resolvePlan(plan(removal)); await expect(controller.preload(await candidate(removed, 'r0000000004'), await runtimeInputs(removed))).rejects.toMatchObject({ code: D1HostErrorCode.ACTIVE_BINDING_RESTART_REQUIRED })
    expect(disposed).toEqual(['b'])
  })

  it('serializes preload with serve and retains failed cleanup for retry', async () => {
    const initial = await fixture(['a']); const additive = await fixture(['a', 'b']); let sources = new Map(initial.resolvedBindings.map((value) => [value.bindingId, value]))
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve }); let disposeAttempts = 0
    const controller = createD1CollectionController({ limits, resolveBinding: async (binding) => ({ resolved: sources.get(binding.bindingId)!, bundleBytes: 2 }), preloadBinding: async (binding) => { if (binding.bindingId === 'a') await gate; return { async dispose() { if (binding.bindingId === 'b' && ++disposeAttempts === 1) throw new Error('dispose failed') } } } })
    const first = await controller.resolver.resolvePlan(plan(initial)); const one = await candidate(first, 'r0000000001'); const preparing = controller.preload(one, await runtimeInputs(first)); const serving = controller.serve({ schemaVersion: 1, revisionId: one.revisionId, desiredStateDigest: one.desiredStateDigest })
    await Promise.resolve(); expect(controller.snapshot()).toBeNull(); release(); await preparing; await serving
    sources = new Map(additive.resolvedBindings.map((value) => [value.bindingId, value])); const next = await controller.resolver.resolvePlan(plan(additive)); const pending = await candidate(next, 'r0000000002'); await controller.preload(pending, await runtimeInputs(next))
    const identity = { schemaVersion: 1 as const, revisionId: pending.revisionId, desiredStateDigest: pending.desiredStateDigest }
    await expect(controller.discardPrepared(identity)).rejects.toMatchObject({ code: D1HostErrorCode.COLLECTION_NOT_READY }); expect(controller.snapshot()!.bindingIds).toEqual(['a'])
    await controller.discardPrepared(identity); expect(disposeAttempts).toBe(2); expect(controller.snapshot()!.bindingIds).toEqual(['a'])
  })
})
