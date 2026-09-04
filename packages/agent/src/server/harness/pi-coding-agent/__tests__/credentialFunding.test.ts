import { describe, expect, test } from 'vitest'
import type { OAuthCredential } from '@earendil-works/pi-ai'
import { allowsSubscriptionOAuthForAgentTypeV1 } from '../../../agent-host/buildAgentComposition'
import {
  createInMemoryCredentialVaultPersistenceV1,
  createInMemoryCredentialVersionAnchorV1,
  createLocalKekWorkspaceKekProviderV1,
  createVaultCredentialStoreBackendV1,
} from '../../../credentials/vault'
import { createVaultCredentialStoreV1 } from '../../../credentials/vaultCredentialStore'

function backend() {
  return createVaultCredentialStoreBackendV1({
    persistence: createInMemoryCredentialVaultPersistenceV1(),
    versionAnchor: createInMemoryCredentialVersionAnchorV1(),
    kmsBackend: createLocalKekWorkspaceKekProviderV1({
      keyRef: 'test', keyVersion: 1, loadKek: async () => new Uint8Array(32).fill(3),
    }),
  })
}

describe('workspace credential funding policy', () => {
  test('normal interactive agents can select Codex OAuth while Factory seats cannot', async () => {
    const vaultBackend = backend()
    const normal = createVaultCredentialStoreV1({
      workspaceId: 'workspace-a', vaultBackend,
      allowSubscriptionOAuth: allowsSubscriptionOAuthForAgentTypeV1('default'),
    })
    const oauth: OAuthCredential = {
      type: 'oauth', refresh: 'refresh-token', access: 'access-token', expires: Date.now() + 60_000,
    }
    await normal.modify('openai-codex', async () => oauth)
    expect(await normal.read('openai-codex')).toEqual(oauth)

    const factory = createVaultCredentialStoreV1({
      workspaceId: 'workspace-a', vaultBackend,
      allowSubscriptionOAuth: allowsSubscriptionOAuthForAgentTypeV1('boring-worker'),
    })
    expect(await factory.read('openai-codex')).toBeUndefined()
    expect(await factory.list()).toEqual([])
  })

  test('Factory seats consume workspace API-key funding through the same Pi store seam', async () => {
    const vaultBackend = backend()
    const writer = createVaultCredentialStoreV1({
      workspaceId: 'workspace-a', vaultBackend, allowSubscriptionOAuth: true,
    })
    await writer.modify('openai-codex', async () => ({ type: 'api_key', key: 'sk-factory-funded' }))

    for (const agentTypeId of ['default', 'boring-triage', 'boring-orchestrator', 'boring-worker']) {
      const store = createVaultCredentialStoreV1({
        workspaceId: 'workspace-a', vaultBackend,
        allowSubscriptionOAuth: allowsSubscriptionOAuthForAgentTypeV1(agentTypeId),
      })
      expect(await store.read('openai-codex')).toEqual({ type: 'api_key', key: 'sk-factory-funded' })
    }
  })
})
