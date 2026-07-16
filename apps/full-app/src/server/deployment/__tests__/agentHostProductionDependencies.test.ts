import type { AgentHostDesiredSnapshotV1 } from '../agentHostRevisionCodec.js'
import type { AgentHostSiteBindingV1 } from '../agentHostPlan.js'
import { AgentHostError, AgentHostErrorCode } from '../agentHostPlan.js'
import type { AgentHostBindingSecretProvider, AgentHostSecretMaterializerOptions } from '../agentHostSecretMaterializer.js'
import type { AgentHostStoredCandidateV1 } from '../hostRevisionStore.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const seams = vi.hoisted(() => {
  const provider = {
    inspect: vi.fn(async (_binding: AgentHostSiteBindingV1) => ({ metadataOnly: true })),
    resolveSecrets: vi.fn(async (_binding: AgentHostSiteBindingV1) => {
      throw new AgentHostError(AgentHostErrorCode.SECRET_UNAVAILABLE, { field: 'secret' })
    }),
  }
  const unavailable = (field: string) => async () => { throw new AgentHostError(AgentHostErrorCode.COLLECTION_NOT_READY, { field }) }
  const resolver = { resolvePlan: unavailable('resolver'), reproduce: unavailable('resolver') }
  const publication = { preload: unavailable('preload'), verifyActive: unavailable('active'), status: vi.fn(), commit: vi.fn(), discard: vi.fn(), recover: vi.fn() }
  return { provider, resolver, publication, createProvider: vi.fn(() => provider), createInspector: vi.fn(), createMaterializer: vi.fn(),
    loadArtifacts: vi.fn(async () => []), createResolver: vi.fn(() => resolver), createPublication: vi.fn(() => publication), runCompose: vi.fn(async () => {}) }
})

vi.mock('../agentHostFileRuntimeInputsProvider.js', () => ({ createAgentHostFileRuntimeInputsProvider: seams.createProvider }))
vi.mock('../agentHostSecretMaterializer.js', () => ({
  createAgentHostRuntimeInputsInspector: seams.createInspector,
  createAgentHostBindingSecretMaterializer: seams.createMaterializer,
}))
vi.mock('../agentHostAgentArtifactSnapshot.js', () => ({ loadAgentHostAgentArtifactInputs: seams.loadArtifacts }))
vi.mock('../agentHostRootDesiredResolver.js', () => ({ createAgentHostRootDesiredResolver: seams.createResolver }))
vi.mock('../agentHostPublicationControl.js', () => ({ createAgentHostRootPublicationClient: seams.createPublication }))
vi.mock('../composeAdapter.js', () => ({ runAgentHostComposeAction: seams.runCompose }))

import { parseAgentHostIsolatedAuthorityDescriptor } from '../agentHostAuthority.js'
import { createProductionAgentHostDependencies } from '../agentHostCommandEntry.js'

const binding: AgentHostSiteBindingV1 = {
  bindingId: 'insurance', hostname: 'insurance.example.test', workspaceId: 'workspace:insurance',
  defaultDeploymentId: 'deployment:insurance', bundleRef: 'bundle', deploymentRef: 'deployment',
  workspaceAllocationRef: 'insurance-workspace', sessionAllocationRef: 'insurance-session', ownerPrincipalRef: 'owner',
  landing: { title: 'Insurance', summary: 'Compare policies.' }, environmentRef: 'production', secretRefs: ['credential-ref'],
}
const desired = { plan: { bindings: [binding] }, resolvedBindings: [{ composition: { digest: `sha256:${'a'.repeat(64)}` } }] } as unknown as AgentHostDesiredSnapshotV1
const candidate = { desired } as AgentHostStoredCandidateV1

