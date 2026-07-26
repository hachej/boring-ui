import { expect, test, vi } from 'vitest'

import { buildHarnessAgentTools } from '@hachej/boring-bash/agent'
import type { ExtractedSandboxProviderIdV1, SandboxProviderV1 } from '@hachej/boring-sandbox/shared'
import type { Sandbox, Workspace } from '../../../../shared'
import { ErrorCode } from '../../../../shared/error-codes'
import { READONLY_WORKSPACE_SHELL_UNAVAILABLE_REASON, type RuntimeBundle } from '../../mode'
import { createProviderRuntimeModeAdapter } from '../providerAdapter'
import {
  createSandboxRuntimeModeAdapter,
  sandboxRuntimeHostOperations,
} from '../../sandboxRuntimeHost'
import { testRuntimeHostOperations } from '@agent-test-host'

function createPairProvider(options: {
  checkHealth?: () => Promise<{ state: 'ok' } | { state: 'recreate'; message?: string }>
  dispose: () => Promise<void>
  invalidate?: (ctx: { workspaceId: string }) => Promise<void>
  echoReadonlyPolicy?: boolean
  providerId?: ExtractedSandboxProviderIdV1
  readonlyWorkspacePathEnforcement?: 'operations' | 'operations-and-shell'
}): SandboxProviderV1 {
  const runtimeContext = { runtimeCwd: '/workspace' }
  const workspace: Workspace = {
    root: '/workspace',
    runtimeContext,
    fsCapability: 'strong',
    async readFile() { return '' },
    async writeFile() {},
    async unlink() {},
    async readdir() { return [] },
    async stat() { return { kind: 'file', size: 0, mtimeMs: 0 } },
    async mkdir() {},
    async rename() {},
  }
  const sandbox: Sandbox = {
    id: 'provider-adapter-test',
    placement: 'server',
    provider: 'direct',
    capabilities: ['exec'],
    runtimeContext,
    async exec() {
      return {
        stdout: new Uint8Array(),
        stderr: new Uint8Array(),
        exitCode: 0,
        durationMs: 0,
        truncated: false,
      }
    },
  }

  return {
    contractVersion: 'boring-sandbox.provider.v1',
    providerId: options.providerId ?? 'direct',
    ...(options.readonlyWorkspacePathEnforcement
      ? { readonlyWorkspacePathEnforcement: options.readonlyWorkspacePathEnforcement }
      : {}),
    capabilities: {
      exec: true,
      fs: 'readwrite',
      realBash: 'unknown',
      realBinaries: 'unknown',
      networkIsolation: 'none',
      watch: true,
      search: true,
      sourceOfTruth: 'storage-primary',
      provisioningSupport: true,
      providerContractVersion: 'boring-sandbox.provider.v1',
      runtimeImage: false,
      hardening: 'none',
      filesystemPersistence: 'durable',
    },
    resolveRuntimeRoot: () => '/workspace',
    ...(options.invalidate ? { invalidate: options.invalidate } : {}),
    async create(context) {
      return {
        workspace,
        sandbox,
        checkHealth: options.checkHealth,
        ...(options.echoReadonlyPolicy ? { readonlyWorkspacePolicy: context.readonlyWorkspacePolicy } : {}),
        dispose: options.dispose,
      }
    },
  }
}

test('health and disposal stay bound to the pair after RuntimeBundle decoration', async () => {
  const dispose = vi.fn(async () => {})
  const checkHealth = vi.fn(async () => ({ state: 'recreate' as const, message: 'stopped' }))
  const adapter = createProviderRuntimeModeAdapter({
    id: 'direct',
    provider: createPairProvider({ checkHealth, dispose }),
    runtimeHost: testRuntimeHostOperations,
    workspaceFsCapability: 'strong',
    bash: { kind: 'host' },
    filesystem: { kind: 'host' },
    healthCheckIntervalMs: 1,
  })
  const bundle = await adapter.create({ workspaceRoot: '/tmp/workspace', sessionId: 'session' })
  const decoratedBundle: RuntimeBundle = { ...bundle, getRuntimeEnv: async () => ({ TEST: '1' }) }

  await expect(adapter.cachedBindingHealthCheck?.check({
    runtimeBundle: decoratedBundle,
    workspaceId: 'workspace',
  })).resolves.toEqual({ state: 'recreate', message: 'stopped' })
  expect(checkHealth).toHaveBeenCalledOnce()

  await decoratedBundle.disposeRuntime?.()
  expect(dispose).toHaveBeenCalledOnce()
})

test('fails closed and disposes when a provider drops readonly policy', async () => {
  const dispose = vi.fn(async () => {})
  const adapter = createProviderRuntimeModeAdapter({
    id: 'direct',
    provider: createPairProvider({ dispose }),
    runtimeHost: testRuntimeHostOperations,
    workspaceFsCapability: 'strong',
    bash: { kind: 'host' },
    filesystem: { kind: 'host' },
  })

  await expect(adapter.create({
    workspaceRoot: '/tmp/workspace',
    sessionId: 'session',
    readonlyWorkspacePolicy: { readonlyPaths: ['locked'], revision: 'policy-v1' },
  })).rejects.toMatchObject({ code: ErrorCode.enum.CONFIG_INVALID })
  expect(dispose).toHaveBeenCalledOnce()
})

