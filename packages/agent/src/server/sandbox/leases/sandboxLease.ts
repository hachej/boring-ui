import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'

import type {
  SandboxProviderV1,
  WorkspaceSandboxPairV1,
} from '@hachej/boring-sandbox/shared'

const LEASE_HANDLE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/
export const SANDBOX_REMOTE_DISPOSE_OPERATION_ID = 'sandbox.remote.dispose.v1' as const

export const SANDBOX_LEASE_ERROR_CODES = Object.freeze({
  INVALID_LEASE_REQUEST: 'SANDBOX_LEASE_INVALID',
  LEASE_NOT_FOUND: 'SANDBOX_LEASE_NOT_FOUND',
  LEASE_EXPIRED: 'SANDBOX_LEASE_EXPIRED',
  LEASE_DRAINING: 'SANDBOX_LEASE_DRAINING',
  LEASE_QUOTA_EXCEEDED: 'SANDBOX_LEASE_QUOTA_EXCEEDED',
  LEASE_CREATION_ABORTED: 'SANDBOX_LEASE_CREATION_ABORTED',
  LEASE_CLEANUP_FAILED: 'SANDBOX_LEASE_CLEANUP_FAILED',
  SERVICE_CLOSED: 'SANDBOX_LEASE_SERVICE_CLOSED',
} as const)

export type SandboxLeaseErrorCode =
  (typeof SANDBOX_LEASE_ERROR_CODES)[keyof typeof SANDBOX_LEASE_ERROR_CODES]
export type SandboxLeaseState = 'active' | 'expired' | 'draining' | 'cleanup-pending'

/** A host-issued capability; callers never receive a provider or filesystem root. */
export interface SandboxLease {
  readonly handle: string
  readonly expiresAt: number
}

export interface SandboxLeaseStatus extends SandboxLease {
  readonly state: SandboxLeaseState
}

export interface SandboxLeaseCleanupTelemetry {
  capture(event: {
    name: 'sandbox.lease.cleanup'
    properties: Readonly<Record<string, string | number | boolean>>
  }): void
}

export interface SandboxLeaseServiceOptions {
  workspaceRoot: string
  provider: SandboxProviderV1
  /** Immutable profile/capability identity; never exposed to the model. */
  serviceDigest: string
  ttlMs: number
  reapIntervalMs: number
  drainTimeoutMs: number
  maxActiveLeasesPerOwner: number
  maxActiveLeasesTotal: number
  now?: () => number
  createHandle?: () => string
  telemetry?: SandboxLeaseCleanupTelemetry
}

type CleanupReason = 'release' | 'expiry' | 'owner-end' | 'host-shutdown' | 'create-compensation'

interface ActiveLease extends SandboxLease {
  readonly ownerId: string
  readonly pair: WorkspaceSandboxPairV1
  readonly cleanupRegistrationKey: string
  state: 'active' | 'draining' | 'cleanup-pending'
  activeOperations: number
  cleanupReason?: CleanupReason
  cleanupPromise?: Promise<void>
  zeroActiveWaiters: Set<() => void>
}

export class SandboxLeaseError extends Error {
  constructor(
    readonly code: SandboxLeaseErrorCode,
    message: string,
    readonly retryable = false,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'SandboxLeaseError'
  }
}

export class SandboxLeaseCleanupError extends SandboxLeaseError {
  constructor(
    readonly operation: 'reap-expired' | 'release-owner' | 'dispose',
    readonly releasedCount: number,
    readonly failures: readonly unknown[],
  ) {
    super(
      SANDBOX_LEASE_ERROR_CODES.LEASE_CLEANUP_FAILED,
      `${operation} released ${releasedCount} lease(s) and failed to release ${failures.length}`,
      true,
      { cause: new AggregateError(failures, `${operation} sandbox lease cleanup failures`) },
    )
    this.name = 'SandboxLeaseCleanupError'
  }
}

