import { describe, expect, test } from 'vitest'
import { createAssistantMessageEventStream, type OAuthCredential } from '@earendil-works/pi-ai'
import { ModelRuntime } from '@mariozechner/pi-coding-agent'
import { allowsSubscriptionOAuthForInvocationV1 } from '../../../agent-host/buildAgentComposition'
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
  test('invocation authority allows interactive OAuth and denies unattended agents regardless of name', async () => {
    const vaultBackend = backend()
    const normal = createVaultCredentialStoreV1({
      workspaceId: 'workspace-a', userId: 'user-a', vaultBackend,
      allowSubscriptionOAuth: allowsSubscriptionOAuthForInvocationV1('personal-subscription'),
    })
    const oauth: OAuthCredential = {
      type: 'oauth', refresh: 'refresh-token', access: 'access-token', expires: Date.now() + 60_000,
    }
    await normal.modify('openai-codex', async () => oauth)
    expect(await normal.read('openai-codex')).toEqual(oauth)

    for (const unattendedAgentTypeId of ['default', 'renamed-custom-worker']) {
      const unattended = createVaultCredentialStoreV1({
        workspaceId: 'workspace-a', userId: 'user-a', vaultBackend,
        allowSubscriptionOAuth: allowsSubscriptionOAuthForInvocationV1('api-key-only'),
      })
      expect(unattendedAgentTypeId).not.toBe('boring-worker')
      expect(await unattended.read('openai-codex')).toBeUndefined()
      expect(await unattended.list()).toEqual([])
    }
  })

  test('normal and Factory runtimes complete deterministically with workspace API-key funding', async () => {
    const vaultBackend = backend()
    const writer = createVaultCredentialStoreV1({
      workspaceId: 'workspace-a', vaultBackend, userId: 'user-a',
      allowSubscriptionOAuth: true,
    })
    await writer.modify('credential-proof', async () => ({ type: 'api_key', key: 'sk-factory-funded' }))

    for (const [agentTypeId, fundingPolicy] of [
      ['default', 'personal-subscription'],
      ['renamed-custom-worker', 'api-key-only'],
    ] as const) {
      const store = createVaultCredentialStoreV1({
        workspaceId: 'workspace-a', userId: 'user-a', vaultBackend,
        allowSubscriptionOAuth: allowsSubscriptionOAuthForInvocationV1(fundingPolicy),
      })
      const runtime = await ModelRuntime.create({ credentials: store, modelsPath: null, refreshOnCreate: false })
      runtime.registerProvider('credential-proof', {
        name: 'Credential proof',
        baseUrl: 'https://example.test/v1',
        api: 'openai-completions',
        models: [{
          id: 'deterministic', name: 'Deterministic', api: 'openai-completions',
          reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 1024, maxTokens: 64,
        }],
        streamSimple(_model, _context, options) {
          expect(options?.apiKey).toBe('sk-factory-funded')
          const stream = createAssistantMessageEventStream()
          const message = {
            role: 'assistant' as const,
            content: [{ type: 'text' as const, text: `funded:${agentTypeId}` }],
            api: 'openai-completions' as const,
            provider: 'credential-proof', model: 'deterministic',
            usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
            stopReason: 'stop' as const, timestamp: 1,
          }
          stream.push({ type: 'done', reason: 'stop', message })
          return stream
        },
      })
      await runtime.refresh({ allowNetwork: false })
      const model = runtime.getModel('credential-proof', 'deterministic')!
      const completed = await runtime.completeSimple(model, { messages: [{ role: 'user', content: 'proof', timestamp: 0 }] })
      expect(completed.content).toEqual([{ type: 'text', text: `funded:${agentTypeId}` }])
    }
  })
})
