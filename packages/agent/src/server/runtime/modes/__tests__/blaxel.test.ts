import { expect, test } from 'vitest'

import type { SandboxProviderV1 } from '@hachej/boring-sandbox/shared'
import { createBlaxelSandboxModeAdapter } from '../blaxel'

test('Blaxel mode is a best-effort remote workspace without periodic wake checks', () => {
  const provider = {
    contractVersion: 'boring-sandbox.provider.v1',
    providerId: 'blaxel',
    capabilities: {
      fs: 'readwrite', exec: true, watch: true, search: true,
      sourceOfTruth: 'sandbox-primary', provisioningSupport: true,
      providerContractVersion: 'boring-sandbox.provider.v1', runtimeImage: true,
    },
    resolveRuntimeRoot: () => '/workspace',
    async create() { throw new Error('not called') },
  } satisfies SandboxProviderV1
  const adapter = createBlaxelSandboxModeAdapter({ provider, runtimeHost: {} as never })
  expect(adapter.id).toBe('blaxel')
  expect(adapter.workspaceFsCapability).toBe('best-effort')
  expect(adapter.cachedBindingHealthCheck).toBeUndefined()
  expect(adapter.getRuntimeLayoutRoot({ workspaceRoot: '/host', workspaceId: 'w', sessionId: 's' })).toBe('/workspace')
})