/** Host-owned lifecycle registry for mutable disposable sandbox pairs. */
export class SandboxLeaseService {
  private readonly leases = new Map<string, ActiveLease>()
  private readonly pendingByOwner = new Map<string, number>()
  private readonly now: () => number
  private readonly createHandle: () => string
  private readonly timer: ReturnType<typeof setInterval>
  private pendingTotal = 0
  private closed = false
  private reapInFlight: Promise<number> | undefined
  private disposal: Promise<void> | undefined

  constructor(private readonly options: SandboxLeaseServiceOptions) {
    if (!Number.isFinite(options.ttlMs) || options.ttlMs <= 0) this.invalid('ttlMs must be greater than zero')
    if (!Number.isFinite(options.reapIntervalMs) || options.reapIntervalMs < 1_000 || options.reapIntervalMs > Math.min(options.ttlMs, 60_000)) {
      this.invalid('reapIntervalMs must be between 1000 and min(ttlMs, 60000)')
    }
    if (!Number.isFinite(options.drainTimeoutMs) || options.drainTimeoutMs <= 0) this.invalid('drainTimeoutMs must be greater than zero')
    if (!Number.isSafeInteger(options.maxActiveLeasesPerOwner) || options.maxActiveLeasesPerOwner <= 0) this.invalid('maxActiveLeasesPerOwner must be a positive integer')
    if (!Number.isSafeInteger(options.maxActiveLeasesTotal) || options.maxActiveLeasesTotal <= 0) this.invalid('maxActiveLeasesTotal must be a positive integer')
    if (!options.serviceDigest.trim()) this.invalid('serviceDigest is required')
    this.now = options.now ?? Date.now
    this.createHandle = options.createHandle ?? randomUUID
    this.timer = setInterval(() => { void this.runScheduledReap() }, options.reapIntervalMs)
    this.timer.unref?.()
  }

  async acquire(ownerId: string, signal?: AbortSignal): Promise<SandboxLease> {
    this.assertOpen()
    this.assertOwner(ownerId)
    this.reserve(ownerId)
    let pair: WorkspaceSandboxPairV1 | undefined
    try {
      if (signal?.aborted) throw this.creationAborted()
      const handle = this.nextHandle()
      pair = await this.options.provider.create({
        workspaceRoot: join(this.options.workspaceRoot, handle),
        sessionId: handle,
      })
      if (signal?.aborted) {
        await pair.dispose()
        throw this.creationAborted()
      }
      const health = await pair.checkHealth?.()
      if (health?.state === 'recreate') {
        await pair.dispose()
        throw new SandboxLeaseError(SANDBOX_LEASE_ERROR_CODES.LEASE_CLEANUP_FAILED, 'sandbox pair is not healthy', true)
      }
      const lease: ActiveLease = {
        handle,
        ownerId,
        pair,
        expiresAt: this.now() + this.options.ttlMs,
        cleanupRegistrationKey: createHash('sha256').update(`${this.options.serviceDigest}:${handle}`).digest('hex'),
        state: 'active',
        activeOperations: 0,
        zeroActiveWaiters: new Set(),
      }
      this.leases.set(handle, lease)
      return { handle, expiresAt: lease.expiresAt }
    } catch (error) {
      if (pair && signal?.aborted) await pair.dispose().catch(() => undefined)
      throw error
    } finally {
      this.unreserve(ownerId)
    }
  }

  listOwn(ownerId: string): SandboxLeaseStatus[] {
    this.assertOwner(ownerId)
    return [...this.leases.values()]
      .filter((lease) => lease.ownerId === ownerId)
      .map((lease) => this.projectStatus(lease))
      .sort((left, right) => left.handle.localeCompare(right.handle))
  }

  status(ownerId: string, handle: string): SandboxLeaseStatus {
    return this.projectStatus(this.requireOwned(ownerId, handle))
  }

