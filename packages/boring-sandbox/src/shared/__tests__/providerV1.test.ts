import type { Sandbox, Workspace } from '@hachej/boring-agent/shared'
import { describe, expect, test } from 'vitest'

import { PROVIDER_CAPABILITIES, PROVIDER_CONTRACT_VERSION } from '../providerMatrix'
import type { SandboxProviderV1, WorkspaceSandboxPairV1 } from '../providerV1'

const workspace = {} as Workspace
const sandbox = {} as Sandbox

// @ts-expect-error the V1 result can never publish only a Workspace half.
const workspaceOnlyPair: WorkspaceSandboxPairV1 = { workspace, async dispose() {} }
// @ts-expect-error the V1 result can never publish only a Sandbox half.
const sandboxOnlyPair: WorkspaceSandboxPairV1 = { sandbox, async dispose() {} }

const fixtureProvider: SandboxProviderV1 = {
  contractVersion: PROVIDER_CONTRACT_VERSION,
  providerId: 'direct',
  capabilities: PROVIDER_CAPABILITIES.direct,
  resolveRuntimeRoot(context) { return context.workspaceRoot },
  async create() {
    return { workspace, sandbox, async dispose() {} }
  },
}

const wrongVersionProvider = {
  ...fixtureProvider,
  contractVersion: 'boring-sandbox.provider.v0',
}
// @ts-expect-error a provider stamped with any other contract version is rejected.
const rejectedProvider: SandboxProviderV1 = wrongVersionProvider

describe('SandboxProviderV1 contract', () => {
  test('uses the existing provider version authority', () => {
    expect(fixtureProvider.contractVersion).toBe(PROVIDER_CONTRACT_VERSION)
  })

  test('requires both halves at runtime fixtures', async () => {
    const pair = await fixtureProvider.create({
      workspaceRoot: '/workspace',
      sessionId: 'session-1',
    })
    expect(pair.workspace).toBe(workspace)
    expect(pair.sandbox).toBe(sandbox)
  })

  test('keeps compile-only rejection fixtures inert', () => {
    expect(workspaceOnlyPair.workspace).toBe(workspace)
    expect(sandboxOnlyPair.sandbox).toBe(sandbox)
    expect(rejectedProvider.contractVersion).toBe('boring-sandbox.provider.v0')
  })
})
