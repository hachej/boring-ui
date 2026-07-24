import { describe, expect, it } from 'vitest'
import {
  createEnvironmentProvisioningFingerprint,
  createResolvedRuntimeScopeIdentity,
  type RuntimeScopeIdentityInput,
} from '../runtimeScopeIdentity'

const base: RuntimeScopeIdentityInput = {
  artifacts: [{ pluginId: 'macro', digest: 'artifact-a' }],
  validatedConfig: { currency: 'USD' },
  grants: ['data.read'],
  placementIdentity: 'direct:workspace',
  isolationMode: 'shared',
  toolContractDigests: ['tool-a'],
  provisioningGeneration: 'generation-a',
}

describe('runtime scope identity', () => {
  it.each([
    ['artifact digest', { artifacts: [{ pluginId: 'macro', digest: 'artifact-b' }] }],
    ['validated config', { validatedConfig: { currency: 'EUR' } }],
    ['grant', { grants: ['data.read', 'data.write'] }],
    ['placement', { placementIdentity: 'sandbox:workspace' }],
    ['isolation', { isolationMode: 'dedicated' }],
    ['tool contract', { toolContractDigests: ['tool-b'] }],
    ['provisioning generation', { provisioningGeneration: 'generation-b' }],
  ] satisfies readonly [string, Partial<RuntimeScopeIdentityInput>][])('changes for %s', (_name, change) => {
    expect(createResolvedRuntimeScopeIdentity({ ...base, ...change }))
      .not.toBe(createResolvedRuntimeScopeIdentity(base))
  })

  it('is stable across ordering-only changes', () => {
    const first = createResolvedRuntimeScopeIdentity({
      ...base,
      artifacts: [{ pluginId: 'b', digest: '2' }, { pluginId: 'a', digest: '1' }],
      grants: ['z', 'a'],
      toolContractDigests: ['2', '1'],
    })
    const second = createResolvedRuntimeScopeIdentity({
      ...base,
      artifacts: [{ pluginId: 'a', digest: '1' }, { pluginId: 'b', digest: '2' }],
      grants: ['a', 'z'],
      toolContractDigests: ['1', '2'],
    })
    expect(first).toBe(second)
  })

  it('keeps grant-only changes out of the Environment fingerprint', () => {
    const environment = {
      placementIdentity: 'direct:workspace',
      providerDigest: 'provider-a',
      provisioningArtifactDigests: ['python-a'],
      provisioningGeneration: 'generation-a',
    }
    expect(createEnvironmentProvisioningFingerprint(environment)).toBe(
      createEnvironmentProvisioningFingerprint({ ...environment }),
    )
    expect(createResolvedRuntimeScopeIdentity({ ...base, grants: ['data.write'] }))
      .not.toBe(createResolvedRuntimeScopeIdentity(base))
  })
})
