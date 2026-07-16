import { createAgentAssetDigest, createAgentDeploymentDigest, type Sha256Digest } from '@hachej/boring-agent/shared'
import { createResolvedAgentDigest } from '@hachej/boring-agent/server'
import { describe, expect, it } from 'vitest'

import { createAgentHostCommandEngine, type AgentHostCommandEngineOptions, type AgentHostRuntimeInputsInspectionV1 } from '../agentHostCommand.js'
import type { AgentHostDestructivePublicationIdentity } from '../destructivePublicationJournal.js'
import type { AgentHostFencedDestructivePublication } from '../fencedDestructivePublication.js'
import { AgentHostError, AgentHostErrorCode } from '../agentHostPlan.js'
import {
  canonicalizeAgentHostAuditRecord,
  canonicalizeAgentHostObservation,
  createAgentHostCompleteEnvelope,
  createAgentHostDesiredSnapshot,
  deriveAgentHostSecretRefsEnvelope,
  digestAgentHostDesired,
  isAgentHostTerminalAuditFor,
  type AgentHostActiveEnvelopeV1,
  type AgentHostAuditRecordV1,
  type AgentHostDesiredSnapshotV1,
  type AgentHostObservationV1,
} from '../agentHostRevisionCodec.js'
import { AgentHostActivePublishError, type AgentHostRevisionStore, type AgentHostStoredCandidateV1, type AgentHostStoredCompleteV1 } from '../hostRevisionStore.js'
import { canonicalizeWorkspaceCompositionSnapshot } from '../workspaceComposition.js'
import { createAgentHostRuntimeInputsIdentity, type AgentHostRuntimeInputsAttestationV1, type AgentHostRuntimeInputsIdentityV1 } from '../agentHostRuntimeInputs.js'
import type { AgentHostLoadedAgentArtifact } from '../agentHostAgentArtifactSnapshot.js'

const sha = (value: string): Sha256Digest => `sha256:${value.repeat(64).slice(0, 64)}`
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
interface BindingSpec {
  id: string; landing?: string; hostname?: string; workspace?: string; deployment?: string; bundle?: string; deploymentRef?: string
  workspaceAllocation?: string; sessionAllocation?: string; owner?: string; environment?: string; secretRefs?: readonly string[]
  compositionVersion?: string; deploymentVersion?: string; definitionVersion?: string
}
interface HostSpec { hostImage?: Sha256Digest; runtimeProfile?: string; database?: string; workspacePolicy?: string; sessionPolicy?: string }

async function desired(specs: readonly BindingSpec[] = [{ id: 'insurance' }], host: HostSpec = {}): Promise<AgentHostDesiredSnapshotV1> {
  const hostImage = host.hostImage ?? sha('a'); const runtimeProfile = host.runtimeProfile ?? 'runsc-eu'
  const workspacePolicy = host.workspacePolicy ?? 'workspace-roots'; const sessionPolicy = host.sessionPolicy ?? 'session-roots'
  const planBindings = []
  const resolvedBindings = []
  for (const spec of specs) {
    const workspaceId = spec.workspace ?? `workspace:${spec.id}`; const deploymentId = spec.deployment ?? `deployment:${spec.id}`
    const snapshot = canonicalizeWorkspaceCompositionSnapshot({
      schemaVersion: 1, domain: 'boring-workspace-composition:v1', workspaceId,
      runtimeProfile: { ref: runtimeProfile, id: 'runsc', version: '2026.07.12', contentDigest: sha('b'), isolationAttestationDigest: sha('c'), workspaceRootPolicyRef: workspacePolicy, sessionRootPolicyRef: sessionPolicy },
      hostAppImageDigest: hostImage, serverPlugins: spec.compositionVersion ? [{ id: 'plugin', version: spec.compositionVersion, contentDigest: sha('8') }] : [], defaultPluginPackages: [], staticSystemPromptDigest: sha('e'),
      inventories: { capabilities: [], tools: [], skills: null, mcpServers: null }, provisioning: [], filesystemBindings: [],
      policies: { externalPlugins: false, pluginAuthoring: false },
    })
    const compositionDigest = await createAgentAssetDigest(JSON.stringify(snapshot))
    const version = spec.definitionVersion ?? '1.0.0'
    const definition = { definitionId: `definition:${spec.id}`, version, digest: sha(version === '1.0.0' ? 'f' : '9'), instructionsRef: 'instructions.md' }
    const deploymentInput = { deploymentId, version: spec.deploymentVersion ?? '2026.07.12', agentId: 'default', definition: { definitionId: definition.definitionId, version, digest: definition.digest } }
    const deploymentDigest = await createAgentDeploymentDigest(deploymentInput)
    const resolvedDigest = await createResolvedAgentDigest({ workspaceId: snapshot.workspaceId, defaultDeploymentId: deploymentInput.deploymentId, workspaceCompositionDigest: compositionDigest, definitionDigest: definition.digest, deploymentDigest })
    planBindings.push({ bindingId: spec.id, hostname: spec.hostname ?? `${spec.id}.example.test`, workspaceId: snapshot.workspaceId, defaultDeploymentId: deploymentInput.deploymentId, bundleRef: spec.bundle ?? 'bundle', deploymentRef: spec.deploymentRef ?? 'deployment', workspaceAllocationRef: spec.workspaceAllocation ?? `${spec.id}-workspace-allocation`, sessionAllocationRef: spec.sessionAllocation ?? `${spec.id}-session-allocation`, ownerPrincipalRef: spec.owner ?? 'owner', landing: { title: spec.landing ?? spec.id, summary: 'Summary.' }, environmentRef: spec.environment ?? 'production', secretRefs: spec.secretRefs ?? ['credential-ref'] })
    resolvedBindings.push({ schemaVersion: 1, bindingId: spec.id, composition: { snapshot, digest: compositionDigest }, workspace: { workspaceId: snapshot.workspaceId, defaultDeploymentId: deploymentInput.deploymentId, compositionDigest }, deployment: { deploymentId: deploymentInput.deploymentId, version: deploymentInput.version, agentId: 'default', digest: deploymentDigest }, definition, resolvedDigest })
  }
  return createAgentHostDesiredSnapshot({ schemaVersion: 1, hostId: 'host-1', expectedHostRevision: null, hostAppImageDigest: hostImage, runtimeProfileRef: runtimeProfile, databaseRef: host.database ?? 'postgres-eu', workspaceRootPolicyRef: workspacePolicy, sessionRootPolicyRef: sessionPolicy, bindings: planBindings }, resolvedBindings)
}
interface RuntimeVersionSpec { environment?: string; workspace?: string; session?: string; secret?: string }
function attestations(value: AgentHostDesiredSnapshotV1, versions: RuntimeVersionSpec = {}) {
  return value.plan.bindings.map((binding) => ({
    bindingId: binding.bindingId,
    attestation: {
      environment: { versionFingerprint: sha(versions.environment ?? '1') },
      workspaceAllocation: { versionFingerprint: sha(versions.workspace ?? '2') },
      sessionAllocation: { versionFingerprint: sha(versions.session ?? '3') },
      secrets: binding.secretRefs.map((secretRef) => ({ secretRef, providerVersionFingerprint: sha(versions.secret ?? '4') })),
    } satisfies AgentHostRuntimeInputsAttestationV1,
  }))
}
async function runtimeIdentities(value: AgentHostDesiredSnapshotV1, versions: RuntimeVersionSpec = {}) {
  return Promise.all(attestations(value, versions).map(({ bindingId, attestation }) =>
    createAgentHostRuntimeInputsIdentity(value.plan.bindings.find((binding) => binding.bindingId === bindingId)!, attestation)))
}
function observation(value: AgentHostDesiredSnapshotV1, identities: readonly AgentHostRuntimeInputsIdentityV1[]): AgentHostObservationV1 {
  const runtime = new Map(identities.map((identity) => [identity.bindingId, identity]))
  return { schemaVersion: 1, domain: 'boring-agent-host-observed:v1', bindings: value.resolvedBindings.map((binding) => ({ bindingId: binding.bindingId, ready: true, resolvedDigest: binding.resolvedDigest, runtimeInputs: runtime.get(binding.bindingId)! })) }
}

