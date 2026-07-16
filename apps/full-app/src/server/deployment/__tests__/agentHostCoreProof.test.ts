import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createAgentAssetDigest, createAgentDeploymentDigest, type Sha256Digest } from '@hachej/boring-agent/shared'
import { createResolvedAgentDigest } from '@hachej/boring-agent/server'
import { createDockerRuntimeIsolationEvidence, RUNTIME_ISOLATION_PROBE_IDS } from '@hachej/boring-sandbox/providers/runsc'
import { describe, expect, it } from 'vitest'

import { createAgentHostCollectionController, type AgentHostPreparedBindingHandle } from '../bootCollection.js'
import { captureAgentHostCoreProofRevision, createAgentHostCoreProofBindingIdDigest, createAgentHostCoreProofOperationIdDigest, verifyAgentHostCoreProof, type AgentHostCoreProofBindingV1, type AgentHostCoreProofRevisionV1 } from '../agentHostCoreProof.js'
import { captureAgentHostDrFingerprint } from '../agentHostDrProof.js'
import { AgentHostErrorCode, type AgentHostPlanV1 } from '../agentHostPlan.js'
import { createAgentHostDesiredSnapshot, deriveAgentHostSecretRefsEnvelope, digestAgentHostDesired, type AgentHostDesiredSnapshotV1, type AgentHostResolvedBindingV1 } from '../agentHostRevisionCodec.js'
import { createAgentHostRuntimeInputsIdentity } from '../agentHostRuntimeInputs.js'
import type { AgentHostStoredCandidateV1 } from '../hostRevisionStore.js'
import { canonicalizeWorkspaceCompositionSnapshot } from '../workspaceComposition.js'

const sha = (value: string): Sha256Digest => `sha256:${value.repeat(64).slice(0, 64)}` as Sha256Digest
const bindingDigests = new Map(await Promise.all(['alpha', 'bravo', 'charlie', 'delta'].map(async (id) => [id, await createAgentHostCoreProofBindingIdDigest(id)] as const)))
const rollbackOperationIdDigest = await createAgentHostCoreProofOperationIdDigest('rollback-delta')
const limits = {
  maxBindings: 4,
  maxBundleBytes: 10,
  maxTotalBundleBytes: 40,
  maxConcurrentPreloads: 2,
}

