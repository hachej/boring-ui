import type { WorkspaceSandboxPairV1 } from '@hachej/boring-sandbox/shared'
import { describe, expect, it, vi } from 'vitest'

import type { ToolExecContext } from '../../../shared/tool'
import {
  SANDBOX_LEASE_ERROR_CODES,
  SandboxLeaseError,
  SandboxLeaseService,
} from '../../sandbox/leases/sandboxLease'
import { fakeDisposableProvider } from '../../sandbox/leases/__tests__/fakeDisposableProvider'
import { sandboxLeaseOwnerId } from '../../sandbox/leases/sandboxLeaseOwner'
import { createSandboxManagementTool } from '../sandboxManagement'

const ctx = {
  abortSignal: new AbortController().signal,
  toolCallId: 'tool-call-a',
  sessionId: 'session-a',
  workspaceId: 'workspace-a',
} as ToolExecContext

function fixture(releaseError?: SandboxLeaseError) {
  const leases = {
    acquire: vi.fn(async () => ({ handle: 'lease-handle-0001', expiresAt: 1234 })),
    listOwn: vi.fn(() => [{ handle: 'lease-handle-0001', expiresAt: 1234, state: 'active' as const }]),
    status: vi.fn(() => ({ handle: 'lease-handle-0001', expiresAt: 1234, state: 'active' as const })),
    release: vi.fn(async () => {
      if (releaseError) throw releaseError
    }),
  } as unknown as SandboxLeaseService
  const tool = createSandboxManagementTool({
    leases,
    workspaceScopeId: 'workspace-a',
    agentTypeId: 'worker',
  })
  return { tool, leases }
}

