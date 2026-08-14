import { expect, test, vi } from 'vitest'

import type { Sandbox, Workspace } from '@hachej/boring-agent/shared'

import {
  BUILTIN_RUNTIME_MODE_IDS,
  type SandboxProviderV1,
  type SandboxRuntimeModeDescriptorV1,
} from '../../../shared'
import {
  BUILTIN_SANDBOX_RUNTIME_DESCRIPTORS,
  sandboxRuntimeModeRegistry,
} from '..'
import { MutableSandboxRuntimeModeRegistryV1 } from '../runtimeModeRegistry'

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

test('built-in catalog and registered descriptors are the same exact set', () => {
  const catalogIds = [...BUILTIN_RUNTIME_MODE_IDS].sort()
  const descriptorIds = BUILTIN_SANDBOX_RUNTIME_DESCRIPTORS.map(({ id }) => id).sort()

  expect(descriptorIds).toEqual(catalogIds)
  expect(sandboxRuntimeModeRegistry.list().map(({ id }) => id).sort()).toEqual(catalogIds)
  expect('register' in sandboxRuntimeModeRegistry).toBe(false)
})

test('a provider added only in boring-sandbox registers, resolves, and creates its required pair', async () => {
  const registry = new MutableSandboxRuntimeModeRegistryV1()
  registry.register(fixtureProviderDescriptor)

  const descriptor = registry.resolve('fixture-provider')
  expect(descriptor).toBe(fixtureProviderDescriptor)
  const provider = await descriptor.createPairFactory({})
  const pair = await provider.create({
    workspaceRoot: '/host/fixture-provider',
    workspaceId: 'workspace-1',
    sessionId: 'session-1',
  })

  expect(pair.workspace.root).toBe('/workspace')
  expect(pair.sandbox.provider).toBe('fixture-provider')
  expect(pair.workspace.runtimeContext).toBe(pair.sandbox.runtimeContext)
  await pair.dispose()
  expect(disposeFixturePair).toHaveBeenCalledOnce()
})

test('registry rejects a descriptor whose declared provider and pair differ', () => {
  const registry = new MutableSandboxRuntimeModeRegistryV1()
  expect(() => registry.register({
    ...fixtureProviderDescriptor,
    pair: { ...fixtureProviderDescriptor.pair, sandboxProviderId: 'swapped-provider' },
  })).toThrow('must pair its declared provider')
})