async function desired(ids: readonly string[]): Promise<AgentHostDesiredSnapshotV1> {
  const bindings = ids.map((id) => ({
    bindingId: id,
    hostname: `${id}.customer.example`,
    workspaceId: `workspace:${id}`,
    defaultDeploymentId: `deployment:${id}`,
    bundleRef: `bundle-${id}`,
    deploymentRef: `deployment-${id}`,
    workspaceAllocationRef: `workspace-${id}`,
    sessionAllocationRef: `session-${id}`,
    ownerPrincipalRef: 'owner',
    landing: { title: id, summary: 'Summary.' },
    environmentRef: 'production',
    secretRefs: [`credential-${id}`],
  }))
  const resolved = await Promise.all(
    bindings.map(async (binding) => {
      const composition = canonicalizeWorkspaceCompositionSnapshot({
        schemaVersion: 1,
        domain: 'boring-workspace-composition:v1',
        workspaceId: binding.workspaceId,
        runtimeProfile: {
          ref: 'runsc-eu',
          id: 'runsc',
          version: '1',
          contentDigest: sha('a'),
          isolationAttestationDigest: isolationEvidence().evidenceDigest,
          workspaceRootPolicyRef: 'workspace-roots',
          sessionRootPolicyRef: 'session-roots',
        },
        hostAppImageDigest: sha('c'),
        serverPlugins: [],
        defaultPluginPackages: [],
        staticSystemPromptDigest: sha('d'),
        inventories: {
          capabilities: [],
          tools: [],
          skills: [],
          mcpServers: [],
        },
        provisioning: [],
        filesystemBindings: [],
        policies: { externalPlugins: false, pluginAuthoring: false },
      })
      const compositionDigest = await createAgentAssetDigest(JSON.stringify(composition))
      const definitionDigest = await createAgentAssetDigest(`bundle:${binding.bindingId}`)
      const definition = {
        definitionId: `definition:${binding.bindingId}`,
        version: '1',
        digest: definitionDigest,
        instructionsRef: 'instructions.md',
      }
      const deploymentInput = {
        deploymentId: binding.defaultDeploymentId,
        version: '1',
        agentId: 'default',
        definition: {
          definitionId: definition.definitionId,
          version: definition.version,
          digest: definition.digest,
        },
      }
      const deploymentDigest = await createAgentDeploymentDigest(deploymentInput)
      return {
        schemaVersion: 1 as const,
        bindingId: binding.bindingId,
        composition: { snapshot: composition, digest: compositionDigest },
        workspace: {
          workspaceId: binding.workspaceId,
          defaultDeploymentId: binding.defaultDeploymentId,
          compositionDigest,
        },
        deployment: {
          deploymentId: deploymentInput.deploymentId,
          version: deploymentInput.version,
          agentId: deploymentInput.agentId,
          digest: deploymentDigest,
        },
        definition,
        resolvedDigest: await createResolvedAgentDigest({
          workspaceId: binding.workspaceId,
          defaultDeploymentId: binding.defaultDeploymentId,
          workspaceCompositionDigest: compositionDigest,
          definitionDigest,
          deploymentDigest,
        }),
      }
    }),
  )
  return createAgentHostDesiredSnapshot(
    {
      schemaVersion: 1,
      hostId: 'eu-host',
      expectedHostRevision: null,
      hostAppImageDigest: sha('c'),
      runtimeProfileRef: 'runsc-eu',
      databaseRef: 'postgres-eu',
      workspaceRootPolicyRef: 'workspace-roots',
      sessionRootPolicyRef: 'session-roots',
      bindings,
    },
    resolved,
  )
}
function plan(value: AgentHostDesiredSnapshotV1): AgentHostPlanV1 {
  return { ...value.plan, expectedHostRevision: null }
}
async function candidate(value: AgentHostDesiredSnapshotV1, revisionId: string): Promise<AgentHostStoredCandidateV1> {
  return {
    revisionId,
    desired: value,
    desiredStateDigest: await digestAgentHostDesired(value),
    secretRefs: deriveAgentHostSecretRefsEnvelope(value),
  }
}
async function inputs(value: AgentHostDesiredSnapshotV1) {
  return Promise.all(
    value.plan.bindings.map((binding) =>
      createAgentHostRuntimeInputsIdentity(binding, {
        environment: { versionFingerprint: sha('4') },
        workspaceAllocation: { versionFingerprint: sha('5') },
        sessionAllocation: { versionFingerprint: sha('6') },
        secrets: binding.secretRefs.map((secretRef) => ({
          secretRef,
          providerVersionFingerprint: sha('7'),
        })),
      }),
    ),
  )
}
function handle(binding: AgentHostResolvedBindingV1): AgentHostPreparedBindingHandle {
  return Object.freeze({
    recipe: Object.freeze({
      workspaceId: binding.workspace.workspaceId,
      defaultDeploymentId: binding.workspace.defaultDeploymentId,
      resolvedDigest: binding.resolvedDigest,
      instructions: Object.freeze({
        ref: 'instructions.md',
        content: binding.bindingId,
      }),
    }),
    async dispose() {},
  })
}

