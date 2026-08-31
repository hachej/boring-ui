import type { SandboxLeaseService } from './sandboxLease'

/** Host-owned one-to-one identity registry for capability digest/service pairs. */
export class SandboxLeaseServiceRegistry {
  private readonly serviceByDigest = new Map<string, SandboxLeaseService>()
  private readonly digestByService = new WeakMap<SandboxLeaseService, string>()

  register(capability: { readonly digest: string; readonly leases: SandboxLeaseService }): void {
    const existingService = this.serviceByDigest.get(capability.digest)
    if (existingService && existingService !== capability.leases) {
      throw new TypeError('sandbox capability digest is already bound to another lease service')
    }
    const existingDigest = this.digestByService.get(capability.leases)
    if (existingDigest && existingDigest !== capability.digest) {
      throw new TypeError('sandbox lease service is already bound to another capability digest')
    }
    this.serviceByDigest.set(capability.digest, capability.leases)
    this.digestByService.set(capability.leases, capability.digest)
  }

  async dispose(): Promise<readonly PromiseSettledResult<void>[]> {
    const entries = [...this.serviceByDigest.entries()]
    return await Promise.allSettled(entries.map(async ([digest, service]) => {
      await service.dispose()
      if (this.serviceByDigest.get(digest) === service) {
        this.serviceByDigest.delete(digest)
        this.digestByService.delete(service)
      }
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
