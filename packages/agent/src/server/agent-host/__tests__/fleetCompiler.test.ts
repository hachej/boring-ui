import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestRuntimeModeAdapter } from '@agent-test-host'
import { createAgentHost } from '../createAgentHost'
import {
  AgentFleetCompilationErrorCode,
  createValidatingAgentFleetCompiler,
} from '../fleetCompiler'
import type { AgentFleetCompiler, AgentHostAgentSpec } from '../types'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

async function base(agents: readonly AgentHostAgentSpec[], fleetCompiler: AgentFleetCompiler) {
  const sessionRoot = await mkdtemp(join(tmpdir(), 'agent-fleet-'))
  roots.push(sessionRoot)
  return {
    agents,
    fleetCompiler,
    hostId: 'host-a',
    scopeVerifier: { verify: async () => ({ workspaceScopeId: 'workspace', authSubjectId: 'subject' }) },
    runtimeModeAdapter: createTestRuntimeModeAdapter('direct'),
    sessionRoot,
    resolveAuthorizedEnvironmentScope: async () => ({
      placementIdentity: 'direct',
      workspaceRoot: sessionRoot,
      provisioningFingerprint: 'provision',
    }),
    resolveAuthorizedAgentRuntimeScope: async () => ({
      identity: 'runtime',
      physicalBindingIdentity: 'runtime',
      resourceInputDigest: 'runtime',
      sessionNamespace: 'sessions',
    }),
  }
}

const alpha = { agentTypeId: 'alpha', definition: { instructions: 'a', label: 'Alpha' } } as const
const beta = { agentTypeId: 'beta', definition: { instructions: 'b', label: 'Beta' } } as const

describe('fleet compilation validation', () => {
  it.each([
    { name: 'empty', agents: [] },
    { name: 'duplicate', agents: [alpha, alpha] },
    { name: 'unsafe', agents: [{ ...alpha, agentTypeId: '../alpha' }] },
  ])('rejects $name input before serving', async ({ agents }) => {
    const compiler = { compile: vi.fn(async ({ agents: input }) => input) }
    await expect(createAgentHost(await base(agents, compiler))).rejects.toThrow()
    if (nameIsPreCompiler(agents)) expect(compiler.compile).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'renamed', output: [{ ...alpha, agentTypeId: 'renamed' }, beta] },
    { name: 'injected', output: [alpha, beta, { ...beta, agentTypeId: 'gamma' }] },
    { name: 'duplicate', output: [alpha, alpha] },
  ])('rejects $name compiler output', async ({ output }) => {
    await expect(createAgentHost(await base([alpha, beta], {
      compile: async () => output,
    }))).rejects.toThrow()
  })

  it('recursively freezes validated compiler output without retaining caller arrays', async () => {
    const compiled = [{ ...alpha, resolvedPolicy: { nested: { allowed: true } } }]
    const host = await createAgentHost(await base([alpha], { compile: async () => compiled }))
    expect(Object.isFrozen(host)).toBe(true)
    expect(Object.isFrozen((await host.host.describe()).agents)).toBe(false)
    expect(compiled).not.toBe((host as unknown as { compiled?: unknown }).compiled)
    await host.host.close()
  })

  it.each([
    {
      name: 'unknown plugin ID',
      agent: {
        ...alpha,
        plugins: [{ name: 'missing-plugin' }],
      },
      code: AgentFleetCompilationErrorCode.AGENT_FLEET_PLUGIN_UNKNOWN,
      details: { pluginId: 'missing-plugin' },
    },
    {
      name: 'unknown config binding',
      agent: {
        ...alpha,
        plugins: [{ name: 'known-plugin', config: { unexpected: true } }],
      },
      code: AgentFleetCompilationErrorCode.AGENT_FLEET_CONFIG_BINDING_UNKNOWN,
      details: { pluginId: 'known-plugin', configKey: 'unexpected' },
    },
  ])('rejects $name before Host identity or runtime construction', async ({ agent, code, details }) => {
    const compiler = createValidatingAgentFleetCompiler({
      plugins: [{ id: 'known-plugin', configKeys: ['allowed'] }],
    })
    const hostOptions = await base([agent], compiler)
    const createRuntime = vi.fn(hostOptions.runtimeModeAdapter.create.bind(hostOptions.runtimeModeAdapter))
    const resolveAuthorizedAgentRuntimeScope = vi.fn(hostOptions.resolveAuthorizedAgentRuntimeScope)
    const harnessFactory = vi.fn(async () => {
      throw new Error('harness must not be constructed')
    })
    const result = createAgentHost({
      ...hostOptions,
      hostId: undefined,
      runtimeModeAdapter: { ...hostOptions.runtimeModeAdapter, create: createRuntime },
      resolveAuthorizedAgentRuntimeScope,
      harnessFactory,
    })

    await expect(result).rejects.toMatchObject({ code, details })
    expect(createRuntime).not.toHaveBeenCalled()
    expect(resolveAuthorizedAgentRuntimeScope).not.toHaveBeenCalled()
    expect(harnessFactory).not.toHaveBeenCalled()
    await expect(access(join(hostOptions.sessionRoot, '.agent-host-id'))).rejects.toThrow()
  })

  it('accepts only config keys declared by the resolved plugin contract', async () => {
    const compiler = createValidatingAgentFleetCompiler({
      plugins: [{ id: 'known-plugin', configKeys: ['allowed'] }],
    })
    const host = await createAgentHost(await base([{
      ...alpha,
      plugins: [{ name: 'known-plugin', config: { allowed: true } }],
    }], compiler))
    await host.host.close()
  })
})

function nameIsPreCompiler(agents: readonly AgentHostAgentSpec[]): boolean {
  return agents.length === 0 || new Set(agents.map((agent) => agent.agentTypeId)).size !== agents.length
    || agents.some((agent) => agent.agentTypeId.includes('/'))
}