function proofBinding(id: string, value: string): AgentHostCoreProofBindingV1 {
  return Object.freeze({
    bindingId: id,
    bindingIdDigest: bindingDigests.get(id)!,
    hostnameDigest: sha(value),
    workspaceIdDigest: sha(value),
    runtimeProfileId: 'runsc',
    runtimeProfileContentDigest: sha('a'),
    isolationAttestationDigest: isolationEvidence().evidenceDigest,
    bundleDigest: sha(value),
    compositionDigest: sha(value),
    deploymentDigest: sha(value),
    resolvedDigest: sha(value),
    runtimeInputsDigest: sha(value),
  })
}
function snapshot(revisionId: string, state: string, bindings: readonly AgentHostCoreProofBindingV1[]): AgentHostCoreProofRevisionV1 {
  return Object.freeze({
    revisionId,
    desiredStateDigest: sha(state),
    coreImageDigest: sha('f'),
    bindings: Object.freeze(bindings),
  })
}
const initialBindings = [proofBinding('alpha', 'a'), proofBinding('bravo', 'b'), proofBinding('charlie', 'c')]
const addition = proofBinding('delta', 'd')
const drIdentity = {
  hostIdentityDigest: sha('1'),
  admissionHistoryDigest: sha('2'),
  admissionRows: 3,
  admittedBindingDigests: initialBindings.map((binding) => binding.bindingIdDigest).sort(),
  journalHistoryDigest: sha('3'),
  journalRows: 2,
  membershipDigest: sha('4'),
  membershipRows: 3,
  revisionHistoryDigest: sha('5'),
  revisionRows: 3,
  completeRevisions: [
    { revisionId: 'r0000000001', desiredStateDigest: sha('6') },
    { revisionId: 'r0000000002', desiredStateDigest: sha('8') },
    { revisionId: 'r0000000003', desiredStateDigest: sha('6') },
  ],
  destructivePublications: [{
    operationIdDigest: rollbackOperationIdDigest,
    state: 'committed' as const,
    expectedRevisionId: 'r0000000002',
    expectedDesiredStateDigest: sha('8'),
    requestedTargetRevisionId: 'r0000000001',
    requestedTargetDesiredStateDigest: sha('6'),
    publicationRevisionId: 'r0000000003',
    publicationDesiredStateDigest: sha('6'),
    removalBindingDigests: [bindingDigests.get('delta')!],
  }],
  activeDesiredStateDigest: sha('6'),
  stateRootDigest: sha('9'),
  workspaceRootDigest: sha('a'),
  workspaceDataDigest: sha('8'),
  sessionRootDigest: sha('b'),
  sessionHistoryDigest: sha('7'),
}
function isolationEvidence() {
  const probes = Object.fromEntries(RUNTIME_ISOLATION_PROBE_IDS.map((id) => [id, { status: 'passed' }]))
  return createDockerRuntimeIsolationEvidence({
    profile: {
      schemaVersion: 2,
      provider: 'runsc',
      launcher: 'docker-runsc',
      privilegeModel: 'docker-runsc-nonroot',
      kernelRelease: '4.19.0-gvisor',
      runtimeVersion: 'release',
      runtimeBinaryDigest: sha('1'),
      rootfsBinaryDigest: sha('2'),
      platformMode: 'systrap',
      containerCapabilities: [],
      workloadIdentity: 'uid-65532-gid-65532',
      networkPolicy: 'isolated-internal-bridge-no-default-route',
      cgroupPolicy: { version: 2, cpuQuotaMicros: 50_000, cpuPeriodMicros: 100_000, memoryBytes: 134_217_728, pidsMax: 64 },
      providerConfigDigest: sha('3'),
      hostPolicyDigest: sha('4'),
    },
    testSuiteDigest: sha('6'),
    probes,
    positiveControls: {
      ownMarkerReadable: true,
      attackerEndpointReachableBeforeHostileCalls: true,
      attackerEndpointReachableAfterHostileCalls: true,
      siblingEndpointReachableFromSibling: true,
      siblingCanaryReadableFromSibling: true,
      siblingAliveBeforeHostileCalls: true,
      siblingAliveAfterHostileCalls: true,
    },
    coldStartLatency: null,
  })
}
function authorizationEvidence(bindingId: string, crossBindingId: string) {
  return {
    bindingId,
    crossBindingId,
    member: {
      outcome: 'allowed', code: null, effectsBefore: 0, effectsAfter: 1, admissionsBefore: 0, admissionsAfter: 1,
      admissionCommittedAt: '2026-07-15T12:00:00.000Z', effectStartedAt: '2026-07-15T12:00:00.001Z',
    },
    nonMember: { outcome: 'denied', code: 'not_member', effectsBefore: 1, effectsAfter: 1, admissionsBefore: 1, admissionsAfter: 1 },
    crossBinding: { outcome: 'denied', code: AgentHostErrorCode.HOST_SCOPE_VIOLATION, effectsBefore: 1, effectsAfter: 1, admissionsBefore: 1, admissionsAfter: 1 },
  }
}
function evidence() {
  return {
    schemaVersion: 1,
    domain: 'boring-agent-host-core-proof:v1',
    initial: snapshot('r0000000001', '6', initialBindings),
    authorization: [authorizationEvidence('alpha', 'bravo'), authorizationEvidence('bravo', 'charlie'), authorizationEvidence('charlie', 'alpha')],
    nPlusOne: {
      revision: snapshot('r0000000002', '8', [...initialBindings, addition]),
      continuity: {
        coreProcessDigestBefore: sha('9'),
        coreProcessDigestAfter: sha('9'),
        restartCountBefore: 2,
        restartCountAfter: 2,
        ingressProcessDigestBefore: sha('0'),
        ingressProcessDigestAfter: sha('0'),
        ingressRestartCountBefore: 1,
        ingressRestartCountAfter: 1,
        composeServiceMutationCount: 0,
        inFlightBindingId: 'alpha',
        inFlightCompleted: true,
        reconnectResolvedDigest: initialBindings[0]!.resolvedDigest,
      },
    },
    rollback: {
      revision: snapshot('r0000000003', '6', initialBindings),
      authorization: {
        operationIdDigest: rollbackOperationIdDigest,
        expectedRevisionId: 'r0000000002',
        expectedDesiredStateDigest: sha('8'),
        requestedTargetRevisionId: 'r0000000001',
        requestedTargetDesiredStateDigest: sha('6'),
        publicationRevisionId: 'r0000000003',
        publicationDesiredStateDigest: sha('6'),
      },
      removedBindingId: 'delta',
      removedBindingAdmitted: false,
      continuity: {
        coreProcessDigestBefore: sha('9'),
        coreProcessDigestAfter: sha('9'),
        restartCountBefore: 2,
        restartCountAfter: 2,
        ingressProcessDigestBefore: sha('0'),
        ingressProcessDigestAfter: sha('0'),
        ingressRestartCountBefore: 1,
        ingressRestartCountAfter: 1,
        composeServiceMutationCount: 0,
      },
    },
    timing: {
      targetSeconds: 900,
      totalSeconds: 901.25,
      stages: [
        { name: 'apply-three', startedAt: '2026-07-15T12:00:00.000Z', completedAt: '2026-07-15T12:06:40.000Z', seconds: 400 },
        { name: 'first-success', startedAt: '2026-07-15T12:06:40.000Z', completedAt: '2026-07-15T12:15:01.250Z', seconds: 501.25 },
      ],
    },
    dr: {
      offline: true,
      ingressStarts: 0,
      source: drIdentity,
      restored: { ...drIdentity },
      readableSessions: 3,
      rpoSeconds: 12.5,
      rtoSeconds: 45.25,
    },
    redaction: { containsSecrets: false, containsRawPaths: false },
  }
}

