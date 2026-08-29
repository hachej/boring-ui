import { createHash, randomUUID } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { join } from 'node:path'

import type {
  SandboxProviderV1,
  WorkspaceSandboxPairV1,
} from '@hachej/boring-sandbox/shared'
import { isDisposableLeaseProvider } from './disposableProvider'

const LEASE_HANDLE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/
export const SANDBOX_REMOTE_DISPOSE_OPERATION_ID = 'sandbox.remote.dispose.v1' as const

export const SANDBOX_LEASE_ERROR_CODES = Object.freeze({
  INVALID_LEASE_REQUEST: 'SANDBOX_LEASE_INVALID',
  LEASE_NOT_FOUND: 'SANDBOX_LEASE_NOT_FOUND',
  LEASE_EXPIRED: 'SANDBOX_LEASE_EXPIRED',
  LEASE_DRAINING: 'SANDBOX_LEASE_DRAINING',
  LEASE_QUOTA_EXCEEDED: 'SANDBOX_LEASE_QUOTA_EXCEEDED',
  LEASE_CREATION_ABORTED: 'SANDBOX_LEASE_CREATION_ABORTED',
  LEASE_DRAIN_TIMEOUT: 'SANDBOX_LEASE_DRAIN_TIMEOUT',
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
    name: 'sandbox.lease.cleanup' | 'sandbox.lease.cleanup.reconciliation'
    properties: Readonly<Record<string, string | number | boolean>>
  }): void
}

export interface SandboxLeaseServiceOptions {
  workspaceRoot: string
  provider: SandboxProviderV1
  /** Immutable profile/capability identity; never exposed to the model. */
  serviceDigest: string
  /** Host-authorized physical provider scope; never derived from model input. */
  providerWorkspaceId?: string
  templatePath?: string
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
  readonly cleanupRegistration: {
    readonly operationId: typeof SANDBOX_REMOTE_DISPOSE_OPERATION_ID
    readonly keyDigest: string
    attempts: number
    inFlight?: Promise<void>
  }
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
  private readonly pendingHandles = new Set<string>()
  private readonly pendingByOwner = new Map<string, number>()
  private readonly pendingAcquisitions = new Set<Promise<void>>()
  private readonly now: () => number
  private readonly createHandle: () => string
  private readonly timer: ReturnType<typeof setInterval>
  private pendingTotal = 0
  private closed = false
  private providerClosed = false
  private reapInFlight: Promise<number> | undefined
  private providerCloseInFlight: Promise<void> | undefined
  private disposal: Promise<void> | undefined

