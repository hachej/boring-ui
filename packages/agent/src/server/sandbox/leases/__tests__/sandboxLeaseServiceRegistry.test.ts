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

  it('never adopts a same-digest legacy service into the profile namespace', async () => {
    const legacy = service()
    const factory = vi.fn(() => service())
    const registry = new SandboxLeaseServiceRegistry()
    registry.register({ digest: 'profile-a', leases: legacy })

    await expect(registry.getOrCreate('profile-a', factory)).rejects.toThrow('owned by a legacy service')
    expect(factory).not.toHaveBeenCalled()
    await registry.dispose()
    expect(legacy.dispose).toHaveBeenCalledOnce()
  })

  it('reserves a pending profile digest against legacy registration and keeps one cleanup owner', async () => {
    let resolveFactory!: (value: SandboxLeaseService) => void
    const profileService = service()
    const rejectedLegacy = service()
    const factory = vi.fn(() => new Promise<SandboxLeaseService>((resolve) => { resolveFactory = resolve }))
    const registry = new SandboxLeaseServiceRegistry()
    const acquiring = registry.getOrCreate('profile-a', factory)
    await vi.waitFor(() => expect(factory).toHaveBeenCalledOnce())

    expect(() => registry.register({ digest: 'profile-a', leases: rejectedLegacy }))
      .toThrow('reserved by a pending factory')
    resolveFactory(profileService)
    await expect(acquiring).resolves.toBe(profileService)
    await registry.dispose()
    expect(profileService.dispose).toHaveBeenCalledOnce()
    expect(rejectedLegacy.dispose).not.toHaveBeenCalled()
  })

  it('abandons only a new service wrapper when its provider is already owned', async () => {
    const provider = {}
    const owner = service(vi.fn(async () => {}), provider)
    const alias = service(vi.fn(async () => {}), provider)
    const registry = new SandboxLeaseServiceRegistry()
    registry.register({ digest: 'legacy-a', leases: owner })

    await expect(registry.getOrCreate('profile-b', () => alias)).rejects.toThrow('provider is already owned')
    expect(alias.abandonUnregistered).toHaveBeenCalledOnce()
    expect(alias.dispose).not.toHaveBeenCalled()
    await registry.dispose()
    expect(owner.dispose).toHaveBeenCalledOnce()
  })

  it('claims one pending provider across digests and promotes the claim on binding', async () => {
    const provider = {}
    const leases = service(vi.fn(async () => {}), provider)
    const registry = new SandboxLeaseServiceRegistry()
    const release = await registry.claimProfileProvider('profile-a', provider)

    await expect(registry.claimProfileProvider('profile-b', provider)).rejects.toThrow('already owned or claimed')
    expect(() => registry.register({ digest: 'profile-a', leases })).toThrow('provider is already owned')
    registry.promoteProfileProvider('profile-a', leases)
    await expect(registry.getOrCreate('profile-a', () => service())).resolves.toBe(leases)
    release()
    await expect(registry.claimProfileProvider('profile-b', provider)).rejects.toThrow('already owned or claimed')
    await registry.dispose()
  })

  it('coalesces concurrent factories only within the profile namespace', async () => {
    let resolveFactory!: (value: SandboxLeaseService) => void
    const leases = service()
    const factory = vi.fn(() => new Promise<SandboxLeaseService>((resolve) => { resolveFactory = resolve }))
    const registry = new SandboxLeaseServiceRegistry()
    const first = registry.getOrCreate('profile-a', factory)
    const second = registry.getOrCreate('profile-a', factory)
    await vi.waitFor(() => expect(factory).toHaveBeenCalledOnce())
    resolveFactory(leases)

    await expect(first).resolves.toBe(leases)
    await expect(second).resolves.toBe(leases)
    await registry.dispose()
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

  it('disposes registered services before a stuck factory settles and retries late cleanup debt', async () => {
    let resolveFactory!: (value: SandboxLeaseService) => void
    let registeredDisposed = false
    const registeredDispose = vi.fn(async () => { registeredDisposed = true })
    const lateDispose = vi.fn()
      .mockRejectedValueOnce(new Error('late provider delete failed'))
      .mockResolvedValue(undefined)
    const registry = new SandboxLeaseServiceRegistry()
    registry.register({ digest: 'registered', leases: service(registeredDispose) })
    const acquiring = registry.getOrCreate('pending', () => new Promise((resolve) => { resolveFactory = resolve }))
    await vi.waitFor(() => expect(resolveFactory).toBeTypeOf('function'))

    const timedOut = await registry.disposeUntil(Date.now() + 20)
    expect(registeredDispose).toHaveBeenCalledOnce()
    expect(registeredDisposed).toBe(true)
    expect(timedOut).toEqual([expect.objectContaining({ status: 'rejected' })])

    resolveFactory(service(lateDispose))
    await expect(acquiring).rejects.toThrow('late provider delete failed')
    expect(lateDispose).toHaveBeenCalledOnce()
    await expect(registry.disposeUntil(Date.now() + 100)).resolves.toEqual([
      { status: 'fulfilled', value: undefined },
    ])
    expect(lateDispose).toHaveBeenCalledTimes(2)
    await expect(registry.dispose()).resolves.toEqual([])
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
