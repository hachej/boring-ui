import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthorizedAgentScope } from '../../../shared/index'
import { createTestRuntimeModeAdapter } from '@agent-test-host'
import { createAgentHost } from '../createAgentHost'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

async function root() {
  const value = await mkdtemp(join(tmpdir(), 'agent-host-'))
  roots.push(value)
  return value
}

const scope = { workspaceScopeId: 'workspace-a', authSubjectId: 'subject-a' } as AuthorizedAgentScope

function options(sessionRoot: string) {
  return {
    agents: [{ agentTypeId: 'alpha', definition: { instructions: 'alpha', label: 'Alpha' } }],
    fleetCompiler: { compile: vi.fn(async ({ agents }: { agents: readonly unknown[] }) => agents as never) },
    scopeVerifier: { verify: vi.fn(async () => ({ workspaceScopeId: 'workspace-a', authSubjectId: 'subject-a' })) },
    runtimeModeAdapter: createTestRuntimeModeAdapter('direct'),
    sessionRoot,
    resolveRuntimeScope: vi.fn(async () => ({
      identity: 'runtime-a',
      environment: {
        placementIdentity: 'direct-a',
        workspaceRoot: sessionRoot,
        provisioningFingerprint: 'provision-a',
      },
      sessionNamespace: 'alpha-a',
    })),
  }
}

describe('createAgentHost', () => {
  it('awaits compilation, freezes the fleet, and publishes a stable durable identity', async () => {
    const sessionRoot = await root()
    const firstOptions = options(sessionRoot)
    const first = await createAgentHost(firstOptions)
    const firstDescription = await first.host.describe()
    expect(firstOptions.fleetCompiler.compile).toHaveBeenCalledOnce()
    expect(firstDescription).toMatchObject({ agents: [{ agentTypeId: 'alpha', label: 'Alpha' }] })
    expect((await first.gateway.listAgents({ scope }))[0]).toMatchObject({ agentTypeId: 'alpha' })
    expect((await readFile(join(sessionRoot, '.agent-host-id'), 'utf8')).trim()).toBe(first.host.hostId)
    await first.host.close()

    const second = await createAgentHost(options(sessionRoot))
    expect(second.host.hostId).toBe(first.host.hostId)
    await second.host.close()
  })

  it('requires a stable host identity source and validates explicit IDs', async () => {
    const sessionRoot = await root()
    await expect(createAgentHost({ ...options(sessionRoot), hostId: 'bad host' })).rejects.toThrow('hostId')
    await expect(createAgentHost({ ...options(sessionRoot), sessionRoot: undefined })).rejects.toThrow('hostId or a durable sessionRoot')
  })
})
