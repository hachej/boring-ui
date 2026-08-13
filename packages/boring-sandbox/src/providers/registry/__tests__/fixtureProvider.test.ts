import { expect, test, vi } from 'vitest'

import type { Sandbox, Workspace } from '@hachej/boring-agent/shared'
import type { RuntimeBundle } from '../../../../../agent/src/server/runtime/mode'
import { createDescriptorRuntimeModeAdapter } from '../../../../../agent/src/server/runtime/modes/providerAdapter'
import type { AgentRuntimeHostOperations } from '../../../../../agent/src/server/runtime/runtimeHost'

import {
  SandboxRuntimeModeRegistryV1,
  type SandboxProviderV1,
  type SandboxRuntimeModeDescriptorV1,
} from '../../../shared'

function createFixtureProvider(dispose: () => Promise<void>): SandboxProviderV1 {
  const runtimeContext = { runtimeCwd: '/workspace' }
  const workspace: Workspace = {
    root: '/workspace',
    runtimeContext,
    fsCapability: 'best-effort',
    async readFile() { return '' },
    async writeFile() {},
    async unlink() {},
    async readdir() { return [] },
    async stat() { return { kind: 'file', size: 0, mtimeMs: 0 } },
    async mkdir() {},
    async rename() {},
  }
  const sandbox: Sandbox = {
    id: 'fixture-provider-sandbox',
    placement: 'remote',
    provider: 'fixture-provider',
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
    providerId: 'fixture-provider',
    capabilities: fixtureProviderDescriptor.capabilities,
    resolveRuntimeRoot: () => '/workspace',
    async create() {
      return { workspace, sandbox, dispose }
    },
  }
}

const fixtureProviderDescriptor: SandboxRuntimeModeDescriptorV1 = {
  id: 'fixture-provider',
  providerId: 'fixture-provider',
  pair: {
    workspaceProviderId: 'fixture-provider',
    sandboxProviderId: 'fixture-provider',
  },
  capabilities: {
    exec: true,
    fs: 'readwrite',
    realBash: true,
    realBinaries: true,
    networkIsolation: 'provider',
    watch: false,
    search: true,
    sourceOfTruth: 'sandbox-primary',
    provisioningSupport: false,
    providerContractVersion: 'boring-sandbox.provider.v1',
    runtimeImage: true,
    hardening: 'provider',
    filesystemPersistence: 'ephemeral',
  },
  errorCodeNamespace: 'FIXTURE_PROVIDER',
  adapter: {
    workspaceFsCapability: 'best-effort',
    bash: { kind: 'remote' },
    filesystem: { kind: 'remote-workspace' },
    storageRoot: 'none',
    provisioning: 'pair',
  },
  host: {
    productionSafe: false,
    inferSiblingSessionRoot: false,
    allowPiExtensions: false,
    loadWorkspacePiResources: false,
    includePluginAuthoringProvisioning: true,
    resolveCompanyContextFromHostWorkspace: false,
    httpWorkspaceScope: 'default',
  },
  resolveRuntimeRoot: () => '/workspace',
  createPairFactory: () => createFixtureProvider(disposeFixturePair),
}

const disposeFixturePair = vi.fn(async () => {})

test('a provider added only in boring-sandbox registers, resolves, and composes end to end', async () => {
  const registry = new SandboxRuntimeModeRegistryV1()
  registry.register(fixtureProviderDescriptor)

  expect(registry.resolve('fixture-provider')).toBe(fixtureProviderDescriptor)
  const adapter = createDescriptorRuntimeModeAdapter({
    descriptor: registry.resolve('fixture-provider'),
    // This remote fixture uses no host operations; composition still exercises
    // the same generic adapter used by the Agent registry import.
    runtimeHost: {} as AgentRuntimeHostOperations,
  })
  const bundle: RuntimeBundle = await adapter.create({
    workspaceRoot: '/host/fixture-provider',
    workspaceId: 'workspace-1',
    sessionId: 'session-1',
  })

  expect(adapter.runtimeProvider).toBe(fixtureProviderDescriptor)
  expect(bundle.workspace.root).toBe('/workspace')
  expect(bundle.sandbox.provider).toBe('fixture-provider')
  expect(bundle.workspace.runtimeContext).toBe(bundle.sandbox.runtimeContext)
  await bundle.disposeRuntime?.()
  expect(disposeFixturePair).toHaveBeenCalledOnce()
})

test('registry rejects a descriptor whose declared provider and pair differ', () => {
  const registry = new SandboxRuntimeModeRegistryV1()
  expect(() => registry.register({
    ...fixtureProviderDescriptor,
    pair: { ...fixtureProviderDescriptor.pair, sandboxProviderId: 'swapped-provider' },
  })).toThrow('must pair its declared provider')
})
