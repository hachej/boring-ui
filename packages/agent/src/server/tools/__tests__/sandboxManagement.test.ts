import { describe, expect, it, vi } from 'vitest'

import { AgentGatewayErrorCode } from '../../../shared/index'
import { ErrorCode } from '../../../shared/error-codes'
import type { ToolExecContext } from '../../../shared/tool'
import type { AgentHostRuntime } from '../../agent-host/createAgentHost'
import { InMemoryAgentRequestLedger } from '../../agent-host/requestLedger'
import { acceptedExternalEffectExecutor } from '../../agent-host/acceptedWork'
import type { AgentRequestKey } from '../../agent-host/types'
import type { SandboxProviderV1, WorkspaceSandboxPairV1 } from '@hachej/boring-sandbox/shared'
import {
  SANDBOX_LEASE_ERROR_CODES,
  SandboxLeaseError,
  SandboxLeaseService,
} from '../../sandbox/leases/sandboxLease'
import { sandboxLeaseOwnerId } from '../../sandbox/leases/sandboxLeaseOwner'
import { createSandboxManagementTool } from '../sandboxManagement'

const parentKey: AgentRequestKey = {
  workspaceScopeId: 'workspace-a',
  authSubjectId: 'subject-a',
  operation: 'session.prompt',
  target: { kind: 'session', ref: { agentTypeId: 'worker', sessionId: 'session-a' } },
  requestId: 'parent-a',
}
const invocation = {
  provenance: {
    parentKey,
    claim: { workspaceScopeId: 'workspace-a', authSubjectId: 'subject-a' },
  },
  toolCallId: 'tool-call-a',
}
const ctx = {
  abortSignal: new AbortController().signal,
  toolCallId: 'tool-call-a',
  sessionId: 'session-a',
  workspaceId: 'workspace-a',
} as ToolExecContext