test('old V1 provider fixture resolves absent readonly shell claim to operations-only', async () => {
  const adapter = createProviderRuntimeModeAdapter({
    id: 'direct',
    provider: createPairProvider({ dispose: vi.fn(async () => {}), echoReadonlyPolicy: true }),
    runtimeHost: testRuntimeHostOperations,
    workspaceFsCapability: 'strong',
    bash: { kind: 'host' },
    filesystem: { kind: 'host' },
  })

  const bundle = await adapter.create({
    workspaceRoot: '/tmp/workspace',
    sessionId: 'session',
    readonlyWorkspacePolicy: { readonlyPaths: ['locked'], revision: 'policy-v1' },
  })
  expect(bundle.readonlyWorkspacePathEnforcement).toBe('operations')
  expect(bundle.readonlyWorkspaceShellUnavailableReason).toBe(READONLY_WORKSPACE_SHELL_UNAVAILABLE_REASON)
  expect(buildHarnessAgentTools(bundle)).toEqual([])
  await bundle.disposeRuntime?.()
})

test.each(['direct', 'vercel-sandbox', 'remote-worker'] as const)(
  'rejects requested strong readonly shell enforcement from %s',
  async (providerId) => {
    const adapter = createProviderRuntimeModeAdapter({
      id: providerId === 'vercel-sandbox' ? 'vercel-sandbox' : 'direct',
      provider: createPairProvider({
        providerId,
        dispose: vi.fn(async () => {}),
        echoReadonlyPolicy: true,
      }),
      runtimeHost: testRuntimeHostOperations,
      workspaceFsCapability: 'strong',
      bash: { kind: 'host' },
      filesystem: { kind: 'host' },
    })

    await expect(adapter.create({
      workspaceRoot: '/tmp/workspace',
      sessionId: 'session',
      readonlyWorkspacePolicy: { readonlyPaths: ['locked'], revision: 'policy-v1' },
      requestedReadonlyWorkspacePathEnforcement: 'operations-and-shell',
    })).rejects.toMatchObject({ code: ErrorCode.enum.CONFIG_INVALID })
  },
)

test('projects the qualified bwrap strong claim onto the runtime bundle', async () => {
  const adapter = createProviderRuntimeModeAdapter({
    id: 'local',
    provider: createPairProvider({
      dispose: vi.fn(async () => {}),
      providerId: 'bwrap',
      echoReadonlyPolicy: true,
      readonlyWorkspacePathEnforcement: 'operations-and-shell',
    }),
    runtimeHost: testRuntimeHostOperations,
    workspaceFsCapability: 'strong',
    bash: { kind: 'local-sandbox', sandboxRoot: '/workspace' },
    filesystem: { kind: 'host' },
  })

  const bundle = await adapter.create({
    workspaceRoot: '/tmp/workspace',
    sessionId: 'session',
    readonlyWorkspacePolicy: { readonlyPaths: ['locked'], revision: 'policy-v1' },
    requestedReadonlyWorkspacePathEnforcement: 'operations-and-shell',
  })
  expect(bundle.readonlyWorkspacePathEnforcement).toBe('operations-and-shell')
  await bundle.disposeRuntime?.()
})

test('bundle construction preserves its first error when pair cleanup also fails', async () => {
  const constructionError = new Error('bundle construction failed')
  const dispose = vi.fn(async () => { throw new Error('pair cleanup failed') })
  const adapter = createProviderRuntimeModeAdapter({
    id: 'direct',
    provider: createPairProvider({ dispose }),
    runtimeHost: testRuntimeHostOperations,
    workspaceFsCapability: 'strong',
    bash: { kind: 'host' },
    filesystem: { kind: 'host' },
    provisioningAdapter: () => { throw constructionError },
  })

  await expect(adapter.create({ workspaceRoot: '/tmp/workspace', sessionId: 'session' }))
    .rejects.toBe(constructionError)
  expect(dispose).toHaveBeenCalledOnce()
})

test('Agent owns built-in sandbox adapter selection and host operations', async () => {
  const adapter = createSandboxRuntimeModeAdapter('direct')
  expect(adapter.id).toBe('direct')
  expect(adapter.runtimeHost).toBe(sandboxRuntimeHostOperations)
  await adapter.dispose?.()
  expect(() => createSandboxRuntimeModeAdapter('custom' as 'direct')).toThrow('no built-in adapter')
})

test('cached runtime eviction awaits asynchronous provider invalidation', async () => {
  let releaseInvalidation!: () => void
  const invalidate = vi.fn(() => new Promise<void>((resolve) => { releaseInvalidation = resolve }))
  const adapter = createProviderRuntimeModeAdapter({
    id: 'direct',
    provider: createPairProvider({ dispose: vi.fn(async () => {}), invalidate }),
    runtimeHost: testRuntimeHostOperations,
    workspaceFsCapability: 'strong',
    bash: { kind: 'host' },
    filesystem: { kind: 'host' },
  })

  let settled = false
  const eviction = Promise.resolve(adapter.evictCachedRuntime?.({ workspaceId: 'workspace' }))
    .then(() => { settled = true })
  await Promise.resolve()
  expect(settled).toBe(false)
  releaseInvalidation()
  await eviction
  expect(invalidate).toHaveBeenCalledWith({ workspaceId: 'workspace' })
})
