import { AsyncLocalStorage } from 'node:async_hooks'

import {
  AuthStorage,
  createAgentSession,
  createExtensionRuntime,
  ModelRegistry,
  SessionManager,
  type ToolDefinition,
} from '@mariozechner/pi-coding-agent'
import { describe, expect, it, vi } from 'vitest'

import type { WorkspaceSandboxPairV1 } from '@hachej/boring-sandbox/shared'
import { buildFilesystemAgentTools, buildHarnessAgentTools } from '@hachej/boring-bash/agent'
import type { RuntimeBundle } from '../../../runtime/mode'
import type { RunContext } from '../../../../shared/harness'
import { ErrorCode } from '../../../../shared/error-codes'
import type { Sandbox, Workspace } from '../../../../shared/index'
import type { AgentHostRuntime } from '../../../agent-host/createAgentHost'
import type { AgentRequestKey } from '../../../agent-host/types'
import { attachAcceptedWorkProvenance } from '../../../agent-host/acceptedWork'
import { SqliteAgentRequestLedger } from '../../../agent-host/sqliteRequestLedger'
import { SandboxLeaseService } from '../../../sandbox/leases/sandboxLease'
import { fakeDisposableProvider } from '../../../sandbox/leases/__tests__/fakeDisposableProvider'
import { createScriptedPiHarness } from '../../../testing/scriptedPiHarness'
import { buildAgentComposition } from '../../../agent-host/buildAgentComposition'
import { adaptToolsForPi } from '../tool-adapter'

