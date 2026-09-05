import Fastify from 'fastify'
import { describe, expect, test } from 'vitest'
import {
  CREDENTIAL_ERROR_CODES,
  createProviderRegistryV1,
} from '../../../../shared/credentials'
import type {
  CredentialFieldId,
  ProviderId,
  VerifiedWorkspaceCredentialAuthorityV1,
} from '../../../../shared/credentials'
import {
  createInMemoryCredentialVaultPersistenceV1,
  createInMemoryCredentialVersionAnchorV1,
  createLocalFileCredentialVersionAnchorV1,
  createLocalKekWorkspaceKekProviderV1,
  createVaultCredentialStoreBackendV1,
} from '../../../credentials'
import type { VaultCredentialStoreBackendV1 } from '../../../credentials'
import { createTemporaryCredentialAnchorPath } from '../../../credentials/__tests__/testSupport'
import { credentialsRoutes } from '../credentials'

const PROVIDER = 'anthropic' as ProviderId
const FIELD = 'api-key' as CredentialFieldId

function authority(role: 'owner' | 'editor' | 'viewer'): VerifiedWorkspaceCredentialAuthorityV1 {
  return {
    workspaceId: 'workspace-a',
    appId: 'test',
    principal: { kind: 'user', userId: 'user-a', membershipRole: role },
    authorizationReceiptId: 'receipt-a',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }
}

async function setup(
  role: 'owner' | 'editor' | 'viewer' = 'owner',
  backendOverride?: VaultCredentialStoreBackendV1,
  includeCodex = false,
) {
  const providerRegistry = createProviderRegistryV1([{
    contractVersion: 'boring.provider.v1',
    id: PROVIDER,
    displayName: 'Anthropic',
    category: 'llm',
    credential: {
      type: 'api-key',
      fields: [{
        id: FIELD,
        label: 'API key',
        required: true,
        sensitivity: 'secret',
        minBytes: 1,
        maxBytes: 4096,
      }],
    },
    consumerBindingIds: [],
    sandboxEgressOrigins: [],
  }, ...(includeCodex ? [{
    contractVersion: 'boring.provider.v1' as const,
    id: 'openai-codex' as ProviderId,
    displayName: 'OpenAI Codex',
    category: 'llm' as const,
    credential: { type: 'none' as const },
    consumerBindingIds: [],
    sandboxEgressOrigins: [],
  }] : [])])
  const persistence = createInMemoryCredentialVaultPersistenceV1()
  const vaultBackend = backendOverride ?? createVaultCredentialStoreBackendV1({
    persistence,
    versionAnchor: createInMemoryCredentialVersionAnchorV1(),
    kmsBackend: createLocalKekWorkspaceKekProviderV1({
      keyRef: 'test-key',
      keyVersion: 1,
      loadKek: async () => new Uint8Array(32).fill(7),
    }),
  })
  const app = Fastify({ logger: false })
  await app.register(credentialsRoutes, {
    providerRegistry,
    vaultBackend,
    authorizeRequest: async () => authority(role),
  })
  return { app, vaultBackend }
}

