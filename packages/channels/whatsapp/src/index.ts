import {
  shapeChannelText,
  type ChannelOutboundAdapter,
  type ChannelOutboundTurn,
  type InboundChannelMessage,
  withResolvedCredential,
} from '@hachej/boring-agent/server'
import type {
  AuthorizedWorkspaceCredentialScopeV1,
  CredentialFieldId,
  ProviderCredentialRefV1,
  WorkspaceCredentialResolverV1,
} from '@hachej/boring-agent/shared'

export const WHATSAPP_CHANNEL_ID = 'whatsapp'
export const WHATSAPP_WEBHOOK_BODY_LIMIT = 1_048_576
export const WHATSAPP_GRAPH_API_ORIGIN = 'https://graph.facebook.com'
export const WHATSAPP_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1_000

export interface WhatsAppCloudCredentials {
  readonly accessToken: string
  readonly appSecret: string
  readonly verifyToken: string
  readonly phoneNumberId: string
  readonly apiVersion?: string
  readonly fallbackTemplateName: string
  readonly fallbackTemplateLanguage?: string
}

/** Host-owned resolver. Implement it with server/credentials; never environment reads in this package. */
export type ResolveWhatsAppCloudCredentials = () => Promise<WhatsAppCloudCredentials>

export interface WhatsAppCredentialFieldMap {
  readonly accessToken: CredentialFieldId
  readonly appSecret: CredentialFieldId
  readonly verifyToken: CredentialFieldId
  readonly phoneNumberId: CredentialFieldId
  readonly apiVersion?: CredentialFieldId
  readonly fallbackTemplateName: CredentialFieldId
  readonly fallbackTemplateLanguage?: CredentialFieldId
}

/** Creates a short-lived provider resolver backed by the host credential lease. */
export function createWhatsAppCloudCredentialResolver(input: {
  readonly resolver: WorkspaceCredentialResolverV1
  readonly workspace: AuthorizedWorkspaceCredentialScopeV1
  readonly ref: ProviderCredentialRefV1
  readonly fields: WhatsAppCredentialFieldMap
}): ResolveWhatsAppCloudCredentials {
  return () => withResolvedCredential(input.resolver, input.workspace, input.ref, (lease) => {
    if (lease.material.kind !== 'field-set') throw new Error('WhatsApp credentials require field-set material')
    const read = (field: CredentialFieldId, required: boolean): string | undefined => {
      const value = lease.material.kind === 'field-set' ? lease.material.fields.get(field) : undefined
      const decoded = value ? new TextDecoder().decode(value) : ''
      if (required && decoded.length === 0) throw new Error(`Missing required WhatsApp credential field: ${field}`)
      return decoded || undefined
    }
    return {
      accessToken: read(input.fields.accessToken, true)!,
      appSecret: read(input.fields.appSecret, true)!,
      verifyToken: read(input.fields.verifyToken, true)!,
      phoneNumberId: read(input.fields.phoneNumberId, true)!,
      fallbackTemplateName: read(input.fields.fallbackTemplateName, true)!,
      ...(input.fields.apiVersion ? { apiVersion: read(input.fields.apiVersion, false) } : {}),
      ...(input.fields.fallbackTemplateLanguage
        ? { fallbackTemplateLanguage: read(input.fields.fallbackTemplateLanguage, false) }
        : {}),
    }
  })
}

export interface WhatsAppCloudMessage {
  readonly messaging_product: 'whatsapp'
  readonly recipient_type: 'individual'
  readonly to?: string
  readonly type: 'text' | 'template'
  readonly text?: { readonly body: string; readonly preview_url: false }
  readonly template?: {
    readonly name: string
    readonly language: { readonly code: string }
  }
}

export interface WhatsAppWebhookInput {
  readonly method: 'GET' | 'POST'
  readonly url: string
  readonly headers?: Readonly<Record<string, string | undefined>>
  readonly body?: Uint8Array
}

export interface WhatsAppWebhookResult {
  readonly status: number
  readonly body: string
  readonly contentType: 'text/plain' | 'application/json'
}

export interface WhatsAppWebhookHandlerOptions {
  readonly credentials: ResolveWhatsAppCloudCredentials
  /** Must durably enqueue before resolving; the HTTP 200 is the acknowledgement boundary. */
  readonly acceptInbound: (message: InboundChannelMessage) => unknown | Promise<unknown>
  readonly bodyLimit?: number
  readonly now?: () => number
}

