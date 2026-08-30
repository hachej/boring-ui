import type { SandboxLeaseService } from './sandboxLease'

/** Host-owned one-to-one identity registry for capability digest/service pairs. */
export class SandboxLeaseServiceRegistry {
  private readonly serviceByDigest = new Map<string, SandboxLeaseService>()
  private readonly pendingByDigest = new Map<string, Promise<SandboxLeaseService>>()
  private readonly digestByService = new WeakMap<SandboxLeaseService, string>()
  private readonly digestByProvider = new WeakMap<object, string>()
  private readonly profileFactoryServices = new WeakSet<SandboxLeaseService>()
  private readonly drainingServices = new Set<SandboxLeaseService>()
  private draining = false

  async getOrCreate(
    digest: string,
    factory: () => SandboxLeaseService | Promise<SandboxLeaseService>,
  ): Promise<SandboxLeaseService> {
    if (this.draining) throw new TypeError('sandbox lease service registry is draining')
    const current = this.serviceByDigest.get(digest)
    if (current && !current.isDisposed) {
      if (!this.profileFactoryServices.has(current)) throw new TypeError('sandbox profile digest is owned by a legacy service')
      return current
    }
    if (current?.isDisposed) this.evict(digest, current)
    const pending = this.pendingByDigest.get(digest)
    if (pending) return await pending
    const creation = Promise.resolve().then(factory).then(async (service) => {
      if (this.draining) {
        this.drainingServices.add(service)
        try { await service.dispose(); this.drainingServices.delete(service) }
        catch (error) {
          throw new AggregateError([error], 'sandbox lease service registry drain cleanup failed')
        }
        throw new TypeError('sandbox lease service registry drained during construction')
      }
      try {
        this.profileFactoryServices.add(service)
        this.register({ digest, leases: service })
        return service
      } catch (error) {
        this.profileFactoryServices.delete(service)
        service.abandonUnregistered()
        throw error
      }
    })
    this.pendingByDigest.set(digest, creation)
    try { return await creation }
    finally { if (this.pendingByDigest.get(digest) === creation) this.pendingByDigest.delete(digest) }
  }

  register(capability: { readonly digest: string; readonly leases: SandboxLeaseService }): void {
    if (this.draining) throw new TypeError('sandbox lease service registry is draining')
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
    this.draining = true
    const pending = [...this.pendingByDigest.values()]
    const pendingResults = await Promise.allSettled(pending)
    const entries = [...this.serviceByDigest.entries()]
    const serviceResults = await Promise.allSettled(entries.map(async ([digest, service]) => {
      await service.dispose()
      this.evict(digest, service)
    }))
    const debtResults = await Promise.allSettled([...this.drainingServices].map(async (service) => {
      await service.dispose()
      this.drainingServices.delete(service)
    }))
    for (const [digest, service] of this.serviceByDigest) {
      if (service.isDisposed) this.evict(digest, service)
    }
    return [...pendingResults.map((result): PromiseSettledResult<void> => result.status === 'fulfilled'
      ? { status: 'fulfilled', value: undefined }
      : result), ...serviceResults, ...debtResults]
  }

  async disposeUntil(deadline: number): Promise<readonly PromiseSettledResult<void>[]> {
    for (;;) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) return [{ status: 'rejected', reason: new Error('sandbox lease registry drain deadline exceeded') }]
      const attempt = this.dispose()
      let timer: number | undefined
      const results = await Promise.race([
        attempt,
        new Promise<undefined>((resolve) => { timer = setTimeout(resolve, remaining) }),
      ])
      if (timer) clearTimeout(timer)
      if (!results) {
        void attempt.catch(() => { /* late factory cleanup remains registry-owned */ })
        return [{ status: 'rejected', reason: new Error('sandbox lease registry drain deadline exceeded') }]
      }
      if (results.every((result) => result.status === 'fulfilled')) return results
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(10, deadline - Date.now())))
    }
  }
}
