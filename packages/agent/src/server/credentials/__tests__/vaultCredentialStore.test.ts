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
import { actorCredentialProviderIdV1, createVaultCredentialStoreV1 } from '../vaultCredentialStore'

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
      userId: 'user-a', allowSubscriptionOAuth: true,
    })
    await first.modify('openai-codex', async () => initial)

    const restarted = createVaultCredentialStoreV1({
      workspaceId: 'workspace-a',
      vaultBackend: backend(),
      userId: 'user-a', allowSubscriptionOAuth: true,
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
    expect(await backend().getCredentialMetadata('workspace-a', actorCredentialProviderIdV1('user-a', 'openai-codex'))).toMatchObject({
      credentialType: 'oauth',
      credentialVersion: 2,
      state: 'active',
    })
  })

  test('serializes refresh modify across independent stores sharing durable persistence', async () => {
    const { backend } = setup()
    const one = createVaultCredentialStoreV1({ workspaceId: 'workspace-a', vaultBackend: backend(), userId: 'user-a', allowSubscriptionOAuth: true })
    const two = createVaultCredentialStoreV1({ workspaceId: 'workspace-a', vaultBackend: backend(), userId: 'user-a', allowSubscriptionOAuth: true })
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
      userId: 'user-a', allowSubscriptionOAuth: true,
    })
    await store.modify('openai-codex', async () => initial)

    await backend().setCredentialLifecycleState('workspace-a', actorCredentialProviderIdV1('user-a', 'openai-codex'), 'disabled')
    await expect(store.read('openai-codex')).rejects.toMatchObject({
      code: CREDENTIAL_ERROR_CODES.DISABLED,
    })
    await backend().setCredentialLifecycleState('workspace-a', actorCredentialProviderIdV1('user-a', 'openai-codex'), 'revoked')
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
      userId: 'user-a', allowSubscriptionOAuth: true,
    })
    await store.modify('openai-codex', async () => initial)
    const activeMetadata = await persistence.getCredentialMetadata(
      'workspace-a',
      actorCredentialProviderIdV1('user-a', 'openai-codex'),
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
      userId: 'user-a',
      allowSubscriptionOAuth: true,
    })
    await expect(typeTamperedStore.read('openai-codex')).rejects.toMatchObject({
      code: CREDENTIAL_ERROR_CODES.UNREADABLE,
    })

    await backend().setCredentialLifecycleState(
      'workspace-a',
      actorCredentialProviderIdV1('user-a', 'openai-codex'),
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
        userId: 'user-a',
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
        userId: 'user-a', allowSubscriptionOAuth: true,
      })
      const lifecycleStore = createVaultCredentialStoreV1({
        workspaceId: 'workspace-a',
        vaultBackend: backend(),
        userId: 'user-a', allowSubscriptionOAuth: true,
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
          actorCredentialProviderIdV1('user-a', 'openai-codex'),
          'revoked',
        )
        : lifecycleStore.delete('openai-codex')
      release()
      await Promise.all([refresh, lifecycle])

      expect(await backend().getCredentialMetadata('workspace-a', actorCredentialProviderIdV1('user-a', 'openai-codex')))
        .toMatchObject({ state: outcome === 'revoked' ? 'revoked' : 'intentionally_absent' })
      await expect(store.read('openai-codex')).rejects.toMatchObject({
        code: CREDENTIAL_ERROR_CODES.REVOKED,
      })
    },
  )

  test('binds personal OAuth read, refresh, list, and logout to one verified actor', async () => {
    const { backend } = setup()
    const alice = createVaultCredentialStoreV1({
      workspaceId: 'workspace-a', userId: 'alice', vaultBackend: backend(), allowSubscriptionOAuth: true,
    })
    const bob = createVaultCredentialStoreV1({
      workspaceId: 'workspace-a', userId: 'bob', vaultBackend: backend(), allowSubscriptionOAuth: true,
    })
    await alice.modify('openai-codex', async () => initial)

    expect(await bob.read('openai-codex')).toBeUndefined()
    expect(await bob.list()).toEqual([])
    await bob.modify('openai-codex', async () => ({ ...initial, access: 'bob-access', refresh: 'bob-refresh' }))
    await bob.modify('openai-codex', async (current) => ({ ...(current as OAuthCredential), expires: 44 }))
    expect(await alice.read('openai-codex')).toMatchObject({ access: 'access-canary-one', expires: 1 })
    expect(await bob.read('openai-codex')).toMatchObject({ access: 'bob-access', expires: 44 })

    await bob.delete('openai-codex')
    await expect(bob.read('openai-codex')).rejects.toMatchObject({ code: CREDENTIAL_ERROR_CODES.REVOKED })
    expect(await alice.read('openai-codex')).toMatchObject({ access: 'access-canary-one' })
    expect(await alice.list()).toEqual([{ providerId: 'openai-codex', type: 'oauth' }])
  })

  test('reconnect replaces revoked personal OAuth without exposing workspace fallback', async () => {
    const { backend } = setup()
    const workspace = createVaultCredentialStoreV1({
      workspaceId: 'workspace-a', vaultBackend: backend(), allowSubscriptionOAuth: false,
    })
    const normal = createVaultCredentialStoreV1({
      workspaceId: 'workspace-a', userId: 'alice', vaultBackend: backend(), allowSubscriptionOAuth: true,
    })
    const reconnect = createVaultCredentialStoreV1({
      workspaceId: 'workspace-a', userId: 'alice', vaultBackend: backend(), allowSubscriptionOAuth: true,
      allowRevokedOAuthReplacement: true,
    })
    await workspace.modify('openai-codex', async () => ({ type: 'api_key', key: 'workspace-fallback' }))
    await normal.modify('openai-codex', async () => initial)
    await backend().setCredentialLifecycleState(
      'workspace-a', actorCredentialProviderIdV1('alice', 'openai-codex'), 'revoked',
    )

    await expect(normal.read('openai-codex')).rejects.toMatchObject({ code: CREDENTIAL_ERROR_CODES.REVOKED })
    await expect(normal.modify('openai-codex', async () => ({ ...initial, access: 'unexpected' })))
      .rejects.toMatchObject({ code: CREDENTIAL_ERROR_CODES.REVOKED })
    await reconnect.modify('openai-codex', async (current) => {
      expect(current).toBeUndefined()
      return { ...initial, access: 'reconnected-access', refresh: 'reconnected-refresh' }
    })
    expect(await normal.read('openai-codex')).toMatchObject({
      type: 'oauth', access: 'reconnected-access', refresh: 'reconnected-refresh',
    })
    expect(await workspace.read('openai-codex')).toEqual({ type: 'api_key', key: 'workspace-fallback' })
  })

  test('keeps workspace API-key fallback distinct from personal OAuth custody', async () => {
    const { backend } = setup()
    const workspace = createVaultCredentialStoreV1({
      workspaceId: 'workspace-a', vaultBackend: backend(), allowSubscriptionOAuth: false,
    })
    await workspace.modify('openai-codex', async () => ({ type: 'api_key', key: 'workspace-key' }))
    const alice = createVaultCredentialStoreV1({
      workspaceId: 'workspace-a', userId: 'alice', vaultBackend: backend(), allowSubscriptionOAuth: true,
    })
    expect(await alice.read('openai-codex')).toEqual({ type: 'api_key', key: 'workspace-key' })
    await alice.modify('openai-codex', async () => initial)
    expect(await alice.read('openai-codex')).toEqual(initial)
    expect(await workspace.read('openai-codex')).toEqual({ type: 'api_key', key: 'workspace-key' })
  })

  test('refuses an OAuth-capable store without verified actor identity', () => {
    expect(() => createVaultCredentialStoreV1({
      workspaceId: 'workspace-a', vaultBackend: setup().backend(), allowSubscriptionOAuth: true,
    })).toThrow('verified userId is required')
  })

  test('isolates workspace scope and hides subscription OAuth from unattended stores', async () => {
    const { backend } = setup()
    const interactive = createVaultCredentialStoreV1({
      workspaceId: 'workspace-a',
      vaultBackend: backend(),
      userId: 'user-a', allowSubscriptionOAuth: true,
    })
    await interactive.modify('openai-codex', async () => initial)

    const otherWorkspace = createVaultCredentialStoreV1({
      workspaceId: 'workspace-b',
      vaultBackend: backend(),
      userId: 'user-a', allowSubscriptionOAuth: true,
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