  async withPair<T>(
    ownerId: string,
    handle: string,
    action: (pair: WorkspaceSandboxPairV1) => Promise<T>,
  ): Promise<T> {
    this.assertOpen()
    const lease = this.requireOwned(ownerId, handle)
    if (lease.state !== 'active') throw this.unavailableForState(lease.state)
    if (lease.expiresAt <= this.now()) {
      lease.state = 'draining'
      lease.cleanupReason = 'expiry'
      void this.startCleanup(lease).catch(() => undefined)
      throw new SandboxLeaseError(SANDBOX_LEASE_ERROR_CODES.LEASE_EXPIRED, 'sandbox lease has expired')
    }
    lease.activeOperations += 1
    try {
      const health = await lease.pair.checkHealth?.()
      if (health?.state === 'recreate') {
        throw new SandboxLeaseError(SANDBOX_LEASE_ERROR_CODES.LEASE_EXPIRED, 'sandbox lease is unavailable')
      }
      return await action(lease.pair)
    } finally {
      lease.activeOperations -= 1
      if (lease.activeOperations === 0) {
        for (const wake of lease.zeroActiveWaiters) wake()
        lease.zeroActiveWaiters.clear()
      }
    }
  }

  async release(ownerId: string, handle: string): Promise<void> {
    const lease = this.requireOwned(ownerId, handle)
    await this.transitionAndCleanup(lease, 'release')
  }

  async releaseOwner(ownerId: string): Promise<number> {
    this.assertOwner(ownerId)
    return await this.cleanupMany(
      [...this.leases.values()].filter((lease) => lease.ownerId === ownerId),
      'owner-end',
      'release-owner',
    )
  }

  async reapExpired(): Promise<number> {
    return await this.cleanupMany(
      [...this.leases.values()].filter((lease) => lease.expiresAt <= this.now() || lease.state === 'cleanup-pending'),
      'expiry',
      'reap-expired',
    )
  }

  dispose(): Promise<void> {
    if (!this.disposal) {
      const wrapped = this.disposeOnce().finally(() => {
        if (this.leases.size > 0 && this.disposal === wrapped) this.disposal = undefined
      })
      this.disposal = wrapped
    }
    return this.disposal
  }

  private async disposeOnce(): Promise<void> {
    this.closed = true
    clearInterval(this.timer)
    await this.reapInFlight?.catch(() => undefined)
    await this.cleanupMany([...this.leases.values()], 'host-shutdown', 'dispose').then(() => undefined)
    await this.options.provider.close?.()
  }

  private async runScheduledReap(): Promise<void> {
    if (this.reapInFlight || this.closed) return
    const startedAt = this.now()
    this.reapInFlight = this.reapExpired()
    try {
      const released = await this.reapInFlight
      this.captureCleanup(released, 0, this.now() - startedAt)
    } catch (error) {
      const failures = error instanceof SandboxLeaseCleanupError ? error.failures.length : 1
      const released = error instanceof SandboxLeaseCleanupError ? error.releasedCount : 0
      this.captureCleanup(released, failures, this.now() - startedAt)
    } finally {
      this.reapInFlight = undefined
    }
  }

  private captureCleanup(released: number, failed: number, durationMs: number): void {
    this.options.telemetry?.capture({
      name: 'sandbox.lease.cleanup',
      properties: {
        serviceDigest: createHash('sha256').update(this.options.serviceDigest).digest('hex'),
        operationId: SANDBOX_REMOTE_DISPOSE_OPERATION_ID,
        released,
        failed,
        durationMs,
      },
    })
  }

