import { describe, expect, it, vi } from 'vitest'

import type { SandboxProviderV1, WorkspaceSandboxPairV1 } from '@hachej/boring-sandbox/shared'
import type { Sandbox, Workspace } from '../../../../shared/index'
import {
  SANDBOX_LEASE_ERROR_CODES,
  SandboxLeaseCleanupError,
  SandboxLeaseService,
} from '../sandboxLease'

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
    provider: { create: providerCreate } as unknown as SandboxProviderV1,
    serviceDigest: 'profile-v1',
    ttlMs: 60_000,
    reapIntervalMs: 60_000,
    drainTimeoutMs: input.drainTimeoutMs ?? 100,
    maxActiveLeasesPerOwner: input.maxOwner ?? 3,
    maxActiveLeasesTotal: input.maxTotal ?? 5,
    now: () => input.now?.value ?? 100,
    createHandle: () => `lease-handle-${String(++sequence).padStart(4, '0')}`,
  })
  return { service, pairs, providerCreate }
}

async function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('SandboxLeaseService lifecycle registry', () => {
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
      .rejects.toMatchObject({ code: SANDBOX_LEASE_ERROR_CODES.LEASE_CLEANUP_FAILED })
    expect(service.status('owner-a', lease.handle).state).toBe('cleanup-pending')
    expect(pairs[0]?.dispose).not.toHaveBeenCalled()
    gate.resolve()
    await operation
    await service.release('owner-a', lease.handle)
    expect(pairs[0]?.dispose).toHaveBeenCalledOnce()
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
    const telemetry = { capture: vi.fn() }
    const service = new SandboxLeaseService({
      workspaceRoot: '/host/leases',
      provider: { create: async () => pair.pair } as unknown as SandboxProviderV1,
      serviceDigest: 'scheduled-profile',
      ttlMs: 1_000,
      reapIntervalMs: 1_000,
      drainTimeoutMs: 100,
      maxActiveLeasesPerOwner: 1,
      maxActiveLeasesTotal: 1,
      telemetry,
      createHandle: () => 'lease-handle-0001',
    })
    await service.acquire('owner-a')
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(pair.dispose).toHaveBeenCalledOnce()
    gate.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(telemetry.capture).toHaveBeenCalledOnce()
    expect(JSON.stringify(telemetry.capture.mock.calls)).not.toContain('lease-handle-0001')
    await service.dispose()
    vi.useRealTimers()
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
