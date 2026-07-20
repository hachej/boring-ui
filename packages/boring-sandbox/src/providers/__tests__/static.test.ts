import { describe, expect, test } from 'vitest'

import { PROVIDER_CONTRACT_VERSION } from '../../shared/providerMatrix'
import {
  createStaticSandboxProvidersV1,
  resolveStaticSandboxProviderV1,
} from '../static'

describe('static SandboxProviderV1 composition', () => {
  test('maps only the three current runtime modes', () => {
    const providers = createStaticSandboxProvidersV1()

    expect(Object.keys(providers)).toEqual([
      'direct',
      'local',
      'vercel-sandbox',
    ])
    expect(resolveStaticSandboxProviderV1('direct', providers).providerId).toBe('direct')
    expect(resolveStaticSandboxProviderV1('local', providers).providerId).toBe('bwrap')
    expect(resolveStaticSandboxProviderV1('vercel-sandbox', providers).providerId).toBe('vercel-sandbox')
    expect(Object.values(providers).every(
      (provider) => provider.contractVersion === PROVIDER_CONTRACT_VERSION,
    )).toBe(true)
  })

  test('is immutable and exposes no pre-pair provisioning acquisition', () => {
    const providers = createStaticSandboxProvidersV1()
    expect(Object.isFrozen(providers)).toBe(true)
    expect('provisioning' in providers['vercel-sandbox']).toBe(false)
    expect('createProvisioningAdapter' in providers['vercel-sandbox']).toBe(false)
  })
})