describe('owner credential routes', () => {
  test('lists registry providers from clean persistence before the anchor is provisioned', async () => {
    const anchorFilePath = await createTemporaryCredentialAnchorPath()
    const loadKek = async () => new Uint8Array(32).fill(7)
    const vaultBackend = createVaultCredentialStoreBackendV1({
      persistence: createInMemoryCredentialVaultPersistenceV1(),
      versionAnchor: createLocalFileCredentialVersionAnchorV1({ anchorFilePath, loadKek }),
      kmsBackend: createLocalKekWorkspaceKekProviderV1({
        keyRef: 'test-key',
        keyVersion: 1,
        loadKek,
      }),
    })
    const { app } = await setup('owner', vaultBackend)

    const response = await app.inject({ method: 'GET', url: '/api/v1/credentials' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      credentials: [{
        providerId: 'anthropic',
        displayName: 'Anthropic',
        credentialType: 'api-key',
        state: 'not_configured',
      }],
    })
    await app.close()
  })

  test.each(['editor', 'viewer'] as const)('denies %s writes server-side', async (role) => {
    const { app } = await setup(role)
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/credentials/anthropic',
      payload: { fields: { 'api-key': 'secret' } },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({
      error: {
        code: CREDENTIAL_ERROR_CODES.FORBIDDEN,
        message: 'Credential operation failed',
      },
    })
    await app.close()
  })

  test('rejects API-key writes for Pi providers that do not advertise api-key auth', async () => {
    const { app, vaultBackend } = await setup('owner', undefined, true)
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/credentials/openai-codex',
      payload: { fields: { 'api-key': 'secret' } },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({
      error: {
        code: CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
        message: 'Credential operation failed',
      },
    })

    await vaultBackend.writeCredentialFields({
      workspaceId: 'workspace-a',
      providerId: 'openai-codex' as ProviderId,
      fields: new Map([[FIELD, new TextEncoder().encode('legacy-key')]]),
      metadata: {
        displayLabel: 'Legacy Codex key',
        credentialType: 'api-key',
        maskedLastFourSuffix: '-key',
      },
    })
    const legacy = await app.inject({ method: 'GET', url: '/api/v1/credentials/openai-codex' })
    expect(legacy.json()).toMatchObject({
      providerId: 'openai-codex',
      displayName: 'OpenAI Codex',
      credentialType: 'none',
      state: 'needs_reauth',
    })
    expect(legacy.body).not.toContain('Legacy Codex key')
    expect(legacy.body).not.toContain('-key')
    await app.close()
  })

  test('supports create, replace, disable, revoke, and delete without plaintext reads', async () => {
    const { app, vaultBackend } = await setup()
    const put = (value: string, displayLabel = 'Team key') => app.inject({
      method: 'PUT',
      url: '/api/v1/credentials/anthropic',
      payload: { displayLabel, fields: { 'api-key': value } },
    })

    const created = await put('sk-first-1111')
    expect(created.statusCode).toBe(200)
    expect(created.json()).toMatchObject({
      providerId: 'anthropic',
      displayName: 'Team key',
      credentialType: 'api-key',
      state: 'active',
      credentialVersion: 1,
      maskedLastFourSuffix: '1111',
    })
    expect(created.body).not.toContain('sk-first')

    const replaced = await put('sk-second-2222', 'Rotated key')
    expect(replaced.json()).toMatchObject({
      displayName: 'Rotated key',
      state: 'active',
      credentialVersion: 2,
      maskedLastFourSuffix: '2222',
    })

    const disabled = await app.inject({ method: 'POST', url: '/api/v1/credentials/anthropic/disable' })
    expect(disabled.json()).toMatchObject({ state: 'disabled', credentialVersion: 2 })
    await expect(vaultBackend.read('workspace-a', PROVIDER, [FIELD])).rejects.toMatchObject({
      code: CREDENTIAL_ERROR_CODES.DISABLED,
    })

    const reactivated = await put('sk-third-3333')
    expect(reactivated.json()).toMatchObject({ state: 'active', credentialVersion: 3 })

    const revoked = await app.inject({ method: 'POST', url: '/api/v1/credentials/anthropic/revoke' })
    expect(revoked.json()).toMatchObject({ state: 'revoked', credentialVersion: 3 })
    await expect(vaultBackend.read('workspace-a', PROVIDER, [FIELD])).rejects.toMatchObject({
      code: CREDENTIAL_ERROR_CODES.REVOKED,
    })

    const deleted = await app.inject({ method: 'DELETE', url: '/api/v1/credentials/anthropic' })
    expect(deleted.json()).toMatchObject({ state: 'intentionally_absent', credentialVersion: 4 })
    await expect(vaultBackend.read('workspace-a', PROVIDER, [FIELD])).rejects.toMatchObject({
      code: CREDENTIAL_ERROR_CODES.REVOKED,
    })

    const status = await app.inject({ method: 'GET', url: '/api/v1/credentials/anthropic' })
    const list = await app.inject({ method: 'GET', url: '/api/v1/credentials' })
    expect(status.json()).toEqual(expect.objectContaining({ state: 'intentionally_absent' }))
    expect(list.json().credentials).toHaveLength(1)
    for (const response of [created, replaced, disabled, reactivated, revoked, deleted, status, list]) {
      expect(response.body).not.toContain('sk-')
      expect(response.body).not.toHaveProperty('fields')
    }
    await app.close()
  })
})
