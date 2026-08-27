import { describe, expect, it, vi } from 'vitest'

import type { SandboxProviderV1, WorkspaceSandboxPairV1 } from '@hachej/boring-sandbox/shared'
import type { Sandbox, Workspace } from '../../shared/index'
import {
  SANDBOX_LEASE_ERROR_CODES,
  SandboxLeaseCleanupError,
  SandboxLeaseError,
  SandboxLeaseService,
  runSandbox,
} from '../sandboxLease'

const EEXIST_CODE = 'EEXIST'

interface FakePair {
  pair: WorkspaceSandboxPairV1
  files: Map<string, string | Uint8Array>
  exec: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
  workspace: {
    readFile: ReturnType<typeof vi.fn>
    writeFile: ReturnType<typeof vi.fn>
    readdir: ReturnType<typeof vi.fn>
    stat: ReturnType<typeof vi.fn>
    writeBinaryFile: ReturnType<typeof vi.fn>
    createBinaryFile: ReturnType<typeof vi.fn>
  }
}

function createFakePair(): FakePair {
  const files = new Map<string, string | Uint8Array>()
  const workspace = {
    readFile: vi.fn(async (path: string) => {
      const value = files.get(path)
      return typeof value === 'string' ? value : ''
    }),
    writeFile: vi.fn(async (path: string, content: string) => { files.set(path, content) }),
    readdir: vi.fn(async () => [{ name: 'proof.txt', kind: 'file' as const }]),
    stat: vi.fn(async () => ({ size: 1, mtimeMs: 1, kind: 'file' as const })),
    writeBinaryFile: vi.fn(async (path: string, content: Uint8Array) => { files.set(path, content) }),
    createBinaryFile: vi.fn(async (path: string, content: Uint8Array) => {
      if (files.has(path)) throw Object.assign(new Error('exists'), { code: EEXIST_CODE })
      files.set(path, content)
    }),
  }
  const exec = vi.fn(async () => ({
    stdout: new Uint8Array([111, 107]),
    stderr: new Uint8Array(),
    exitCode: 0,
    durationMs: 1,
    truncated: false,
  }))
  const dispose = vi.fn(async () => {})
  return {
    files,
    exec,
    dispose,
    workspace,
    pair: {
      workspace: {
        root: '/sandbox',
        runtimeContext: { runtimeCwd: '/sandbox' },
        ...workspace,
        unlink: vi.fn(),
        mkdir: vi.fn(),
        rename: vi.fn(),
      } as unknown as Workspace,
      sandbox: {
        id: 'fake',
        placement: 'remote',
        provider: 'fake',
        capabilities: ['exec'],
        runtimeContext: { runtimeCwd: '/sandbox' },
        exec,
      } as unknown as Sandbox,
      dispose,
    },
  }
}

function createService(now = { value: 100 }) {
  const pairs: FakePair[] = []
  const create = vi.fn(async () => {
    const fake = createFakePair()
    pairs.push(fake)
    return fake.pair
  })
  let sequence = 0
  const service = new SandboxLeaseService({
    workspaceRoot: '/host/verification-sandboxes',
    provider: { create } as unknown as SandboxProviderV1,
    ttlMs: 50,
    now: () => now.value,
    createHandle: () => `lease-handle-${String(++sequence).padStart(4, '0')}`,
  })
  return { service, pairs, create }
}

