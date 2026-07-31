import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestRuntimeModeAdapter } from '@agent-test-host'
import { ErrorCode, type AuthorizedAgentScope } from '../../../shared/index'
import type { AgentCoreHarness } from '../../../shared/harness'
import type { PiAgentSessionAdapter } from '../../pi-chat/PiAgentSessionAdapter'
import {
  createAgentHost,
  resolveAgentHostCompatibilityComposition,
} from '../createAgentHost'
import { PiSessionStore } from '../../harness/pi-coding-agent/sessions'
import { seedNativeSession } from '../../harness/pi-coding-agent/__tests__/fixtures/sessionFiles'
import type { AgentHostAgentSpec, CreatedAgentHost } from '../types'

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
const scope = { workspaceScopeId: 'workspace-a', authSubjectId: 'subject-a' } as AuthorizedAgentScope
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
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  for (const key of ENV_KEYS) {
    const previous = previousEnv[key]
    if (previous === undefined) delete process.env[key]
    else process.env[key] = previous
  }
})

function agent(agentTypeId: string, preferred?: string): AgentHostAgentSpec {
  return {
    agentTypeId,
    definition: { instructions: agentTypeId, label: agentTypeId },
    ...(preferred === undefined ? {} : { model: { preferred } }),
  }
}

async function createHost(agents: readonly AgentHostAgentSpec[]) {
  const sessionRoot = await mkdtemp(join(tmpdir(), 'agent-model-policy-session-'))
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'agent-model-policy-workspace-'))
  roots.push(sessionRoot, workspaceRoot)
  const created = await createAgentHost({
    agents,
    fleetCompiler: { compile: async ({ agents: input }) => input },
    hostId: 'model-policy-host',
    scopeVerifier: { verify: async (claim) => claim },
    runtimeModeAdapter: createTestRuntimeModeAdapter('direct'),
    sessionRoot,
    resolveRuntimeScope: async ({ agentTypeId }) => ({
      identity: `runtime-${agentTypeId}`,
      environment: {
        placementIdentity: `direct-${agentTypeId}`,
        workspaceRoot,
        provisioningFingerprint: `provision-${agentTypeId}`,
      },
      sessionNamespace: agentTypeId,
    }),
  })
  return { created, workspaceRoot }
}

async function resolveModel(
  created: CreatedAgentHost,
  workspaceRoot: string,
  agentTypeId: string,
  sessionId: string,
  model?: { provider: string; id: string },
) {
  const composition = await resolveAgentHostCompatibilityComposition(created, agentTypeId, scope)
  const harness = composition.harness as AgentCoreHarness
  // Sessions are minted server-side before a prompt reaches the harness.
  await seedNativeSession((harness.sessions as PiSessionStore).getSessionDir(), workspaceRoot, sessionId, {})
  const adapter = await harness.getPiSessionAdapter(
    { sessionId, message: 'hello', model },
    { abortSignal: new AbortController().signal, workdir: workspaceRoot },
  ) as PiAgentSessionAdapter
  return adapter.currentModel?.()
}

describe('per-agent model policy', { timeout: 15_000 }, () => {
  it('uses an agent preferred model when the prompt specifies none', async () => {
    process.env.BORING_AGENT_DEFAULT_MODEL = 'custom:custom-model'
    const { created, workspaceRoot } = await createHost([agent('alpha', 'infomaniak:inf-model')])
    try {
      await expect(resolveModel(created, workspaceRoot, 'alpha', 'preferred')).resolves.toEqual({
        provider: 'infomaniak',
        id: 'inf-model',
      })
    } finally {
      await created.host.close()
    }
  })

  it('keeps a per-prompt model ahead of the agent preferred model', async () => {
    const { created, workspaceRoot } = await createHost([agent('alpha', 'infomaniak:inf-model')])
    try {
      await expect(resolveModel(created, workspaceRoot, 'alpha', 'prompt', {
        provider: 'custom',
        id: 'custom-model',
      })).resolves.toEqual({ provider: 'custom', id: 'custom-model' })
    } finally {
      await created.host.close()
    }
  })

  it('keeps the global env default for an agent without a declared model', async () => {
    process.env.BORING_AGENT_DEFAULT_MODEL = 'custom:custom-model'
    const { created, workspaceRoot } = await createHost([agent('alpha')])
    try {
      await expect(resolveModel(created, workspaceRoot, 'alpha', 'global')).resolves.toEqual({
        provider: 'custom',
        id: 'custom-model',
      })
    } finally {
      await created.host.close()
    }
  })

  it('isolates different preferred models across two agents in one fleet', async () => {
    const { created, workspaceRoot } = await createHost([
      agent('alpha', 'custom:custom-model'),
      agent('beta', 'infomaniak:inf-model'),
    ])
    try {
      await expect(Promise.all([
        resolveModel(created, workspaceRoot, 'alpha', 'alpha-session'),
        resolveModel(created, workspaceRoot, 'beta', 'beta-session'),
      ])).resolves.toEqual([
        { provider: 'custom', id: 'custom-model' },
        { provider: 'infomaniak', id: 'inf-model' },
      ])
    } finally {
      await created.host.close()
    }
  })

  it('fails loudly when an agent preferred model cannot be resolved', async () => {
    process.env.BORING_AGENT_DEFAULT_MODEL = 'custom:custom-model'
    const { created, workspaceRoot } = await createHost([agent('alpha', 'missing:missing-model')])
    try {
      await expect(resolveModel(created, workspaceRoot, 'alpha', 'missing')).rejects.toMatchObject({
        statusCode: 400,
        code: ErrorCode.enum.TOOL_INVALID_INPUT,
        details: { provider: 'missing', model: 'missing-model' },
      })
    } finally {
      await created.host.close()
    }
  })
})
