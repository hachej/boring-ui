import { describe, expect, it, vi } from 'vitest'

import type { SandboxProviderV1, WorkspaceSandboxPairV1 } from '@hachej/boring-sandbox/shared'
import type { Sandbox, Workspace } from '@hachej/boring-agent/shared'
import {
  SANDBOX_LEASE_ERROR_CODES,
  SandboxLeaseCleanupError,
  SandboxLeaseService,
} from '../leaseService'
import { SandboxLeaseServiceRegistry } from '../leaseServiceRegistry'
import { fakeDisposableProvider } from './fakeDisposableProvider'

interface FakePair {
  pair: WorkspaceSandboxPairV1
  dispose: ReturnType<typeof vi.fn>
}

function fakePair(name: string): FakePair {
  const workspace = {
    root: '/workspace',
    runtimeContext: { runtimeCwd: '/workspace' },
    readFile: vi.fn(async () => name),
    writeFile: vi.fn(async () => {}),
    readdir: vi.fn(async () => []),
    stat: vi.fn(async () => ({ size: 1, mtimeMs: 1, kind: 'file' as const })),
    unlink: vi.fn(),
    mkdir: vi.fn(),
    rename: vi.fn(),
  } as unknown as Workspace
  const sandbox = {
    id: name,
    placement: 'remote',
    provider: 'fake',
    capabilities: ['exec'],
    runtimeContext: { runtimeCwd: '/workspace' },
    exec: vi.fn(async () => ({
      stdout: new Uint8Array(), stderr: new Uint8Array(), exitCode: 0, durationMs: 1, truncated: false,
    })),
  } as unknown as Sandbox
  const dispose = vi.fn(async () => {})
  return { pair: { workspace, sandbox, checkHealth: async () => ({ state: 'ok' }), dispose }, dispose }
}

function createService(input: {
  now?: { value: number }
  maxOwner?: number
  maxTotal?: number
  drainTimeoutMs?: number
  create?: () => Promise<WorkspaceSandboxPairV1>
  provider?: SandboxProviderV1
  close?: () => Promise<void>
  createHandle?: () => string
} = {}) {
  const pairs: FakePair[] = []
  let sequence = 0
  const providerCreate = vi.fn(input.create ?? (async () => {
    const pair = fakePair(`pair-${pairs.length + 1}`)
    pairs.push(pair)
    return pair.pair
  }))
  const service = new SandboxLeaseService({
    workspaceRoot: '/host/leases',
    provider: input.provider ?? fakeDisposableProvider({ create: providerCreate, close: input.close }),
    serviceDigest: 'profile-v1',
    ttlMs: 60_000,
    reapIntervalMs: 60_000,
    drainTimeoutMs: input.drainTimeoutMs ?? 100,
    maxActiveLeasesPerOwner: input.maxOwner ?? 3,
    maxActiveLeasesTotal: input.maxTotal ?? 5,
    now: () => input.now?.value ?? 100,
    createHandle: input.createHandle ?? (() => `lease-handle-${String(++sequence).padStart(4, '0')}`),
  })
  return { service, pairs, providerCreate }
}

it('preserves the trusted legacy preconstructed service seam without Agent-private branding', async () => {
  const branded = fakeDisposableProvider({ create: async () => fakePair('legacy').pair })
  const legacyProvider = { ...branded } as SandboxProviderV1
  const { service } = createService({ provider: legacyProvider })
  await expect(service.acquire('owner-a')).resolves.toMatchObject({ handle: expect.any(String) })
  await expect(service.dispose()).resolves.toBeUndefined()
})

