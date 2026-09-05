import { describe, expect, test, vi } from 'vitest'
import fixture from './fixtures.json'
import {
  WhatsAppCloudAdapter,
  WhatsAppCloudApiError,
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
const withCredentials = async <T>(use: (value: WhatsAppCloudCredentials) => T | Promise<T>) => use(credentials)

async function signature(body: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(credentials.appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, Uint8Array.from(body).buffer))
  return `sha256=${[...digest].map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

describe('WhatsApp Cloud webhook', () => {
  test('answers Meta challenge only for an exact constant-time token match', async () => {
    const handler = createWhatsAppWebhookHandler({ withCredentials, acceptInbound: vi.fn() })
    await expect(handler({ method: 'GET', url: '/webhook?hub.mode=subscribe&hub.verify_token=verify-secret&hub.challenge=challenge-42' }))
      .resolves.toEqual({ status: 200, body: 'challenge-42', contentType: 'text/plain' })
    await expect(handler({ method: 'GET', url: '/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=nope' }))
      .resolves.toMatchObject({ status: 403 })
  })

  test('authenticates raw bytes before parsing and durably accepts text and interactive replies', async () => {
    const body = new TextEncoder().encode(JSON.stringify(fixture.inbound))
    const accepted = vi.fn()
    const handler = createWhatsAppWebhookHandler({ withCredentials, acceptInbound: accepted })
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
    const handler = createWhatsAppWebhookHandler({ withCredentials, acceptInbound: accepted, bodyLimit: 4 })
    await expect(handler({ method: 'POST', url: '/webhook', body: new TextEncoder().encode('not json'), headers: { 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) } }))
      .resolves.toMatchObject({ status: 413 })
    expect(accepted).not.toHaveBeenCalled()
  })

  test('composes the fetch webhook with the channel inbound contract', async () => {
    const body = new TextEncoder().encode(JSON.stringify(fixture.inbound))
    const accept = vi.fn()
    const edge = createWhatsAppCloudEdge({ withCredentials, agentTypeId: 'default', inbound: { accept } })
    const response = await edge.webhook(new Request('https://example.test/api/channels/whatsapp/webhook', {
      method: 'POST', body, headers: { 'x-hub-signature-256': await signature(body) },
    }))
    expect(response.status).toBe(200)
    expect(accept).toHaveBeenCalledTimes(2)
    expect(accept).toHaveBeenNthCalledWith(1, expect.objectContaining({ providerMessageId: 'wamid.text-1' }), 'default')
  })

  test('rejects a signed malformed envelope so Meta can retry', async () => {
    const body = new TextEncoder().encode('{"object":"whatsapp_business_account","entry":[{}]}')
    const handler = createWhatsAppWebhookHandler({ withCredentials, acceptInbound: vi.fn() })
    await expect(handler({ method: 'POST', url: '/webhook', body, headers: { 'x-hub-signature-256': await signature(body) } }))
      .resolves.toMatchObject({ status: 400, body: 'invalid envelope' })
  })

  test('bounds a chunked fetch body before dispatch', async () => {
    const edge = createWhatsAppCloudEdge({ withCredentials, agentTypeId: 'default', inbound: { accept: vi.fn() }, bodyLimit: 4 })
    const response = await edge.webhook(new Request('https://example.test/webhook', { method: 'POST', body: '12345' }))
    expect(response.status).toBe(413)
  })

  test('has deterministic signature and envelope guards', async () => {
    const body = new TextEncoder().encode('payload')
    expect(await verifySignature(body, await signature(body), credentials.appSecret)).toBe(true)
    expect(await verifySignature(new TextEncoder().encode('tampered'), await signature(body), credentials.appSecret)).toBe(false)
    expect(() => parseWhatsAppInbound({ object: 'other', entry: [] })).toThrow('Invalid WhatsApp webhook envelope')
  })
})

describe('WhatsApp Cloud outbound', () => {
  test('renders 4096-bounded WhatsApp chunks and sends Graph API text', async () => {
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}', { status: 200 }))
    const adapter = new WhatsAppCloudAdapter({ withCredentials, fetch: request })
    const messages = adapter.renderOutbound({ turnId: 'turn-1', status: 'ok', text: `**Title**\n\n${'x'.repeat(4_200)}` })
    expect(messages.length).toBe(2)
    expect(messages.every((message) => (message.text?.body.length ?? 0) <= 4_096)).toBe(true)
    const unicode = adapter.renderOutbound({ turnId: 'turn-unicode', status: 'ok', text: `${'x'.repeat(4_095)}😀` })
    expect(unicode).toHaveLength(2)
    expect(unicode[0]!.text!.body.endsWith('\ud83d')).toBe(false)
    expect(unicode[1]!.text!.body.startsWith('\ude00')).toBe(false)
    await adapter.send({ conversationKey: '41790000000', message: messages[0]! })
    expect(request).toHaveBeenCalledWith(
      'https://graph.facebook.com/v25.0/123456789/messages',
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ authorization: 'Bearer secret-access-token' }) }),
    )
    expect(JSON.parse(String(request.mock.calls[0]![1]!.body))).toMatchObject({ to: '41790000000', type: 'text' })
  })

  test('sends the approved fallback template outside the service window', async () => {
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}', { status: 200 }))
    const adapter = new WhatsAppCloudAdapter({ withCredentials, fetch: request })
    expect(adapter.serviceWindowMs).toBe(86_400_000)
    await adapter.sendWindowTemplate({ conversationKey: '41790000000' })
    expect(JSON.parse(String(request.mock.calls[0]![1]!.body))).toMatchObject({
      to: '41790000000', type: 'template',
      template: { name: 'resume_request', language: { code: 'en_GB' } },
    })
  })

  test('classifies throttling as retryable and auth failures as permanent', async () => {
    const throttled = new WhatsAppCloudAdapter({ withCredentials, fetch: vi.fn(async () => new Response('', { status: 429 })) })
    await expect(throttled.sendWindowTemplate({ conversationKey: '1' })).rejects.toEqual(expect.objectContaining<Partial<WhatsAppCloudApiError>>({ status: 429, retryable: true }))
    const unauthorized = new WhatsAppCloudAdapter({ withCredentials, fetch: vi.fn(async () => new Response('', { status: 401 })) })
    await expect(unauthorized.sendWindowTemplate({ conversationKey: '1' })).rejects.toEqual(expect.objectContaining<Partial<WhatsAppCloudApiError>>({ status: 401, retryable: false }))
    const providerTransient = new WhatsAppCloudAdapter({ withCredentials, fetch: vi.fn(async () => Response.json({ error: { code: 2, is_transient: true } }, { status: 400 })) })
    await expect(providerTransient.sendWindowTemplate({ conversationKey: '1' })).rejects.toEqual(expect.objectContaining<Partial<WhatsAppCloudApiError>>({ status: 400, retryable: true }))
  })
})