export interface WhatsAppCloudAdapterOptions {
  readonly credentials: ResolveWhatsAppCloudCredentials
  readonly fetch?: typeof fetch
  readonly graphApiOrigin?: string
}

export interface WhatsAppCloudEdgeOptions extends WhatsAppCloudAdapterOptions {
  readonly agentTypeId: string
  readonly inbound: {
    accept(message: InboundChannelMessage, agentTypeId: string): unknown | Promise<unknown>
  }
  readonly bodyLimit?: number
  readonly now?: () => number
}

/** Host composition seam: one credential resolver powers challenge, signature, and Graph sends. */
export function createWhatsAppCloudEdge(options: WhatsAppCloudEdgeOptions) {
  const adapter = new WhatsAppCloudAdapter(options)
  const webhook = createWhatsAppFetchHandler({
    credentials: options.credentials,
    acceptInbound: (message) => options.inbound.accept(message, options.agentTypeId),
    ...(options.bodyLimit === undefined ? {} : { bodyLimit: options.bodyLimit }),
    ...(options.now === undefined ? {} : { now: options.now }),
  })
  return { adapter, webhook }
}

export class WhatsAppCloudApiError extends Error {
  readonly retryable: boolean
  readonly status: number

  constructor(status: number, retryable: boolean) {
    super(`WhatsApp Cloud API request failed (${status})`)
    this.name = 'WhatsAppCloudApiError'
    this.status = status
    this.retryable = retryable
  }
}

export class WhatsAppCloudAdapter implements ChannelOutboundAdapter<WhatsAppCloudMessage> {
  readonly serviceWindowMs = WHATSAPP_SERVICE_WINDOW_MS
  private readonly request: typeof fetch
  private readonly origin: string

  constructor(private readonly options: WhatsAppCloudAdapterOptions) {
    this.request = options.fetch ?? fetch
    this.origin = (options.graphApiOrigin ?? WHATSAPP_GRAPH_API_ORIGIN).replace(/\/$/, '')
  }

  renderOutbound(turn: ChannelOutboundTurn): readonly WhatsAppCloudMessage[] {
    return shapeChannelText(turn.text, 'whatsapp/markdown', 4_096).map((body) => ({
      messaging_product: 'whatsapp' as const,
      recipient_type: 'individual' as const,
      type: 'text' as const,
      text: { body, preview_url: false as const },
    }))
  }

  async send(input: { readonly conversationKey: string; readonly message: WhatsAppCloudMessage }): Promise<void> {
    await this.sendPayload({ ...input.message, to: input.conversationKey })
  }

  async sendWindowTemplate(input: { readonly conversationKey: string }): Promise<void> {
    const credentials = await this.options.credentials()
    await this.sendPayload({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: input.conversationKey,
      type: 'template',
      template: {
        name: credentials.fallbackTemplateName,
        language: { code: credentials.fallbackTemplateLanguage ?? 'en' },
      },
    }, credentials)
  }