async function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('SandboxLeaseService lifecycle registry', () => {
  it('rejects a resumable provider before starting its reaper', () => {
    vi.useFakeTimers()
    expect(() => new SandboxLeaseService({
      workspaceRoot: '/host/leases',
      provider: {
        contractVersion: 'boring-sandbox.provider.v1',
        providerId: 'direct',
      } as unknown as SandboxProviderV1,
      serviceDigest: 'persistent-profile',
      ttlMs: 60_000,
      reapIntervalMs: 60_000,
      drainTimeoutMs: 100,
      maxActiveLeasesPerOwner: 1,
      maxActiveLeasesTotal: 1,
    })).toThrow('provider must implement the disposable sandbox profile')
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })

  it('creates several owner-bound leases and lists only the owner records', async () => {
    const { service, providerCreate } = createService()
    const first = await service.acquire('owner-a')
    const second = await service.acquire('owner-a')
    await service.acquire('owner-b')

    expect(service.listOwn('owner-a')).toEqual([
      { handle: first.handle, expiresAt: 60_100, state: 'active' },
      { handle: second.handle, expiresAt: 60_100, state: 'active' },
    ])
    expect(providerCreate).toHaveBeenNthCalledWith(1, {
      workspaceRoot: `/host/leases/${first.handle}`,
      sessionId: first.handle,
      requestId: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(() => service.status('owner-b', first.handle)).toThrow('sandbox lease is unavailable')
    await service.dispose()
  })

  it('pins the canonical pair for an operation and denies another owner', async () => {
    const { service, pairs } = createService()
    const lease = await service.acquire('owner-a')
    await expect(service.withPair('owner-a', lease.handle, async (pair) => await pair.workspace.readFile('proof')))
      .resolves.toBe('pair-1')
    await expect(service.withPair('owner-b', lease.handle, async () => undefined))
      .rejects.toMatchObject({ code: SANDBOX_LEASE_ERROR_CODES.LEASE_NOT_FOUND })
    expect(pairs[0]?.dispose).not.toHaveBeenCalled()
    await service.dispose()
  })

  it('drains a pinned operation before deleting and rejects new pins', async () => {
    const { service, pairs } = createService()
    const lease = await service.acquire('owner-a')
    const gate = await deferred<void>()
    const operation = service.withPair('owner-a', lease.handle, async () => await gate.promise)
    await Promise.resolve()
    const release = service.release('owner-a', lease.handle)
    await Promise.resolve()

    expect(service.status('owner-a', lease.handle).state).toBe('draining')
    await expect(service.withPair('owner-a', lease.handle, async () => undefined))
      .rejects.toMatchObject({ code: SANDBOX_LEASE_ERROR_CODES.LEASE_DRAINING })
    expect(pairs[0]?.dispose).not.toHaveBeenCalled()
    gate.resolve()
    await operation
    await release
    expect(pairs[0]?.dispose).toHaveBeenCalledOnce()
    expect(() => service.status('owner-a', lease.handle)).toThrow('sandbox lease is unavailable')
    await service.dispose()
  })

  it('keeps a cleanup-pending lease after drain timeout and retries after unpin', async () => {
    const { service, pairs } = createService({ drainTimeoutMs: 5 })
    const lease = await service.acquire('owner-a')
    const gate = await deferred<void>()
    const operation = service.withPair('owner-a', lease.handle, async () => await gate.promise)
    await Promise.resolve()

    await expect(service.release('owner-a', lease.handle))
      .rejects.toMatchObject({ code: SANDBOX_LEASE_ERROR_CODES.LEASE_DRAIN_TIMEOUT })
    expect(service.status('owner-a', lease.handle).state).toBe('cleanup-pending')
    expect(pairs[0]?.dispose).not.toHaveBeenCalled()
    gate.resolve()
    await operation
    await service.release('owner-a', lease.handle)
    expect(pairs[0]?.dispose).toHaveBeenCalledOnce()
    await service.dispose()
  })

  it('retains quota when relocated-root cleanup fails until retry settles', async () => {
    const pair = fakePair('relocated-root')
    pair.dispose.mockRejectedValueOnce(new Error('owned root is absent at its bound path'))
    const { service } = createService({ maxOwner: 1, maxTotal: 1, create: async () => pair.pair })
    const lease = await service.acquire('owner-a')

    await expect(service.release('owner-a', lease.handle)).rejects.toMatchObject({
      code: SANDBOX_LEASE_ERROR_CODES.LEASE_CLEANUP_FAILED,
    })
    expect(service.status('owner-a', lease.handle).state).toBe('cleanup-pending')
    await expect(service.acquire('owner-a')).rejects.toMatchObject({
      code: SANDBOX_LEASE_ERROR_CODES.LEASE_QUOTA_EXCEEDED,
    })
    await expect(service.release('owner-a', lease.handle)).resolves.toBeUndefined()
    expect(pair.dispose).toHaveBeenCalledTimes(2)
    await service.dispose()
  })

  it('does not let provider close delete a published pair while an operation is pinned', async () => {
    const providerClose = vi.fn(async () => {})
    const { service, pairs } = createService({ drainTimeoutMs: 100, close: providerClose })
    const lease = await service.acquire('owner-a')
    const gate = await deferred<void>()
    const operation = service.withPair('owner-a', lease.handle, async () => await gate.promise)
    await Promise.resolve()

    await expect(service.dispose()).rejects.toBeInstanceOf(SandboxLeaseCleanupError)
    expect(providerClose).toHaveBeenCalledOnce()
    expect(pairs[0]?.dispose).not.toHaveBeenCalled()

    gate.resolve()
    await operation
    await expect(service.dispose()).resolves.toBeUndefined()
    expect(pairs[0]?.dispose).toHaveBeenCalledOnce()
    expect(providerClose).toHaveBeenCalledOnce()
    await service.dispose()
    expect(providerClose).toHaveBeenCalledOnce()
  })

  it('compensates a returned pair when readiness fails before publication', async () => {
    const pair = fakePair('unhealthy')
    pair.pair = { ...pair.pair, checkHealth: async () => { throw new Error('health failed') } }
    const { service } = createService({ create: async () => pair.pair })

    await expect(service.acquire('owner-a')).rejects.toMatchObject({
      code: SANDBOX_LEASE_ERROR_CODES.LEASE_CREATION_ABORTED,
    })
    expect(pair.dispose).toHaveBeenCalledOnce()
    expect(service.listOwn('owner-a')).toEqual([])
    await service.dispose()
  })

  it('reserves quota before async provider creation', async () => {
    const gate = await deferred<WorkspaceSandboxPairV1>()
    const { service } = createService({ maxOwner: 1, maxTotal: 1, create: async () => await gate.promise })
    const first = service.acquire('owner-a')
    await Promise.resolve()
    await expect(service.acquire('owner-a')).rejects.toMatchObject({
      code: SANDBOX_LEASE_ERROR_CODES.LEASE_QUOTA_EXCEEDED,
    })
    gate.resolve(fakePair('first').pair)
    const lease = await first
    await service.release('owner-a', lease.handle)
    await service.dispose()
  })

  it('retains provider cleanup debt and its causes under owner and global quota until release retry settles', async () => {
    const cleanupOrder: string[] = []
    let returnedObjectPending = true
    let correlationAttempts = 0
    const retry = vi.fn(async () => {
      if (returnedObjectPending) {
        cleanupOrder.push('returned-object')
        returnedObjectPending = false
      }
      cleanupOrder.push('correlation')
      if (++correlationAttempts === 1) throw new Error('correlation mismatch remains')
    })
    const originalError = new Error('create outcome unknown')
    const cleanupError = new Error('provider-local cleanup failed')
    const error = Object.assign(new AggregateError([originalError, cleanupError], 'create compensation failed'), {
      sandboxProviderCleanupDebt: { retry },
    })
    expect(error.errors).toEqual([originalError, cleanupError])
    const { service } = createService({ maxOwner: 1, maxTotal: 1, create: async () => { throw error } })

    await expect(service.acquire('owner-a')).rejects.toMatchObject({
      code: SANDBOX_LEASE_ERROR_CODES.LEASE_CLEANUP_FAILED,
    })
    expect(cleanupOrder).toEqual(['returned-object', 'correlation'])
    expect(service.listOwn('owner-a')).toEqual([
      { handle: 'lease-handle-0001', expiresAt: 60_100, state: 'cleanup-pending' },
    ])
    await expect(service.acquire('owner-a')).rejects.toMatchObject({
      code: SANDBOX_LEASE_ERROR_CODES.LEASE_QUOTA_EXCEEDED,
    })
    await service.release('owner-a', 'lease-handle-0001')
    expect(retry).toHaveBeenCalledTimes(2)
    expect(cleanupOrder).toEqual(['returned-object', 'correlation', 'correlation'])
    expect(service.listOwn('owner-a')).toEqual([])
    await service.dispose()
  })

  it('normalizes definitive provider rejection without claiming cleanup ambiguity', async () => {
    const providerError = Object.assign(new Error('credential detail'), { code: 'VERCEL_AUTH_FAILED' })
    const { service } = createService({ create: async () => { throw providerError } })

    await expect(service.acquire('owner-a')).rejects.toMatchObject({
      code: SANDBOX_LEASE_ERROR_CODES.LEASE_CREATION_ABORTED,
      message: 'sandbox provider rejected lease creation',
      retryable: false,
    })
    expect(service.listOwn('owner-a')).toEqual([])
    await service.dispose()
  })

  it('releases quota and pending-handle ownership when the handle generator is invalid', async () => {
    let attempts = 0
    const created = fakePair('valid-after-invalid')
    const { service, providerCreate } = createService({
      maxOwner: 1,
      maxTotal: 1,
      createHandle: () => ++attempts === 1 ? 'invalid' : 'lease-handle-0001',
      create: async () => created.pair,
    })

    await expect(service.acquire('owner-a')).rejects.toMatchObject({
      code: SANDBOX_LEASE_ERROR_CODES.INVALID_LEASE_REQUEST,
    })
    const lease = await service.acquire('owner-a')
    expect(lease.handle).toBe('lease-handle-0001')
    expect(providerCreate).toHaveBeenCalledOnce()
    await service.release('owner-a', lease.handle)
    expect(created.dispose).toHaveBeenCalledOnce()
    await service.dispose()
  })

  it('rejects published and concurrent pending handle collisions without creating orphan pairs', async () => {
    const firstGate = await deferred<WorkspaceSandboxPairV1>()
    const firstPair = fakePair('first-collision-owner')
    const providerCreate = vi.fn(async () => await firstGate.promise)
    const { service } = createService({
      maxOwner: 3,
      maxTotal: 3,
      createHandle: () => 'lease-handle-0001',
      create: providerCreate,
    })

    const first = service.acquire('owner-a')
    await Promise.resolve()
    await expect(service.acquire('owner-b')).rejects.toMatchObject({
      code: SANDBOX_LEASE_ERROR_CODES.INVALID_LEASE_REQUEST,
    })
    await vi.waitFor(() => expect(providerCreate).toHaveBeenCalledOnce())
    firstGate.resolve(firstPair.pair)
    const lease = await first
    await expect(service.acquire('owner-b')).rejects.toMatchObject({
      code: SANDBOX_LEASE_ERROR_CODES.INVALID_LEASE_REQUEST,
    })
    expect(providerCreate).toHaveBeenCalledOnce()
    await service.release('owner-a', lease.handle)
    expect(firstPair.dispose).toHaveBeenCalledOnce()
    await service.dispose()
  })

  it('compensates an aborted creation without publishing a lease', async () => {
    const gate = await deferred<WorkspaceSandboxPairV1>()
    const pair = fakePair('late')
    const { service } = createService({ create: async () => await gate.promise })
    const controller = new AbortController()
    const acquiring = service.acquire('owner-a', controller.signal)
    controller.abort()
    gate.resolve(pair.pair)
    await expect(acquiring).rejects.toMatchObject({ code: SANDBOX_LEASE_ERROR_CODES.LEASE_CREATION_ABORTED })
    expect(pair.dispose).toHaveBeenCalled()
    expect(service.listOwn('owner-a')).toEqual([])
    await service.dispose()
  })

  it('fences a pending creation against shutdown before publishing it', async () => {
    const gate = await deferred<WorkspaceSandboxPairV1>()
    const pair = fakePair('shutdown-race')
    const { service } = createService({ create: async () => await gate.promise })
    const acquiring = service.acquire('owner-a')
    await Promise.resolve()
    const closing = service.dispose()
    gate.resolve(pair.pair)

    await expect(acquiring).rejects.toMatchObject({ code: SANDBOX_LEASE_ERROR_CODES.LEASE_CREATION_ABORTED })
    await closing
    expect(pair.dispose).toHaveBeenCalledOnce()
    expect(service.listOwn('owner-a')).toEqual([])
  })

  it('keeps a timed-out pending acquisition registered until its late cleanup debt converges', async () => {
    const gate = await deferred<WorkspaceSandboxPairV1>()
    const pair = fakePair('late-shutdown-debt')
    pair.dispose.mockRejectedValueOnce(new Error('delete acknowledgement lost'))
    const { service } = createService({ create: async () => await gate.promise, drainTimeoutMs: 5 })
    const registry = new SandboxLeaseServiceRegistry()
    registry.register({ digest: 'pending-profile', leases: service })
    const acquiring = service.acquire('owner-a')
    await Promise.resolve()

    await expect(registry.disposeUntil(Date.now() + 15)).resolves.toEqual([
      expect.objectContaining({ status: 'rejected' }),
    ])
    expect(service.isDisposed).toBe(false)
    gate.resolve(pair.pair)
    await expect(acquiring).rejects.toMatchObject({ code: SANDBOX_LEASE_ERROR_CODES.LEASE_CLEANUP_FAILED })
    expect(service.listOwn('owner-a')).toEqual([
      expect.objectContaining({ state: 'cleanup-pending' }),
    ])
    await expect(registry.disposeUntil(Date.now() + 100)).resolves.toEqual([
      { status: 'fulfilled', value: undefined },
    ])
    expect(pair.dispose).toHaveBeenCalledTimes(2)
    expect(service.listOwn('owner-a')).toEqual([])
  })

  it('retains cleanup authority when readiness and the first compensation delete both fail', async () => {
    const pair = fakePair('setup-delete-ambiguous')
    pair.pair = { ...pair.pair, checkHealth: async () => { throw new Error('setup failed') } }
    pair.dispose.mockRejectedValueOnce(new Error('delete acknowledgement lost'))
    const { service } = createService({ create: async () => pair.pair })

    await expect(service.acquire('owner-a')).rejects.toMatchObject({
      code: SANDBOX_LEASE_ERROR_CODES.LEASE_CLEANUP_FAILED,
    })
    expect(service.listOwn('owner-a')).toEqual([
      expect.objectContaining({ handle: 'lease-handle-0001', state: 'cleanup-pending' }),
    ])
    expect(pair.dispose).toHaveBeenCalledOnce()
    await expect(service.reapExpired()).resolves.toBe(1)
    expect(pair.dispose).toHaveBeenCalledTimes(2)
    expect(service.listOwn('owner-a')).toEqual([])
    await service.dispose()
  })

  it('rechecks cancellation after asynchronous health and retains failed compensation', async () => {
    const health = await deferred<void>()
    const pair = fakePair('health-race')
    pair.pair = { ...pair.pair, checkHealth: async () => { await health.promise; return { state: 'ok' } } }
    pair.dispose.mockRejectedValueOnce(new Error('delete unavailable'))
    const { service } = createService({ create: async () => pair.pair })
    const controller = new AbortController()
    const acquiring = service.acquire('owner-a', controller.signal)
    await Promise.resolve()
    controller.abort()
    health.resolve()

    await expect(acquiring).rejects.toMatchObject({ code: SANDBOX_LEASE_ERROR_CODES.LEASE_CLEANUP_FAILED })
    expect(service.listOwn('owner-a')).toEqual([
      expect.objectContaining({ state: 'cleanup-pending' }),
    ])
    await expect(service.releaseOwner('owner-a')).resolves.toBe(1)
    await service.dispose()
  })

  it('atomically drains an unhealthy lease after its health-check pin and retains cleanup failure', async () => {
    const health = await deferred<void>()
    const unhealthy = fakePair('health-recreate')
    let healthChecks = 0
    unhealthy.pair = {
      ...unhealthy.pair,
      checkHealth: async () => {
        healthChecks += 1
        if (healthChecks === 1) return { state: 'ok' }
        await health.promise
        return { state: 'recreate' }
      },
    }
    unhealthy.dispose.mockRejectedValueOnce(new Error('delete ambiguous'))
    const { service } = createService({ create: async () => unhealthy.pair })
    const lease = await service.acquire('owner-a')
    const checked = service.withPair('owner-a', lease.handle, async () => undefined)
    await Promise.resolve()
    health.resolve()

    await expect(checked).rejects.toMatchObject({ code: SANDBOX_LEASE_ERROR_CODES.LEASE_EXPIRED })
    await vi.waitFor(() => {
      expect(service.status('owner-a', lease.handle).state).toBe('cleanup-pending')
    })
    await expect(service.withPair('owner-a', lease.handle, async () => undefined))
      .rejects.toMatchObject({ code: SANDBOX_LEASE_ERROR_CODES.LEASE_DRAINING })
    expect(unhealthy.dispose).toHaveBeenCalledOnce()
    await service.release('owner-a', lease.handle)
    expect(unhealthy.dispose).toHaveBeenCalledTimes(2)
    await service.dispose()
  })

  it('drains and sanitizes a lease whose health check throws', async () => {
    const unhealthy = fakePair('health-throw')
    let checks = 0
    unhealthy.pair = {
      ...unhealthy.pair,
      checkHealth: async () => {
        checks += 1
        if (checks === 1) return { state: 'ok' }
        throw new Error('provider secret detail')
      },
    }
    const { service } = createService({ create: async () => unhealthy.pair })
    const lease = await service.acquire('owner-a')
    await expect(service.withPair('owner-a', lease.handle, async () => undefined))
      .rejects.toMatchObject({
        code: SANDBOX_LEASE_ERROR_CODES.LEASE_EXPIRED,
        message: 'sandbox lease is unavailable',
      })
    await vi.waitFor(() => expect(service.listOwn('owner-a')).toEqual([]))
    expect(unhealthy.dispose).toHaveBeenCalledOnce()
    await service.dispose()
  })

  it('projects expiry without observing side effects and reaps every expired lease', async () => {
    const now = { value: 100 }
    const { service, pairs } = createService({ now })
    const first = await service.acquire('owner-a')
    await service.acquire('owner-b')
    now.value = 60_100

    expect(service.status('owner-a', first.handle).state).toBe('expired')
    expect(pairs[0]?.dispose).not.toHaveBeenCalled()
    await expect(service.reapExpired()).resolves.toBe(2)
    expect(pairs[0]?.dispose).toHaveBeenCalledOnce()
    expect(pairs[1]?.dispose).toHaveBeenCalledOnce()
    await service.dispose()
  })

  it('attempts every lease during bulk cleanup and retains failures for retry', async () => {
    const { service, pairs } = createService()
    await service.acquire('owner-a')
    await service.acquire('owner-a')
    pairs[0]?.dispose.mockRejectedValueOnce(new Error('delete failed'))

    await expect(service.releaseOwner('owner-a')).rejects.toBeInstanceOf(SandboxLeaseCleanupError)
    expect(pairs[0]?.dispose).toHaveBeenCalledOnce()
    expect(pairs[1]?.dispose).toHaveBeenCalledOnce()
    expect(service.listOwn('owner-a')).toHaveLength(1)
    await service.releaseOwner('owner-a')
    await service.dispose()
  })

  it('automatically reaps on one non-overlapping service-owned timer', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const gate = await deferred<void>()
    const pair = fakePair('scheduled')
    pair.dispose.mockImplementationOnce(async () => await gate.promise)
    const service = new SandboxLeaseService({
      workspaceRoot: '/host/leases',
      provider: fakeDisposableProvider({ create: async () => pair.pair }),
      serviceDigest: 'scheduled-profile',
      ttlMs: 1_000,
      reapIntervalMs: 1_000,
      drainTimeoutMs: 5_000,
      maxActiveLeasesPerOwner: 1,
      maxActiveLeasesTotal: 1,
      createHandle: () => 'lease-handle-0001',
    })
    await service.acquire('owner-a')
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(pair.dispose).toHaveBeenCalledOnce()
    gate.resolve()
    await vi.advanceTimersByTimeAsync(0)
    await service.dispose()
    vi.useRealTimers()
  })

  it('uses one shutdown drain deadline across multiple pinned leases', async () => {
    const { service } = createService({ drainTimeoutMs: 20 })
    const first = await service.acquire('owner-a')
    const second = await service.acquire('owner-a')
    const gate = await deferred<void>()
    const operations = [first, second].map(async (lease) =>
      await service.withPair('owner-a', lease.handle, async () => await gate.promise))
    await Promise.resolve()
    const startedAt = Date.now()
    await expect(service.dispose()).rejects.toBeInstanceOf(SandboxLeaseCleanupError)
    expect(Date.now() - startedAt).toBeLessThan(100)
    expect(service.listOwn('owner-a')).toHaveLength(2)
    gate.resolve()
    await Promise.all(operations)
    await service.dispose()
  })

  it('bounds an existing cleanup join by the shorter host shutdown deadline', async () => {
    const { service, pairs } = createService({ drainTimeoutMs: 5_000 })
    const lease = await service.acquire('owner-a')
    const gate = await deferred<void>()
    const operation = service.withPair('owner-a', lease.handle, async () => await gate.promise)
    await Promise.resolve()
    const releasing = service.release('owner-a', lease.handle)
    await Promise.resolve()
    const registry = new SandboxLeaseServiceRegistry()
    registry.register({ digest: 'host-deadline', leases: service })

    const startedAt = Date.now()
    await expect(registry.disposeUntil(Date.now() + 20)).resolves.toEqual([
      expect.objectContaining({ status: 'rejected' }),
    ])
    expect(Date.now() - startedAt).toBeLessThan(250)
    expect(service.listOwn('owner-a')).toHaveLength(1)

    gate.resolve()
    await operation
    await releasing
    await expect(registry.disposeUntil(Date.now() + 100)).resolves.toEqual([
      { status: 'fulfilled', value: undefined },
    ])
    expect(pairs[0]?.dispose).toHaveBeenCalledOnce()
  })

  it('joins a provider-close attempt that outlives the first shutdown deadline', async () => {
    const gate = await deferred<void>()
    const providerClose = vi.fn(async () => await gate.promise)
    const { service } = createService({ close: providerClose, drainTimeoutMs: 5 })

    await expect(service.dispose()).rejects.toBeInstanceOf(SandboxLeaseCleanupError)
    const retry = service.dispose()
    await Promise.resolve()
    expect(providerClose).toHaveBeenCalledOnce()
    gate.resolve()
    await expect(retry).resolves.toBeUndefined()
    expect(providerClose).toHaveBeenCalledOnce()
  })

  it('retries a zero-lease provider-close failure without overlapping attempts', async () => {
    const providerClose = vi.fn()
      .mockRejectedValueOnce(new Error('provider orphan cleanup failed'))
      .mockResolvedValue(undefined)
    const { service } = createService({ close: providerClose })

    const first = service.dispose()
    expect(service.dispose()).toBe(first)
    await expect(first).rejects.toBeInstanceOf(SandboxLeaseCleanupError)
    expect(providerClose).toHaveBeenCalledOnce()

    const registry = new SandboxLeaseServiceRegistry()
    registry.register({ digest: 'profile-v1', leases: service })
    await expect(registry.disposeUntil(Date.now() + 100)).resolves.toEqual([
      { status: 'fulfilled', value: undefined },
    ])
    expect(providerClose).toHaveBeenCalledTimes(2)
    await expect(service.dispose()).resolves.toBeUndefined()
    expect(providerClose).toHaveBeenCalledTimes(2)
  })

  it('closes idempotently and rejects new create or pin operations', async () => {
    const { service } = createService()
    const lease = await service.acquire('owner-a')
    await service.dispose()
    await service.dispose()
    await expect(service.acquire('owner-a')).rejects.toMatchObject({ code: SANDBOX_LEASE_ERROR_CODES.SERVICE_CLOSED })
    await expect(service.withPair('owner-a', lease.handle, async () => undefined))
      .rejects.toMatchObject({ code: SANDBOX_LEASE_ERROR_CODES.SERVICE_CLOSED })
  })
})
