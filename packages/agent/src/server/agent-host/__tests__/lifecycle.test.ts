import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentGatewayErrorCode, type AuthorizedAgentScope } from '../../../shared/index'
import type { AgentCoreHarnessFactory } from '../../../shared/harness'
import { createTestRuntimeModeAdapter } from '@agent-test-host'
import { createScriptedPiHarness } from '../../testing/scriptedPiHarness'
import { createAgentHost } from '../createAgentHost'
import type { CreateAgentHostOptions } from '../types'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

async function options(overrides: Partial<CreateAgentHostOptions> = {}) {
  const sessionRoot = await mkdtemp(join(tmpdir(), 'agent-host-lifecycle-'))
  roots.push(sessionRoot)
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'agent-host-workspace-'))
  roots.push(workspaceRoot)
  const baseAdapter = createTestRuntimeModeAdapter('direct')
  const dispose = vi.fn(async () => baseAdapter.dispose?.())
  const runtimeModeAdapter = { ...baseAdapter, dispose }
  const value: CreateAgentHostOptions = {
    agents: [{ agentTypeId: 'alpha', definition: { instructions: 'alpha', label: 'Alpha' } }],
    fleetCompiler: { compile: async ({ agents }) => agents },
    hostId: 'lifecycle-host',
    scopeVerifier: { verify: async (scope) => ({ workspaceScopeId: scope.workspaceScopeId, authSubjectId: scope.authSubjectId }) },
    runtimeModeAdapter,
    sessionRoot,
    shutdownGraceMs: 10,
    harnessFactory: createScriptedPiHarness as AgentCoreHarnessFactory,
    resolveRuntimeScope: async () => ({
      identity: 'runtime-a',
      environment: {
        placementIdentity: 'direct-a',
        workspaceRoot,
        provisioningFingerprint: 'provision-a',
      },
      sessionNamespace: 'alpha-a',
    }),
    ...overrides,
  }
  return { value, dispose }
}

const scope = { workspaceScopeId: 'workspace-a', authSubjectId: 'subject-a' } as AuthorizedAgentScope

describe('Agent Host lifecycle', () => {
  it('closes active unbounded subscriptions and disposes bindings, Environment, and adapter once', async () => {
    const fixture = await options()
    const created = await createAgentHost(fixture.value)
    const ref = await created.gateway.createSession({ scope, agentTypeId: 'alpha', requestId: 'create' })
    const connection = await created.gateway.connectSession({ scope, ref })
    const pending = connection.events[Symbol.asyncIterator]().next()

    await Promise.all([created.host.close(), created.host.close()])
    await expect(pending).resolves.toMatchObject({ done: true })
    expect(fixture.dispose).toHaveBeenCalledOnce()
    await expect(created.gateway.listAgents({ scope })).rejects.toMatchObject({
      code: AgentGatewayErrorCode.AGENT_GATEWAY_CLOSED,
    })
  })

  it('bounds a stuck admitted effect by shutdownGraceMs and fences late completion', async () => {
    let admitStarted!: () => void
    const started = new Promise<void>((resolve) => { admitStarted = resolve })
    const fixture = await options({
      effectAdmission: {
        async admit() {
          admitStarted()
          return await new Promise<never>(() => {})
        },
      },
    })
    const created = await createAgentHost(fixture.value)
    void created.gateway.createSession({ scope, agentTypeId: 'alpha', requestId: 'stuck' }).catch(() => {})
    await started
    const before = Date.now()
    await created.host.close()
    expect(Date.now() - before).toBeLessThan(250)
    expect(fixture.dispose).toHaveBeenCalledOnce()
  })

  it('keeps gateway.close facade-local and idempotent', async () => {
    const fixture = await options()
    const created = await createAgentHost(fixture.value)
    await Promise.all([created.gateway.close(), created.gateway.close()])
    expect((await created.host.describe()).draining).toBe(false)
    await created.host.close()
    expect(fixture.dispose).toHaveBeenCalledOnce()
  })
})
