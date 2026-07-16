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
    loadArtifacts: vi.fn(async () => []), createResolver: vi.fn(() => resolver), createPublication: vi.fn(() => publication) }
})

vi.mock('../agentHostFileRuntimeInputsProvider.js', () => ({ createAgentHostFileRuntimeInputsProvider: seams.createProvider }))
vi.mock('../agentHostSecretMaterializer.js', () => ({
  createAgentHostRuntimeInputsInspector: seams.createInspector,
  createAgentHostBindingSecretMaterializer: seams.createMaterializer,
}))
vi.mock('../agentHostAgentArtifactSnapshot.js', () => ({ loadAgentHostAgentArtifactInputs: seams.loadArtifacts }))
vi.mock('../agentHostRootDesiredResolver.js', () => ({ createAgentHostRootDesiredResolver: seams.createResolver }))
vi.mock('../agentHostPublicationControl.js', () => ({ createAgentHostRootPublicationClient: seams.createPublication }))

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
})
