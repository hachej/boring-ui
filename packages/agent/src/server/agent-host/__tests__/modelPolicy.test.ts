import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestRuntimeModeAdapter } from '@agent-test-host'
import { ErrorCode } from '../../../shared/index'
import type { AgentCoreHarness } from '../../../shared/harness'
import type { AuthorizedAgentScope } from '../../../shared/index'
import type { PiAgentSessionAdapter } from '../../pi-chat/PiAgentSessionAdapter'
import { createAgentHost } from '../createAgentHost'
import type { EmbeddedAgentGateway } from '../embeddedGateway'
import type { CompiledAgentHostAgentSpec } from '../types'

const ENV_KEYS = [
  'BORING_AGENT_DEFAULT_MODEL',
  'BORING_AGENT_CUSTOM_MODEL_PROVIDER',
  'BORING_AGENT_CUSTOM_MODEL_ID',
  'BORING_AGENT_CUSTOM_MODEL_BASE_URL',
  'BORING_AGENT_CUSTOM_MODEL_API_KEY',
  'BORING_AGENT_INFOMANIAK_BASE_URL',
  'BORING_AGENT_INFOMANIAK_MODEL',
  'BORING_AGENT_INFOMANIAK_API_KEY',
] as const
const roots: string[] = []
const disposals: Array<() => Promise<void>> = []
let previousEnv: Partial<Record<(typeof ENV_KEYS)[number], string>>

beforeEach(() => {
  previousEnv = {}
  for (const key of ENV_KEYS) {
    previousEnv[key] = process.env[key]
    delete process.env[key]
  }
  process.env.BORING_AGENT_CUSTOM_MODEL_PROVIDER = 'custom'
  process.env.BORING_AGENT_CUSTOM_MODEL_ID = 'custom-model'
  process.env.BORING_AGENT_CUSTOM_MODEL_BASE_URL = 'https://custom.example.test/v1'
  process.env.BORING_AGENT_CUSTOM_MODEL_API_KEY = 'custom-test-key'
  process.env.BORING_AGENT_INFOMANIAK_BASE_URL = 'https://infomaniak.example.test/v1'
  process.env.BORING_AGENT_INFOMANIAK_MODEL = 'inf-model'
  process.env.BORING_AGENT_INFOMANIAK_API_KEY = 'infomaniak-test-key'
})

afterEach(async () => {
  await Promise.all(disposals.splice(0).map((dispose) => dispose()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  for (const key of ENV_KEYS) {
    const previous = previousEnv[key]
    if (previous === undefined) delete process.env[key]
    else process.env[key] = previous
  }
})

function agent(agentTypeId: string, preferred?: string): CompiledAgentHostAgentSpec {
  return {
    agentTypeId,
    definition: { instructions: agentTypeId, label: agentTypeId },
    ...(preferred === undefined ? {} : { model: { preferred } }),
  }
}

const scope = Object.freeze({
  workspaceScopeId: 'workspace-a',
  authSubjectId: 'subject-a',
}) as AuthorizedAgentScope

async function buildHost(agentSpecs: readonly CompiledAgentHostAgentSpec[]) {
  const sessionRoot = await mkdtemp(join(tmpdir(), 'agent-model-policy-session-'))
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'agent-model-policy-workspace-'))
  roots.push(sessionRoot, workspaceRoot)
  const runtimeModeAdapter = createTestRuntimeModeAdapter('direct')
  const created = await createAgentHost({
    agents: agentSpecs,
    fleetCompiler: { async compile({ agents }) { return agents as readonly CompiledAgentHostAgentSpec[] } },
    hostId: `model-policy-${roots.length}`,
    scopeVerifier: {
      async verify() { return { workspaceScopeId: 'workspace-a', authSubjectId: 'subject-a' } },
    },
    runtimeModeAdapter,
    sessionRoot,
    inMemoryRequestLedgerMode: 'test',
    async resolveAuthorizedEnvironmentScope() {
      return {
        placementIdentity: 'direct',
        workspaceRoot,
        provisioningFingerprint: 'model-policy-v1',
      }
    },
    async resolveAuthorizedAgentRuntimeScope({ agentTypeId }) {
      return {
        identity: `runtime-${agentTypeId}`,
        physicalBindingIdentity: `binding-${agentTypeId}`,
        resourceInputDigest: `resources-${agentTypeId}`,
        sessionNamespace: agentTypeId,
      }
    },
  })
  disposals.push(async () => {
    await created.host.close()
  })
  return { created, workspaceRoot }
}

