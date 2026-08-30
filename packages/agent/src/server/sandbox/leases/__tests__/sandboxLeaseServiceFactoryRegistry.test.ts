import { describe, expect, it, vi } from 'vitest'

import { SandboxLeaseService } from '../sandboxLease'
import { SandboxLeaseServiceFactoryRegistry } from '../sandboxLeaseServiceFactoryRegistry'
import { fakeDisposableProvider } from './fakeDisposableProvider'

function service(): SandboxLeaseService {
  return {
    isDisposed: false,
    providerIdentity: {},
    dispose: vi.fn(async () => {}),
  } as unknown as SandboxLeaseService
}

describe('SandboxLeaseServiceFactoryRegistry compatibility alias', () => {
  it('invokes one factory for concurrent callers and owns disposal', async () => {
    const leases = service()
    const factory = vi.fn(async () => leases)
    const registry = new SandboxLeaseServiceFactoryRegistry()
    const [first, second] = await Promise.all([
      registry.getOrCreate('profile-a', factory),
      registry.getOrCreate('profile-a', factory),
    ])
    expect(first).toBe(leases)
    expect(second).toBe(leases)
    expect(factory).toHaveBeenCalledOnce()
    await registry.dispose()
    expect(leases.dispose).toHaveBeenCalledOnce()
  })

  it('evicts a service disposed outside the registry and constructs a fresh service', async () => {
    const registry = new SandboxLeaseServiceFactoryRegistry()
    const factory = vi.fn(() => new SandboxLeaseService({
      workspaceRoot: '/host/leases',
      provider: fakeDisposableProvider({ create: async () => { throw new Error('not used') } }),
      serviceDigest: 'profile-a', ttlMs: 60_000, reapIntervalMs: 60_000,
      drainTimeoutMs: 100, maxActiveLeasesPerOwner: 1, maxActiveLeasesTotal: 1,
    }))
    const first = await registry.getOrCreate('profile-a', factory)
    await first.dispose()
    expect(first.isDisposed).toBe(true)
    const second = await registry.getOrCreate('profile-a', factory)
    expect(second).not.toBe(first)
    expect(factory).toHaveBeenCalledTimes(2)
    await registry.dispose()
  })

  it('allows retry after construction fails', async () => {
    const registry = new SandboxLeaseServiceFactoryRegistry()
    await expect(registry.getOrCreate('profile-a', async () => { throw new Error('failed') })).rejects.toThrow('failed')
    const leases = service()
    await expect(registry.getOrCreate('profile-a', () => leases)).resolves.toBe(leases)
  })
})
