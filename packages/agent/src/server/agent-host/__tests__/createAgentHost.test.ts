import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthorizedAgentScope } from '../../../shared/index'
import type { AgentTool } from '../../../shared/tool'
import type { AgentHarnessFactory } from '../../../shared/harness'
import { createTestRuntimeModeAdapter } from '@agent-test-host'
import { createScriptedPiHarness } from '../../testing/scriptedPiHarness'
import {
  createAgentHost,
  resolveAgentHostCompatibilityComposition,
} from '../createAgentHost'

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
  it('gives a configured non-default agent the legacy default compatibility tool groups', async () => {
    const sessionRoot = await root()
    const compatibilityTool = (name: string): AgentTool => ({
      name,
      description: `${name} compatibility probe`,
      parameters: { type: 'object', properties: {} },
      async execute() {
        return { content: [{ type: 'text', text: name }] }
      },
    })
    const additionalStandardTool = compatibilityTool('compatibility_standard')
    const extraTool = compatibilityTool('compatibility_extra')
    const pluginTool = compatibilityTool('compatibility_plugin')
    const parityOptions = {
      ...options(sessionRoot),
      agents: [
        { agentTypeId: 'default', legacyDefault: true },
        { agentTypeId: 'researcher', definition: { instructions: 'researcher', label: 'Researcher' } },
      ] as const,
      harnessFactory: (async (input) => createScriptedPiHarness(input)) satisfies AgentHarnessFactory,
      resolveRuntimeScope: vi.fn(async () => ({
        identity: 'runtime-parity',
        environment: {
          placementIdentity: 'direct-parity',
          workspaceRoot: sessionRoot,
          provisioningFingerprint: 'provision-parity',
        },
        sessionNamespace: 'parity',
        extraTools: [extraTool],
        compatibility: {
          additionalStandardTools: [additionalStandardTool],
          pluginTools: [{ pluginName: 'parity-plugin', tools: [pluginTool] }],
        },
      })),
    }
    const host = await createAgentHost(parityOptions)

    try {
      const legacy = await resolveAgentHostCompatibilityComposition(host, 'default', scope)
      const configured = await resolveAgentHostCompatibilityComposition(host, 'researcher', scope)
      const legacyToolNames = legacy.tools.map((tool) => tool.name)
      const configuredToolNames = configured.tools.map((tool) => tool.name)

      expect(configuredToolNames).toEqual(legacyToolNames)
      expect(configuredToolNames).toEqual(expect.arrayContaining([
        'bash',
        'read',
        'ls',
        'compatibility_standard',
        'compatibility_extra',
        'compatibility_plugin',
      ]))
    } finally {
      await host.host.close()
    }
  })

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

  it('keeps configured prompt precedence byte-identical across Host restart', async () => {
    const sessionRoot = await root()
    const renderedPrompts: string[] = []
    const harnessFactory: AgentHarnessFactory = async (input) => {
      const dynamic = await input.systemPromptDynamic?.()
      const renderedPrompt = ['HARNESS_BASE', input.systemPromptAppend, dynamic]
        .filter(Boolean)
        .join('\n\n')
      renderedPrompts.push(renderedPrompt)
      return {
        ...createScriptedPiHarness(input),
        getSystemPrompt: () => renderedPrompt,
      }
    }
    const restartOptions = () => ({
      ...options(sessionRoot),
      harnessFactory,
      resolveRuntimeScope: vi.fn(async () => ({
        identity: 'runtime-prompt',
        environment: {
          placementIdentity: 'direct-prompt',
          workspaceRoot: sessionRoot,
          provisioningFingerprint: 'provision-prompt',
        },
        sessionNamespace: 'alpha-prompt',
        // The Workspace resolver's observed deterministic fragment order is
        // alphabetical by plugin ID: alpha before zeta.
        systemPromptAppend: 'PLUGIN_ALPHA\n\nPLUGIN_ZETA',
        loadSystemPromptAppend: async () => 'HOST_DYNAMIC',
      })),
    })

    const first = await createAgentHost(restartOptions())
    await resolveAgentHostCompatibilityComposition(first, 'alpha', scope)
    await first.host.close()

    const second = await createAgentHost(restartOptions())
    await resolveAgentHostCompatibilityComposition(second, 'alpha', scope)
    await second.host.close()

    const golden = [
      'HARNESS_BASE',
      'alpha',
      'PLUGIN_ALPHA',
      'PLUGIN_ZETA',
      'HOST_DYNAMIC',
    ].join('\n\n')
    expect(renderedPrompts).toEqual([golden, golden])
    expect(Buffer.from(renderedPrompts[0]!).equals(Buffer.from(renderedPrompts[1]!))).toBe(true)
  })
})