async function resolveModel(
  host: Awaited<ReturnType<typeof buildHost>>,
  agentTypeId: string,
  sessionId: string,
  model?: { provider: string; id: string },
) {
  const ref = await host.created.gateway.createSession({
    scope,
    agentTypeId,
    requestId: `create-${sessionId}`,
  })
  const resolved = await (host.created.gateway as EmbeddedAgentGateway).resolveHostSessionBinding(scope, ref)
  const harness = resolved.binding.composition.harness as AgentCoreHarness
  const sessionCtx = {
    workspaceId: scope.workspaceScopeId,
    runtimeScopeIdentity: resolved.binding.scope.identity,
  }
  const adapter = await harness.getPiSessionAdapter(
    { sessionId: ref.sessionId, message: 'hello', model, ctx: sessionCtx },
    { abortSignal: new AbortController().signal, workdir: host.workspaceRoot, sessionCtx },
  ) as PiAgentSessionAdapter
  return adapter.currentModel?.()
}

describe.sequential('direct Host composition per-Agent model policy', { timeout: 15_000 }, () => {
  it('uses an Agent preferred model when the prompt specifies none', async () => {
    process.env.BORING_AGENT_DEFAULT_MODEL = 'custom:custom-model'
    const host = await buildHost([agent('alpha', 'infomaniak:inf-model'), agent('beta')])
    await expect(resolveModel(host, 'alpha', 'preferred')).resolves.toEqual({
      provider: 'infomaniak', id: 'inf-model',
    })
  })

  it('keeps a per-prompt model ahead of the Agent preferred model', async () => {
    const host = await buildHost([agent('alpha', 'infomaniak:inf-model'), agent('beta')])
    await expect(resolveModel(host, 'alpha', 'prompt', {
      provider: 'custom', id: 'custom-model',
    })).resolves.toEqual({ provider: 'custom', id: 'custom-model' })
  })

  it('keeps the global default for an Agent without a declared model', async () => {
    process.env.BORING_AGENT_DEFAULT_MODEL = 'custom:custom-model'
    const host = await buildHost([agent('alpha'), agent('beta', 'infomaniak:inf-model')])
    await expect(resolveModel(host, 'alpha', 'global')).resolves.toEqual({
      provider: 'custom', id: 'custom-model',
    })
  })

  it('isolates preferred models across two Agents in one process', async () => {
    const host = await buildHost([
      agent('alpha', 'custom:custom-model'),
      agent('beta', 'infomaniak:inf-model'),
    ])
    const models = await Promise.all([
      resolveModel(host, 'alpha', 'alpha-session'),
      resolveModel(host, 'beta', 'beta-session'),
    ])
    expect(models).toEqual([
      { provider: 'custom', id: 'custom-model' },
      { provider: 'infomaniak', id: 'inf-model' },
    ])
  })

  it('fails strictly when an Agent preferred model cannot be resolved', async () => {
    process.env.BORING_AGENT_DEFAULT_MODEL = 'custom:custom-model'
    const host = await buildHost([agent('alpha', 'missing:missing-model'), agent('beta')])
    await expect(resolveModel(host, 'alpha', 'missing')).rejects.toMatchObject({
      statusCode: 400,
      code: ErrorCode.enum.TOOL_INVALID_INPUT,
      details: { provider: 'missing', model: 'missing-model' },
    })
  })
})