  private async sendPayload(message: WhatsAppCloudMessage, supplied?: WhatsAppCloudCredentials): Promise<void> {
    const credentials = supplied ?? await this.options.credentials()
    const apiVersion = credentials.apiVersion ?? 'v25.0'
    if (!/^v\d+\.\d+$/.test(apiVersion) || !/^\d+$/.test(credentials.phoneNumberId)) {
      throw new WhatsAppCloudApiError(0, false)
    }
    const response = await this.request(
      `${this.origin}/${apiVersion}/${credentials.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${credentials.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(message),
      },
    )
    if (!response.ok) {
      // Retry throttling and server errors. Auth, schema, and policy failures park immediately.
      throw new WhatsAppCloudApiError(response.status, response.status === 408 || response.status === 429 || response.status >= 500)
    }
  }
}

export function createWhatsAppFetchHandler(options: WhatsAppWebhookHandlerOptions) {
  const handle = createWhatsAppWebhookHandler(options)
  return async (request: Request): Promise<Response> => {
    const method = request.method.toUpperCase()
    if (method !== 'GET' && method !== 'POST') return new Response('method not allowed', { status: 405 })
    const announcedLength = Number(request.headers.get('content-length') ?? 0)
    const limit = options.bodyLimit ?? WHATSAPP_WEBHOOK_BODY_LIMIT
    if (Number.isFinite(announcedLength) && announcedLength > limit) return new Response('payload too large', { status: 413 })
    const body = method === 'POST' ? new Uint8Array(await request.arrayBuffer()) : undefined
    const handled = await handle({
      method,
      url: request.url,
      headers: Object.fromEntries(request.headers.entries()),
      ...(body ? { body } : {}),
    })
    return new Response(handled.body, { status: handled.status, headers: { 'content-type': handled.contentType } })
  }
}

export function createWhatsAppWebhookHandler(options: WhatsAppWebhookHandlerOptions) {
  return async (input: WhatsAppWebhookInput): Promise<WhatsAppWebhookResult> => {
    const credentials = await options.credentials()
    if (input.method === 'GET') return verifyChallenge(input.url, credentials.verifyToken)

    const body = input.body ?? new Uint8Array()
    if (body.byteLength > (options.bodyLimit ?? WHATSAPP_WEBHOOK_BODY_LIMIT)) {
      return result(413, 'payload too large')
    }
    const signature = header(input.headers, 'x-hub-signature-256')
    if (!signature || !await verifySignature(body, signature, credentials.appSecret)) {
      return result(401, 'invalid signature')
    }

    let payload: unknown
    try {
      payload = JSON.parse(new TextDecoder().decode(body))
    } catch {
      return result(400, 'invalid json')
    }
    const messages = parseWhatsAppInbound(payload, options.now?.() ?? Date.now())
    for (const message of messages) await options.acceptInbound(message)
    return result(200, JSON.stringify({ accepted: messages.length }), 'application/json')
  }
}

export function parseWhatsAppInbound(payload: unknown, receivedAt = Date.now()): InboundChannelMessage[] {
  if (!isRecord(payload) || payload.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) return []
  const output: InboundChannelMessage[] = []
  for (const entry of payload.entry) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) continue
    for (const change of entry.changes) {
      if (!isRecord(change) || change.field !== 'messages' || !isRecord(change.value) || !Array.isArray(change.value.messages)) continue
      for (const message of change.value.messages) {
        if (!isRecord(message) || typeof message.id !== 'string' || typeof message.from !== 'string') continue
        const text = inboundText(message)
        if (text === undefined) continue
        const timestamp = typeof message.timestamp === 'string' && /^\d+$/.test(message.timestamp)
          ? Number(message.timestamp) * 1_000
          : receivedAt
        output.push({
          channel: WHATSAPP_CHANNEL_ID,
          conversationKey: message.from,
          providerMessageId: message.id,
          text,
          receivedAt: Number.isSafeInteger(timestamp) ? timestamp : receivedAt,
        })
      }
    }
  }
  return output
}

export async function verifySignature(body: Uint8Array, signature: string, appSecret: string): Promise<boolean> {
  if (!/^sha256=[0-9a-f]{64}$/.test(signature)) return false
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const rawBody = Uint8Array.from(body).buffer
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, rawBody))
  return constantTimeEqual(digest, decodeHex(signature.slice(7)))
}

function verifyChallenge(url: string, verifyToken: string): WhatsAppWebhookResult {
  const query = new URL(url, 'https://webhook.invalid').searchParams
  const challenge = query.get('hub.challenge')
  const supplied = query.get('hub.verify_token')
  if (query.get('hub.mode') !== 'subscribe' || challenge === null || supplied === null
    || !constantTimeEqual(new TextEncoder().encode(supplied), new TextEncoder().encode(verifyToken))) {
    return result(403, 'verification failed')
  }
  return result(200, challenge)
}

function inboundText(message: Record<string, unknown>): string | undefined {
  if (message.type === 'text' && isRecord(message.text) && typeof message.text.body === 'string') return message.text.body
  if (message.type === 'interactive' && isRecord(message.interactive)) {
    const choice = message.interactive.type === 'button_reply' ? message.interactive.button_reply : message.interactive.list_reply
    if (isRecord(choice)) {
      if (typeof choice.id === 'string') return choice.id
      if (typeof choice.title === 'string') return choice.title
    }
  }
  return undefined
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.byteLength ^ right.byteLength
  const length = Math.max(left.byteLength, right.byteLength)
  for (let index = 0; index < length; index += 1) difference |= (left[index] ?? 0) ^ (right[index] ?? 0)
  return difference === 0
}

function decodeHex(value: string): Uint8Array {
  const output = new Uint8Array(value.length / 2)
  for (let index = 0; index < output.length; index += 1) output[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  return output
}

function header(headers: WhatsAppWebhookInput['headers'], name: string): string | undefined {
  if (!headers) return undefined
  const target = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) if (key.toLowerCase() === target) return value
  return undefined
}

function result(status: number, body: string, contentType: WhatsAppWebhookResult['contentType'] = 'text/plain'): WhatsAppWebhookResult {
  return { status, body, contentType }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