describe('sandbox management tool', () => {
  it('exposes only strict lifecycle inputs and no authority controls', () => {
    const { tool } = fixture()
    expect(tool.name).toBe('sandbox')
    const text = JSON.stringify(tool.parameters)
    for (const forbidden of ['provider', 'snapshot', 'repository', 'environment', 'credential', 'network', 'ownerId', 'ttlMs']) {
      expect(text).not.toContain(forbidden)
    }
    expect(text).toContain('create')
    expect(text).toContain('release')
  })

  it('creates directly through the lease service', async () => {
    const { tool, leases } = fixture()
    await expect(tool.execute({ op: 'create' }, ctx)).resolves.toMatchObject({
      details: { op: 'create', sandbox: 'lease-handle-0001', expiresAt: 1234 },
    })
    expect(leases.acquire).toHaveBeenCalledWith(expect.any(String), ctx.abortSignal)
  })

  it.each([
    ['missing', { ...ctx, workspaceId: undefined }],
    ['mismatched', { ...ctx, workspaceId: 'workspace-b' }],
  ])('rejects %s workspace identity before lease acquisition', async (_label, invalidCtx) => {
    const { tool, leases } = fixture()
    await expect(tool.execute({ op: 'create' }, invalidCtx)).resolves.toMatchObject({
      isError: true,
      details: { code: SANDBOX_LEASE_ERROR_CODES.INVALID_LEASE_REQUEST, retryable: false },
    })
    expect(leases.acquire).not.toHaveBeenCalled()
  })

  it('does not claim durable per-tool replay before the durable execution lane lands', async () => {
    const { tool, leases } = fixture()
    await tool.execute({ op: 'create' }, ctx)
    await tool.execute({ op: 'create' }, ctx)
    expect(leases.acquire).toHaveBeenCalledTimes(2)
  })

  it('lists and inspects through the host-derived owner binding', async () => {
    const { tool, leases } = fixture()
    await expect(tool.execute({ op: 'list' }, ctx)).resolves.toMatchObject({
      details: { op: 'list', sandboxes: [{ sandbox: 'lease-handle-0001' }] },
    })
    await expect(tool.execute({ op: 'status', sandbox: 'lease-handle-0001' }, ctx)).resolves.toMatchObject({
      details: { op: 'status', sandbox: 'lease-handle-0001', state: 'active' },
    })
    const listedOwner = vi.mocked(leases.listOwn).mock.calls[0]?.[0]
    expect(listedOwner).toMatch(/^[a-f0-9]{64}$/)
    expect(leases.status).toHaveBeenCalledWith(listedOwner, 'lease-handle-0001')
  })

  it('releases directly and rejects unknown fields', async () => {
    const { tool, leases } = fixture()
    await expect(tool.execute({ op: 'release', sandbox: 'lease-handle-0001' }, ctx))
      .resolves.toMatchObject({ details: { released: true } })
    expect(leases.release).toHaveBeenCalledOnce()

    await expect(tool.execute({ op: 'list', provider: 'vercel' }, ctx))
      .resolves.toMatchObject({
        isError: true,
        details: { code: SANDBOX_LEASE_ERROR_CODES.INVALID_LEASE_REQUEST },
      })
  })

  it.each([
    [SANDBOX_LEASE_ERROR_CODES.INVALID_LEASE_REQUEST, false],
    [SANDBOX_LEASE_ERROR_CODES.LEASE_NOT_FOUND, false],
    [SANDBOX_LEASE_ERROR_CODES.LEASE_EXPIRED, false],
    [SANDBOX_LEASE_ERROR_CODES.LEASE_DRAINING, false],
    [SANDBOX_LEASE_ERROR_CODES.LEASE_QUOTA_EXCEEDED, true],
    [SANDBOX_LEASE_ERROR_CODES.LEASE_CREATION_ABORTED, true],
    [SANDBOX_LEASE_ERROR_CODES.LEASE_DRAIN_TIMEOUT, true],
    [SANDBOX_LEASE_ERROR_CODES.SERVICE_CLOSED, false],
  ] as const)('preserves canonical service error %s', async (code, retryable) => {
    const { tool } = fixture(new SandboxLeaseError(code, 'sandbox operation failed', retryable))
    await expect(tool.execute({ op: 'release', sandbox: 'lease-handle-0001' }, ctx)).resolves.toMatchObject({
      isError: true,
      details: { code, retryable },
    })
  })

  it('preserves drain timeout without disposing an active pair', async () => {
    const dispose = vi.fn(async () => {})
    const pair = { workspace: {}, sandbox: {}, dispose } as unknown as WorkspaceSandboxPairV1
    const provider = fakeDisposableProvider({
      create: vi.fn(async () => pair),
      providerId: 'vercel-sandbox',
    })
    const leases = new SandboxLeaseService({
      workspaceRoot: '/host/sandboxes',
      provider,
      serviceDigest: 'service-a',
      ttlMs: 60_000,
      reapIntervalMs: 60_000,
      drainTimeoutMs: 10,
      maxActiveLeasesPerOwner: 2,
      maxActiveLeasesTotal: 2,
      createHandle: () => 'lease-handle-0001',
    })
    const tool = createSandboxManagementTool({
      leases,
      workspaceScopeId: 'workspace-a',
      agentTypeId: 'worker',
    })
    const owner = sandboxLeaseOwnerId({ workspaceScopeId: 'workspace-a', agentTypeId: 'worker' }, ctx)
    const lease = await leases.acquire(owner)
    let finishOperation!: () => void
    const operationGate = new Promise<void>((resolve) => { finishOperation = resolve })
    const operation = leases.withPair(owner, lease.handle, async () => await operationGate)
    await Promise.resolve()

    try {
      await expect(tool.execute({ op: 'release', sandbox: lease.handle }, ctx)).resolves.toMatchObject({
        isError: true,
        details: { code: SANDBOX_LEASE_ERROR_CODES.LEASE_DRAIN_TIMEOUT, retryable: true },
      })
      expect(dispose).not.toHaveBeenCalled()
    } finally {
      finishOperation()
      await operation
      await leases.release(owner, lease.handle)
      await leases.dispose()
    }
  })

  it('surfaces ambiguous create cleanup debt without automatic tool replay', async () => {
    const { tool, leases } = fixture()
    vi.mocked(leases.acquire).mockRejectedValue(new SandboxLeaseError(
      SANDBOX_LEASE_ERROR_CODES.LEASE_CLEANUP_FAILED,
      'sandbox cleanup failed',
      true,
    ))

    await expect(tool.execute({ op: 'create' }, ctx)).resolves.toMatchObject({
      isError: true,
      details: { code: SANDBOX_LEASE_ERROR_CODES.LEASE_CLEANUP_FAILED, retryable: true },
    })
    expect(leases.acquire).toHaveBeenCalledOnce()
  })

  it('sanitizes unknown provider-shaped failures as generic cleanup failure', async () => {
    const { tool, leases } = fixture()
    vi.mocked(leases.status).mockImplementation(() => {
      throw new Error('provider secret detail')
    })

    const response = await tool.execute({ op: 'status', sandbox: 'lease-handle-0001' }, ctx)
    expect(response).toMatchObject({
      isError: true,
      details: { code: SANDBOX_LEASE_ERROR_CODES.LEASE_CLEANUP_FAILED, retryable: true },
    })
    expect(response.content[0]?.text).toBe('sandbox operation failed')
  })
})
