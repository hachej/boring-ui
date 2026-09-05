import Fastify from 'fastify'
import { describe, expect, test } from 'vitest'
import { InMemoryCredentialStore } from '@earendil-works/pi-ai'
import { createProviderRegistryV1 } from '../../../../shared/credentials'
import type { ProviderId, VerifiedWorkspaceCredentialAuthorityV1 } from '../../../../shared/credentials'
import {
  createInMemoryCredentialVaultPersistenceV1,
  createOpenAiCodexOAuthBrokerV1,
  createInMemoryCredentialVersionAnchorV1,
  createLocalKekWorkspaceKekProviderV1,
  createVaultCredentialStoreBackendV1,
} from '../../../credentials'
import type { OAuthFlowSnapshotV1, OpenAiCodexOAuthBrokerV1 } from '../../../credentials'
import { credentialsRoutes } from '../credentials'

const providerId = 'openai-codex' as ProviderId
function owner(workspaceId: string, userId = 'owner'): VerifiedWorkspaceCredentialAuthorityV1 {
  return {
    workspaceId,
    appId: 'test',
    principal: { kind: 'user', userId, membershipRole: 'owner' },
    authorizationReceiptId: 'receipt',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }
}

function setup() {
  const providerRegistry = createProviderRegistryV1([{
    contractVersion: 'boring.provider.v1',
    id: providerId,
    displayName: 'OpenAI Codex',
    category: 'llm',
    credential: { type: 'api-key', fields: [{ id: 'api-key' as never, label: 'API key', required: true, sensitivity: 'secret', maxBytes: 4096 }] },
    consumerBindingIds: [],
    sandboxEgressOrigins: [],
  }])
  const vaultBackend = createVaultCredentialStoreBackendV1({
    persistence: createInMemoryCredentialVaultPersistenceV1(),
    versionAnchor: createInMemoryCredentialVersionAnchorV1(),
    kmsBackend: createLocalKekWorkspaceKekProviderV1({
      keyRef: 'test', keyVersion: 1, loadKek: async () => new Uint8Array(32).fill(4),
    }),
  })
  const secret = 'oauth-secret-canary'
  const pending: OAuthFlowSnapshotV1 = {
    flowId: 'flow-a', providerId: 'openai-codex', status: 'pending', createdAt: new Date(0).toISOString(),
    events: [{ type: 'device_code', userCode: 'ABCD-EFGH', verificationUri: 'https://example.test/device' }],
    prompt: { type: 'manual_code' },
  }
  const oauthBroker: OpenAiCodexOAuthBrokerV1 = {
    async start() { return pending },
    get(workspaceId, userId, flowId) { return workspaceId === 'workspace-a' && userId === 'owner' && flowId === 'flow-a' ? pending : undefined },
    async respond(workspaceId, userId, flowId, value) {
      if (workspaceId !== 'workspace-a' || userId !== 'owner' || flowId !== 'flow-a' || value !== secret) throw new Error('invalid')
      return { ...pending, status: 'succeeded', prompt: undefined, completedAt: new Date(1).toISOString() }
    },
    async cancel() {},
  }
  const app = Fastify({ logger: false })
  app.register(credentialsRoutes, {
    providerRegistry,
    vaultBackend,
    oauthBroker,
    authorizeRequest: async (request) => owner(
      String(request.headers['x-workspace'] ?? 'workspace-a'),
      String(request.headers['x-user'] ?? 'owner'),
    ),
  })
  return { app, secret }
}

describe('OpenAI Codex OAuth routes', () => {
  test('delegates the flow to Pi login callbacks and persists only through its CredentialStore', async () => {
    const store = new InMemoryCredentialStore()
    const broker = createOpenAiCodexOAuthBrokerV1({
      credentialStoreForActor: () => store,
      createRuntime: async (credentials) => ({
        async login(provider, type, interaction) {
          expect([provider, type]).toEqual(['openai-codex', 'oauth'])
          interaction.notify({ type: 'info', message: 'provider-text-access-token-canary' })
          interaction.notify({ type: 'auth_url', url: 'https://login.example.test/authorize?challenge=safe' })
          const code = await interaction.prompt({ type: 'manual_code', message: 'Paste code' })
          expect(code).toBe('owner-code')
          const credential = { type: 'oauth' as const, refresh: 'refresh-secret', access: 'access-secret', expires: 123 }
          await credentials.modify(provider, async () => credential)
          return credential
        },
      }),
    })
    const started = await broker.start('workspace-a', 'owner')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(broker.get('workspace-a', 'owner', started.flowId)).toMatchObject({
      status: 'pending',
      events: [
        { type: 'progress' },
        { type: 'auth_url', url: 'https://login.example.test/authorize?challenge=safe' },
      ],
      prompt: { type: 'manual_code' },
    })
    await broker.respond('workspace-a', 'owner', started.flowId, 'owner-code')
    await new Promise((resolve) => setTimeout(resolve, 0))
    const completed = broker.get('workspace-a', 'owner', started.flowId)
    expect(completed?.status).toBe('succeeded')
    expect(JSON.stringify(completed)).not.toContain('access-secret')
    expect(await store.read('openai-codex')).toMatchObject({ type: 'oauth', refresh: 'refresh-secret' })
  })

  test('brokers safe interaction state without returning submitted codes or tokens', async () => {
    const { app, secret } = setup()
    const started = await app.inject({ method: 'POST', url: '/api/v1/credentials/openai-codex/oauth' })
    expect(started.statusCode).toBe(202)
    expect(started.json()).toMatchObject({
      flowId: 'flow-a', providerId: 'openai-codex', status: 'pending',
      events: [{ type: 'device_code', userCode: 'ABCD-EFGH', verificationUri: 'https://example.test/device' }],
      prompt: { type: 'manual_code' },
    })

    const completed = await app.inject({
      method: 'POST',
      url: '/api/v1/credentials/openai-codex/oauth/flow-a/respond',
      payload: { value: secret },
    })
    expect(completed.statusCode).toBe(200)
    expect(completed.json().status).toBe('succeeded')
    expect(completed.body).not.toContain(secret)
    expect(completed.body).not.toContain('access_token')
    await app.close()
  })

  test('does not allow another actor in the same workspace to observe or mutate a flow', async () => {
    const { app, secret } = setup()
    const headers = { 'x-user': 'other-owner' }
    const get = await app.inject({
      method: 'GET', url: '/api/v1/credentials/openai-codex/oauth/flow-a', headers,
    })
    expect(get.statusCode).toBe(404)
    const respond = await app.inject({
      method: 'POST', url: '/api/v1/credentials/openai-codex/oauth/flow-a/respond', headers,
      payload: { value: secret },
    })
    expect(respond.statusCode).toBe(400)
    expect(respond.body).not.toContain(secret)
    await app.close()
  })

  test('does not allow one workspace to observe another workspace flow', async () => {
    const { app } = setup()
    const response = await app.inject({
      method: 'GET', url: '/api/v1/credentials/openai-codex/oauth/flow-a', headers: { 'x-workspace': 'workspace-b' },
    })
    expect(response.statusCode).toBe(404)
    expect(response.body).not.toContain('ABCD-EFGH')
    await app.close()
  })
})