describe('AgentHost-006 core proof', () => {
  it('captures stable-process three -> four -> exact rollback through the served collection seam', async () => {
    const initial = await desired(['alpha', 'bravo', 'charlie'])
    const additive = await desired(['alpha', 'bravo', 'charlie', 'delta'])
    let sources = new Map(additive.resolvedBindings.map((value) => [value.bindingId, value]))
    let rollbackAllowed = false
    const controller = createAgentHostCollectionController({
      limits,
      resolveBinding: async (binding) => ({
        resolved: sources.get(binding.bindingId)!,
        bundleBytes: 2,
      }),
      preloadBinding: async (binding) => handle(binding),
      commitRollback: async (_authorization, commit) => {
        if (rollbackAllowed) commit()
      },
      retireRemoved: async ({ removals }) => {
        for (const removal of removals) await removal.dispose()
      },
    })
    const first = await controller.resolver.resolvePlan(plan(initial))
    const one = await candidate(first, 'r0000000001')
    await controller.preload(one, await inputs(first))
    await controller.serve({
      schemaVersion: 1,
      revisionId: one.revisionId,
      desiredStateDigest: one.desiredStateDigest,
    })
    const capturedInitial = await captureAgentHostCoreProofRevision(controller)
    const next = await controller.resolver.resolvePlan(plan(additive))
    const two = await candidate(next, 'r0000000002')
    const retainedRecipe = await controller.readRecipe('workspace:alpha')
    await controller.preload(two, await inputs(next))
    await controller.serve({
      schemaVersion: 1,
      revisionId: two.revisionId,
      desiredStateDigest: two.desiredStateDigest,
    })
    const capturedAdd = await captureAgentHostCoreProofRevision(controller)
    expect(await controller.readRecipe('workspace:alpha')).toBe(retainedRecipe)
    const three = await candidate(first, 'r0000000003')
    await controller.preload(three, await inputs(first))
    rollbackAllowed = true
    await controller.serve(
      {
        schemaVersion: 1,
        revisionId: three.revisionId,
        desiredStateDigest: three.desiredStateDigest,
      },
      {
        kind: 'rollback',
        authorization: {
          operationId: 'rollback-delta',
          hostId: 'eu-host',
          expectedRevision: two.revisionId,
          expectedDigest: two.desiredStateDigest,
          targetRevision: three.revisionId,
          targetDigest: three.desiredStateDigest,
          removalBindingIds: ['delta'],
        },
      },
    )
    const capturedRollback = await captureAgentHostCoreProofRevision(controller)

    expect(capturedInitial.bindings).toHaveLength(3)
    expect(capturedAdd.bindings).toHaveLength(4)
    expect(capturedAdd.bindings.slice(0, 3)).toEqual(capturedInitial.bindings)
    expect(capturedRollback).toEqual({ ...capturedInitial, revisionId: 'r0000000003' })
    expect(JSON.stringify([capturedInitial, capturedAdd, capturedRollback])).not.toMatch(/customer\.example|workspace:/)

    const makeRoots = async () => {
      const root = await mkdtemp(join(tmpdir(), 'agent-host-core-dr-proof-'))
      const hostRoot = join(root, 'state')
      const workspaceRoot = join(root, 'workspaces')
      const sessionRoot = join(root, 'sessions')
      for (const revision of ['r0000000001', 'r0000000002', 'r0000000003']) await mkdir(join(hostRoot, 'revisions', revision), { recursive: true })
      await mkdir(join(hostRoot, 'revisions', '.r0000000004.00000000-0000-4000-8000-000000000000'))
      await mkdir(workspaceRoot)
      await mkdir(sessionRoot)
      await writeFile(join(hostRoot, 'active'), 'r0000000003\n')
      await writeFile(join(workspaceRoot, 'canary.txt'), 'canary-secret-must-stay-digested\n')
      await writeFile(join(sessionRoot, 'session.jsonl'), [
        '{"type":"session","version":3,"id":"session","timestamp":"2026-07-15T12:00:00.000Z","cwd":"/workspace"}',
        '{"type":"message","id":"turn-1","parentId":null,"timestamp":"2026-07-15T12:00:00.001Z","message":{"role":"user","content":"restored"}}',
      ].join('\n') + '\n')
      return { hostRoot, workspaceRoot, sessionRoot }
    }
    const rows = async () => ({
      admissions: [{ sequence: '1', binding_id: 'alpha' }, { sequence: '2', binding_id: 'bravo' }, { sequence: '3', binding_id: 'charlie' }],
      journal: ['prepared', 'committed'].map((state, index) => ({
        sequence: String(index + 1), operation_id: 'rollback-delta', state,
        expected_revision: two.revisionId, expected_digest: two.desiredStateDigest,
        source_revision: one.revisionId, source_digest: one.desiredStateDigest,
        target_revision: three.revisionId, target_digest: three.desiredStateDigest,
        removal_binding_ids: ['delta'], recorded_at: new Date(`2026-07-15T12:00:00.00${index}Z`),
      })),
      membership: [{ workspace: 'alpha' }, { workspace: 'bravo' }, { workspace: 'charlie' }],
    })
    const revisions = new Map([one, two, three].map((value) => [value.revisionId, value]))
    const revisionReader = { readComplete: async (revisionId: string) => {
      const value = revisions.get(revisionId)
      return value ? { ...value, observation: {}, completion: {
        status: 'COMPLETE', revisionId, desiredStateDigest: value.desiredStateDigest,
      } } as never : null
    } }
    const restoredRoots = await makeRoots()
    const captureDr = () => captureAgentHostDrFingerprint({ reader: controller, revisionReader, hostId: 'eu-host', ...restoredRoots, readRows: rows })
    const sourceDr = await captureDr()
    const restoredDr = await captureDr()
    expect(restoredDr).toEqual(sourceDr)
    expect(restoredDr.readableSessions).toBe(1)
    expect(JSON.stringify(restoredDr)).not.toMatch(/agent-host-core-dr-proof|canary-secret|session\.jsonl/)
    await expect(captureAgentHostDrFingerprint({ reader: controller,
      revisionReader: { readComplete: async (revisionId: string) => revisionId === 'r0000000002' ? null : revisionReader.readComplete(revisionId) },
      hostId: 'eu-host', ...restoredRoots, readRows: rows })).rejects.toMatchObject({ code: AgentHostErrorCode.PROOF_INVALID })
    await expect(captureAgentHostDrFingerprint({ reader: controller, revisionReader, hostId: 'eu-host', ...restoredRoots,
      sessionRoot: restoredRoots.workspaceRoot, readRows: rows })).rejects.toMatchObject({ code: AgentHostErrorCode.PROOF_INVALID })
    await writeFile(join(restoredRoots.workspaceRoot, 'canary.txt'), 'changed\n')
    const driftedDr = await captureDr()
    expect(driftedDr.identity.workspaceDataDigest).not.toBe(sourceDr.identity.workspaceDataDigest)
    await writeFile(join(restoredRoots.sessionRoot, 'session.jsonl'), '{"type":"session","version":3,"id":"session","timestamp":"2026-07-15T12:00:00.000Z","cwd":"/workspace"}\n')
    const unreadableDr = await captureDr()
    expect(unreadableDr.readableSessions).toBe(0)
    await writeFile(join(restoredRoots.sessionRoot, 'session.jsonl'), [
      '{"type":"session","version":3,"id":"session","timestamp":"2026-07-15T12:00:00.000Z","cwd":"/workspace"}',
      '{"type":"pi_session_file","timestamp":"2026-07-15T12:00:00.001Z","path":"/source/sessions/native_native-linked.jsonl"}',
    ].join('\n') + '\n')
    await writeFile(join(restoredRoots.sessionRoot, 'native_native-linked.jsonl'), [
      '{"type":"session","version":3,"id":"native-linked","timestamp":"2026-07-15T12:00:00.000Z","cwd":"/workspace"}',
      '{"type":"message","id":"turn-1","parentId":null,"timestamp":"2026-07-15T12:00:00.001Z","message":{"role":"user","content":"orphaned"}}',
    ].join('\n') + '\n')
    const staleLinkDr = await captureDr()
    expect(staleLinkDr.readableSessions).toBe(0)
    await writeFile(join(restoredRoots.sessionRoot, 'session.jsonl'), [
      '{"type":"session","version":3,"id":"session","timestamp":"2026-07-15T12:00:00.000Z","cwd":"/workspace"}',
      JSON.stringify({ type: 'pi_session_file', timestamp: '2026-07-15T12:00:00.001Z', path: join(restoredRoots.sessionRoot, 'native_native-linked.jsonl') }),
    ].join('\n') + '\n')
    const linkedDr = await captureDr()
    expect(linkedDr.readableSessions).toBe(1)
    await writeFile(join(restoredRoots.sessionRoot, 'native_native-linked.jsonl'), [
      '{"type":"message","id":"turn-1","parentId":null,"timestamp":"2026-07-15T12:00:00.001Z","message":{"role":"user","content":"not-openable"}}',
      '{"type":"session","version":3,"id":"native-linked","timestamp":"2026-07-15T12:00:00.000Z","cwd":"/workspace"}',
    ].join('\n') + '\n')
    const invalidOrderDr = await captureDr()
    expect(invalidOrderDr.readableSessions).toBe(0)
    await writeFile(join(restoredRoots.sessionRoot, 'native_native-linked.jsonl'), [
      '{"type":"session","version":1,"id":"native-linked","timestamp":"2026-07-15T12:00:00.000Z","cwd":"/workspace"}',
      '{"type":"message","message":{"role":"user","content":"legacy-readable"}}',
    ].join('\n') + '\n')
    const legacyDr = await captureDr()
    expect(legacyDr.readableSessions).toBe(1)
  })

  it('accepts complete evidence even when the measured target is missed', async () => {
    expect(await verifyAgentHostCoreProof(evidence(), isolationEvidence())).toEqual(
      expect.objectContaining({
        status: 'pass',
        bindings: { initial: 3, nPlusOne: 4, rollback: 3 },
        timing: { totalSeconds: 901.25, targetSeconds: 900, targetMet: false },
        dr: { rpoSeconds: 12.5, rtoSeconds: 45.25, ingressStarts: 0 },
      }),
    )
  })

  it('allows bindings to reuse content-addressed definition and runtime assets', async () => {
    const value = structuredClone(evidence())
    const shared = (revision: AgentHostCoreProofRevisionV1): AgentHostCoreProofRevisionV1 => ({ ...revision,
      bindings: revision.bindings.map((binding) => ({ ...binding, bundleDigest: sha('f'), deploymentDigest: sha('e'), runtimeInputsDigest: sha('c') })) })
    value.initial = shared(value.initial)
    value.nPlusOne.revision = shared(value.nPlusOne.revision)
    value.rollback.revision = shared(value.rollback.revision)
    await expect(verifyAgentHostCoreProof(value, isolationEvidence())).resolves.toMatchObject({ status: 'pass' })
  })

  it.each([
    [
      'retained identity drift',
      (value: ReturnType<typeof evidence>) => {
        value.nPlusOne.revision = {
          ...value.nPlusOne.revision,
          bindings: [proofBinding('alpha', 'e'), ...value.nPlusOne.revision.bindings.slice(1)],
        }
      },
    ],
    [
      'binding id digest mismatch',
      (value: ReturnType<typeof evidence>) => {
        value.initial = { ...value.initial, bindings: [{ ...value.initial.bindings[0]!, bindingIdDigest: sha('e') }, ...value.initial.bindings.slice(1)] }
      },
    ],
    [
      'retained runtime-input drift',
      (value: ReturnType<typeof evidence>) => {
        value.nPlusOne.revision = {
          ...value.nPlusOne.revision,
          bindings: [{ ...value.nPlusOne.revision.bindings[0]!, runtimeInputsDigest: sha('e') }, ...value.nPlusOne.revision.bindings.slice(1)],
        }
      },
    ],
    [
      'served isolation attestation drift',
      (value: ReturnType<typeof evidence>) => {
        value.initial = { ...value.initial, bindings: [{ ...value.initial.bindings[0]!, isolationAttestationDigest: sha('e') }, ...value.initial.bindings.slice(1)] }
      },
    ],
    [
      'mixed runtime-profile definitions',
      (value: ReturnType<typeof evidence>) => {
        value.nPlusOne.revision = { ...value.nPlusOne.revision,
          bindings: [...value.nPlusOne.revision.bindings.slice(0, 3), { ...value.nPlusOne.revision.bindings[3]!, runtimeProfileContentDigest: sha('e') }] }
      },
    ],
    [
      'new-binding in-flight turn',
      (value: ReturnType<typeof evidence>) => {
        value.nPlusOne.continuity.inFlightBindingId = 'delta'
        value.nPlusOne.continuity.reconnectResolvedDigest = addition.resolvedDigest
      },
    ],
    [
      'unchanged additive desired digest',
      (value: ReturnType<typeof evidence>) => {
        value.nPlusOne.revision = { ...value.nPlusOne.revision, desiredStateDigest: value.initial.desiredStateDigest }
      },
    ],
    [
      'non-member effect',
      (value: ReturnType<typeof evidence>) => {
        value.authorization[0]!.nonMember.effectsAfter = 2
      },
    ],
    [
      'effect before admission',
      (value: ReturnType<typeof evidence>) => {
        value.authorization[0]!.member.effectStartedAt = '2026-07-15T11:59:59.999Z'
      },
    ],
    [
      'missing binding authorization proof',
      (value: ReturnType<typeof evidence>) => {
        value.authorization[2] = authorizationEvidence('bravo', 'alpha')
      },
    ],
    [
      'missing cross-binding target coverage',
      (value: ReturnType<typeof evidence>) => {
        value.authorization[2]!.crossBindingId = 'bravo'
      },
    ],
    [
      'ingress restart during N+1',
      (value: ReturnType<typeof evidence>) => {
        value.nPlusOne.continuity.ingressRestartCountAfter = 2
      },
    ],
    [
      'timing total inconsistent with stages',
      (value: ReturnType<typeof evidence>) => {
        value.timing.totalSeconds = 800
      },
    ],
    [
      'missing first-success timing stage',
      (value: ReturnType<typeof evidence>) => {
        value.timing.stages = value.timing.stages.slice(0, 1)
      },
    ],
    [
      'rollback not tied to historical target revision',
      (value: ReturnType<typeof evidence>) => {
        value.rollback.authorization.requestedTargetRevisionId = 'r0000000002'
      },
    ],
    [
      'rollback not tied to committed journal publication',
      (value: ReturnType<typeof evidence>) => {
        value.rollback.authorization.operationIdDigest = sha('e')
      },
    ],
    [
      'durable rollback source mismatch',
      (value: ReturnType<typeof evidence>) => {
        value.dr.source.destructivePublications[0]!.requestedTargetDesiredStateDigest = sha('e')
        value.dr.restored.destructivePublications[0]!.requestedTargetDesiredStateDigest = sha('e')
      },
    ],
    [
      'admitted removal',
      (value: ReturnType<typeof evidence>) => {
        value.rollback.removedBindingAdmitted = true
      },
    ],
    [
      'empty restored admission history',
      (value: ReturnType<typeof evidence>) => {
        value.dr.restored.admissionRows = 0
      },
    ],
    [
      'admitted rolled-back addition',
      (value: ReturnType<typeof evidence>) => {
        const admitted = [initialBindings[1]!.bindingIdDigest, initialBindings[2]!.bindingIdDigest, addition.bindingIdDigest].sort()
        value.dr.source.admittedBindingDigests = admitted
        value.dr.restored.admittedBindingDigests = [...admitted]
      },
    ],
    [
      'DR history drift',
      (value: ReturnType<typeof evidence>) => {
        value.dr.restored.journalHistoryDigest = sha('8')
      },
    ],
    [
      'DR logical session root drift',
      (value: ReturnType<typeof evidence>) => {
        value.dr.restored.sessionRootDigest = sha('e')
      },
    ],
    [
      'DR exact rollback source missing from COMPLETE history',
      (value: ReturnType<typeof evidence>) => {
        value.dr.source.completeRevisions[0] = { revisionId: 'r0000000001', desiredStateDigest: sha('e') }
        value.dr.restored.completeRevisions[0] = { revisionId: 'r0000000001', desiredStateDigest: sha('e') }
      },
    ],
  ])('rejects %s with one stable code', async (_name, mutate) => {
    const value = structuredClone(evidence())
    mutate(value)
    await expect(verifyAgentHostCoreProof(value, isolationEvidence())).rejects.toMatchObject({
        code: AgentHostErrorCode.PROOF_INVALID,
        details: { field: 'proof' },
    })
  })

  it('rejects isolation evidence whose canonical digest does not verify', async () => {
    const hostile = { ...isolationEvidence(), evidenceDigest: sha('0') }
    await expect(verifyAgentHostCoreProof(evidence(), hostile)).rejects.toMatchObject({ code: AgentHostErrorCode.PROOF_INVALID })
  })

  it('never echoes a secret value or raw path in proof errors', async () => {
    const hostile = {
      ...evidence(),
      leaked: '/private/operator/restore TOKEN=canary-secret',
    }
    const error = await (async () => {
      try {
        await verifyAgentHostCoreProof(hostile, isolationEvidence())
      } catch (caught) {
        return caught
      }
    })()
    expect(error).toMatchObject({
      code: AgentHostErrorCode.PROOF_INVALID,
      details: { field: 'proof' },
    })
    expect(JSON.stringify(error)).toBe('{"code":"AGENT_HOST_PROOF_INVALID","details":{"field":"proof"},"name":"AgentHostError"}')
    expect(JSON.stringify(error)).not.toMatch(/private|operator|TOKEN|canary|secret/)
  })
})
