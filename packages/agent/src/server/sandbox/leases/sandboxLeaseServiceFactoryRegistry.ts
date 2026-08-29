import type { SandboxLeaseService } from './sandboxLease'

/** Atomically constructs one host-owned service per immutable profile digest. */
export class SandboxLeaseServiceFactoryRegistry {
  private readonly services = new Map<string, Promise<SandboxLeaseService>>()

  getOrCreate(
    digest: string,
    factory: () => SandboxLeaseService | Promise<SandboxLeaseService>,
  ): Promise<SandboxLeaseService> {
    if (!digest.trim()) throw new TypeError('sandbox capability digest is required')
    const existing = this.services.get(digest)
    if (existing) return existing
    const creation = Promise.resolve().then(factory)
    this.services.set(digest, creation)
    void creation.catch(() => {
      if (this.services.get(digest) === creation) this.services.delete(digest)
    })
    return creation
  }
}
