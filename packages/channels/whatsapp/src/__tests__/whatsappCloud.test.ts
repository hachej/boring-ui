import { describe, expect, test, vi } from 'vitest'
import type {
  AuthorizedWorkspaceCredentialScopeV1,
  CredentialFieldId,
  ProviderCredentialRefV1,
  WorkspaceCredentialResolverV1,
} from '@hachej/boring-agent/shared'
import fixture from './fixtures.json'
import {
  WhatsAppCloudAdapter,
  WhatsAppCloudApiError,
  createWhatsAppCloudCredentialResolver,
  createWhatsAppCloudEdge,
  createWhatsAppWebhookHandler,
  parseWhatsAppInbound,
  verifySignature,
  type WhatsAppCloudCredentials,
} from '..'

const credentials: WhatsAppCloudCredentials = {
  accessToken: 'secret-access-token',
  appSecret: 'app-secret',
  verifyToken: 'verify-secret',
  phoneNumberId: '123456789',
  fallbackTemplateName: 'resume_request',
  fallbackTemplateLanguage: 'en_GB',
}
const resolveCredentials = async () => credentials

async function signature(body: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(credentials.appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, Uint8Array.from(body).buffer))
  return `sha256=${[...digest].map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

describe('WhatsApp host credential wiring', () => {
  test('maps field material and disposes every short-lived lease', async () => {
    const asField = (value: string) => value as CredentialFieldId
    const dispose = vi.fn()
    const resolver = {
      contractVersion: 'boring.workspace-credential-resolver.v1',
      resolve: vi.fn(async () => ({
        contractVersion: 'boring.resolved-credential.v1', workspaceId: 'workspace-1', providerId: 'meta-whatsapp',
        credentialVersion: 1, executionId: 'webhook', expiresAt: new Date(Date.now() + 1_000).toISOString(), dispose,
        material: { kind: 'field-set', fields: new Map([
          [asField('access_token'), new TextEncoder().encode('token')],
          [asField('app_secret'), new TextEncoder().encode('secret')],
          [asField('verify_token'), new TextEncoder().encode('verify')],
          [asField('phone_number_id'), new TextEncoder().encode('123')],
          [asField('template_name'), new TextEncoder().encode('resume')],
        ]) },
      })),
    } as unknown as WorkspaceCredentialResolverV1
    const resolve = createWhatsAppCloudCredentialResolver({
      resolver, workspace: {} as AuthorizedWorkspaceCredentialScopeV1, ref: {} as ProviderCredentialRefV1,
      fields: { accessToken: asField('access_token'), appSecret: asField('app_secret'),
        verifyToken: asField('verify_token'), phoneNumberId: asField('phone_number_id'),
        fallbackTemplateName: asField('template_name') },
    })
    await expect(resolve()).resolves.toMatchObject({ accessToken: 'token', appSecret: 'secret', verifyToken: 'verify', phoneNumberId: '123' })
    expect(dispose).toHaveBeenCalledOnce()
  })
})

describe('WhatsApp Cloud webhook', () => {
  test('answers Meta challenge only for an exact constant-time token match', async () => {
    const handler = createWhatsAppWebhookHandler({ credentials: resolveCredentials, acceptInbound: vi.fn() })
    await expect(handler({ method: 'GET', url: '/webhook?hub.mode=subscribe&hub.verify_token=verify-secret&hub.challenge=challenge-42' }))
      .resolves.toEqual({ status: 200, body: 'challenge-42', contentType: 'text/plain' })
    await expect(handler({ method: 'GET', url: '/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=nope' }))
      .resolves.toMatchObject({ status: 403 })
  })

  test('authenticates raw bytes before parsing and durably accepts text and interactive replies', async () => {
    const body = new TextEncoder().encode(JSON.stringify(fixture.inbound))
    const accepted = vi.fn()
    const handler = createWhatsAppWebhookHandler({ credentials: resolveCredentials, acceptInbound: accepted })
    await expect(handler({
      method: 'POST', url: '/webhook', body,
      headers: { 'X-Hub-Signature-256': await signature(body) },
    })).resolves.toMatchObject({ status: 200, body: '{"accepted":2}' })
    expect(accepted).toHaveBeenNthCalledWith(1, {
      channel: 'whatsapp', conversationKey: '41790000000', providerMessageId: 'wamid.text-1',
      text: 'hello', receivedAt: 1_710_000_000_000,
    })
    expect(accepted).toHaveBeenNthCalledWith(2, expect.objectContaining({ text: 'approve:question-1' }))
  })

  test('rejects tampered and oversized bodies before JSON parsing or enqueue', async () => {
    const accepted = vi.fn()
    const handler = createWhatsAppWebhookHandler({ credentials: resolveCredentials, acceptInbound: accepted, bodyLimit: 4 })
    await expect(handler({ method: 'POST', url: '/webhook', body: new TextEncoder().encode('not json'), headers: { 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) } }))
      .resolves.toMatchObject({ status: 413 })
    expect(accepted).not.toHaveBeenCalled()
  })

  test('composes the fetch webhook with the channel inbound contract', async () => {
    const body = new TextEncoder().encode(JSON.stringify(fixture.inbound))
    const accept = vi.fn()
    const edge = createWhatsAppCloudEdge({ credentials: resolveCredentials, agentTypeId: 'default', inbound: { accept } })
    const response = await edge.webhook(new Request('https://example.test/api/channels/whatsapp/webhook', {
      method: 'POST', body, headers: { 'x-hub-signature-256': await signature(body) },
    }))
    expect(response.status).toBe(200)
    expect(accept).toHaveBeenCalledTimes(2)
    expect(accept).toHaveBeenNthCalledWith(1, expect.objectContaining({ providerMessageId: 'wamid.text-1' }), 'default')
  })

  test('has deterministic signature and envelope guards', async () => {
    const body = new TextEncoder().encode('payload')
    expect(await verifySignature(body, await signature(body), credentials.appSecret)).toBe(true)
    expect(await verifySignature(new TextEncoder().encode('tampered'), await signature(body), credentials.appSecret)).toBe(false)
    expect(parseWhatsAppInbound({ object: 'other', entry: [] })).toEqual([])
  })
})

describe('WhatsApp Cloud outbound', () => {
  test('renders 4096-bounded WhatsApp chunks and sends Graph API text', async () => {
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}', { status: 200 }))
    const adapter = new WhatsAppCloudAdapter({ credentials: resolveCredentials, fetch: request })
    const messages = adapter.renderOutbound({ turnId: 'turn-1', status: 'ok', text: `**Title**\n\n${'x'.repeat(4_200)}` })
    expect(messages.length).toBe(2)
    expect(messages.every((message) => (message.text?.body.length ?? 0) <= 4_096)).toBe(true)
    await adapter.send({ conversationKey: '41790000000', message: messages[0]! })
    expect(request).toHaveBeenCalledWith(
      'https://graph.facebook.com/v25.0/123456789/messages',
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ authorization: 'Bearer secret-access-token' }) }),
    )
    expect(JSON.parse(String(request.mock.calls[0]![1]!.body))).toMatchObject({ to: '41790000000', type: 'text' })
  })

  test('sends the approved fallback template outside the service window', async () => {
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}', { status: 200 }))
    const adapter = new WhatsAppCloudAdapter({ credentials: resolveCredentials, fetch: request })
    expect(adapter.serviceWindowMs).toBe(86_400_000)
    await adapter.sendWindowTemplate({ conversationKey: '41790000000' })
    expect(JSON.parse(String(request.mock.calls[0]![1]!.body))).toMatchObject({
      to: '41790000000', type: 'template',
      template: { name: 'resume_request', language: { code: 'en_GB' } },
    })
  })

  test('classifies throttling as retryable and auth failures as permanent', async () => {
    const throttled = new WhatsAppCloudAdapter({ credentials: resolveCredentials, fetch: vi.fn(async () => new Response('', { status: 429 })) })
    await expect(throttled.sendWindowTemplate({ conversationKey: '1' })).rejects.toEqual(expect.objectContaining<Partial<WhatsAppCloudApiError>>({ status: 429, retryable: true }))
    const unauthorized = new WhatsAppCloudAdapter({ credentials: resolveCredentials, fetch: vi.fn(async () => new Response('', { status: 401 })) })
    await expect(unauthorized.sendWindowTemplate({ conversationKey: '1' })).rejects.toEqual(expect.objectContaining<Partial<WhatsAppCloudApiError>>({ status: 401, retryable: false }))
  })
})
