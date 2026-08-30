import { describe, expect, it, vi } from 'vitest'

import type { SandboxLeaseService } from '../sandboxLease'
import { SandboxLeaseServiceRegistry } from '../sandboxLeaseServiceRegistry'

function service(dispose = vi.fn(async () => {}), providerIdentity: object = {}) {
  return {
    dispose,
    abandonUnregistered: vi.fn(),
    isDisposed: false,
    providerIdentity,
  } as unknown as SandboxLeaseService
}

describe('SandboxLeaseServiceRegistry', () => {
  it('shares one service for one digest and disposes it once', async () => {
    const leases = service()
    const registry = new SandboxLeaseServiceRegistry()
    registry.register({ digest: 'profile-a', leases })
    registry.register({ digest: 'profile-a', leases })

    await expect(registry.dispose()).resolves.toEqual([{ status: 'fulfilled', value: undefined }])
    expect(leases.dispose).toHaveBeenCalledOnce()
    await expect(registry.dispose()).resolves.toEqual([])
  })

  it('rejects the same digest bound to different services without taking ownership', async () => {
    const first = service()
    const conflict = service()
    const registry = new SandboxLeaseServiceRegistry()
    registry.register({ digest: 'profile-a', leases: first })

    expect(() => registry.register({ digest: 'profile-a', leases: conflict }))
      .toThrow('digest is already bound to another lease service')
    await registry.dispose()
    expect(first.dispose).toHaveBeenCalledOnce()
    expect(conflict.dispose).not.toHaveBeenCalled()
  })

  it('rejects one provider instance owned by services under different digests', async () => {
    const provider = {}
    const first = service(vi.fn(async () => {}), provider)
    const alias = service(vi.fn(async () => {}), provider)
    const registry = new SandboxLeaseServiceRegistry()
    registry.register({ digest: 'profile-a', leases: first })
    expect(() => registry.register({ digest: 'profile-b', leases: alias }))
      .toThrow('provider is already owned')
    await registry.dispose()
  })

  it('rejects the same service bound to different digests', async () => {
    const leases = service()
    const registry = new SandboxLeaseServiceRegistry()
    registry.register({ digest: 'profile-a', leases })

    expect(() => registry.register({ digest: 'profile-b', leases }))
      .toThrow('service is already bound to another capability digest')
    await registry.dispose()
    expect(leases.dispose).toHaveBeenCalledOnce()
  })

  it('drains a pending factory without publishing and rejects later acquisition', async () => {
    let resolveFactory!: (value: SandboxLeaseService) => void
    const pending = new Promise<SandboxLeaseService>((resolve) => { resolveFactory = resolve })
    const leases = service()
    const registry = new SandboxLeaseServiceRegistry()
    const acquiring = registry.getOrCreate('profile-a', async () => await pending)
    const draining = registry.disposeUntil(Date.now() + 500)
    resolveFactory(leases)

    await expect(acquiring).rejects.toThrow('drained during construction')
    await expect(draining).resolves.toEqual([])
    expect(leases.dispose).toHaveBeenCalledOnce()
    await expect(registry.getOrCreate('profile-b', () => service())).rejects.toThrow('registry is draining')
    expect(() => registry.register({ digest: 'profile-b', leases: service() })).toThrow('registry is draining')
  })

  it('bounds a stuck factory and owns its late service cleanup', async () => {
    let resolveFactory!: (value: SandboxLeaseService) => void
    const leases = service()
    const registry = new SandboxLeaseServiceRegistry()
    const acquiring = registry.getOrCreate('profile-a', () => new Promise((resolve) => { resolveFactory = resolve }))

    const results = await registry.disposeUntil(Date.now() + 20)
    expect(results).toEqual([expect.objectContaining({ status: 'rejected' })])
    resolveFactory(leases)
    await expect(acquiring).rejects.toThrow('drained during construction')
    expect(leases.dispose).toHaveBeenCalledOnce()
  })

  it('retains failed services and retries them to terminal disposal within a deadline', async () => {
    const dispose = vi.fn()
      .mockRejectedValueOnce(new Error('remote deletion acknowledgement lost'))
      .mockResolvedValue(undefined)
    const leases = service(dispose)
    const registry = new SandboxLeaseServiceRegistry()
    registry.register({ digest: 'profile-a', leases })

    await expect(registry.disposeUntil(Date.now() + 100)).resolves.toEqual([
      { status: 'fulfilled', value: undefined },
    ])
    expect(dispose).toHaveBeenCalledTimes(2)
    await expect(registry.dispose()).resolves.toEqual([])
  })
})
