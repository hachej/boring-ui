import type {
  ChannelOutboundAdapter,
  ChannelOutboundTurn,
  InboundChannelMessage,
} from '@hachej/boring-agent/server'

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

/** Host-owned credential lease callback; secrets never escape its lifetime. */
export type WithWhatsAppCloudCredentials = <T>(
  use: (credentials: WhatsAppCloudCredentials) => T | Promise<T>,
) => Promise<T>

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
  readonly withCredentials: WithWhatsAppCloudCredentials
  /** Must durably enqueue before resolving; the HTTP 200 is the acknowledgement boundary. */
  readonly acceptInbound: (message: InboundChannelMessage) => unknown | Promise<unknown>
  readonly bodyLimit?: number
  readonly now?: () => number
}

export interface WhatsAppCloudAdapterOptions {
  readonly withCredentials: WithWhatsAppCloudCredentials
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
    withCredentials: options.withCredentials,
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
    return shapeWhatsAppText(turn.text, 4_096).map((body) => ({
      messaging_product: 'whatsapp' as const,
      recipient_type: 'individual' as const,
      type: 'text' as const,
      text: { body, preview_url: false as const },
    }))
  }

  async send(input: { readonly conversationKey: string; readonly message: WhatsAppCloudMessage }): Promise<void> {
    await this.options.withCredentials((credentials) =>
      this.sendPayload({ ...input.message, to: input.conversationKey }, credentials))
  }

  async sendWindowTemplate(input: { readonly conversationKey: string }): Promise<void> {
    await this.options.withCredentials((credentials) => this.sendPayload({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: input.conversationKey,
      type: 'template',
      template: {
        name: credentials.fallbackTemplateName,
        language: { code: credentials.fallbackTemplateLanguage ?? 'en' },
      },
    }, credentials))
  }

  private async sendPayload(message: WhatsAppCloudMessage, credentials: WhatsAppCloudCredentials): Promise<void> {
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
      let providerTransient = false
      let providerCode: number | undefined
      try {
        const payload: unknown = await response.json()
        if (isRecord(payload) && isRecord(payload.error)) {
          providerTransient = payload.error.is_transient === true
          providerCode = typeof payload.error.code === 'number' ? payload.error.code : undefined
        }
      } catch {
        // A non-JSON failure still has reliable HTTP retry semantics.
      }
      const transientCodes = new Set([1, 2, 4, 17, 32, 613, 80007])
      const retryable = providerTransient || (providerCode !== undefined && transientCodes.has(providerCode))
        || response.status === 408 || response.status === 429 || response.status >= 500
      throw new WhatsAppCloudApiError(response.status, retryable)
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
    const body = method === 'POST' ? await readRequestBody(request, limit) : undefined
    if (body === undefined && method === 'POST') return new Response('payload too large', { status: 413 })
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
  return async (input: WhatsAppWebhookInput): Promise<WhatsAppWebhookResult> => options.withCredentials(async (credentials) => {
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
    let messages: InboundChannelMessage[]
    try {
      messages = parseWhatsAppInbound(payload, options.now?.() ?? Date.now())
    } catch {
      return result(400, 'invalid envelope')
    }
    for (const message of messages) await options.acceptInbound(message)
    return result(200, JSON.stringify({ accepted: messages.length }), 'application/json')
  })
}

export function parseWhatsAppInbound(payload: unknown, receivedAt = Date.now()): InboundChannelMessage[] {
  if (!isRecord(payload) || payload.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) {
    throw new Error('Invalid WhatsApp webhook envelope')
  }
  const output: InboundChannelMessage[] = []
  for (const entry of payload.entry) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) throw new Error('Invalid WhatsApp webhook entry')
    for (const change of entry.changes) {
      if (!isRecord(change) || typeof change.field !== 'string' || !isRecord(change.value)) {
        throw new Error('Invalid WhatsApp webhook change')
      }
      if (change.field !== 'messages') continue
      if (!Array.isArray(change.value.messages)) {
        if (Array.isArray(change.value.statuses)) continue
        throw new Error('Invalid WhatsApp messages change')
      }
      for (const message of change.value.messages) {
        if (!isRecord(message) || typeof message.id !== 'string' || typeof message.from !== 'string'
          || typeof message.type !== 'string') throw new Error('Invalid WhatsApp message')
        const text = inboundText(message)
        if (text === undefined) {
          if (message.type === 'text' || message.type === 'interactive') throw new Error('Invalid supported WhatsApp message')
          continue
        }
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

async function readRequestBody(request: Request, limit: number): Promise<Uint8Array | undefined> {
  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > limit) {
        await reader.cancel()
        return undefined
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

function shapeWhatsAppText(text: string, maxLength: number): string[] {
  const rendered = renderWhatsAppMarkdown(text)
  const chunks: string[] = []
  let remaining = rendered
  while (remaining.length > maxLength) {
    let split = remaining.lastIndexOf('\n\n', maxLength)
    if (split < Math.floor(maxLength / 2)) split = remaining.lastIndexOf('\n', maxLength)
    if (split < Math.floor(maxLength / 2)) split = maxLength
    if (split > 0 && isHighSurrogate(remaining.charCodeAt(split - 1))) split -= 1
    let chunk = remaining.slice(0, split)
    remaining = remaining.slice(split).replace(/^\n+/, '')
    if ((chunk.match(/```/g) ?? []).length % 2 === 1) {
      const closeFence = '\n```'
      if (chunk.length + closeFence.length > maxLength) {
        let keep = maxLength - closeFence.length
        if (keep > 0 && isHighSurrogate(chunk.charCodeAt(keep - 1))) keep -= 1
        remaining = chunk.slice(keep) + remaining
        chunk = chunk.slice(0, keep)
      }
      chunk += closeFence
      remaining = `\`\`\`\n${remaining}`
    }
    chunks.push(chunk)
  }
  if (remaining.length > 0 || chunks.length === 0) chunks.push(remaining)
  return chunks
}

function renderWhatsAppMarkdown(text: string): string {
  let inFence = false
  return text.split(/(```)/g).map((section) => {
    if (section === '```') {
      inFence = !inFence
      return section
    }
    if (inFence) return section
    return section
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1_$2_')
      .replace(/\*\*([^*\n]+)\*\*/g, '*$1*')
  }).join('')
}

function isHighSurrogate(value: number): boolean {
  return value >= 0xd800 && value <= 0xdbff
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
