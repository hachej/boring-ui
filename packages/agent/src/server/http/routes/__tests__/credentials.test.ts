import Fastify from 'fastify'
import { describe, expect, test, vi } from 'vitest'
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
  authorityOverride?: VerifiedWorkspaceCredentialAuthorityV1,
  loggerOverride?: any,
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
  const app = Fastify({ logger: loggerOverride ?? false })
  await app.register(credentialsRoutes, {
    providerRegistry,
    vaultBackend,
    authorizeRequest: async () => authorityOverride ?? authority(role),
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

  test('runs confirmed key lifecycle operations with metadata-only idempotency receipts', async () => {
    const base = createVaultCredentialStoreBackendV1({
      persistence: createInMemoryCredentialVaultPersistenceV1(),
      versionAnchor: createInMemoryCredentialVersionAnchorV1(),
      kmsBackend: createLocalKekWorkspaceKekProviderV1({
        keyRef: 'test-key',
        keyVersion: 1,
        loadKek: async () => new Uint8Array(32).fill(7),
      }),
    })
    const calls: string[] = []
    const backend: VaultCredentialStoreBackendV1 = {
      ...base,
      async rotateWorkspaceDek(workspaceId, operationId) {
        calls.push(`rotate:${workspaceId}:${operationId}`)
        return 2
      },
      async rewrapWorkspaceDek(workspaceId, generation) {
        calls.push(`rewrap:${workspaceId}:${generation}`)
      },
      async cryptoShredWorkspace(workspaceId) {
        calls.push(`shred:${workspaceId}`)
      },
    }
    const systemAuthority: VerifiedWorkspaceCredentialAuthorityV1 = {
      workspaceId: 'workspace-a',
      appId: 'test',
      principal: { kind: 'system', principalId: 'operator-a', workspaceGrantId: 'grant-a' },
      authorizationReceiptId: 'operator-receipt-a',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }
    const { app } = await setup('owner', backend, false, systemAuthority)
    const post = (operation: string, payload: Record<string, unknown>) => app.inject({
      method: 'POST',
      url: `/api/v1/credential-key-lifecycle/${operation}`,
      payload: { operationId: `${operation}-1`, confirmWorkspaceId: 'workspace-a', ...payload },
    })

    const rotate = await post('rotate', {})
    const rotateRetry = await post('rotate', {})
    const rewrap = await post('rewrap', {
      operationId: 'rewrap-dek-generation-2',
      dekGeneration: 2,
    })
    const rewrapRetry = await post('rewrap', {
      operationId: 'rewrap-dek-generation-2',
      dekGeneration: 2,
    })
    const conflictingRewrap = await post('rewrap', {
      operationId: 'rewrap-dek-generation-2',
      dekGeneration: 3,
    })
    const shred = await post('crypto-shred', {})
    const shredRetry = await post('crypto-shred', {})

    expect(rotate.statusCode).toBe(200)
    expect(rotateRetry.json()).toEqual(rotate.json())
    expect(rotate.json()).toEqual({
      contractVersion: 'boring.credential-key-lifecycle-receipt.v1',
      operation: 'rotate',
      workspaceId: 'workspace-a',
      operationId: 'rotate-1',
      status: 'completed',
      dekGeneration: 2,
    })
    expect(rewrap.json()).toMatchObject({
      operation: 'rewrap', operationId: 'rewrap-dek-generation-2', dekGeneration: 2,
    })
    expect(rewrapRetry.json()).toEqual(rewrap.json())
    expect(conflictingRewrap.statusCode).toBe(400)
    expect(shredRetry.json()).toEqual(shred.json())
    expect(calls).toEqual([
      'rotate:workspace-a:rotate-1',
      'rotate:workspace-a:rotate-1',
      'rewrap:workspace-a:2',
      'rewrap:workspace-a:2',
      'shred:workspace-a',
      'shred:workspace-a',
    ])
    for (const response of [rotate, rotateRetry, rewrap, rewrapRetry, conflictingRewrap, shred, shredRetry]) {
      expect(response.body).not.toMatch(/secret|cipher|wrapped/i)
    }
    await app.close()
  })

  test('denies non-owner lifecycle calls and requires workspace-bound confirmation without leaking input', async () => {
    const rotateWorkspaceDek = vi.fn(async () => 2)
    const deniedLogs: string[] = []
    const { app } = await setup('editor', {
      ...createVaultCredentialStoreBackendV1({
        persistence: createInMemoryCredentialVaultPersistenceV1(),
        versionAnchor: createInMemoryCredentialVersionAnchorV1(),
        kmsBackend: createLocalKekWorkspaceKekProviderV1({
          keyRef: 'test-key', keyVersion: 1, loadKek: async () => new Uint8Array(32).fill(7),
        }),
      }),
      rotateWorkspaceDek,
    }, false, undefined, {
      level: 'warn',
      stream: { write: (line: string) => deniedLogs.push(line) },
    })
    const denied = await app.inject({
      method: 'POST',
      url: '/api/v1/credential-key-lifecycle/rotate',
      payload: { operationId: 'secret-canary', confirmWorkspaceId: 'workspace-a' },
    })
    expect(denied.statusCode).toBe(403)
    expect(denied.body).not.toContain('secret-canary')
    expect(rotateWorkspaceDek).not.toHaveBeenCalled()
    const deniedAudit = deniedLogs.join('\n')
    expect(deniedAudit).toContain('workspace-a')
    expect(deniedAudit).toContain('receipt-a')
    expect(deniedAudit).toContain('operationIdDigest')
    expect(deniedAudit).not.toContain('secret-canary')
    await app.close()

    const owner = await setup('owner')
    const unconfirmed = await owner.app.inject({
      method: 'POST',
      url: '/api/v1/credential-key-lifecycle/crypto-shred',
      payload: { operationId: 'secret-canary', confirmWorkspaceId: 'workspace-b' },
    })
    expect(unconfirmed.statusCode).toBe(400)
    expect(unconfirmed.body).not.toContain('secret-canary')
    await owner.app.close()
  })

  test('audits lifecycle failures with metadata and a digest, never raw operation/provider values', async () => {
    const logs: string[] = []
    const base = createVaultCredentialStoreBackendV1({
      persistence: createInMemoryCredentialVaultPersistenceV1(),
      versionAnchor: createInMemoryCredentialVersionAnchorV1(),
      kmsBackend: createLocalKekWorkspaceKekProviderV1({
        keyRef: 'test-key', keyVersion: 1, loadKek: async () => new Uint8Array(32).fill(7),
      }),
    })
    const { app } = await setup('owner', {
      ...base,
      cryptoShredWorkspace: async () => { throw new Error('provider-secret-canary') },
    }, false, undefined, {
      level: 'warn',
      stream: { write: (line: string) => logs.push(line) },
    })
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/credential-key-lifecycle/crypto-shred',
      payload: { operationId: 'operation-secret-canary', confirmWorkspaceId: 'workspace-a' },
    })

    expect(response.statusCode).toBe(400)
    const audit = logs.join('\n')
    expect(audit).toContain('crypto-shred')
    expect(audit).toContain('workspace-a')
    expect(audit).toContain('receipt-a')
    expect(audit).toContain('operationIdDigest')
    expect(audit).not.toContain('operation-secret-canary')
    expect(audit).not.toContain('provider-secret-canary')
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