  private async cleanupMany(
    leases: readonly ActiveLease[],
    reason: CleanupReason,
    operation: SandboxLeaseCleanupError['operation'],
  ): Promise<number> {
    let releasedCount = 0
    const failures: unknown[] = []
    for (const lease of leases) {
      try {
        await this.transitionAndCleanup(lease, reason)
        releasedCount += 1
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length) throw new SandboxLeaseCleanupError(operation, releasedCount, failures)
    return releasedCount
  }

  private async transitionAndCleanup(lease: ActiveLease, reason: CleanupReason): Promise<void> {
    if (!this.leases.has(lease.handle)) return
    if (lease.state === 'active') {
      lease.state = 'draining'
      lease.cleanupReason = reason
    }
    await this.startCleanup(lease)
  }

  private startCleanup(lease: ActiveLease): Promise<void> {
    if (lease.cleanupPromise) return lease.cleanupPromise
    lease.cleanupPromise = this.drainAndDispose(lease).finally(() => { lease.cleanupPromise = undefined })
    return lease.cleanupPromise
  }

  private async drainAndDispose(lease: ActiveLease): Promise<void> {
    if (lease.activeOperations > 0) {
      const drained = await new Promise<boolean>((resolve) => {
        const wake = () => { clearTimeout(timeout); resolve(true) }
        const timeout = setTimeout(() => { lease.zeroActiveWaiters.delete(wake); resolve(false) }, this.options.drainTimeoutMs)
        timeout.unref?.()
        lease.zeroActiveWaiters.add(wake)
      })
      if (!drained) {
        lease.state = 'cleanup-pending'
        throw new SandboxLeaseError(SANDBOX_LEASE_ERROR_CODES.LEASE_CLEANUP_FAILED, 'sandbox operations did not drain', true)
      }
    }
    try {
      await lease.pair.dispose()
      this.leases.delete(lease.handle)
    } catch (error) {
      lease.state = 'cleanup-pending'
      throw new SandboxLeaseError(
        SANDBOX_LEASE_ERROR_CODES.LEASE_CLEANUP_FAILED,
        'sandbox cleanup failed',
        true,
        { cause: error },
      )
    }
  }

  private reserve(ownerId: string): void {
    const ownerActive = [...this.leases.values()].filter((lease) => lease.ownerId === ownerId).length
      + (this.pendingByOwner.get(ownerId) ?? 0)
    if (ownerActive >= this.options.maxActiveLeasesPerOwner || this.leases.size + this.pendingTotal >= this.options.maxActiveLeasesTotal) {
      throw new SandboxLeaseError(SANDBOX_LEASE_ERROR_CODES.LEASE_QUOTA_EXCEEDED, 'sandbox lease quota exceeded', true)
    }
    this.pendingTotal += 1
    this.pendingByOwner.set(ownerId, (this.pendingByOwner.get(ownerId) ?? 0) + 1)
  }

  private unreserve(ownerId: string): void {
    this.pendingTotal -= 1
    const value = (this.pendingByOwner.get(ownerId) ?? 1) - 1
    if (value <= 0) this.pendingByOwner.delete(ownerId)
    else this.pendingByOwner.set(ownerId, value)
  }

  private projectStatus(lease: ActiveLease): SandboxLeaseStatus {
    return {
      handle: lease.handle,
      expiresAt: lease.expiresAt,
      state: lease.state === 'active' && lease.expiresAt <= this.now() ? 'expired' : lease.state,
    }
  }

  private requireOwned(ownerId: string, handle: string): ActiveLease {
    this.assertOwner(ownerId)
    const lease = this.leases.get(handle)
    if (!lease || lease.ownerId !== ownerId) {
      throw new SandboxLeaseError(SANDBOX_LEASE_ERROR_CODES.LEASE_NOT_FOUND, 'sandbox lease is unavailable')
    }
    return lease
  }

  private unavailableForState(state: ActiveLease['state']): SandboxLeaseError {
    return new SandboxLeaseError(
      state === 'active' ? SANDBOX_LEASE_ERROR_CODES.LEASE_EXPIRED : SANDBOX_LEASE_ERROR_CODES.LEASE_DRAINING,
      'sandbox lease is unavailable',
      state === 'cleanup-pending',
    )
  }

  private assertOpen(): void {
    if (this.closed) throw new SandboxLeaseError(SANDBOX_LEASE_ERROR_CODES.SERVICE_CLOSED, 'sandbox lease service is closed')
  }

  private assertOwner(ownerId: string): void {
    if (!ownerId.trim()) this.invalid('ownerId is required')
  }

  private nextHandle(): string {
    const handle = this.createHandle()
    if (!LEASE_HANDLE_PATTERN.test(handle) || this.leases.has(handle)) this.invalid('lease handle generator returned an invalid handle')
    return handle
  }

  private creationAborted(): SandboxLeaseError {
    return new SandboxLeaseError(SANDBOX_LEASE_ERROR_CODES.LEASE_CREATION_ABORTED, 'sandbox creation was aborted', true)
  }

  private invalid(message: string): never {
    throw new SandboxLeaseError(SANDBOX_LEASE_ERROR_CODES.INVALID_LEASE_REQUEST, message)
  }
}