describe('AgentHost production dependency composition', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seams.createProvider.mockReturnValue(seams.provider)
    seams.createInspector.mockImplementation((provider: AgentHostBindingSecretProvider) => async (input: AgentHostDesiredSnapshotV1) => {
      await provider.inspect(input.plan.bindings[0]!)
      return []
    })
    seams.createMaterializer.mockImplementation((options: AgentHostSecretMaterializerOptions) => async (input: AgentHostStoredCandidateV1) => {
      await options.provider.resolveSecrets(input.desired.plan.bindings[0]!)
      return []
    })
  })

  it('shares one host-scoped provider while leaving unfinished dependencies fail-closed', async () => {
    const mutationGuard = { assertHeld: vi.fn() }
    const collectionLimits = { maxBindings: 20, maxBundleBytes: 1000, maxTotalBundleBytes: 10000, maxConcurrentPreloads: 4 }
    const dependencies = createProductionAgentHostDependencies({ hostId: 'host-1', ownerUid: process.geteuid!(), stateRoot: '/unused', collectionLimits, mutationGuard })

    expect(seams.createProvider).toHaveBeenCalledOnce()
    expect(seams.createProvider).toHaveBeenCalledWith({ hostId: 'host-1', ownerUid: process.geteuid!() })
    expect(seams.createInspector).toHaveBeenCalledWith(seams.provider)
    expect(seams.createMaterializer).toHaveBeenCalledWith({
      root: '/run/boring/agent-host', ownerUid: process.geteuid!(), appUid: 10001, appGid: 10001, provider: seams.provider,
    })

    await dependencies.inspectRuntimeInputs(desired)
    expect(seams.provider.inspect).toHaveBeenCalledWith(binding)
    expect(seams.provider.resolveSecrets).not.toHaveBeenCalled()
    await dependencies.effects.loadAgentArtifacts!(desired)
    expect(seams.loadArtifacts).toHaveBeenCalledWith(expect.objectContaining({ hostId: 'host-1', ownerUid: process.geteuid!(), limits: collectionLimits }))
    await expect(dependencies.effects.materialize(candidate, [])).rejects.toMatchObject({
      code: AgentHostErrorCode.SECRET_UNAVAILABLE, details: { field: 'secret' },
    })
    expect(seams.provider.resolveSecrets).toHaveBeenCalledWith(binding)
    await expect(dependencies.resolver.resolvePlan({} as never)).rejects.toMatchObject({
      code: AgentHostErrorCode.COLLECTION_NOT_READY, details: { field: 'resolver' },
    })
    await expect(dependencies.resolver.reproduce({} as never)).rejects.toMatchObject({
      code: AgentHostErrorCode.COLLECTION_NOT_READY, details: { field: 'resolver' },
    })
    await expect(dependencies.effects.loadAdmittedBindingIds('host-1', 'postgres-eu')).rejects.toMatchObject({
      code: AgentHostErrorCode.COLLECTION_NOT_READY, details: { field: 'admissions' },
    })
    await expect(dependencies.effects.preload(candidate, [])).rejects.toMatchObject({
      code: AgentHostErrorCode.COLLECTION_NOT_READY, details: { field: 'preload' },
    })
    await expect(dependencies.effects.verifyActive({} as never)).rejects.toMatchObject({
      code: AgentHostErrorCode.COLLECTION_NOT_READY, details: { field: 'active' },
    })
  })

  it('threads one isolated authority through state, materialization, control, start, status, and recovery seams', async () => {
    const root = '/srv/agent-host-proof-seneca'; const hostId = 'agent-host-proof-eu'
    const authority = parseAgentHostIsolatedAuthorityDescriptor({
      schemaVersion: 1, domain: 'boring-agent-host-authority:v1', mode: 'isolated-proof', authorityRoot: root, hostId,
      operatorUid: process.geteuid!(), composeProject: 'agent-host-proof-seneca', configRoot: `${root}/config`, stateRoot: `${root}/state`,
      materializedRoot: `${root}/materialized`, controlRoot: `${root}/control`, lockRoot: `${root}/locks`, secretRoot: `${root}/secrets`,
      workspaceRoot: `${root}/workspaces`, sessionRoot: `${root}/sessions`, databaseUrlFile: `${root}/secrets/database-url`,
      databaseRef: 'agent_host_proof_seneca', runtimeProfile: { ref: 'runsc-eu', id: 'runsc', launcher: 'docker-runsc', privilegeModel: 'docker-runsc-nonroot', composeRuntime: 'runsc' },
    }, hostId)
    const collectionLimits = { maxBindings: 20, maxBundleBytes: 1000, maxTotalBundleBytes: 10000, maxConcurrentPreloads: 4 }
    createProductionAgentHostDependencies({ hostId, ownerUid: process.geteuid!(), stateRoot: '/normal-must-not-be-used', authority,
      collectionLimits, mutationGuard: { assertHeld: vi.fn() }, admissionLedger: { databaseRef: authority.databaseRef } as never })

    expect(seams.createMaterializer).toHaveBeenCalledWith(expect.objectContaining({ root: authority.materializedRoot }))
    const publicationCalls = seams.createPublication.mock.calls as unknown as Array<[{ hostRoot: string; controlRoot: string; startCore(candidate: AgentHostStoredCandidateV1): Promise<void>; startIngress(candidate: AgentHostStoredCandidateV1): Promise<void> }]>
    const publicationOptions = publicationCalls[0]![0]
    expect(publicationOptions).toMatchObject({ hostRoot: `${authority.stateRoot}/${hostId}`, controlRoot: authority.controlRoot })
    const isolatedCandidate = { desired: { plan: { hostId, hostAppImageDigest: `sha256:${'a'.repeat(64)}`, runtimeProfileRef: 'runsc-eu', databaseRef: authority.databaseRef } } } as AgentHostStoredCandidateV1
    const previousIngress = process.env.AGENT_HOST_INGRESS_IMAGE; const previousCore = process.env.AGENT_HOST_CORE_APP_IMAGE
    process.env.AGENT_HOST_INGRESS_IMAGE = `caddy@sha256:${'b'.repeat(64)}`; process.env.AGENT_HOST_CORE_APP_IMAGE = `boring@sha256:${'a'.repeat(64)}`
    try { await publicationOptions.startCore(isolatedCandidate); await publicationOptions.startIngress(isolatedCandidate) }
    finally {
      previousIngress === undefined ? delete process.env.AGENT_HOST_INGRESS_IMAGE : process.env.AGENT_HOST_INGRESS_IMAGE = previousIngress
      previousCore === undefined ? delete process.env.AGENT_HOST_CORE_APP_IMAGE : process.env.AGENT_HOST_CORE_APP_IMAGE = previousCore
    }
    expect(seams.runCompose).toHaveBeenNthCalledWith(1, 'initial', expect.objectContaining({ hostId }), expect.anything(), expect.any(Function), authority)
    expect(seams.runCompose).toHaveBeenNthCalledWith(2, 'start-ingress', expect.objectContaining({ hostId }), expect.anything(), expect.any(Function), authority)
    expect(seams.createPublication.mock.results[0]?.value).toBe(seams.publication)
  })
})
