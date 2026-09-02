import type { Sandbox, Workspace } from '@hachej/boring-agent/shared'
import type { WorkspaceSandboxPairV1 } from '@hachej/boring-sandbox/shared'
import { describe, expect, it, vi } from 'vitest'

import { createSandboxBashTool } from '../sandboxBashTool'
import { sandboxLeaseOwnerIdForSession } from '../leaseOwner'
import type { SandboxLeaseService } from '../leaseService'

function leasedPair(exec: Sandbox['exec']): WorkspaceSandboxPairV1 {
  return {
    workspace: { root: '/workspace' } as Workspace,
    sandbox: {
      id: 'sandbox-a',
      placement: 'remote',
      provider: 'fake',
      capabilities: ['exec'],
      runtimeContext: { runtimeCwd: '/workspace' },
      exec,
      dispose: vi.fn(async () => {}),
    } as unknown as Sandbox,
    dispose: vi.fn(async () => {}),
  }
}

describe('sandbox_bash', () => {
  it('requires an owned handle, strips it, and delegates while the pair is pinned', async () => {
    const exec = vi.fn(async (_command, options) => {
      options?.onStdout?.(new TextEncoder().encode('leased-output'))
      return { exitCode: 0, stdout: new Uint8Array(), stderr: new Uint8Array() }
    }) as unknown as Sandbox['exec']
    const pair = leasedPair(exec)
    const withPair = vi.fn(async (_owner, _handle, action) => await action(pair))
    const leases = { withPair } as unknown as SandboxLeaseService
    const tool = createSandboxBashTool({
      leases,
      workspaceScopeId: 'workspace-a',
      agentTypeId: 'worker',
    })
    const ctx = {
      abortSignal: new AbortController().signal,
      toolCallId: 'call-a',
      workspaceId: 'workspace-a',
      sessionId: 'session-a',
    }

    const result = await tool.execute({ sandbox: 'lease-handle-0001', command: 'printf leased-output' }, ctx)

    expect(result.isError).not.toBe(true)
    expect(withPair).toHaveBeenCalledWith(
      sandboxLeaseOwnerIdForSession({ workspaceScopeId: 'workspace-a', agentTypeId: 'worker' }, 'session-a'),
      'lease-handle-0001',
      expect.any(Function),
    )
    expect(exec).toHaveBeenCalledWith('printf leased-output', expect.objectContaining({ cwd: '/workspace' }))
    expect(JSON.stringify((exec as unknown as ReturnType<typeof vi.fn>).mock.calls)).not.toContain('lease-handle-0001')
  })

  it('fails closed without the exact session/workspace execution context', async () => {
    const leases = { withPair: vi.fn() } as unknown as SandboxLeaseService
    const tool = createSandboxBashTool({
      leases,
      workspaceScopeId: 'workspace-a',
      agentTypeId: 'worker',
    })

    const result = await tool.execute(
      { sandbox: 'lease-handle-0001', command: 'true' },
      { abortSignal: new AbortController().signal, toolCallId: 'call-a', workspaceId: 'workspace-a' },
    )

    expect(result).toMatchObject({ isError: true, details: { code: 'SANDBOX_LEASE_INVALID' } })
    expect(leases.withPair).not.toHaveBeenCalled()
  })
})
