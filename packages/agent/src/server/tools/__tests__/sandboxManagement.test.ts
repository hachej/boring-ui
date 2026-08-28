import { describe, expect, it, vi } from 'vitest'

import { AgentGatewayErrorCode } from '../../../shared/index'
import { ErrorCode } from '../../../shared/error-codes'
import type { ToolExecContext } from '../../../shared/tool'
import type { AgentHostRuntime } from '../../agent-host/createAgentHost'
import { InMemoryAgentRequestLedger } from '../../agent-host/requestLedger'
import { acceptedExternalEffectExecutor } from '../../agent-host/acceptedWork'
import type { AgentRequestKey } from '../../agent-host/types'
import type { SandboxLeaseService } from '../../sandbox/leases/sandboxLease'
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

function fixture() {
  const leases = {
    acquire: vi.fn(async () => ({ handle: 'lease-handle-0001', expiresAt: 1234 })),
    listOwn: vi.fn(() => [{ handle: 'lease-handle-0001', expiresAt: 1234, state: 'active' as const }]),
    status: vi.fn(() => ({ handle: 'lease-handle-0001', expiresAt: 1234, state: 'active' as const })),
    release: vi.fn(async () => {}),
  } as unknown as SandboxLeaseService
  const tool = createSandboxManagementTool({
    runtime: runtime(),
    leases,
    workspaceScopeId: 'workspace-a',
    agentTypeId: 'worker',
    allowInMemoryLedgerForTests: true,
  })
  return { tool, leases, execute: acceptedExternalEffectExecutor(tool)! }
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

  it('fails closed through ordinary public execution', async () => {
    const { tool } = fixture()
    await expect(tool.execute({ op: 'create' }, ctx)).rejects.toMatchObject({
      code: AgentGatewayErrorCode.AGENT_ACCEPTED_WORK_UNAVAILABLE,
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

  it('lists and inspects only through the host-derived owner binding', async () => {
    const { execute, leases } = fixture()
    await expect(execute({ op: 'list' }, ctx, invocation)).resolves.toMatchObject({
      details: { op: 'list', sandboxes: [{ sandbox: 'lease-handle-0001' }] },
    })
    await expect(execute({ op: 'status', sandbox: 'lease-handle-0001' }, ctx, invocation)).resolves.toMatchObject({
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
})
