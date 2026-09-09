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
    await expect(handler({ method: 'GET', url: fixture.challenge.url }))
      .resolves.toEqual({ status: 200, body: fixture.challenge.expected, contentType: 'text/plain' })
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

  test('rejects signed malformed envelopes and supported messages so Meta can retry', async () => {
    const handler = createWhatsAppWebhookHandler({ withCredentials, acceptInbound: vi.fn() })
    for (const source of [
      '{"object":"whatsapp_business_account","entry":[{}]}',
      '{"object":"whatsapp_business_account","entry":[{"changes":[{"field":"messages","value":{"messages":[{"id":"wamid.bad","from":"1","type":"text"}]}}]}]}',
    ]) {
      const body = new TextEncoder().encode(source)
      await expect(handler({ method: 'POST', url: '/webhook', body, headers: { 'x-hub-signature-256': await signature(body) } }))
        .resolves.toMatchObject({ status: 400, body: 'invalid envelope' })
    }
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
    const fenced = adapter.renderOutbound({ turnId: 'turn-code', status: 'ok', text: `\`\`\`ts\n${'x'.repeat(4_200)}\n\`\`\`` })
    expect(fenced).toHaveLength(2)
    expect(fenced.every((message) => ((message.text!.body.match(/```/g) ?? []).length % 2) === 0)).toBe(true)
    await adapter.send({ conversationKey: fixture.outbound.conversationKey, message: messages[0]! })
    expect(request).toHaveBeenCalledWith(
      'https://graph.facebook.com/v25.0/123456789/messages',
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ authorization: 'Bearer secret-access-token' }) }),
    )
    expect(JSON.parse(String(request.mock.calls[0]![1]!.body))).toMatchObject(fixture.outbound.text)
  })

  test('uploads PDF bytes privately and sends a WhatsApp document beside the authenticated link', async () => {
    const request = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) =>
      String(input).endsWith('/media') ? Response.json({ id: 'media-opaque-1' }) : new Response('{}', { status: 200 }))
    const adapter = new WhatsAppCloudAdapter({ withCredentials, fetch: request })
    const bytes = new TextEncoder().encode('%PDF-snapshot-v1')

    await adapter.sendDocument({
      conversationKey: fixture.outbound.conversationKey,
      bytes,
      filename: 'artifact.pdf',
      mimeType: 'application/pdf',
    })
    await adapter.sendArtifactLink({
      conversationKey: fixture.outbound.conversationKey,
      url: 'https://app.example.test/a/opaque-share-id',
    })

    expect(request).toHaveBeenCalledTimes(3)
    const upload = request.mock.calls[0]!
    expect(String(upload[0])).toBe('https://graph.facebook.com/v25.0/123456789/media')
    expect(upload[1]?.headers).toEqual({ authorization: 'Bearer secret-access-token' })
    expect(upload[1]?.body).toBeInstanceOf(FormData)
    const form = upload[1]!.body as FormData
    expect(form.get('messaging_product')).toBe('whatsapp')
    expect(form.get('type')).toBe('application/pdf')
    const file = form.get('file') as File
    expect(file.name).toBe('artifact.pdf')
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes)

    const document = JSON.parse(String(request.mock.calls[1]![1]!.body))
    expect(document).toMatchObject({
      to: fixture.outbound.conversationKey,
      type: 'document',
      document: { id: 'media-opaque-1', filename: 'artifact.pdf' },
    })
    expect(JSON.stringify(document)).not.toContain('secret-access-token')
    expect(JSON.parse(String(request.mock.calls[2]![1]!.body))).toMatchObject({
      type: 'text',
      text: { body: 'View artifact: https://app.example.test/a/opaque-share-id', preview_url: false },
    })
  })

  test('rejects secret-bearing artifact links and path-bearing document filenames before Graph calls', async () => {
    const request = vi.fn(async () => new Response('{}', { status: 200 }))
    const adapter = new WhatsAppCloudAdapter({ withCredentials, fetch: request })
    await expect(adapter.sendArtifactLink({ conversationKey: '1', url: 'https://app.example.test/a/id?token=secret' }))
      .rejects.toMatchObject({ retryable: false })
    await expect(adapter.sendDocument({ conversationKey: '1', bytes: new Uint8Array([1]), filename: '../quote.pdf', mimeType: 'application/pdf' }))
      .rejects.toMatchObject({ retryable: false })
    expect(request).not.toHaveBeenCalled()
  })

  test('sends the approved fallback template outside the service window', async () => {
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}', { status: 200 }))
    const adapter = new WhatsAppCloudAdapter({ withCredentials, fetch: request })
    expect(adapter.serviceWindowMs).toBe(86_400_000)
    await adapter.sendWindowTemplate({ conversationKey: fixture.outbound.conversationKey })
    expect(JSON.parse(String(request.mock.calls[0]![1]!.body))).toMatchObject(fixture.outbound.template)
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
