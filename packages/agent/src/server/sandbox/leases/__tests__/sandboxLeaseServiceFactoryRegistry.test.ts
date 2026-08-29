import { describe, expect, it, vi } from 'vitest'

import type { SandboxLeaseService } from '../sandboxLease'
import { SandboxLeaseServiceFactoryRegistry } from '../sandboxLeaseServiceFactoryRegistry'

describe('SandboxLeaseServiceFactoryRegistry', () => {
  it('invokes one factory for concurrent callers', async () => {
    const service = {} as SandboxLeaseService
    const factory = vi.fn(async () => service)
    const registry = new SandboxLeaseServiceFactoryRegistry()
    const [first, second] = await Promise.all([
      registry.getOrCreate('profile-a', factory),
      registry.getOrCreate('profile-a', factory),
    ])
    expect(first).toBe(service)
    expect(second).toBe(service)
    expect(factory).toHaveBeenCalledOnce()
  })

  it('allows retry after construction fails', async () => {
    const registry = new SandboxLeaseServiceFactoryRegistry()
    await expect(registry.getOrCreate('profile-a', async () => { throw new Error('failed') })).rejects.toThrow('failed')
    const service = {} as SandboxLeaseService
    await expect(registry.getOrCreate('profile-a', () => service)).resolves.toBe(service)
  })
})
