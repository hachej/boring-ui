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

import type { SandboxProviderV1, WorkspaceSandboxPairV1 } from '@hachej/boring-sandbox/shared'
import type { RuntimeBundle } from '@hachej/boring-bash/agent'
import type { RunContext } from '../../../../shared/harness'
import type { Sandbox, Workspace } from '../../../../shared/index'
import type { AgentHostRuntime } from '../../../agent-host/createAgentHost'
import type { AgentRequestKey } from '../../../agent-host/types'
import { attachAcceptedWorkProvenance } from '../../../agent-host/acceptedWork'
import { SqliteAgentRequestLedger } from '../../../agent-host/sqliteRequestLedger'
import { SandboxLeaseService } from '../../../sandbox/leases/sandboxLease'
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
  it('creates, targets ordinary bash, and releases through the real adapter', async () => {
    const admitted: AgentRequestKey[] = []
    const host = runtime(admitted)
    const remote = pair()
    const providerCreate = vi.fn(async () => remote.value)
    const leases = new SandboxLeaseService({
      workspaceRoot: '/host/leases', provider: { create: providerCreate } as unknown as SandboxProviderV1,
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
        sandboxTools: { digest: 'native-test', leases, allowInMemoryLedgerForTests: true },
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
    } as any)
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