  constructor(private readonly options: SandboxLeaseServiceOptions) {
    if (options.provider.contractVersion && !isDisposableLeaseProvider(options.provider)) {
      this.invalid('provider must implement the disposable sandbox profile')
    }
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

  assertProfileBinding(input: {
    readonly digest: string
    readonly provider: SandboxProviderV1
    readonly workspaceRoot: string
    readonly providerWorkspaceId: string
    readonly templatePath?: string
    readonly ttlMs: number
    readonly reapIntervalMs: number
    readonly drainTimeoutMs: number
    readonly maxActiveLeasesPerOwner: number
    readonly maxActiveLeasesTotal: number
  }): void {
    const matches = this.options.serviceDigest === input.digest
      && this.options.provider === input.provider
      && this.options.workspaceRoot === input.workspaceRoot
      && this.options.providerWorkspaceId === input.providerWorkspaceId
      && this.options.templatePath === input.templatePath
      && this.options.ttlMs === input.ttlMs
      && this.options.reapIntervalMs === input.reapIntervalMs
      && this.options.drainTimeoutMs === input.drainTimeoutMs
      && this.options.maxActiveLeasesPerOwner === input.maxActiveLeasesPerOwner
      && this.options.maxActiveLeasesTotal === input.maxActiveLeasesTotal
    if (!matches) throw new TypeError('sandbox lease service does not match its profile identity')
  }

  async acquire(ownerId: string, signal?: AbortSignal): Promise<SandboxLease> {
    this.assertOpen()
    this.assertOwner(ownerId)
    let reserved = false
    let handle: string | undefined
    let finishPending: (() => void) | undefined
    let pending: Promise<void> | undefined
    let pair: WorkspaceSandboxPairV1 | undefined
    let published = false
    try {
      this.reserve(ownerId)
      reserved = true
      handle = this.reserveHandle()
      pending = new Promise<void>((resolve) => { finishPending = resolve })
      this.pendingAcquisitions.add(pending)

      this.assertCreationPublishable(signal)
      const workspaceRoot = join(this.options.workspaceRoot, handle)
      if (this.options.provider.contractVersion) {
        try {
          await lstat(workspaceRoot)
          throw this.creationAborted('sandbox lease root already exists')
        } catch (error) {
          if ((error as { code?: unknown }).code !== 'ENOENT') throw error
        }
      }
      pair = await this.options.provider.create({
        workspaceRoot,
        sessionId: handle,
        ...(this.options.providerWorkspaceId ? { workspaceId: this.options.providerWorkspaceId } : {}),
        ...(this.options.templatePath ? { templatePath: this.options.templatePath } : {}),
        requestId: createHash('sha256')
          .update(`${this.options.serviceDigest}:${handle}:provider-create`)
          .digest('hex'),
      })
      this.assertCreationPublishable(signal)
      const health = await pair.checkHealth?.()
      this.assertCreationPublishable(signal)
      if (health?.state === 'recreate') throw this.creationAborted('sandbox pair is not healthy')
      const lease = this.createLease(ownerId, handle, pair, 'active')
      this.assertCreationPublishable(signal)
      this.leases.set(handle, lease)
      published = true
      return { handle, expiresAt: lease.expiresAt }
    } catch (error) {
      if (pair && handle && !published) {
        const compensation = this.createLease(ownerId, handle, pair, 'cleanup-pending')
        compensation.cleanupReason = 'create-compensation'
        try {
          await this.runRegisteredCleanup(compensation, this.deadlineAfterDrain())
        } catch (cleanupError) {
          this.leases.set(handle, compensation)
          throw new SandboxLeaseError(
            SANDBOX_LEASE_ERROR_CODES.LEASE_CLEANUP_FAILED,
            'sandbox creation compensation failed',
            true,
            { cause: new AggregateError([error, cleanupError]) },
          )
        }
        if (!(error instanceof SandboxLeaseError)) throw this.creationAborted()
      }
      throw error
    } finally {
      if (handle) this.pendingHandles.delete(handle)
      if (reserved) this.unreserve(ownerId)
      if (pending) this.pendingAcquisitions.delete(pending)
      finishPending?.()
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
    let cleanupAfterUnpin = false
    try {
      let health: Awaited<ReturnType<NonNullable<WorkspaceSandboxPairV1['checkHealth']>>> | undefined
      try {
        health = await lease.pair.checkHealth?.()
      } catch {
        lease.state = 'draining'
        lease.cleanupReason = 'expiry'
        cleanupAfterUnpin = true
        throw new SandboxLeaseError(SANDBOX_LEASE_ERROR_CODES.LEASE_EXPIRED, 'sandbox lease is unavailable')
      }
      if (health?.state === 'recreate') {
        lease.state = 'draining'
        lease.cleanupReason = 'expiry'
        cleanupAfterUnpin = true
        throw new SandboxLeaseError(SANDBOX_LEASE_ERROR_CODES.LEASE_EXPIRED, 'sandbox lease is unavailable')
      }
      return await action(lease.pair)
    } finally {
      lease.activeOperations -= 1
      if (lease.activeOperations === 0) {
        for (const wake of lease.zeroActiveWaiters) wake()
        lease.zeroActiveWaiters.clear()
      }
      if (cleanupAfterUnpin) void this.startCleanup(lease).catch(() => undefined)
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
      const wrapped = this.disposeOnce().catch((error: unknown) => {
        if (this.disposal === wrapped) this.disposal = undefined
        throw error
      })
      this.disposal = wrapped
    }
    return this.disposal
  }

  private async disposeOnce(): Promise<void> {
    this.closed = true
    clearInterval(this.timer)
    const deadline = this.deadlineAfterDrain()
    const failures: unknown[] = []
    if (this.reapInFlight) {
      try {
        await this.withDeadline(this.reapInFlight, deadline, 'scheduled cleanup did not settle')
      } catch (error) {
        failures.push(error)
      }
    }
    if (this.pendingAcquisitions.size > 0) {
      try {
        await this.withDeadline(Promise.allSettled([...this.pendingAcquisitions]).then(() => undefined), deadline, 'sandbox creation did not settle')
      } catch (error) {
        failures.push(error)
      }
    }
    try {
      await this.cleanupMany([...this.leases.values()], 'host-shutdown', 'dispose', deadline)
    } catch (error) {
      failures.push(error)
    }
    try {
      await this.withDeadline(this.closeProvider(), deadline, 'sandbox provider close timed out')
    } catch (error) {
      failures.push(error)
    }
    if (failures.length) throw new SandboxLeaseCleanupError('dispose', 0, failures)
  }

  private closeProvider(): Promise<void> {
    if (!this.options.provider.close || this.providerClosed) return Promise.resolve()
    if (!this.providerCloseInFlight) {
      const effect = Promise.resolve().then(async () => { await this.options.provider.close?.() })
      const tracked = effect
        .then(() => { this.providerClosed = true })
        .finally(() => {
          if (this.providerCloseInFlight === tracked) this.providerCloseInFlight = undefined
        })
      this.providerCloseInFlight = tracked
    }
    return this.providerCloseInFlight
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
    deadline = this.deadlineAfterDrain(),
  ): Promise<number> {
    const results = await Promise.allSettled(leases.map(async (lease) => {
      await this.transitionAndCleanup(lease, reason, deadline)
      return lease
    }))
    const releasedCount = results.filter((result) => result.status === 'fulfilled').length
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason)
    if (failures.length) throw new SandboxLeaseCleanupError(operation, releasedCount, failures)
    return releasedCount
  }

  private async transitionAndCleanup(lease: ActiveLease, reason: CleanupReason, deadline = this.deadlineAfterDrain()): Promise<void> {
    if (!this.leases.has(lease.handle)) return
    if (lease.state === 'active') {
      lease.state = 'draining'
      lease.cleanupReason = reason
    }
    await this.startCleanup(lease, deadline)
  }

  private startCleanup(lease: ActiveLease, deadline = this.deadlineAfterDrain()): Promise<void> {
    if (lease.cleanupPromise) return lease.cleanupPromise
    lease.cleanupPromise = this.drainAndDispose(lease, deadline).finally(() => { lease.cleanupPromise = undefined })
    return lease.cleanupPromise
  }

  private async drainAndDispose(lease: ActiveLease, deadline: number): Promise<void> {
    if (lease.activeOperations > 0) {
      const drained = await new Promise<boolean>((resolve) => {
        const remaining = Math.max(0, deadline - Date.now())
        const wake = () => { clearTimeout(timeout); resolve(true) }
        const timeout = setTimeout(() => { lease.zeroActiveWaiters.delete(wake); resolve(false) }, remaining)
        timeout.unref?.()
        lease.zeroActiveWaiters.add(wake)
      })
      if (!drained) {
        lease.state = 'cleanup-pending'
        throw new SandboxLeaseError(SANDBOX_LEASE_ERROR_CODES.LEASE_DRAIN_TIMEOUT, 'sandbox operations did not drain', true)
      }
    }
    await this.runRegisteredCleanup(lease, deadline)
  }

  private createLease(
    ownerId: string,
    handle: string,
    pair: WorkspaceSandboxPairV1,
    state: ActiveLease['state'],
  ): ActiveLease {
    return {
      handle,
      ownerId,
      pair,
      expiresAt: this.now() + this.options.ttlMs,
      cleanupRegistration: {
        operationId: SANDBOX_REMOTE_DISPOSE_OPERATION_ID,
        keyDigest: createHash('sha256').update(`${this.options.serviceDigest}:${handle}`).digest('hex'),
        attempts: 0,
      },
      state,
      activeOperations: 0,
      zeroActiveWaiters: new Set(),
    }
  }

  private async runRegisteredCleanup(lease: ActiveLease, deadline: number): Promise<void> {
    const registration = lease.cleanupRegistration
    registration.attempts += 1
    if (!registration.inFlight) {
      const effect = Promise.resolve().then(async () => await lease.pair.dispose())
      const tracked = effect.finally(() => {
        if (registration.inFlight === tracked) registration.inFlight = undefined
      })
      registration.inFlight = tracked
    }
    try {
      await this.withDeadline(registration.inFlight, deadline, 'sandbox cleanup timed out')
      this.leases.delete(lease.handle)
      this.captureReconciliation(lease, 'settled')
    } catch (error) {
      lease.state = 'cleanup-pending'
      this.captureReconciliation(lease, 'failed', error)
      throw new SandboxLeaseError(
        SANDBOX_LEASE_ERROR_CODES.LEASE_CLEANUP_FAILED,
        'sandbox cleanup failed',
        true,
        { cause: error },
      )
    }
  }

  private captureReconciliation(lease: ActiveLease, outcome: 'settled' | 'failed', error?: unknown): void {
    this.options.telemetry?.capture({
      name: 'sandbox.lease.cleanup.reconciliation',
      properties: {
        serviceDigest: createHash('sha256').update(this.options.serviceDigest).digest('hex'),
        operationId: lease.cleanupRegistration.operationId,
        registrationKeyDigest: lease.cleanupRegistration.keyDigest,
        attemptedCount: lease.cleanupRegistration.attempts,
        reason: lease.cleanupReason ?? 'release',
        outcome,
        failureCode: error instanceof SandboxLeaseError ? error.code : error ? SANDBOX_LEASE_ERROR_CODES.LEASE_CLEANUP_FAILED : 'none',
      },
    })
  }

  private deadlineAfterDrain(): number {
    return Date.now() + this.options.drainTimeoutMs
  }

  private async withDeadline<T>(promise: Promise<T>, deadline: number, message: string): Promise<T> {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new SandboxLeaseError(SANDBOX_LEASE_ERROR_CODES.LEASE_CLEANUP_FAILED, message, true)
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new SandboxLeaseError(SANDBOX_LEASE_ERROR_CODES.LEASE_CLEANUP_FAILED, message, true)), remaining)
          timeout.unref?.()
        }),
      ])
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }

  private assertCreationPublishable(signal?: AbortSignal): void {
    if (signal?.aborted) throw this.creationAborted()
    if (this.closed) throw this.creationAborted('sandbox lease service closed during creation')
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

  private reserveHandle(): string {
    const handle = this.createHandle()
    if (
      !LEASE_HANDLE_PATTERN.test(handle)
      || this.leases.has(handle)
      || this.pendingHandles.has(handle)
    ) this.invalid('lease handle generator returned an invalid or colliding handle')
    this.pendingHandles.add(handle)
    return handle
  }

  private creationAborted(message = 'sandbox creation was aborted'): SandboxLeaseError {
    return new SandboxLeaseError(SANDBOX_LEASE_ERROR_CODES.LEASE_CREATION_ABORTED, message, true)
  }

  private invalid(message: string): never {
    throw new SandboxLeaseError(SANDBOX_LEASE_ERROR_CODES.INVALID_LEASE_REQUEST, message)
  }
}
