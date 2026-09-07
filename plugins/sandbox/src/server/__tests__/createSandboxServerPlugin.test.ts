import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'

import { createSandboxServerPlugin } from '../createSandboxServerPlugin'
import { sandboxLeaseOwnerIdForSession } from '../leaseOwner'
import type { SandboxLeaseService } from '../leaseService'

function serviceDouble() {
  return {
    acquire: vi.fn(),
    listOwn: vi.fn(() => []),
    status: vi.fn(),
    release: vi.fn(),
    releaseOwner: vi.fn(async () => 0),
    withPair: vi.fn(),
    dispose: vi.fn(async () => {}),
  } as unknown as SandboxLeaseService
}

describe('createSandboxServerPlugin', () => {
  it('projects exactly two tools only for an independently host-granted Agent', () => {
    const leases = serviceDouble()
    const plugin = createSandboxServerPlugin({
      workspaceScopeId: 'workspace-a',
      authorizedAgentTypeIds: ['worker'],
      pluginContentDigest: 'sandbox-package-v1',
      authorityDigest: 'policy-v1',
      createLeaseService: vi.fn(() => leases),
    })

    expect(plugin.agentToolFactory?.({ agentTypeId: 'worker' }).map((tool) => tool.name)).toEqual([
      'sandbox',
      'sandbox_bash',
    ])
    expect(() => plugin.agentToolFactory?.({ agentTypeId: 'sibling' })).toThrow(
      'sandbox host grant denied',
    )
  })

  it('composes executable package identity separately from host authority identity', () => {
    const create = (pluginContentDigest: string, authorityDigest: string) => createSandboxServerPlugin({
      workspaceScopeId: 'workspace-a',
      authorizedAgentTypeIds: ['worker'],
      pluginContentDigest,
      authorityDigest,
      createLeaseService: () => serviceDouble(),
    })

    const fixed = create('sandbox-package-v1', 'policy-v1').contentDigest
    expect(fixed).toMatch(/^[a-f0-9]{64}$/)
    expect(create('sandbox-package-v1', 'policy-v1').contentDigest).toBe(fixed)
    expect(create('sandbox-package-v2', 'policy-v1').contentDigest).not.toBe(fixed)
    expect(create('sandbox-package-v1', 'policy-v2').contentDigest).not.toBe(fixed)
    expect(() => create('', 'policy-v1')).toThrow('sandbox pluginContentDigest is required')
  })

  it('joins exact-session owner cleanup without creating an unused service', async () => {
    const leases = serviceDouble()
    const createLeaseService = vi.fn(() => leases)
    const plugin = createSandboxServerPlugin({
      workspaceScopeId: 'workspace-a',
      authorizedAgentTypeIds: ['worker'],
      pluginContentDigest: 'sandbox-package-v1',
      authorityDigest: 'policy-v1',
      createLeaseService,
    })

    await plugin.onAgentSessionDelete?.({
      workspaceScopeId: 'workspace-a',
      agentTypeId: 'worker',
      sessionId: 'session-before-use',
    })
    expect(createLeaseService).not.toHaveBeenCalled()

    const tools = plugin.agentToolFactory?.({ agentTypeId: 'worker' })
    expect(createLeaseService).not.toHaveBeenCalled()
    await tools?.find((tool) => tool.name === 'sandbox')?.execute(
      { op: 'list' },
      {
        abortSignal: new AbortController().signal,
        toolCallId: 'list-a',
        workspaceId: 'workspace-a',
        sessionId: 'session-a',
      },
    )
    await plugin.onAgentSessionDelete?.({
      workspaceScopeId: 'workspace-a',
      agentTypeId: 'worker',
      sessionId: 'session-a',
    })
    expect(leases.releaseOwner).toHaveBeenCalledWith(sandboxLeaseOwnerIdForSession({
      workspaceScopeId: 'workspace-a',
      agentTypeId: 'worker',
    }, 'session-a'))
  })

  it('disposes every created service on graceful host close', async () => {
    const leases = serviceDouble()
    const plugin = createSandboxServerPlugin({
      workspaceScopeId: 'workspace-a',
      authorizedAgentTypeIds: ['worker'],
      pluginContentDigest: 'sandbox-package-v1',
      authorityDigest: 'policy-v1',
      createLeaseService: () => leases,
    })
    const tools = plugin.agentToolFactory?.({ agentTypeId: 'worker' })
    await tools?.find((tool) => tool.name === 'sandbox')?.execute(
      { op: 'list' },
      {
        abortSignal: new AbortController().signal,
        toolCallId: 'list-a',
        workspaceId: 'workspace-a',
        sessionId: 'session-a',
      },
    )

    const app = Fastify({ logger: false })
    await app.register(plugin.routes!)
    await app.close()

    expect(leases.dispose).toHaveBeenCalledOnce()
  })
})