function runtime(): AgentHostRuntime {
  const ledger = new InMemoryAgentRequestLedger()
  return {
    ledger,
    effectAdmission: {
      async admit({ key }: { key: AgentRequestKey }) {
        return { type: 'accepted' as const, admissionReceipt: `admit:${key.requestId}` }
      },
    },
    assertOpen() {},
    startPreparedEffect<T>(_key: AgentRequestKey, effect: () => Promise<T>) { return effect() },
  } as unknown as AgentHostRuntime
}

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
    runtime: runtime(),
    leases,
    workspaceScopeId: 'workspace-a',
    agentTypeId: 'worker',
    allowInMemoryLedgerForTests: true,
  })
  return { tool, leases, execute: acceptedExternalEffectExecutor(tool, { op: 'create' })! }
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
    expect(tool.parameters).toMatchObject({
      type: 'object',
      required: ['op'],
      additionalProperties: false,
      properties: {
        op: { type: 'string', enum: ['create', 'list', 'status', 'release'] },
        sandbox: { type: 'string' },
      },
    })
    expect(tool.parameters).not.toHaveProperty('oneOf')
  })

  it('fails closed through ordinary public execution', async () => {
    const { tool } = fixture()
    await expect(tool.execute({ op: 'create' }, ctx)).resolves.toMatchObject({
      isError: true,
      details: { code: AgentGatewayErrorCode.AGENT_ACCEPTED_WORK_UNAVAILABLE },
    })
  })

  it('creates through accepted work and replays the receipt without another provider call', async () => {
    const { execute, leases } = fixture()
    await expect(execute({ op: 'create' }, ctx, invocation)).resolves.toMatchObject({
      details: { op: 'create', sandbox: 'lease-handle-0001', expiresAt: 1234 },
    })
    await expect(execute({ op: 'create' }, ctx, invocation)).resolves.toMatchObject({
      details: { op: 'create', sandbox: 'lease-handle-0001', expiresAt: 1234 },
    })
    expect(leases.acquire).toHaveBeenCalledOnce()
  })

  it('lists and inspects without accepted-work provenance through the host-derived owner binding', async () => {
    const { tool, leases } = fixture()
    expect(acceptedExternalEffectExecutor(tool, { op: 'list' })).toBeUndefined()
    expect(acceptedExternalEffectExecutor(tool, { op: 'status', sandbox: 'lease-handle-0001' })).toBeUndefined()
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

  it('releases through accepted work and rejects unknown fields', async () => {
    const { execute, leases } = fixture()
    await expect(execute({ op: 'release', sandbox: 'lease-handle-0001' }, ctx, {
      ...invocation,
      toolCallId: 'release-call',
    })).resolves.toMatchObject({ details: { released: true } })
    expect(leases.release).toHaveBeenCalledOnce()

    await expect(execute({ op: 'list', provider: 'vercel' }, ctx, invocation))
      .resolves.toMatchObject({ isError: true, details: { code: ErrorCode.enum.SANDBOX_LEASE_INVALID } })
  })

  it.each([
    [SANDBOX_LEASE_ERROR_CODES.INVALID_LEASE_REQUEST, false],
    [SANDBOX_LEASE_ERROR_CODES.LEASE_NOT_FOUND, false],
    [SANDBOX_LEASE_ERROR_CODES.LEASE_EXPIRED, false],
    [SANDBOX_LEASE_ERROR_CODES.LEASE_DRAINING, true],
    [SANDBOX_LEASE_ERROR_CODES.LEASE_QUOTA_EXCEEDED, true],
    [SANDBOX_LEASE_ERROR_CODES.LEASE_CREATION_ABORTED, true],
    [SANDBOX_LEASE_ERROR_CODES.LEASE_DRAIN_TIMEOUT, true],
    [SANDBOX_LEASE_ERROR_CODES.SERVICE_CLOSED, false],
  ] as const)('preserves canonical service error %s on initial execution and replay', async (code, retryable) => {
    const { tool, leases } = fixture(new SandboxLeaseError(code, 'internal service detail', retryable))
    const executeRelease = acceptedExternalEffectExecutor(tool, { op: 'release', sandbox: 'lease-handle-0001' })!
    const releaseInvocation = { ...invocation, toolCallId: `release-${code}` }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await executeRelease(
        { op: 'release', sandbox: 'lease-handle-0001' },
        { ...ctx, toolCallId: releaseInvocation.toolCallId },
        releaseInvocation,
      )
      expect(response).toMatchObject({ isError: true, details: { code, retryable } })
      expect(response.content[0]?.text).not.toContain('internal service detail')
    }
    expect(leases.release).toHaveBeenCalledOnce()
  })

  it('preserves drain timeout on initial execution and accepted-work replay without disposing an active pair', async () => {
    const dispose = vi.fn(async () => {})
    const pair = {
      workspace: {},
      sandbox: {},
      dispose,
    } as unknown as WorkspaceSandboxPairV1
    const provider = {
      create: vi.fn(async () => pair),
    } as unknown as SandboxProviderV1
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
      runtime: runtime(),
      leases,
      workspaceScopeId: 'workspace-a',
      agentTypeId: 'worker',
      allowInMemoryLedgerForTests: true,
    })
    const owner = sandboxLeaseOwnerId({ workspaceScopeId: 'workspace-a', agentTypeId: 'worker' }, ctx)
    const lease = await leases.acquire(owner)
    let finishOperation!: () => void
    const operationGate = new Promise<void>((resolve) => { finishOperation = resolve })
    const operation = leases.withPair(owner, lease.handle, async () => await operationGate)
    await Promise.resolve()
    const executeRelease = acceptedExternalEffectExecutor(tool, { op: 'release', sandbox: lease.handle })!
    const releaseInvocation = { ...invocation, toolCallId: 'release-drain-timeout' }

    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await expect(executeRelease(
          { op: 'release', sandbox: lease.handle },
          { ...ctx, toolCallId: releaseInvocation.toolCallId },
          releaseInvocation,
        )).resolves.toMatchObject({
          isError: true,
          details: { code: SANDBOX_LEASE_ERROR_CODES.LEASE_DRAIN_TIMEOUT, retryable: true },
        })
        expect(dispose).not.toHaveBeenCalled()
      }
    } finally {
      finishOperation()
      await operation
      await leases.release(owner, lease.handle)
      await leases.dispose()
    }
  })

  it('keeps ambiguous create cleanup outcome-unknown immutable across replay', async () => {
    const { tool, leases } = fixture()
    vi.mocked(leases.acquire).mockRejectedValueOnce(new SandboxLeaseError(
      SANDBOX_LEASE_ERROR_CODES.LEASE_CLEANUP_FAILED,
      'setup failed and first remote delete acknowledgement was lost',
      true,
    ))
    const executeCreate = acceptedExternalEffectExecutor(tool, { op: 'create' })!
    const createInvocation = { ...invocation, toolCallId: 'create-ambiguous-cleanup' }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(executeCreate(
        { op: 'create' },
        { ...ctx, toolCallId: createInvocation.toolCallId },
        createInvocation,
      )).resolves.toMatchObject({
        isError: true,
        details: { code: AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN },
      })
    }
    expect(leases.acquire).toHaveBeenCalledOnce()
  })

  it('sanitizes unknown provider-shaped failures as generic cleanup failure', async () => {
    const { tool, leases } = fixture()
    vi.mocked(leases.status).mockImplementation(() => {
      throw Object.assign(new Error('provider secret detail'), {
        code: ErrorCode.enum.VERCEL_API_ERROR,
        statusCode: 503,
        retryable: true,
      })
    })

    const response = await tool.execute({ op: 'status', sandbox: 'lease-handle-0001' }, ctx)
    expect(response).toMatchObject({
      isError: true,
      details: { code: SANDBOX_LEASE_ERROR_CODES.LEASE_CLEANUP_FAILED, retryable: true },
    })
    expect(response.content[0]?.text).toBe('sandbox operation failed')
  })
})
