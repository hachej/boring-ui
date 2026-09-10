import Fastify from 'fastify'
import { expect, test } from 'vitest'
import { createProviderRegistryV1 } from '../../../shared/credentials'
import type {
  CredentialFieldId,
  ProviderId,
  VerifiedWorkspaceCredentialAuthorityV1,
} from '../../../shared/credentials'
import { credentialsRoutes } from '../../http/routes/credentials'
import {
  createInMemoryCredentialVaultPersistenceV1,
  createInMemoryCredentialVersionAnchorV1,
  createLocalKekWorkspaceKekProviderV1,
  createVaultCredentialStoreBackendV1,
} from '..'

const SECRET_CANARY = 'SECRET-CANARY-never-return-or-log-9876'
const providerId = 'anthropic' as ProviderId
const fieldId = 'api-key' as CredentialFieldId

test('credential responses and logged errors never contain submitted secret material', async () => {
  const logs: string[] = []
  const app = Fastify({
    logger: {
      level: 'warn',
      stream: { write: (line: string) => { logs.push(line) } },
    },
  })
  const providerRegistry = createProviderRegistryV1([{
    contractVersion: 'boring.provider.v1',
    id: providerId,
    displayName: 'Anthropic',
    category: 'llm',
    credential: {
      type: 'api-key',
      fields: [{
        id: fieldId,
        label: 'API key',
        required: true,
        sensitivity: 'secret',
        minBytes: 1,
        maxBytes: 4096,
      }],
    },
    consumerBindingIds: [],
    sandboxEgressOrigins: [],
  }])
  const vaultBackend = createVaultCredentialStoreBackendV1({
    persistence: createInMemoryCredentialVaultPersistenceV1(),
    versionAnchor: createInMemoryCredentialVersionAnchorV1(),
    kmsBackend: createLocalKekWorkspaceKekProviderV1({
      keyRef: 'test-key',
      keyVersion: 1,
      loadKek: async () => new Uint8Array(32).fill(9),
    }),
  })
  const authority: VerifiedWorkspaceCredentialAuthorityV1 = {
    workspaceId: 'workspace-a',
    appId: 'test',
    principal: { kind: 'user', userId: 'owner-a', membershipRole: 'owner' },
    authorizationReceiptId: 'receipt-a',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }
  await app.register(credentialsRoutes, {
    providerRegistry,
    vaultBackend,
    apiKeyValidator: { validate: async () => undefined },
    authorizeRequest: async () => authority,
  })

  const write = await app.inject({
    method: 'PUT',
    url: '/api/v1/credentials/anthropic',
    payload: { fields: { 'api-key': SECRET_CANARY } },
  })
  const status = await app.inject({ method: 'GET', url: '/api/v1/credentials/anthropic' })
  const list = await app.inject({ method: 'GET', url: '/api/v1/credentials' })
  const rejected = await app.inject({
    method: 'PUT',
    url: '/api/v1/credentials/anthropic',
    payload: { fields: { 'api-key': SECRET_CANARY, unexpected: SECRET_CANARY } },
  })

  expect(write.statusCode).toBe(200)
  expect(status.statusCode).toBe(200)
  expect(list.statusCode).toBe(200)
  expect(rejected.statusCode).toBe(400)
  const observable = JSON.stringify({
    responses: [write.body, status.body, list.body, rejected.body],
    logs,
  })
  expect(observable).not.toContain(SECRET_CANARY)
  expect(observable).not.toContain('never-return-or-log')
  await app.close()
})
