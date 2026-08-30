import type { SandboxLeaseService } from './sandboxLease'

/** Host-owned one-to-one identity registry for capability digest/service pairs. */
export class SandboxLeaseServiceRegistry {
  private readonly serviceByDigest = new Map<string, SandboxLeaseService>()
  private readonly pendingByDigest = new Map<string, Promise<SandboxLeaseService>>()
  private readonly digestByService = new WeakMap<SandboxLeaseService, string>()
  private readonly digestByProvider = new WeakMap<object, string>()

  async getOrCreate(
    digest: string,
    factory: () => SandboxLeaseService | Promise<SandboxLeaseService>,
  ): Promise<SandboxLeaseService> {
    const current = this.serviceByDigest.get(digest)
    if (current && !current.isDisposed) return current
    if (current?.isDisposed) this.evict(digest, current)
    const pending = this.pendingByDigest.get(digest)
    if (pending) return await pending
    const creation = Promise.resolve().then(factory).then((service) => {
      try {
        this.register({ digest, leases: service })
        return service
      } catch (error) {
        service.abandonUnregistered()
        throw error
      }
    })
    this.pendingByDigest.set(digest, creation)
    try { return await creation }
    finally { if (this.pendingByDigest.get(digest) === creation) this.pendingByDigest.delete(digest) }
  }

  register(capability: { readonly digest: string; readonly leases: SandboxLeaseService }): void {
    if (capability.leases.isDisposed) throw new TypeError('disposed sandbox lease service cannot be registered')
    const existingService = this.serviceByDigest.get(capability.digest)
    if (existingService && existingService !== capability.leases) {
      throw new TypeError('sandbox capability digest is already bound to another lease service')
    }
    const existingDigest = this.digestByService.get(capability.leases)
    if (existingDigest && existingDigest !== capability.digest) {
      throw new TypeError('sandbox lease service is already bound to another capability digest')
    }
    const provider = capability.leases.providerIdentity
    const providerDigest = this.digestByProvider.get(provider)
    if (providerDigest && providerDigest !== capability.digest) {
      throw new TypeError('sandbox provider is already owned by another lease service')
    }
    this.serviceByDigest.set(capability.digest, capability.leases)
    this.digestByService.set(capability.leases, capability.digest)
    this.digestByProvider.set(provider, capability.digest)
  }

  private evict(digest: string, service: SandboxLeaseService): void {
    if (this.serviceByDigest.get(digest) === service) this.serviceByDigest.delete(digest)
    this.digestByService.delete(service)
    if (this.digestByProvider.get(service.providerIdentity) === digest) {
      this.digestByProvider.delete(service.providerIdentity)
    }
  }

  async dispose(): Promise<readonly PromiseSettledResult<void>[]> {
    const entries = [...this.serviceByDigest.entries()]
    return await Promise.allSettled(entries.map(async ([digest, service]) => {
      await service.dispose()
      this.evict(digest, service)
    }))
  }

  async disposeUntil(deadline: number): Promise<readonly PromiseSettledResult<void>[]> {
    let results = await this.dispose()
    while (results.some((result) => result.status === 'rejected') && Date.now() < deadline) {
      const remaining = deadline - Date.now()
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(10, remaining)))
      results = await this.dispose()
    }
    return results
  }
}
