import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode, type AuthorizedAgentScope } from '../../../shared/index'
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

  it('starts managed workers once and joins them before closing', async () => {
    const sessionRoot = await root()
    const run = vi.fn(async ({ signal }: { signal: AbortSignal }) => {
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
    })
    const created = await createAgentHost({
      ...options(sessionRoot),
      agents: [
        { agentTypeId: 'alpha', definition: { instructions: 'alpha', label: 'Alpha' } },
        { agentTypeId: 'beta', definition: { instructions: 'beta', label: 'Beta' } },
      ],
      hostWorkers: [{ id: 'plugin/worker', run }],
    })
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never

    created.host.startWorkers({ logger })
    created.host.startWorkers({ logger })
    expect(run).toHaveBeenCalledOnce()
    await created.host.close()
    expect(run.mock.calls[0]![0].signal.aborted).toBe(true)
  })

  it('starts later workers after one throws and retains a sanitized stable error', async () => {
    const sessionRoot = await root()
    const later = vi.fn(async ({ signal }: { signal: AbortSignal }) => {
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
    })
    const baseOptions = options(sessionRoot)
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const created = await createAgentHost({
      ...baseOptions,
      runtimeModeAdapter: {
        ...baseOptions.runtimeModeAdapter,
        dispose: async () => { throw new Error('secondary cleanup detail') },
      },
      hostWorkers: [
        { id: 'plugin/failing', run: (() => { throw new Error('secret detail') }) as never },
        { id: 'plugin/later', run: later },
      ],
    })
    created.host.startWorkers({ logger: logger as never })
    expect(later).toHaveBeenCalledOnce()

    await expect(created.host.close()).rejects.toMatchObject({
      code: ErrorCode.enum.AGENT_HOST_WORKER_FAILED,
      workerId: 'plugin/failing',
      message: ErrorCode.enum.AGENT_HOST_WORKER_FAILED,
    })
    await expect(created.host.close()).rejects.toMatchObject({ message: ErrorCode.enum.AGENT_HOST_WORKER_FAILED })
    expect(logger.warn).toHaveBeenCalledWith(
      { agentHostLifecycle: { event: 'runtime-close-failed' } },
      expect.any(String),
    )
  })

  it('records a worker that settled before an immediate drain as an unexpected exit', async () => {
    const sessionRoot = await root()
    const created = await createAgentHost({
      ...options(sessionRoot),
      hostWorkers: [{ id: 'plugin/early', run: async () => {} }],
    })
    created.host.startWorkers({
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    })
    created.host.beginDrain()

    await expect(created.host.close()).rejects.toMatchObject({
      code: ErrorCode.enum.AGENT_HOST_WORKER_EXITED,
      workerId: 'plugin/early',
    })
  })

  it('never starts workers after drain begins', async () => {
    const sessionRoot = await root()
    const run = vi.fn(async () => {})
    const created = await createAgentHost({ ...options(sessionRoot), hostWorkers: [{ id: 'plugin/worker', run }] })
    created.host.beginDrain()
    created.host.startWorkers({
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    })
    expect(run).not.toHaveBeenCalled()
    await created.host.close()
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