class FakeStore implements AgentHostRevisionStore {
  active: AgentHostActiveEnvelopeV1 | null = null
  completes = new Map<string, AgentHostStoredCompleteV1>()
  candidates = new Map<string, AgentHostStoredCandidateV1>()
  observations = new Map<string, AgentHostObservationV1>()
  reserved = new Set<string>()
  audits: AgentHostAuditRecordV1[] = []
  calls: string[] = []
  adapterErrors: Partial<Record<'inspect' | 'materialize' | 'preload', unknown>> = {}
  materializedOutput?: readonly AgentHostRuntimeInputsInspectionV1[]
  materializedVersions: RuntimeVersionSpec = {}
  fault?: 'candidate' | 'materialize' | 'preload' | 'observation' | 'completion' | 'publish-before' | 'publish-after' | 'publish-unknown-null' | 'publish-unknown-current' | 'publish-unknown-new' | 'publish-unknown-read-fail' | 'verify' | 'audit-complete' | 'audit-all'
  failReadActive = false
  targetArtifactError?: Error
  next = 1
  candidateArtifacts = new Map<string, readonly AgentHostLoadedAgentArtifact[]>()
  async seed(value: AgentHostDesiredSnapshotV1, revisionId = 'r0000000001', terminal = true, versions: RuntimeVersionSpec = {}) {
    const desiredStateDigest = await digestAgentHostDesired(value)
    const observed = observation(value, await runtimeIdentities(value, versions))
    const completion = await createAgentHostCompleteEnvelope(revisionId, value, observed)
    const complete = Object.freeze({ revisionId, desired: value, desiredStateDigest, secretRefs: deriveAgentHostSecretRefsEnvelope(value), observation: observed, completion })
    this.completes.set(revisionId, complete); this.active = { schemaVersion: 1, revisionId, desiredStateDigest }; this.next = Number(revisionId.slice(1)) + 1
    if (terminal) this.audits.push(this.record(complete))
    return complete
  }
  record(complete: AgentHostStoredCompleteV1): AgentHostAuditRecordV1 {
    return { schemaVersion: 1, domain: 'boring-agent-host-audit:v1', revisionId: complete.revisionId, desiredStateDigest: complete.desiredStateDigest, completionDigest: complete.completion.completionDigest, at: '2026-07-12T00:00:00.000Z', operator: { uid: 1000, effectiveUser: 'julien', invocationId: 'deploy-1' }, outcome: 'COMPLETE', phase: 'AUDIT' }
  }
  async reserveRevisionId() { this.calls.push('reserve'); const revision = `r${String(this.next++).padStart(10, '0')}`; this.reserved.add(revision); return revision }
  async writeCandidate(_host: string, revisionId: string, value: AgentHostDesiredSnapshotV1, artifacts: readonly AgentHostLoadedAgentArtifact[]) {
    this.calls.push('candidate'); if (this.fault === 'candidate') throw new Error('/secret/candidate')
    if (!this.reserved.has(revisionId) || this.candidates.has(revisionId)) throw new AgentHostError(AgentHostErrorCode.REVISION_CONFLICT, { field: 'candidate' })
    const candidate = Object.freeze({ revisionId, desired: value, desiredStateDigest: await digestAgentHostDesired(value), secretRefs: deriveAgentHostSecretRefsEnvelope(value) })
    this.candidates.set(revisionId, candidate); this.candidateArtifacts.set(revisionId, artifacts); return candidate
  }
  async readCandidate(_host: string, revisionId: string) { return this.candidates.get(revisionId) ?? null }
  async writeObservation(_host: string, revisionId: string, value: AgentHostObservationV1) {
    this.calls.push('observation'); if (this.fault === 'observation') throw new Error('/secret/observation')
    const candidate = this.candidates.get(revisionId); if (!candidate || this.observations.has(revisionId)) throw new AgentHostError(AgentHostErrorCode.COLLECTION_NOT_READY, { field: 'observation' })
    const canonical = await canonicalizeAgentHostObservation(value, candidate.desired); this.observations.set(revisionId, canonical); return canonical
  }
  async writeComplete(_host: string, revisionId: string) {
    this.calls.push('completion'); if (this.fault === 'completion') throw new Error('/secret/completion')
    const candidate = this.candidates.get(revisionId)!; const observed = this.observations.get(revisionId)!; const completion = await createAgentHostCompleteEnvelope(revisionId, candidate.desired, observed)
    const complete = Object.freeze({ ...candidate, observation: observed, completion }); this.completes.set(revisionId, complete); return complete
  }
  async readComplete(_host: string, revisionId: string) { this.calls.push(`read:${revisionId}`); return this.completes.get(revisionId) ?? null }
  async readAgentArtifact() { return null }
  async readActive() { this.calls.push('readActive'); if (this.failReadActive) { this.failReadActive = false; throw new Error('/secret/read-active') } return this.active }
  async publishActive(_host: string, revisionId: string) {
    this.calls.push(`publish:${revisionId}`)
    const complete = this.completes.get(revisionId); if (!complete) throw new AgentHostActivePublishError(false)
    if (this.active?.revisionId === revisionId && this.active.desiredStateDigest === complete.desiredStateDigest) return this.active
    if (this.active && Number(revisionId.slice(1)) <= Number(this.active.revisionId.slice(1))) throw new AgentHostActivePublishError(false)
    if (this.fault === 'publish-before') throw new AgentHostActivePublishError(false)
    if (this.fault === 'publish-unknown-null' || this.fault === 'publish-unknown-current') throw new Error('/secret/publish')
    this.active = { schemaVersion: 1, revisionId, desiredStateDigest: complete.desiredStateDigest }
    if (this.fault === 'publish-after') throw new AgentHostActivePublishError(true)
    if (this.fault === 'publish-unknown-new') throw new Error('/secret/publish')
    if (this.fault === 'publish-unknown-read-fail') { this.failReadActive = true; throw new Error('/secret/publish') }
    return this.active
  }
  async readAuditRecords() { return this.audits }
  async appendAudit(_host: string, raw: AgentHostAuditRecordV1) {
    const record = canonicalizeAgentHostAuditRecord(raw); this.calls.push(`audit:${record.outcome}:${record.phase}`)
    if (this.fault === 'audit-all' || (this.fault === 'audit-complete' && record.outcome === 'COMPLETE')) throw new Error('/secret/audit')
    const complete = this.completes.get(record.revisionId)
    if ('completionDigest' in record && (!complete || complete.desiredStateDigest !== record.desiredStateDigest || complete.completion.completionDigest !== record.completionDigest)) throw new AgentHostError(AgentHostErrorCode.PUBLICATION_FAILED, { field: 'audit' })
    if ((record.outcome === 'COMPLETE' || record.outcome === 'RECOVERY_REQUIRED') && (!this.active || this.active.revisionId !== record.revisionId || this.active.desiredStateDigest !== record.desiredStateDigest)) throw new AgentHostError(AgentHostErrorCode.PUBLICATION_FAILED, { field: 'audit' })
    this.audits.push(record)
  }
  async hasTerminalAudit(_host: string, active: AgentHostActiveEnvelopeV1) {
    this.calls.push('hasTerminalAudit'); const complete = this.completes.get(active.revisionId)
    if (!this.active || !complete || !equal(this.active, active)) return false
    return this.audits.some((record) => isAgentHostTerminalAuditFor(record, active, complete.completion))
  }
}

