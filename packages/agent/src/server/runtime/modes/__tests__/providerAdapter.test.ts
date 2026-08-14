import { expect, test, vi } from 'vitest'

import {
  type SandboxProviderV1,
  type SandboxRuntimeModeDescriptorV1,
} from '@hachej/boring-sandbox/shared'
import type { Sandbox, Workspace } from '../../../../shared'
import type { RuntimeBundle } from '../../mode'
import {
  createDescriptorRuntimeModeAdapter,
  createProviderRuntimeModeAdapter,
} from '../providerAdapter'
import {
  createSandboxRuntimeModeAdapter,
  sandboxRuntimeHostOperations,
} from '../../sandboxRuntimeHost'
import { testRuntimeHostOperations } from '@agent-test-host'

function createPairProvider(options: {
  checkHealth?: () => Promise<{ state: 'ok' } | { state: 'recreate'; message?: string }>
  dispose: () => Promise<void>
  invalidate?: (ctx: { workspaceId: string }) => Promise<void>
  providerId?: string
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
    provider: options.providerId ?? 'direct',
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
    async create() {
      return {
        workspace,
        sandbox,
        checkHealth: options.checkHealth,
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

test('the generic descriptor adapter composes a provider pair without a provider-specific Agent branch', async () => {
  const dispose = vi.fn(async () => {})
  const provider = createPairProvider({ dispose, providerId: 'fixture-provider' })
  const descriptor: SandboxRuntimeModeDescriptorV1 = {
    id: 'fixture-provider',
    providerId: 'fixture-provider',
    pair: {
      workspaceProviderId: 'fixture-provider',
      sandboxProviderId: 'fixture-provider',
    },
    capabilities: provider.capabilities,
    errorCodeNamespace: 'FIXTURE_PROVIDER',
    adapter: {
      workspaceFsCapability: 'strong',
      bash: { kind: 'host' },
      filesystem: { kind: 'host' },
      storageRoot: 'workspace-root',
      provisioning: 'pair',
    },
    host: {
      productionSafe: false,
      inferSiblingSessionRoot: false,
      allowPiExtensions: false,
      loadWorkspacePiResources: false,
      includePluginAuthoringProvisioning: false,
      resolveCompanyContextFromHostWorkspace: false,
      httpWorkspaceScope: 'default',
    },
    resolveRuntimeRoot: () => '/workspace',
    createPairFactory: () => provider,
  }
  const adapter = createDescriptorRuntimeModeAdapter({
    descriptor,
    runtimeHost: testRuntimeHostOperations,
  })

  const bundle = await adapter.create({ workspaceRoot: '/workspace', sessionId: 'session' })

  expect(bundle.workspace.runtimeContext).toBe(bundle.sandbox.runtimeContext)
  expect(bundle.sandbox.provider).toBe('fixture-provider')
  await bundle.disposeRuntime?.()
  expect(dispose).toHaveBeenCalledOnce()
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
  expect(() => createSandboxRuntimeModeAdapter('custom')).toThrow('no built-in adapter')
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

test('rejects and disposes a provider pair whose runtime roots diverge', async () => {
  const dispose = vi.fn(async () => {})
  const provider = createPairProvider({ dispose })
  const originalCreate = provider.create
  provider.create = async (context) => {
    const pair = await originalCreate(context)
    return {
      ...pair,
      sandbox: {
        ...pair.sandbox,
        runtimeContext: { runtimeCwd: '/different-root' },
      },
    }
  }
  const adapter = createProviderRuntimeModeAdapter({
    id: 'direct',
    provider,
    runtimeHost: testRuntimeHostOperations,
    workspaceFsCapability: 'strong',
    bash: { kind: 'host' },
    filesystem: { kind: 'host' },
  })

  await expect(adapter.create({ workspaceRoot: '/tmp/workspace', sessionId: 'session' }))
    .rejects.toThrow('mismatched Workspace + Sandbox pair')
  expect(dispose).toHaveBeenCalledOnce()
})