const encoder = new TextEncoder()
function usage() { return { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }
function message(id: string, content: unknown[], stopReason: 'toolUse' | 'stop') { return { id, role: 'assistant', content, api: 'sandbox-native', provider: 'sandbox-native', model: 'loop', usage: usage(), stopReason, timestamp: Date.now() } }
function stream(events: unknown[], finalMessage: unknown) { return { async *[Symbol.asyncIterator]() { for (const event of events) yield event }, async result() { return finalMessage } } }
function resources() { const extensions = { extensions: [], errors: [], runtime: createExtensionRuntime() }; return { getExtensions: () => extensions, getSkills: () => ({ skills: [], diagnostics: [] }), getPrompts: () => ({ prompts: [], diagnostics: [] }), getThemes: () => ({ themes: [], diagnostics: [] }), getAgentsFiles: () => ({ agentsFiles: [] }), getSystemPrompt: () => undefined, getAppendSystemPrompt: () => [], extendResources: () => {}, reload: async () => {} } }

function runtime(admitted: AgentRequestKey[]): AgentHostRuntime {
  const ledger = new SqliteAgentRequestLedger(':memory:')
  return {
    ledger,
    effectAdmission: { async admit({ key }: { key: AgentRequestKey }) { admitted.push(key); return { type: 'accepted' as const, admissionReceipt: `admit:${key.requestId}` } } },
    assertOpen() {},
    startPreparedEffect<T>(_key: AgentRequestKey, effect: () => Promise<T>) { return effect() },
  } as unknown as AgentHostRuntime
}

function pair() {
  const exec = vi.fn(async (command: string) => ({
    stdout: encoder.encode(`remote:${command}`), stderr: new Uint8Array(), exitCode: 0, durationMs: 1, truncated: false,
  }))
  const workspace = {
    root: '/workspace', runtimeContext: { runtimeCwd: '/workspace' },
    async readFile() { return '' }, async writeFile() {}, async readdir() { return [] },
    async stat() { return { size: 0, mtimeMs: 1, kind: 'dir' as const } }, async mkdir() {}, async unlink() {}, async rename() {},
  } as Workspace
  const sandbox = { id: 'leased', placement: 'remote', provider: 'fake', capabilities: ['exec'], runtimeContext: { runtimeCwd: '/workspace' }, exec } as Sandbox
  const dispose = vi.fn(async () => {})
  return { value: { workspace, sandbox, checkHealth: async () => ({ state: 'ok' as const }), dispose } as WorkspaceSandboxPairV1, exec, dispose }
}

describe('native sandbox tools through real Pi', () => {
  it('keeps the no-capability default catalog byte-equivalent to canonical boring-bash tools', async () => {
    const host = runtime([])
    const remote = pair()
    const primaryBundle = {
      workspace: remote.value.workspace,
      sandbox: { ...remote.value.sandbox, id: 'primary', exec: vi.fn() },
      fileSearch: { async search() { return [] } },
      bash: { kind: 'remote' }, filesystem: { kind: 'remote-workspace' },
    } satisfies RuntimeBundle
    const composition = await buildAgentComposition({
      agent: {
        agentTypeId: 'worker',
        definition: { instructions: 'worker', label: 'Worker', digest: `sha256:${'a'.repeat(64)}` },
      },
      workspaceScopeId: 'workspace-a',
      runtimeScope: {
        identity: 'default-catalog-runtime',
        environment: {
          placementIdentity: 'default-catalog-environment',
          workspaceRoot: '/workspace',
          provisioningFingerprint: 'default-catalog-provisioning',
        },
        sessionNamespace: 'default-catalog',
      },
      runtimeBundle: primaryBundle,
      hostRuntime: host,
      options: {
        runtimeModeAdapter: {
          id: 'vercel-sandbox',
          async create() { return primaryBundle },
          getRuntimeLayoutRoot() { return '/workspace' },
        },
        harnessFactory: createScriptedPiHarness,
      },
    })
    try {
      const surface = (tools: readonly { name: string; description: string; parameters: unknown }[]) =>
        tools.map(({ name, description, parameters }) => ({ name, description, parameters }))
      expect(surface(composition.tools)).toEqual(surface([
        ...buildHarnessAgentTools(primaryBundle),
        ...buildFilesystemAgentTools(primaryBundle),
      ]))
    } finally {
      await composition.dispose()
      await host.ledger.close?.()
    }
  })

  it('registers the native catalog through the default createPiCodingAgentHarness composition', async () => {
    const host = runtime([])
    const remote = pair()
    const providerCreate = vi.fn(async () => remote.value)
    const leases = new SandboxLeaseService({
      workspaceRoot: '/host/leases', provider: fakeDisposableProvider({ create: providerCreate }),
      serviceDigest: 'default-pi-composition', ttlMs: 60_000, reapIntervalMs: 60_000, drainTimeoutMs: 100,
      maxActiveLeasesPerOwner: 1, maxActiveLeasesTotal: 1,
      createHandle: () => 'lease-handle-0001',
    })
    const primaryBundle = {
      workspace: remote.value.workspace,
      sandbox: { ...remote.value.sandbox, id: 'primary', exec: vi.fn() },
      fileSearch: { async search() { return [] } },
      bash: { kind: 'remote' }, filesystem: { kind: 'remote-workspace' },
    } satisfies RuntimeBundle
    const composition = await buildAgentComposition({
      agent: {
        agentTypeId: 'worker',
        definition: { instructions: 'worker', label: 'Worker', digest: `sha256:${'a'.repeat(64)}` },
      },
      workspaceScopeId: 'workspace-a',
      runtimeScope: {
        identity: 'default-pi-runtime',
        environment: {
          placementIdentity: 'default-pi-environment', workspaceRoot: '/workspace',
          provisioningFingerprint: 'default-pi-provisioning',
        },
        sessionNamespace: 'default-pi',
        sandboxTools: { digest: 'default-pi-composition', leases },
        includeFilesystemTools: false,
      },
      runtimeBundle: primaryBundle,
      hostRuntime: host,
      options: {
        runtimeModeAdapter: {
          id: 'vercel-sandbox', async create() { return primaryBundle },
          getRuntimeLayoutRoot() { return '/workspace' },
        },
      },
    })
    try {
      expect(composition.harness.id).toBe('pi-coding-agent')
      expect(composition.tools.map((tool) => tool.name)).toEqual(['bash', 'sandbox'])
      expect(JSON.stringify(composition.tools.find((tool) => tool.name === 'bash')?.parameters))
        .toContain('sandbox')
      expect(providerCreate).not.toHaveBeenCalled()
    } finally {
      await composition.dispose()
      await leases.dispose()
      await host.ledger.close?.()
    }
  })

  it('rejects every reserved name at the composition seam before harness or provider acquisition', async () => {
    for (const reserved of ['sandbox', 'bash', 'read', 'write', 'edit', 'find', 'grep', 'ls', 'upload_file']) {
      const host = runtime([])
      const remote = pair()
      const providerCreate = vi.fn(async () => remote.value)
      const leases = new SandboxLeaseService({
        workspaceRoot: '/host/leases', provider: fakeDisposableProvider({ create: providerCreate }),
        serviceDigest: `collision-${reserved}`, ttlMs: 60_000, reapIntervalMs: 60_000, drainTimeoutMs: 100,
        maxActiveLeasesPerOwner: 1, maxActiveLeasesTotal: 1,
        createHandle: () => 'lease-handle-0001',
      })
      const primaryBundle = {
        workspace: remote.value.workspace,
        sandbox: { ...remote.value.sandbox, id: 'primary', exec: vi.fn() },
        fileSearch: { async search() { return [] } },
        bash: { kind: 'remote' }, filesystem: { kind: 'remote-workspace' },
      } satisfies RuntimeBundle
      const harnessFactory = vi.fn(createScriptedPiHarness)
      try {
        await expect(buildAgentComposition({
          agent: {
            agentTypeId: 'worker',
            definition: { instructions: 'worker', label: 'Worker', digest: `sha256:${'a'.repeat(64)}` },
          },
          workspaceScopeId: 'workspace-a',
          runtimeScope: {
            identity: `collision-runtime-${reserved}`,
            environment: {
              placementIdentity: 'collision-environment', workspaceRoot: '/workspace',
              provisioningFingerprint: 'collision-provisioning',
            },
            sessionNamespace: 'collision',
            sandboxTools: { digest: `collision-${reserved}`, leases },
            includeFilesystemTools: true,
            includeUploadTools: true,
            extraTools: [{
              name: reserved, description: 'collision', parameters: {},
              async execute() { return { content: [{ type: 'text' as const, text: 'collision' }] } },
            }],
          },
          runtimeBundle: primaryBundle,
          hostRuntime: host,
          options: {
            runtimeModeAdapter: {
              id: 'vercel-sandbox', async create() { return primaryBundle },
              getRuntimeLayoutRoot() { return '/workspace' },
            },
            harnessFactory,
          },
        })).rejects.toMatchObject({ code: ErrorCode.enum.AUTHORED_AGENT_TOOL_COLLISION })
        expect(harnessFactory).not.toHaveBeenCalled()
        expect(providerCreate).not.toHaveBeenCalled()
      } finally {
        await leases.dispose()
        await host.ledger.close?.()
      }
    }
  })

  it('creates, targets ordinary bash, and releases through the real adapter', async () => {
    const admitted: AgentRequestKey[] = []
    const host = runtime(admitted)
    const remote = pair()
    const providerCreate = vi.fn(async () => remote.value)
    const leases = new SandboxLeaseService({
      workspaceRoot: '/host/leases', provider: fakeDisposableProvider({ create: providerCreate }),
      serviceDigest: 'native-test', ttlMs: 60_000, reapIntervalMs: 60_000, drainTimeoutMs: 100,
      maxActiveLeasesPerOwner: 2, maxActiveLeasesTotal: 2,
      createHandle: () => 'lease-handle-0001',
    })
    const primaryBundle = {
      workspace: remote.value.workspace,
      sandbox: { ...remote.value.sandbox, id: 'primary', exec: vi.fn() },
      fileSearch: { async search() { return [] } },
      bash: { kind: 'remote' }, filesystem: { kind: 'remote-workspace' },
    } as RuntimeBundle
    const composition = await buildAgentComposition({
      agent: {
        agentTypeId: 'worker',
        definition: { instructions: 'worker', label: 'Worker', digest: `sha256:${'a'.repeat(64)}` },
      },
      workspaceScopeId: 'workspace-a',
      runtimeScope: {
        identity: 'native-composed-runtime',
        environment: {
          placementIdentity: 'native-composed-environment',
          workspaceRoot: '/workspace',
          provisioningFingerprint: 'native-composed-provisioning',
        },
        sessionNamespace: 'native-composed',
        sandboxTools: { digest: 'native-test', leases },
        includeFilesystemTools: false,
      },
      runtimeBundle: primaryBundle,
      hostRuntime: host,
      options: {
        runtimeModeAdapter: {
          id: 'vercel-sandbox',
          async create() { return primaryBundle },
          getRuntimeLayoutRoot() { return '/workspace' },
        },
        harnessFactory: createScriptedPiHarness,
      },
    })
    const runContextStorage = new AsyncLocalStorage<RunContext>()
    const tools = adaptToolsForPi([...composition.tools], 'session-a', undefined, () => runContextStorage.getStore())

    let turn = 0
    const authStorage = AuthStorage.inMemory()
    const registry = ModelRegistry.inMemory(authStorage)
    registry.registerProvider('sandbox-native', {
      name: 'Sandbox Native', api: 'sandbox-native', baseUrl: 'https://example.invalid', apiKey: 'test',
      models: [{ id: 'loop', name: 'Loop', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1_000_000, maxTokens: 128 }],
      streamSimple() {
        turn += 1
        if (turn <= 3) {
          const toolCall = turn === 1
            ? { type: 'toolCall', id: 'create-call', name: 'sandbox', arguments: { op: 'create' } }
            : turn === 2
              ? { type: 'toolCall', id: 'bash-call', name: 'bash', arguments: { command: 'git rev-parse HEAD', sandbox: 'lease-handle-0001' } }
              : { type: 'toolCall', id: 'release-call', name: 'sandbox', arguments: { op: 'release', sandbox: 'lease-handle-0001' } }
          const final = message(`tool-${turn}`, [toolCall], 'toolUse')
          return stream([{ type: 'start', partial: message(`tool-${turn}`, [], 'toolUse') }, { type: 'toolcall_end', contentIndex: 0, toolCall, partial: final }, { type: 'done', reason: 'toolUse', message: final }], final) as any
        }
        const final = message('done', [{ type: 'text', text: 'done' }], 'stop')
        return stream([{ type: 'start', partial: message('done', [], 'stop') }, { type: 'text_delta', contentIndex: 0, delta: 'done', partial: final }, { type: 'text_end', contentIndex: 0, content: 'done', partial: final }, { type: 'done', reason: 'stop', message: final }], final) as any
      },
    })
    const { session } = await createAgentSession({
      cwd: process.cwd(), authStorage, modelRegistry: registry, model: registry.find('sandbox-native', 'loop')!,
      noTools: 'builtin', customTools: tools as ToolDefinition[], resourceLoader: resources() as any,
      sessionManager: SessionManager.inMemory(process.cwd()), thinkingLevel: 'off',
    })
    const parentKey: AgentRequestKey = {
      workspaceScopeId: 'workspace-a', authSubjectId: 'subject-a', operation: 'session.prompt',
      target: { kind: 'session', ref: { agentTypeId: 'worker', sessionId: 'session-a' } }, requestId: 'parent-a',
    }
    const ctx = attachAcceptedWorkProvenance({
      abortSignal: new AbortController().signal, workdir: '/workspace', workspaceId: 'workspace-a', requestId: 'parent-a',
    }, { parentKey, claim: { workspaceScopeId: 'workspace-a', authSubjectId: 'subject-a' } })

    try {
      await runContextStorage.run(ctx, async () => await session.prompt('verify remotely'))
      expect(providerCreate).toHaveBeenCalledOnce()
      expect(remote.exec).toHaveBeenCalledWith('git rev-parse HEAD', expect.objectContaining({ cwd: '/workspace' }))
      expect(remote.dispose).toHaveBeenCalledOnce()
      expect(admitted).toHaveLength(2)
      expect(admitted.map((key) => key.operation)).toEqual(['session.tool.external-effect', 'session.tool.external-effect'])
    } finally {
      session.dispose()
      await composition.dispose()
      await leases.dispose().catch(() => {})
    }
  })
})
