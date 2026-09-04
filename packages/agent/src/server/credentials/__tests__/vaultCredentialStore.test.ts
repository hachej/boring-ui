import { describe, expect, test } from 'vitest'
import type { OAuthCredential } from '@earendil-works/pi-ai'
import { CREDENTIAL_ERROR_CODES } from '../../../shared/credentials'
import type { ProviderId } from '../../../shared/credentials'
import {
  createInMemoryCredentialVaultPersistenceV1,
  createInMemoryCredentialVersionAnchorV1,
  createLocalKekWorkspaceKekProviderV1,
  createVaultCredentialStoreBackendV1,
} from '../vault'
import { createVaultCredentialStoreV1 } from '../vaultCredentialStore'

function setup() {
  const persistence = createInMemoryCredentialVaultPersistenceV1()
  const versionAnchor = createInMemoryCredentialVersionAnchorV1()
  const kmsBackend = createLocalKekWorkspaceKekProviderV1({
    keyRef: 'test-key',
    keyVersion: 1,
    loadKek: async () => new Uint8Array(32).fill(9),
  })
  const backend = () => createVaultCredentialStoreBackendV1({ persistence, versionAnchor, kmsBackend })
  return { backend }
}

const initial: OAuthCredential = {
  type: 'oauth',
  refresh: 'refresh-canary-one',
  access: 'access-canary-one',
  expires: 1,
  accountId: 'account-a',
}

describe('vault-backed Pi CredentialStore', () => {
  test('persists Pi OAuth login and refresh across backend/store instances', async () => {
    const { backend } = setup()
    const first = createVaultCredentialStoreV1({
      workspaceId: 'workspace-a',
      vaultBackend: backend(),
      allowSubscriptionOAuth: true,
    })
    await first.modify('openai-codex', async () => initial)

    const restarted = createVaultCredentialStoreV1({
      workspaceId: 'workspace-a',
      vaultBackend: backend(),
      allowSubscriptionOAuth: true,
    })
    expect(await restarted.read('openai-codex')).toEqual(initial)

    await restarted.modify('openai-codex', async (current) => ({
      ...(current as OAuthCredential),
      refresh: 'refresh-canary-two',
      access: 'access-canary-two',
      expires: 9_999,
    }))
    expect(await first.read('openai-codex')).toMatchObject({
      type: 'oauth',
      refresh: 'refresh-canary-two',
      access: 'access-canary-two',
      expires: 9_999,
    })
    expect(await backend().getCredentialMetadata('workspace-a', 'openai-codex' as ProviderId)).toMatchObject({
      credentialType: 'oauth',
      credentialVersion: 2,
      state: 'active',
    })
  })

  test('serializes refresh modify across independent stores sharing durable persistence', async () => {
    const { backend } = setup()
    const one = createVaultCredentialStoreV1({ workspaceId: 'workspace-a', vaultBackend: backend(), allowSubscriptionOAuth: true })
    const two = createVaultCredentialStoreV1({ workspaceId: 'workspace-a', vaultBackend: backend(), allowSubscriptionOAuth: true })
    await one.modify('openai-codex', async () => initial)
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let secondEntered = false
    const firstRefresh = one.modify('openai-codex', async (current) => {
      await gate
      return { ...(current as OAuthCredential), expires: 2 }
    })
    const secondRefresh = two.modify('openai-codex', async (current) => {
      secondEntered = true
      return { ...(current as OAuthCredential), expires: 3 }
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(secondEntered).toBe(false)
    release()
    await Promise.all([firstRefresh, secondRefresh])
    expect(await one.read('openai-codex')).toMatchObject({ expires: 3 })
  })

  test('isolates workspace scope and hides subscription OAuth from unattended stores', async () => {
    const { backend } = setup()
    const interactive = createVaultCredentialStoreV1({
      workspaceId: 'workspace-a',
      vaultBackend: backend(),
      allowSubscriptionOAuth: true,
    })
    await interactive.modify('openai-codex', async () => initial)

    const otherWorkspace = createVaultCredentialStoreV1({
      workspaceId: 'workspace-b',
      vaultBackend: backend(),
      allowSubscriptionOAuth: true,
    })
    const unattended = createVaultCredentialStoreV1({
      workspaceId: 'workspace-a',
      vaultBackend: backend(),
      allowSubscriptionOAuth: false,
    })
    expect(await otherWorkspace.read('openai-codex')).toBeUndefined()
    expect(await unattended.read('openai-codex')).toBeUndefined()
    expect(await unattended.list()).toEqual([])
    await expect(unattended.modify('openai-codex', async () => initial)).rejects.toMatchObject({
      code: CREDENTIAL_ERROR_CODES.DELIVERY_FORBIDDEN,
    })
  })
})