describe('SandboxLeaseService', () => {
  it('routes every verification operation through the lease pair without runtime redirection', async () => {
    const { service, pairs, create } = createService()
    const lease = await service.acquire('worker-a')

    await expect(runSandbox(service, {
      op: 'exec', ownerId: 'worker-a', lease: lease.handle, command: 'pnpm test', timeoutMs: 10, maxOutputBytes: 20,
    })).resolves.toMatchObject({ op: 'exec', result: { exitCode: 0 } })
    await service.runSandbox({ op: 'write', ownerId: 'worker-a', lease: lease.handle, path: 'proof.txt', content: 'ok' })
    await expect(service.runSandbox({ op: 'read', ownerId: 'worker-a', lease: lease.handle, path: 'proof.txt' }))
      .resolves.toEqual({ op: 'read', content: 'ok' })
    await expect(service.runSandbox({ op: 'list', ownerId: 'worker-a', lease: lease.handle }))
      .resolves.toEqual({ op: 'list', entries: [{ name: 'proof.txt', kind: 'file' }] })
    await expect(service.runSandbox({ op: 'stat', ownerId: 'worker-a', lease: lease.handle }))
      .resolves.toEqual({ op: 'stat', stat: { size: 1, mtimeMs: 1, kind: 'file' } })
    await service.runSandbox({
      op: 'upload', ownerId: 'worker-a', lease: lease.handle, path: 'artifact.bin', content: new Uint8Array([1]), overwrite: false,
    })

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      workspaceRoot: `/host/verification-sandboxes/${lease.handle}`,
      sessionId: lease.handle,
    }))
    expect(pairs[0]?.exec).toHaveBeenCalledWith('pnpm test', { timeoutMs: 10, maxOutputBytes: 20 })
    expect(pairs[0]?.files.get('artifact.bin')).toEqual(new Uint8Array([1]))
  })

  it('returns exact-head command evidence after host-side source provisioning', async () => {
    const { service, pairs } = createService()
    const lease = await service.acquire('worker-a')
    const targetSha = '18301216eb258f39fda93c0e18e4416c5160b55b'
    pairs[0]?.exec.mockResolvedValueOnce({
      stdout: new TextEncoder().encode(`${targetSha}\n`),
      stderr: new Uint8Array(),
      exitCode: 0,
      durationMs: 1,
      truncated: false,
    })

    const proof = await service.runSandbox({
      op: 'exec',
      ownerId: 'worker-a',
      lease: lease.handle,
      command: 'git rev-parse HEAD',
    })

    expect(proof.op).toBe('exec')
    expect(proof.op === 'exec' && new TextDecoder().decode(proof.result.stdout).trim()).toBe(targetSha)
    expect(pairs[0]?.exec).toHaveBeenCalledWith('git rev-parse HEAD', {
      timeoutMs: undefined,
      maxOutputBytes: undefined,
    })
  })

  it('does not reveal or allow another owner to use a lease', async () => {
    const { service, pairs } = createService()
    const first = await service.acquire('worker-a')
    const second = await service.acquire('worker-b')

    await expect(service.runSandbox({ op: 'read', ownerId: 'worker-b', lease: first.handle, path: 'proof.txt' }))
      .rejects.toMatchObject({ code: SANDBOX_LEASE_ERROR_CODES.LEASE_NOT_FOUND satisfies SandboxLeaseError['code'] })
    await service.runSandbox({ op: 'write', ownerId: 'worker-b', lease: second.handle, path: 'proof.txt', content: 'only-b' })

    expect(pairs[0]?.workspace.writeFile).not.toHaveBeenCalled()
    expect(pairs[1]?.workspace.writeFile).toHaveBeenCalledWith('proof.txt', 'only-b')
  })

  it('expires and disposes leases, including scheduler cleanup', async () => {
    const now = { value: 100 }
    const { service, pairs } = createService(now)
    const expired = await service.acquire('worker-a')
    now.value = 150

    await expect(service.runSandbox({ op: 'stat', ownerId: 'worker-a', lease: expired.handle }))
      .rejects.toMatchObject({ code: SANDBOX_LEASE_ERROR_CODES.LEASE_EXPIRED satisfies SandboxLeaseError['code'] })
    expect(pairs[0]?.dispose).toHaveBeenCalledTimes(1)

    await service.acquire('worker-a')
    now.value = 200
    await expect(service.reapExpired()).resolves.toBe(1)
    expect(pairs[1]?.dispose).toHaveBeenCalledTimes(1)
  })

  it('reaps every expired lease, retains failures, and reports partial cleanup', async () => {
    const now = { value: 100 }
    const { service, pairs } = createService(now)
    await service.acquire('worker-a')
    await service.acquire('worker-b')
    await service.acquire('worker-c')
    pairs[0]?.dispose.mockRejectedValueOnce(new Error('delete-a failed'))
    pairs[2]?.dispose.mockRejectedValueOnce(new Error('delete-c failed'))
    now.value = 200

    await expect(service.reapExpired()).rejects.toMatchObject({
      code: SANDBOX_LEASE_ERROR_CODES.LEASE_CLEANUP_FAILED satisfies SandboxLeaseCleanupError['code'],
      operation: 'reap-expired',
      releasedCount: 1,
      failures: [expect.any(Error), expect.any(Error)],
    })
    expect(pairs.map((pair) => pair.dispose.mock.calls.length)).toEqual([1, 1, 1])
    await expect(service.reapExpired()).resolves.toBe(2)
    expect(pairs.map((pair) => pair.dispose.mock.calls.length)).toEqual([2, 1, 2])
  })

  it('disposes every active lease and reports partial cleanup', async () => {
    const { service, pairs } = createService()
    await service.acquire('worker-a')
    await service.acquire('worker-b')
    pairs[0]?.dispose.mockRejectedValueOnce(new Error('delete-a failed'))

    await expect(service.dispose()).rejects.toMatchObject({
      code: SANDBOX_LEASE_ERROR_CODES.LEASE_CLEANUP_FAILED satisfies SandboxLeaseCleanupError['code'],
      operation: 'dispose',
      releasedCount: 1,
      failures: [expect.any(Error)],
    })
    expect(pairs.map((pair) => pair.dispose.mock.calls.length)).toEqual([1, 1])
    await expect(service.dispose()).resolves.toBeUndefined()
    expect(pairs.map((pair) => pair.dispose.mock.calls.length)).toEqual([2, 1])
  })

  it('rejects traversal and host-shaped upload destinations before touching the workspace', async () => {
    const { service, pairs } = createService()
    const lease = await service.acquire('worker-a')
    for (const path of ['../host-secret', '/etc/passwd', 'C:\\host-secret', 'proof/../escape']) {
      await expect(service.runSandbox({
        op: 'upload', ownerId: 'worker-a', lease: lease.handle, path, content: new Uint8Array([1]), overwrite: false,
      })).rejects.toMatchObject({ code: SANDBOX_LEASE_ERROR_CODES.INVALID_LEASE_REQUEST satisfies SandboxLeaseError['code'] })
    }
    expect(pairs[0]?.workspace.createBinaryFile).not.toHaveBeenCalled()
    expect(pairs[0]?.workspace.writeBinaryFile).not.toHaveBeenCalled()
  })

  it('releases a lease only through its owning opaque handle', async () => {
    const { service, pairs } = createService()
    const lease = await service.acquire('worker-a')
    await expect(service.runSandbox({ op: 'release', ownerId: 'worker-a', lease: lease.handle }))
      .resolves.toEqual({ op: 'release', released: true })
    expect(pairs[0]?.dispose).toHaveBeenCalledTimes(1)
    await expect(service.runSandbox({ op: 'stat', ownerId: 'worker-a', lease: lease.handle }))
      .rejects.toMatchObject({ code: SANDBOX_LEASE_ERROR_CODES.LEASE_NOT_FOUND satisfies SandboxLeaseError['code'] })
  })

  it('retains a lease when provider cleanup fails so release can retry', async () => {
    const { service, pairs } = createService()
    const lease = await service.acquire('worker-a')
    pairs[0]?.dispose.mockRejectedValueOnce(new Error('remote delete failed'))

    await expect(service.runSandbox({ op: 'release', ownerId: 'worker-a', lease: lease.handle }))
      .rejects.toThrow('remote delete failed')
    await expect(service.runSandbox({ op: 'stat', ownerId: 'worker-a', lease: lease.handle }))
      .resolves.toMatchObject({ op: 'stat' })
    await expect(service.runSandbox({ op: 'release', ownerId: 'worker-a', lease: lease.handle }))
      .resolves.toEqual({ op: 'release', released: true })
    expect(pairs[0]?.dispose).toHaveBeenCalledTimes(2)
  })
})
