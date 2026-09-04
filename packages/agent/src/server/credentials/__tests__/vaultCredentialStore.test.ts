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
  return { backend, kmsBackend, persistence, versionAnchor }
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

  test('non-active vault states throw instead of permitting Pi environment fallback', async () => {
    const { backend } = setup()
    const store = createVaultCredentialStoreV1({
      workspaceId: 'workspace-a',
      vaultBackend: backend(),
      allowSubscriptionOAuth: true,
    })
    await store.modify('openai-codex', async () => initial)

    await backend().setCredentialLifecycleState('workspace-a', 'openai-codex' as ProviderId, 'disabled')
    await expect(store.read('openai-codex')).rejects.toMatchObject({
      code: CREDENTIAL_ERROR_CODES.DISABLED,
    })
    await backend().setCredentialLifecycleState('workspace-a', 'openai-codex' as ProviderId, 'revoked')
    await expect(store.read('openai-codex')).rejects.toMatchObject({
      code: CREDENTIAL_ERROR_CODES.REVOKED,
    })
    await store.delete('openai-codex')
    await expect(store.read('openai-codex')).rejects.toMatchObject({
      code: CREDENTIAL_ERROR_CODES.REVOKED,
    })
  })

  test('fails closed when anchored metadata is missing or replayed before revocation', async () => {
    const { backend, kmsBackend, persistence, versionAnchor } = setup()
    const store = createVaultCredentialStoreV1({
      workspaceId: 'workspace-a',
      vaultBackend: backend(),
      allowSubscriptionOAuth: true,
    })
    await store.modify('openai-codex', async () => initial)
    const activeMetadata = await persistence.getCredentialMetadata(
      'workspace-a',
      'openai-codex' as ProviderId,
    )
    const typeTamperedStore = createVaultCredentialStoreV1({
      workspaceId: 'workspace-a',
      vaultBackend: createVaultCredentialStoreBackendV1({
        kmsBackend,
        persistence: {
          ...persistence,
          async getCredentialMetadata() {
            return activeMetadata && { ...activeMetadata, credentialType: 'tampered-type' }
          },
        },
        versionAnchor,
      }),
      allowSubscriptionOAuth: true,
    })
    await expect(typeTamperedStore.read('openai-codex')).rejects.toMatchObject({
      code: CREDENTIAL_ERROR_CODES.UNREADABLE,
    })

    await backend().setCredentialLifecycleState(
      'workspace-a',
      'openai-codex' as ProviderId,
      'revoked',
    )

    for (const replayedMetadata of [undefined, activeMetadata]) {
      const replayedPersistence = {
        ...persistence,
        async getCredentialMetadata() { return replayedMetadata },
      }
      const replayedStore = createVaultCredentialStoreV1({
        workspaceId: 'workspace-a',
        vaultBackend: createVaultCredentialStoreBackendV1({
          kmsBackend,
          persistence: replayedPersistence,
          versionAnchor,
        }),
        allowSubscriptionOAuth: true,
      })
      await expect(replayedStore.read('openai-codex')).rejects.toMatchObject({
        code: CREDENTIAL_ERROR_CODES.UNREADABLE,
      })
    }
  })

  test.each(['revoked', 'deleted'] as const)(
    '%s lifecycle update wins a race with an in-flight refresh',
    async (outcome) => {
      const { backend } = setup()
      const store = createVaultCredentialStoreV1({
        workspaceId: 'workspace-a',
        vaultBackend: backend(),
        allowSubscriptionOAuth: true,
      })
      const lifecycleStore = createVaultCredentialStoreV1({
        workspaceId: 'workspace-a',
        vaultBackend: backend(),
        allowSubscriptionOAuth: true,
      })
      await store.modify('openai-codex', async () => initial)
      let entered!: () => void
      const refreshEntered = new Promise<void>((resolve) => { entered = resolve })
      let release!: () => void
      const refreshGate = new Promise<void>((resolve) => { release = resolve })
      const refresh = store.modify('openai-codex', async (current) => {
        entered()
        await refreshGate
        return { ...(current as OAuthCredential), access: 'raced-access' }
      })
      await refreshEntered
      const lifecycle = outcome === 'revoked'
        ? backend().setCredentialLifecycleState(
          'workspace-a',
          'openai-codex' as ProviderId,
          'revoked',
        )
        : lifecycleStore.delete('openai-codex')
      release()
      await Promise.all([refresh, lifecycle])

      expect(await backend().getCredentialMetadata('workspace-a', 'openai-codex' as ProviderId))
        .toMatchObject({ state: outcome === 'revoked' ? 'revoked' : 'intentionally_absent' })
      await expect(store.read('openai-codex')).rejects.toMatchObject({
        code: CREDENTIAL_ERROR_CODES.REVOKED,
      })
    },
  )

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