function harness(
  store: FakeStore,
  next: AgentHostDesiredSnapshotV1,
  admitted: readonly string[] = [],
  inspect: (value: AgentHostDesiredSnapshotV1) => Promise<readonly AgentHostRuntimeInputsInspectionV1[]> = async () => attestations(next),
  preload?: (candidate: AgentHostStoredCandidateV1, identities: readonly AgentHostRuntimeInputsIdentityV1[]) => Promise<AgentHostObservationV1>,
  publication?: AgentHostFencedDestructivePublication | null,
) {
  const calls: string[] = []
  const admissionDatabaseRefs: string[] = []
  const publicationCalls: string[] = []
  const published: AgentHostDestructivePublicationIdentity[] = []
  const artifactCalls: string[] = []
  const inboxArtifacts = [{ envelope: { bindingId: 'inbox' } }] as unknown as readonly AgentHostLoadedAgentArtifact[]
  const targetArtifacts = [{ envelope: { bindingId: 'target' } }] as unknown as readonly AgentHostLoadedAgentArtifact[]
  const defaultPublication: AgentHostFencedDestructivePublication = {
    async recoverPending() { publicationCalls.push(`recover:${calls.join(',')}:${store.calls.join(',')}`) },
    async publish(identity) {
      publicationCalls.push(`publish:${store.completes.has(identity.targetRevision)}`); published.push(identity)
      const complete = store.completes.get(identity.targetRevision)
      if (!complete) throw new Error('missing COMPLETE')
      store.active = Object.freeze({ schemaVersion: 1, revisionId: identity.targetRevision, desiredStateDigest: complete.desiredStateDigest })
    },
  }
  const options: AgentHostCommandEngineOptions = {
    store,
    resolver: { async resolvePlan() { calls.push('resolve'); return next }, async reproduce() { calls.push('reproduce'); return next } },
    async inspectRuntimeInputs(value) { calls.push('inspect'); if (store.adapterErrors.inspect) throw store.adapterErrors.inspect; return inspect(value) },
    effects: {
      async loadAgentArtifacts() { artifactCalls.push('inbox'); return inboxArtifacts },
      async loadRevisionAgentArtifacts() { artifactCalls.push('target'); if (store.targetArtifactError) throw store.targetArtifactError; return targetArtifacts },
      async loadAdmittedBindingIds(_hostId, databaseRef) { calls.push('admissions'); admissionDatabaseRefs.push(databaseRef); return admitted },
      async materialize(candidate) {
        calls.push('materialize'); if (store.adapterErrors.materialize) throw store.adapterErrors.materialize
        if (store.fault === 'materialize') throw new Error('/secret/materialize')
        return store.materializedOutput ?? attestations(candidate.desired, store.materializedVersions)
      },
      async preload(candidate, identities) { calls.push('preload'); if (store.adapterErrors.preload) throw store.adapterErrors.preload; if (store.fault === 'preload') throw new Error('/secret/preload'); return preload ? preload(candidate, identities) : observation(candidate.desired, identities) },
      async verifyActive() { calls.push('verify'); if (store.fault === 'verify') throw new Error('/secret/verify') },
    },
    mutationGuard: { assertHeld() { calls.push('guard') } }, operator: { uid: 1000, effectiveUser: 'julien', invocationId: 'deploy-1' }, clock: () => '2026-07-12T00:00:00.000Z',
    ...(publication === null ? {} : { fencedPublication: publication ?? defaultPublication }),
  }
  return { engine: createAgentHostCommandEngine(options), calls, admissionDatabaseRefs, publicationCalls, published, artifactCalls, targetArtifacts }
}
const plan = (value: AgentHostDesiredSnapshotV1, expectedHostRevision: string | null) => ({ ...value.plan, expectedHostRevision })
const apply = (value: AgentHostDesiredSnapshotV1, expectedHostRevision: string | null, extra: Record<string, unknown> = {}) => ({ kind: 'apply', plan: plan(value, expectedHostRevision), ...extra })

