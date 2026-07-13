import type { D1DesiredSnapshotV1 } from '../d1RevisionCodec.js'
import type { D1SiteBindingV1 } from '../d1Plan.js'
import { D1HostError, D1HostErrorCode } from '../d1Plan.js'
import type { D1BindingSecretProvider, D1SecretMaterializerOptions } from '../d1SecretMaterializer.js'
import type { D1StoredCandidateV1 } from '../hostRevisionStore.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const seams = vi.hoisted(() => {
  const provider = {
    inspect: vi.fn(async (_binding: D1SiteBindingV1) => ({ metadataOnly: true })),
    resolveSecrets: vi.fn(async (_binding: D1SiteBindingV1) => {
      throw new D1HostError(D1HostErrorCode.SECRET_UNAVAILABLE, { field: 'secret' })
    }),
  }
  return { provider, createProvider: vi.fn(() => provider), createInspector: vi.fn(), createMaterializer: vi.fn() }
})

vi.mock('../d1FileRuntimeInputsProvider.js', () => ({ createD1FileRuntimeInputsProvider: seams.createProvider }))
vi.mock('../d1SecretMaterializer.js', () => ({
  createD1RuntimeInputsInspector: seams.createInspector,
  createD1BindingSecretMaterializer: seams.createMaterializer,
}))

import { createProductionD1Dependencies } from '../d1CommandEntry.js'

const binding: D1SiteBindingV1 = {
  bindingId: 'insurance', hostname: 'insurance.example.test', workspaceId: 'workspace:insurance',
  defaultDeploymentId: 'deployment:insurance', bundleRef: 'bundle', deploymentRef: 'deployment',
  workspaceAllocationRef: 'insurance-workspace', sessionAllocationRef: 'insurance-session', ownerPrincipalRef: 'owner',
  landing: { title: 'Insurance', summary: 'Compare policies.' }, environmentRef: 'production', secretRefs: ['credential-ref'],
}
const desired = { plan: { bindings: [binding] } } as unknown as D1DesiredSnapshotV1
const candidate = { desired } as D1StoredCandidateV1

describe('D1 production dependency composition', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seams.createProvider.mockReturnValue(seams.provider)
    seams.createInspector.mockImplementation((provider: D1BindingSecretProvider) => async (input: D1DesiredSnapshotV1) => {
      await provider.inspect(input.plan.bindings[0]!)
      return []
    })
    seams.createMaterializer.mockImplementation((options: D1SecretMaterializerOptions) => async (input: D1StoredCandidateV1) => {
      await options.provider.resolveSecrets(input.desired.plan.bindings[0]!)
      return []
    })
  })

  it('shares one host-scoped provider while leaving unfinished dependencies fail-closed', async () => {
    const mutationGuard = { assertHeld: vi.fn() }
    const dependencies = createProductionD1Dependencies({ hostId: 'host-1', ownerUid: process.geteuid!(), stateRoot: '/unused', mutationGuard })

    expect(seams.createProvider).toHaveBeenCalledOnce()
    expect(seams.createProvider).toHaveBeenCalledWith({ hostId: 'host-1', ownerUid: process.geteuid!() })
    expect(seams.createInspector).toHaveBeenCalledWith(seams.provider)
    expect(seams.createMaterializer).toHaveBeenCalledWith({
      root: '/run/boring/d1', ownerUid: process.geteuid!(), appUid: 10001, appGid: 10001, provider: seams.provider,
    })

    await dependencies.inspectRuntimeInputs(desired)
    expect(seams.provider.inspect).toHaveBeenCalledWith(binding)
    expect(seams.provider.resolveSecrets).not.toHaveBeenCalled()
    await expect(dependencies.effects.materialize(candidate, [])).rejects.toMatchObject({
      code: D1HostErrorCode.SECRET_UNAVAILABLE, details: { field: 'secret' },
    })
    expect(seams.provider.resolveSecrets).toHaveBeenCalledWith(binding)
    await expect(dependencies.resolver.resolvePlan({} as never)).rejects.toMatchObject({
      code: D1HostErrorCode.COLLECTION_NOT_READY, details: { field: 'resolver' },
    })
    await expect(dependencies.resolver.reproduce({} as never)).rejects.toMatchObject({
      code: D1HostErrorCode.COLLECTION_NOT_READY, details: { field: 'resolver' },
    })
    await expect(dependencies.effects.loadAdmittedBindingIds('host-1', 'postgres-eu')).rejects.toMatchObject({
      code: D1HostErrorCode.COLLECTION_NOT_READY, details: { field: 'admissions' },
    })
    await expect(dependencies.effects.preload(candidate, [])).rejects.toMatchObject({
      code: D1HostErrorCode.COLLECTION_NOT_READY, details: { field: 'preload' },
    })
    await expect(dependencies.effects.verifyActive({} as never)).rejects.toMatchObject({
      code: D1HostErrorCode.COLLECTION_NOT_READY, details: { field: 'active' },
    })
  })
})