describe('AgentHost command engine', () => {
  it('rejects an overlong rollback host before mutation or store access', async () => {
    const next = await desired(); const store = new FakeStore(); const h = harness(store, next)
    await expect(h.engine.execute({ kind: 'rollback', hostId: 'a'.repeat(251), expectedHostRevision: null, targetRevision: 'r0000000001' }))
      .rejects.toMatchObject({ code: AgentHostErrorCode.PLAN_INVALID, details: { field: 'hostId' } })
    expect(h.calls).toEqual([]); expect(store.calls).toEqual([])
  })

  it('keeps plan read-only and rejects a CAS loser before resolve, recovery, reservation, or effects', async () => {
    const next = await desired(); const planStore = new FakeStore(); const planned = harness(planStore, next, [], undefined, undefined, null)
    await planned.engine.execute({ ...apply(next, null), kind: 'plan' })
    expect(planned.calls).toEqual(['admissions', 'resolve', 'inspect']); expect(planStore.calls).toEqual(['readActive']); expect(planned.publicationCalls).toEqual([])
    const store = new FakeStore(); await store.seed(next); store.calls = []; const lost = harness(store, next)
    await expect(lost.engine.execute(apply(next, 'r0000000009'))).rejects.toMatchObject({ code: AgentHostErrorCode.REVISION_CONFLICT })
    expect(lost.calls).toEqual(['guard']); expect(store.calls).toEqual(['readActive', 'read:r0000000001'])
  })

  it('requires and recovers the journal immediately after the mutation guard', async () => {
    const next = await desired(); const store = new FakeStore(); const h = harness(store, next)
    await h.engine.execute(apply(next, null))
    expect(h.publicationCalls[0]).toBe('recover:guard:'); expect(store.calls[0]).toBe('readActive')

    const missingStore = new FakeStore(); const missing = harness(missingStore, next, [], undefined, undefined, null)
    await expect(missing.engine.execute(apply(next, null))).rejects.toMatchObject({ code: AgentHostErrorCode.ROLLBACK_JOURNAL_FAILED, details: { field: 'rollbackJournal' } })
    expect(missing.calls).toEqual(['guard']); expect(missingStore.calls).toEqual([])

    const rollbackStore = new FakeStore(); await rollbackStore.seed(next)
    const missingRollback = harness(rollbackStore, next, [], undefined, undefined, null); rollbackStore.calls = []
    await expect(missingRollback.engine.execute({ kind: 'rollback', hostId: 'host-1', expectedHostRevision: 'r0000000001', targetRevision: 'r0000000001' }))
      .rejects.toMatchObject({ code: AgentHostErrorCode.ROLLBACK_JOURNAL_FAILED })
    expect(missingRollback.calls).toEqual(['guard']); expect(rollbackStore.calls).toEqual([])
  })

  it('fails closed on recovery and rechecks CAS against any recovered pointer', async () => {
    const next = await desired(); const failedStore = new FakeStore()
    const failed = harness(failedStore, next, [], undefined, undefined, { recoverPending: async () => { throw new Error('/secret') }, publish: async () => {} })
    await expect(failed.engine.execute(apply(next, null))).rejects.toMatchObject({ code: AgentHostErrorCode.ROLLBACK_JOURNAL_FAILED, details: { field: 'rollbackJournal' } })
    expect(failed.calls).toEqual(['guard']); expect(failedStore.calls).toEqual([])

    const current = await desired(); const advanced = await desired([{ id: 'insurance', landing: 'advanced' }]); const store = new FakeStore()
    await store.seed(current, 'r0000000001'); await store.seed(advanced, 'r0000000002'); store.active = { schemaVersion: 1, revisionId: 'r0000000001', desiredStateDigest: await digestAgentHostDesired(current) }; store.calls = []
    const recovered = harness(store, current, [], undefined, undefined, { recoverPending: async () => { store.active = { schemaVersion: 1, revisionId: 'r0000000002', desiredStateDigest: await digestAgentHostDesired(advanced) } }, publish: async () => {} })
    await expect(recovered.engine.execute(apply(current, 'r0000000001'))).rejects.toMatchObject({ code: AgentHostErrorCode.REVISION_CONFLICT })
    expect(recovered.calls).toEqual(['guard']); expect(store.calls).toEqual(['readActive', 'read:r0000000002'])
  })

  it('requires duplicate-free exact sorted removal confirmations and blocks admitted removals', async () => {
    const current = await desired([{ id: 'insurance' }, { id: 'travel' }]); const retained = await desired()
    for (const confirmRemove of [undefined, ['travel', 'extra'], ['travel', 'travel']]) {
      const store = new FakeStore(); await store.seed(current); const h = harness(store, retained)
      await expect(h.engine.execute(apply(retained, 'r0000000001', { confirmRemove }))).rejects.toMatchObject({ code: AgentHostErrorCode.DESTRUCTIVE_CONFIRMATION_REQUIRED })
      expect(h.calls).toEqual(['guard']); expect(store.calls).not.toContain('reserve')
    }
    const admitted = new FakeStore(); await admitted.seed(current)
    const blocked = harness(admitted, retained, ['travel'])
    await expect(blocked.engine.execute(apply(retained, 'r0000000001', { confirmRemove: ['travel'] }))).rejects.toMatchObject({ code: AgentHostErrorCode.BINDING_ADMITTED })
    expect(blocked.calls).toEqual(['guard', 'admissions']); expect(admitted.calls).not.toContain('reserve')
    const lost = harness(new FakeStore(), retained, ['insurance'])
    await expect(lost.engine.execute(apply(retained, null))).rejects.toMatchObject({ code: AgentHostErrorCode.BINDING_ADMITTED })
    const stale = harness(admitted, current, ['stale'])
    await expect(stale.engine.execute(apply(current, 'r0000000001'))).rejects.toMatchObject({ code: AgentHostErrorCode.BINDING_ADMITTED })
  })

  it('reads admissions from the active database before rejecting candidate database drift', async () => {
    const current = await desired(); const next = await desired(undefined, { database: 'postgres-next' })
    const store = new FakeStore(); await store.seed(current); const h = harness(store, next)
    await expect(h.engine.execute(apply(next, 'r0000000001'))).rejects.toMatchObject({ code: AgentHostErrorCode.ACTIVE_BINDING_RESTART_REQUIRED })
    expect(h.admissionDatabaseRefs).toEqual(['postgres-eu'])
  })

  it('rejects rollback removal gates before reproduce or runtime inspection', async () => {
    const target = await desired(); const current = await desired([{ id: 'insurance' }, { id: 'travel' }])
    for (const confirmRemove of [undefined, ['travel', 'extra'], ['travel', 'travel']]) {
      const store = new FakeStore(); await store.seed(target, 'r0000000001'); await store.seed(current, 'r0000000002'); store.calls = []
      const h = harness(store, target)
      await expect(h.engine.execute({ kind: 'rollback', hostId: 'host-1', expectedHostRevision: 'r0000000002', targetRevision: 'r0000000001', confirmRemove })).rejects.toMatchObject({ code: AgentHostErrorCode.DESTRUCTIVE_CONFIRMATION_REQUIRED })
      expect(h.calls).toEqual(['guard']); expect(store.calls).not.toContain('reserve')
    }
    const store = new FakeStore(); await store.seed(target, 'r0000000001'); await store.seed(current, 'r0000000002'); store.calls = []
    const h = harness(store, target, ['travel'])
    await expect(h.engine.execute({ kind: 'rollback', hostId: 'host-1', expectedHostRevision: 'r0000000002', targetRevision: 'r0000000001', confirmRemove: ['travel'] })).rejects.toMatchObject({ code: AgentHostErrorCode.BINDING_ADMITTED })
    expect(h.calls).toEqual(['guard', 'admissions']); expect(store.calls).not.toContain('reserve'); expect(store.calls).not.toContain('hasTerminalAudit')
  })

  it('reports advisory plan removals without requiring destructive confirmation', async () => {
    const current = await desired([{ id: 'insurance' }, { id: 'travel' }]); const retained = await desired(); const store = new FakeStore(); await store.seed(current); store.calls = []
    const h = harness(store, retained); const result = await h.engine.execute({ kind: 'plan', plan: plan(retained, 'r0000000001') })
    expect(result).toMatchObject({ kind: 'PLAN', removals: ['travel'] }); expect(h.calls).not.toContain('guard'); expect(store.calls).not.toContain('reserve')
  })

  it('recovers every mutation, directly publishes zero-removal changes, and fences removals', async () => {
    const cases = [
      { current: null, next: await desired(), confirmRemove: undefined },
      { current: await desired(), next: await desired([{ id: 'insurance' }, { id: 'travel' }]), confirmRemove: undefined },
      { current: await desired(), next: await desired([{ id: 'insurance', landing: 'New title' }]), confirmRemove: undefined },
      { current: await desired([{ id: 'insurance' }, { id: 'travel' }]), next: await desired(), confirmRemove: ['travel'] },
    ]
    for (const { current, next, confirmRemove } of cases) {
      const store = new FakeStore(); if (current) await store.seed(current); const h = harness(store, next)
      const result = await h.engine.execute(apply(next, current ? 'r0000000001' : null, confirmRemove ? { confirmRemove } : {}))
      expect(result.action).toBe('CREATE'); expect(h.publicationCalls[0]).toMatch(/^recover:/)
      if (confirmRemove) { expect(h.published).toHaveLength(1); expect(store.calls).not.toContain(`publish:${result.revisionId}`) }
      else { expect(h.published).toEqual([]); expect(store.calls).toContain(`publish:${result.revisionId}`) }
    }
  })

  it.each([
    ['host image', () => desired([{ id: 'insurance' }], { hostImage: sha('7') })],
    ['runtime profile', () => desired([{ id: 'insurance' }], { runtimeProfile: 'runsc-next' })],
    ['database', () => desired([{ id: 'insurance' }], { database: 'postgres-next' })],
    ['workspace root policy', () => desired([{ id: 'insurance' }], { workspacePolicy: 'workspace-roots-next' })],
    ['session root policy', () => desired([{ id: 'insurance' }], { sessionPolicy: 'session-roots-next' })],
  ])('rejects host-level replacement: %s', async (_label, makeNext) => {
    const store = new FakeStore(); await store.seed(await desired())
    const next = await makeNext()
    const h = harness(store, next)
    await expect(h.engine.execute(apply(next, 'r0000000001'))).rejects.toMatchObject({ code: AgentHostErrorCode.ACTIVE_BINDING_RESTART_REQUIRED })
    expect(h.calls).toEqual(['guard', 'admissions']); expect(store.calls).not.toContain('reserve'); expect(store.calls).not.toContain('hasTerminalAudit')
  })

  it.each([
    ['host', () => desired([{ id: 'insurance' }], { database: 'postgres-old' })],
    ['retained plan', () => desired([{ id: 'insurance', environment: 'staging' }])],
  ])('rejects rollback %s replacement before reproduce', async (_label, makeTarget) => {
    const target = await makeTarget(); const current = await desired(); const store = new FakeStore()
    await store.seed(target, 'r0000000001'); await store.seed(current, 'r0000000002'); store.calls = []
    const h = harness(store, target)
    await expect(h.engine.execute({ kind: 'rollback', hostId: 'host-1', expectedHostRevision: 'r0000000002', targetRevision: 'r0000000001' })).rejects.toMatchObject({ code: AgentHostErrorCode.ACTIVE_BINDING_RESTART_REQUIRED })
    expect(h.calls).toEqual(['guard', 'admissions']); expect(store.calls).not.toContain('reserve')
  })

  it.each([
    ['hostname', { hostname: 'replacement.example.test' }], ['workspace', { workspace: 'workspace:replacement' }],
    ['deployment', { deployment: 'deployment:replacement' }], ['bundle', { bundle: 'bundle-next' }],
    ['deployment ref', { deploymentRef: 'deployment-next' }], ['workspace allocation', { workspaceAllocation: 'workspace-allocation-next' }],
    ['session allocation', { sessionAllocation: 'session-allocation-next' }], ['owner', { owner: 'owner-next' }],
    ['environment', { environment: 'staging' }], ['secret refs', { secretRefs: ['credential-next'] }],
  ] as const)('rejects retained plan replacement: %s', async (_label, change) => {
    const store = new FakeStore(); await store.seed(await desired()); const next = await desired([{ id: 'insurance', ...change }])
    const h = harness(store, next)
    await expect(h.engine.execute(apply(next, 'r0000000001'))).rejects.toMatchObject({ code: AgentHostErrorCode.ACTIVE_BINDING_RESTART_REQUIRED })
    expect(h.calls).toEqual(['guard', 'admissions']); expect(store.calls).not.toContain('reserve')
  })

  it.each([
    ['composition/resolved digest', { compositionVersion: '2.0.0' }],
    ['deployment/resolved digest', { deploymentVersion: '2026.07.13' }],
    ['definition/deployment/resolved digest', { definitionVersion: '2.0.0' }],
  ] as const)('rejects retained resolved replacement: %s', async (_label, change) => {
    const store = new FakeStore(); await store.seed(await desired()); const next = await desired([{ id: 'insurance', ...change }])
    const h = harness(store, next)
    await expect(h.engine.execute(apply(next, 'r0000000001'))).rejects.toMatchObject({ code: AgentHostErrorCode.ACTIVE_BINDING_RESTART_REQUIRED })
    expect(h.calls).toEqual(['guard', 'admissions', 'resolve']); expect(store.calls).not.toContain('reserve')
  })

  it.each([
    ['environment', { environment: '9' }], ['workspace allocation', { workspace: '9' }],
    ['session allocation', { session: '9' }], ['secret provider version', { secret: '9' }],
  ] as const)('rejects retained runtime rotation before apply effects: %s', async (_label, versions) => {
    const value = await desired(); const store = new FakeStore(); await store.seed(value); store.calls = []
    const h = harness(store, value, [], async () => attestations(value, versions))
    await expect(h.engine.execute(apply(value, 'r0000000001'))).rejects.toMatchObject({ code: AgentHostErrorCode.ACTIVE_BINDING_RESTART_REQUIRED })
    expect(h.calls).toEqual(['guard', 'admissions', 'resolve', 'inspect']); expect(store.calls).not.toContain('reserve'); expect(store.calls).not.toContain('hasTerminalAudit'); expect(h.calls).not.toContain('materialize')
  })

  it.each([
    ['environment', { environment: '9' }], ['workspace allocation', { workspace: '9' }],
    ['session allocation', { session: '9' }], ['secret provider version', { secret: '9' }],
  ] as const)('rejects retained runtime rotation before rollback effects: %s', async (_label, versions) => {
    const value = await desired(); const store = new FakeStore(); await store.seed(value, 'r0000000001'); await store.seed(value, 'r0000000002'); store.calls = []
    const h = harness(store, value, [], async () => attestations(value, versions))
    await expect(h.engine.execute({ kind: 'rollback', hostId: 'host-1', expectedHostRevision: 'r0000000002', targetRevision: 'r0000000001' })).rejects.toMatchObject({ code: AgentHostErrorCode.ACTIVE_BINDING_RESTART_REQUIRED })
    expect(h.calls).toEqual(['guard', 'admissions', 'reproduce', 'inspect']); expect(store.calls).not.toContain('reserve'); expect(store.calls).not.toContain('hasTerminalAudit'); expect(h.calls).not.toContain('materialize')
  })

  it('rejects malformed inspected binding sets before recovery or reservation', async () => {
    const value = await desired(); const base = attestations(value)
    for (const inspected of [[], [base[0], base[0]], [...base, { ...base[0], bindingId: 'extra' }]]) {
      const store = new FakeStore(); await store.seed(value, 'r0000000001', false); store.calls = []
      const h = harness(store, value, [], async () => inspected)
      await expect(h.engine.execute(apply(value, 'r0000000001'))).rejects.toMatchObject({ code: AgentHostErrorCode.COLLECTION_NOT_READY, details: { field: 'runtimeInputs' } })
      expect(store.calls).not.toContain('reserve'); expect(store.calls).not.toContain('hasTerminalAudit')
    }
  })

  it('uses a fresh resolver identity, repairs a missing terminal audit, then noops without effects', async () => {
    const value = await desired(); const store = new FakeStore(); await store.seed(value, 'r0000000001', false); store.calls = []
    const h = harness(store, value); const result = await h.engine.execute(apply(value, 'r0000000001'))
    expect(result.action).toBe('NOOP'); expect(h.calls).toEqual(['guard', 'admissions', 'resolve', 'inspect']); expect(store.calls).toContain('audit:RECOVERY_REQUIRED:RECOVERY'); expect(store.calls).not.toContain('reserve')
  })

  it('passes engine-owned canonical identities to preload and persists only an exact match', async () => {
    const value = await desired([{ id: 'insurance' }, { id: 'travel' }]); const store = new FakeStore(); let received: readonly AgentHostRuntimeInputsIdentityV1[] = []
    const h = harness(store, value, [], async () => attestations(value).reverse(), async (candidate, identities) => {
      received = identities; return observation(candidate.desired, identities)
    })
    const result = await h.engine.execute(apply(value, null))
    expect(result.action).toBe('CREATE'); expect(received.map((identity) => identity.bindingId)).toEqual(['insurance', 'travel'])
    expect(received[0]).toMatchObject({ domain: 'boring-agent-host-runtime-inputs:v1', digest: expect.stringMatching(/^sha256:/) })
    expect(store.observations.get(result.revisionId!)?.bindings[0].runtimeInputs).toEqual(received[0])
  })

  it('re-inspects after materialization and rejects an intervening provider rotation', async () => {
    const value = await desired(); const store = new FakeStore(); let inspections = 0
    const h = harness(store, value, [], async () => attestations(value, inspections++ === 0 ? {} : { secret: '9' }))
    await expect(h.engine.execute(apply(value, null))).rejects.toMatchObject({ code: AgentHostErrorCode.ACTIVE_BINDING_RESTART_REQUIRED, details: { field: 'runtimeInputs' } })
    expect(h.calls).toEqual(['guard', 'admissions', 'resolve', 'inspect', 'materialize', 'inspect'])
    expect(store.calls).not.toContain('observation'); expect(store.calls).not.toContain('completion')
    expect(store.audits.at(-1)).toMatchObject({ outcome: 'FAILED', phase: 'READINESS' })
  })

  it('rejects ABA when materialization consumes a different version even if providers return to the inspected version', async () => {
    const value = await desired(); const store = new FakeStore(); store.materializedVersions = { secret: '9' }
    const h = harness(store, value, [], async () => attestations(value))
    await expect(h.engine.execute(apply(value, null))).rejects.toMatchObject({ code: AgentHostErrorCode.ACTIVE_BINDING_RESTART_REQUIRED, details: { field: 'runtimeInputs' } })
    expect(h.calls).toEqual(['guard', 'admissions', 'resolve', 'inspect', 'materialize'])
    expect(h.calls).not.toContain('preload'); expect(store.calls).not.toContain('observation'); expect(store.calls).not.toContain('completion')
    expect(store.audits.at(-1)).toMatchObject({ outcome: 'FAILED', phase: 'MATERIALIZE' })
  })

  it('rejects malformed materialized identity sets before reinspection or preload', async () => {
    const value = await desired(); const base = attestations(value)
    for (const output of [[], [base[0], base[0]], [...base, { ...base[0], bindingId: 'extra' }]]) {
      const store = new FakeStore(); store.materializedOutput = output
      const h = harness(store, value)
      await expect(h.engine.execute(apply(value, null))).rejects.toMatchObject({ code: AgentHostErrorCode.COLLECTION_NOT_READY, details: { field: 'materialize' } })
      expect(h.calls).toEqual(['guard', 'admissions', 'resolve', 'inspect', 'materialize']); expect(h.calls).not.toContain('preload')
      expect(store.audits.at(-1)).toMatchObject({ outcome: 'FAILED', phase: 'MATERIALIZE' })
    }
  })

  it('rejects preload runtime drift before observation or COMPLETE persistence', async () => {
    const value = await desired(); const store = new FakeStore()
    const h = harness(store, value, [], async () => attestations(value), async (candidate) =>
      observation(candidate.desired, await runtimeIdentities(candidate.desired, { secret: '9' })))
    await expect(h.engine.execute(apply(value, null))).rejects.toMatchObject({ code: AgentHostErrorCode.ACTIVE_BINDING_RESTART_REQUIRED, details: { field: 'runtimeInputs' } })
    expect(store.calls).not.toContain('observation'); expect(store.calls).not.toContain('completion')
    expect(store.audits.at(-1)).toMatchObject({ outcome: 'FAILED', phase: 'READINESS' })
  })

  it.each([
    ['candidate', 'CANDIDATE'], ['materialize', 'MATERIALIZE'], ['preload', 'READINESS'], ['observation', 'READINESS'], ['completion', 'COMPLETION'],
  ] as const)('records pre-complete %s failure without a completion digest', async (fault, phase) => {
    const value = await desired(); const store = new FakeStore(); store.fault = fault; const h = harness(store, value)
    await expect(h.engine.execute(apply(value, null))).rejects.toMatchObject({ code: AgentHostErrorCode.COLLECTION_NOT_READY })
    expect(store.audits.at(-1)).toMatchObject({ outcome: 'FAILED', phase }); expect(store.audits.at(-1)).not.toHaveProperty('completionDigest')
  })

  it.each([
    ['inspect', AgentHostErrorCode.SECRET_UNAVAILABLE, 'secret'],
    ['materialize', AgentHostErrorCode.ACTIVE_BINDING_RESTART_REQUIRED, 'runtimeInputs'],
    ['preload', AgentHostErrorCode.COLLECTION_NOT_READY, 'readiness'],
  ] as const)('preserves whitelisted %s adapter failures with fixed redacted details', async (phase, code, field) => {
    const value = await desired(); const store = new FakeStore(); store.adapterErrors[phase] = new AgentHostError(code, { field: '/secret/private' })
    const error = await harness(store, value).engine.execute(apply(value, null)).catch((caught) => caught)
    expect(error).toMatchObject({ code, details: { field } }); expect(JSON.stringify(error)).not.toMatch(/secret\/private/)
  })

  it.each([
    ['inspect', 'runtimeInputs'], ['materialize', 'materialize'], ['preload', 'readiness'],
  ] as const)('maps unrecognized typed %s adapter failures to a generic phase error', async (phase, field) => {
    const value = await desired(); const store = new FakeStore(); store.adapterErrors[phase] = new AgentHostError(AgentHostErrorCode.PLAN_INVALID, { field: '/secret/private' })
    const error = await harness(store, value).engine.execute(apply(value, null)).catch((caught) => caught)
    expect(error).toMatchObject({ code: AgentHostErrorCode.COLLECTION_NOT_READY, details: { field } }); expect(JSON.stringify(error)).not.toMatch(/secret\/private/)
  })

  it.each([
    ['inspect', 'runtimeInputs'], ['materialize', 'materialize'], ['preload', 'readiness'],
  ] as const)('redacts unknown %s adapter messages', async (phase, field) => {
    const value = await desired(); const store = new FakeStore(); store.adapterErrors[phase] = new Error('/secret/private adapter failure')
    const error = await harness(store, value).engine.execute(apply(value, null)).catch((caught) => caught)
    expect(error).toMatchObject({ code: AgentHostErrorCode.COLLECTION_NOT_READY, details: { field } }); expect(JSON.stringify(error)).not.toMatch(/secret\/private|adapter failure/)
  })

  it.each([
    ['publish-before', 'FAILED', 'PUBLICATION'], ['publish-after', 'RECOVERY_REQUIRED', 'PUBLICATION'], ['verify', 'RECOVERY_REQUIRED', 'PUBLICATION'], ['audit-complete', 'RECOVERY_REQUIRED', 'AUDIT'],
  ] as const)('maps %s after completion to %s/%s and keeps committed active forward', async (fault, outcome, phase) => {
    const value = await desired(); const store = new FakeStore(); store.fault = fault; const h = harness(store, value)
    await expect(h.engine.execute(apply(value, null))).rejects.toMatchObject({ code: AgentHostErrorCode.PUBLICATION_FAILED })
    expect(store.audits.at(-1)).toMatchObject({ outcome, phase, completionDigest: expect.stringMatching(/^sha256:/) })
    expect(store.active === null).toBe(fault === 'publish-before')
  })

  it.each([
    ['null', 'publish-unknown-null', false, 'FAILED'],
    ['current', 'publish-unknown-current', true, 'FAILED'],
    ['new', 'publish-unknown-new', false, 'RECOVERY_REQUIRED'],
    ['read-fail after commit', 'publish-unknown-read-fail', false, 'RECOVERY_REQUIRED'],
  ] as const)('reconciles unknown publication state: %s', async (_label, fault, seeded, outcome) => {
    const current = await desired(); const next = seeded ? await desired([{ id: 'insurance', landing: 'Changed' }]) : current
    const store = new FakeStore(); if (seeded) await store.seed(current); store.calls = []; store.fault = fault
    await expect(harness(store, next).engine.execute(apply(next, seeded ? 'r0000000001' : null))).rejects.toMatchObject({ code: AgentHostErrorCode.PUBLICATION_FAILED })
    expect(store.audits.at(-1)).toMatchObject({ outcome, phase: 'PUBLICATION' })
    expect(store.active?.revisionId ?? null).toBe(seeded ? 'r0000000001' : outcome === 'FAILED' ? null : 'r0000000001')
  })

  it('keeps active forward when terminal and recovery audits both fail, then repairs on a noop retry', async () => {
    const value = await desired(); const store = new FakeStore(); store.fault = 'audit-all'; const h = harness(store, value)
    await expect(h.engine.execute(apply(value, null))).rejects.toMatchObject({ code: AgentHostErrorCode.PUBLICATION_FAILED })
    expect(store.active?.revisionId).toBe('r0000000001'); expect(store.audits).toEqual([])
    store.fault = undefined; store.calls = []; h.calls.length = 0
    const retried = await h.engine.execute(apply(value, 'r0000000001'))
    expect(retried.action).toBe('NOOP'); expect(store.calls).toContain('audit:RECOVERY_REQUIRED:RECOVERY')
    expect(store.calls).not.toContain('reserve'); expect(h.calls).not.toContain('materialize'); expect(h.calls).not.toContain('preload')
  })

  it('keeps the fault fake aligned with monotonic publication and active COMPLETE audit correlation', async () => {
    const first = await desired(); const store = new FakeStore(); const firstResult = await harness(store, first).engine.execute(apply(first, null))
    const firstActive = store.active!; expect(await store.publishActive('host-1', firstResult.revisionId!)).toEqual(firstActive)
    const second = await desired([{ id: 'insurance', landing: 'Changed' }]); await harness(store, second).engine.execute(apply(second, firstResult.revisionId!))
    await expect(store.publishActive('host-1', firstResult.revisionId!)).rejects.toMatchObject({ committed: false })
    expect(await store.hasTerminalAudit('host-1', { ...firstActive, desiredStateDigest: sha('9') })).toBe(false)
    await expect(store.appendAudit('host-1', store.record(store.completes.get(firstResult.revisionId!)!))).rejects.toMatchObject({ code: AgentHostErrorCode.PUBLICATION_FAILED })
  })

  it('publishes exact APPLY and ROLLBACK removal identities only after the new COMPLETE exists', async () => {
    const retained = await desired(); const expanded = await desired([{ id: 'insurance' }, { id: 'travel' }])
    const applyStore = new FakeStore(); const prior = await applyStore.seed(expanded); applyStore.calls = []; const applying = harness(applyStore, retained)
    const applied = await applying.engine.execute(apply(retained, 'r0000000001', { confirmRemove: ['travel'] }))
    expect(applying.published).toEqual([{ operationId: 'deploy-1', hostId: 'host-1', expectedRevision: 'r0000000001', expectedDigest: prior.desiredStateDigest, targetRevision: 'r0000000002', targetDigest: await digestAgentHostDesired(retained), removalBindingIds: ['travel'] }])
    expect(applying.publicationCalls.at(-1)).toBe('publish:true'); expect(applyStore.calls).not.toContain(`publish:${applied.revisionId}`)

    const rollbackStore = new FakeStore(); await rollbackStore.seed(retained, 'r0000000001'); const active = await rollbackStore.seed(expanded, 'r0000000002'); rollbackStore.calls = []
    const rollingBack = harness(rollbackStore, retained)
    const rolledBack = await rollingBack.engine.execute({ kind: 'rollback', hostId: 'host-1', expectedHostRevision: 'r0000000002', targetRevision: 'r0000000001', confirmRemove: ['travel'] })
    expect(rollingBack.published[0]).toMatchObject({ operationId: 'deploy-1', expectedRevision: 'r0000000002', expectedDigest: active.desiredStateDigest,
      targetRevision: 'r0000000003', sourceRevision: 'r0000000001', sourceDigest: await digestAgentHostDesired(retained), removalBindingIds: ['travel'] })
    expect(rollingBack.artifactCalls).toEqual(['target'])
    expect(rollbackStore.candidateArtifacts.get(rolledBack.revisionId!)).toBe(rollingBack.targetArtifacts)
    expect(rollbackStore.calls).not.toContain('publish:r0000000001'); expect(rollbackStore.calls).not.toContain(`publish:${rolledBack.revisionId}`)
  })

  it('fails closed before reservation when a legacy rollback target has no artifact snapshot', async () => {
    const value = await desired(); const current = await desired([{ id: 'insurance', landing: 'Changed' }]); const store = new FakeStore()
    await store.seed(value, 'r0000000001'); await store.seed(current, 'r0000000002')
    store.calls = []; store.targetArtifactError = new Error('missing legacy artifact')
    await expect(harness(store, value).engine.execute({ kind: 'rollback', hostId: 'host-1', expectedHostRevision: 'r0000000002', targetRevision: 'r0000000001' }))
      .rejects.toMatchObject({ code: AgentHostErrorCode.PUBLICATION_FAILED, details: { field: 'agentArtifacts' } })
    expect(store.calls).not.toContain('reserve')
  })

  it.each([
    ['unknown', new Error('/secret/publish'), AgentHostErrorCode.ROLLBACK_JOURNAL_FAILED],
    ['admitted', new AgentHostError(AgentHostErrorCode.BINDING_ADMITTED, { bindingId: 'travel' }), AgentHostErrorCode.BINDING_ADMITTED],
    ['journal', new AgentHostError(AgentHostErrorCode.ROLLBACK_JOURNAL_FAILED, { field: 'rollbackJournal' }), AgentHostErrorCode.ROLLBACK_JOURNAL_FAILED],
  ])('maps or preserves fenced publication failure: %s, with no fallback or success', async (_label, failure, code) => {
    const retained = await desired(); const expanded = await desired([{ id: 'insurance' }, { id: 'travel' }]); const store = new FakeStore(); await store.seed(expanded); store.calls = []
    const h = harness(store, retained, [], undefined, undefined, { recoverPending: async () => {}, publish: async () => { throw failure } })
    const error = await h.engine.execute(apply(retained, 'r0000000001', { confirmRemove: ['travel'] })).catch((caught) => caught)
    expect(error).toMatchObject({ code }); expect(JSON.stringify(error)).not.toMatch(/secret/)
    expect(store.active?.revisionId).toBe('r0000000001'); expect(store.calls).not.toContain('publish:r0000000002'); expect(h.calls).not.toContain('verify'); expect(store.calls).not.toContain('audit:COMPLETE:AUDIT')
  })

  it('rolls back from a freshly reproduced target into a new higher revision, never the old revision', async () => {
    const targetValue = await desired([{ id: 'insurance', landing: 'Old' }]); const currentValue = await desired([{ id: 'insurance', landing: 'Current' }])
    const store = new FakeStore(); await store.seed(targetValue, 'r0000000001'); await store.seed(currentValue, 'r0000000002'); const h = harness(store, targetValue)
    const result = await h.engine.execute({ kind: 'rollback', hostId: 'host-1', expectedHostRevision: 'r0000000002', targetRevision: 'r0000000001' })
    expect(h.calls).toEqual(expect.arrayContaining(['reproduce', 'preload'])); expect(store.calls).toEqual(expect.arrayContaining(['observation', 'completion', 'publish:r0000000003']))
    expect(store.calls).not.toContain('publish:r0000000001'); expect(result).toMatchObject({ action: 'CREATE', revisionId: 'r0000000003', activeRevision: 'r0000000003' })
  })

  it('rejects rollback reproduction mismatch before reservation and redacts adapter failures', async () => {
    const target = await desired([{ id: 'insurance', landing: 'Old' }]); const current = await desired([{ id: 'insurance', landing: 'Current' }]); const store = new FakeStore(); await store.seed(target, 'r0000000001'); await store.seed(current, 'r0000000002')
    const mismatch = harness(store, current)
    await expect(mismatch.engine.execute({ kind: 'rollback', hostId: 'host-1', expectedHostRevision: 'r0000000002', targetRevision: 'r0000000001' })).rejects.toMatchObject({ code: AgentHostErrorCode.ROLLBACK_TARGET_INVALID })
    expect(store.calls).not.toContain('reserve')
    const failing = new FakeStore(); failing.fault = 'candidate'
    try { await harness(failing, current).engine.execute(apply(current, null)) } catch (error) { expect(JSON.stringify(error)).not.toMatch(/secret|candidate\//) }
  })
})
