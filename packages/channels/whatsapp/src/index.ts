import type {
  ChannelMediaDownload,
  ChannelMediaDownloader,
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
  readonly type: 'text' | 'template' | 'document'
  readonly text?: { readonly body: string; readonly preview_url: false }
  readonly document?: {
    readonly id: string
    readonly filename: string
  }
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
  readonly mediaDownloadTimeoutMs?: number
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

export class WhatsAppCloudAdapter implements ChannelOutboundAdapter<WhatsAppCloudMessage>, ChannelMediaDownloader {
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

  async download(input: { readonly mediaId: string; readonly maxBytes: number }): Promise<ChannelMediaDownload> {
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(input.mediaId) || !Number.isSafeInteger(input.maxBytes) || input.maxBytes <= 0) {
      throw new WhatsAppCloudApiError(0, false)
    }
    return await this.options.withCredentials(async (credentials) => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.options.mediaDownloadTimeoutMs ?? 15_000)
      try {
      const apiVersion = credentials.apiVersion ?? 'v25.0'
      if (!/^v\d+\.\d+$/.test(apiVersion)) throw new WhatsAppCloudApiError(0, false)
      const metadata = await this.authenticatedRequest(`${this.origin}/${apiVersion}/${input.mediaId}`, credentials.accessToken, controller.signal)
      if (!metadata.ok) throw await this.apiError(metadata)
      const value: unknown = await metadata.json().catch(() => undefined)
      if (!isRecord(value) || typeof value.url !== 'string' || typeof value.mime_type !== 'string') {
        throw new WhatsAppCloudApiError(metadata.status, false)
      }
      const url = safeMediaUrl(value.url)
      const response = await this.authenticatedRequest(url, credentials.accessToken, controller.signal)
      if (!response.ok) throw await this.apiError(response)
      const mimeType = (response.headers.get('content-type') ?? '').split(';', 1)[0]!.toLowerCase()
      if (mimeType !== value.mime_type.split(';', 1)[0]!.toLowerCase()) throw new WhatsAppCloudApiError(response.status, false)
      const announced = Number(response.headers.get('content-length') ?? 0)
      if (Number.isFinite(announced) && announced > input.maxBytes) throw new WhatsAppCloudApiError(413, false)
      if (response.url) safeMediaUrl(response.url)
      const bytes = await readBoundedResponse(response, input.maxBytes)
      return { bytes, mimeType }
      } finally {
        clearTimeout(timer)
      }
    })
  }

  async send(input: { readonly conversationKey: string; readonly message: WhatsAppCloudMessage }): Promise<void> {
    await this.options.withCredentials((credentials) =>
      this.sendPayload({ ...input.message, to: input.conversationKey }, credentials))
  }

  async sendDocument(input: {
    readonly conversationKey: string
    readonly bytes: Uint8Array
    readonly filename: string
    readonly mimeType: 'application/pdf'
  }): Promise<void> {
    if (input.filename !== 'artifact.pdf' || input.bytes.byteLength === 0) {
      throw new WhatsAppCloudApiError(0, false)
    }
    await this.options.withCredentials(async (credentials) => {
      const mediaId = await this.uploadDocument(input.bytes, input.filename, input.mimeType, credentials)
      await this.sendPayload({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: input.conversationKey,
        type: 'document',
        document: { id: mediaId, filename: input.filename },
      }, credentials)
    })
  }

  async sendArtifactLink(input: { readonly conversationKey: string; readonly url: string }): Promise<void> {
    let parsed: URL
    try {
      parsed = new URL(input.url)
    } catch {
      throw new WhatsAppCloudApiError(0, false)
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new WhatsAppCloudApiError(0, false)
    }
    await this.send({
      conversationKey: input.conversationKey,
      message: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        type: 'text',
        text: { body: `Download artifact: ${parsed.toString()}`, preview_url: false },
      },
    })
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

  private async authenticatedRequest(url: string, accessToken: string, signal: AbortSignal): Promise<Response> {
    try {
      return await this.request(url, { headers: { authorization: `Bearer ${accessToken}` }, signal, redirect: 'manual' })
    } catch {
      throw new WhatsAppCloudApiError(0, true)
    }
  }

  private async uploadDocument(
    bytes: Uint8Array,
    filename: string,
    mimeType: 'application/pdf',
    credentials: WhatsAppCloudCredentials,
  ): Promise<string> {
    const endpoint = this.graphEndpoint(credentials, 'media')
    const form = new FormData()
    form.set('messaging_product', 'whatsapp')
    form.set('type', mimeType)
    form.set('file', new Blob([Uint8Array.from(bytes)], { type: mimeType }), filename)
    let response: Response
    try {
      response = await this.request(endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${credentials.accessToken}` },
        body: form,
      })
    } catch {
      throw new WhatsAppCloudApiError(0, true)
    }
    if (!response.ok) throw await this.apiError(response)
    const payload: unknown = await response.json().catch(() => undefined)
    if (!isRecord(payload) || typeof payload.id !== 'string' || !payload.id) {
      throw new WhatsAppCloudApiError(response.status, false)
    }
    return payload.id
  }

  private async sendPayload(message: WhatsAppCloudMessage, credentials: WhatsAppCloudCredentials): Promise<void> {
    const endpoint = this.graphEndpoint(credentials, 'messages')
    let response: Response
    try {
      response = await this.request(endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${credentials.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(message),
      })
    } catch {
      throw new WhatsAppCloudApiError(0, true)
    }
    if (!response.ok) throw await this.apiError(response)
  }

  private graphEndpoint(credentials: WhatsAppCloudCredentials, resource: 'media' | 'messages'): string {
    const apiVersion = credentials.apiVersion ?? 'v25.0'
    if (!/^v\d+\.\d+$/.test(apiVersion) || !/^\d+$/.test(credentials.phoneNumberId)) {
      throw new WhatsAppCloudApiError(0, false)
    }
    return `${this.origin}/${apiVersion}/${credentials.phoneNumberId}/${resource}`
  }

  private async apiError(response: Response): Promise<WhatsAppCloudApiError> {
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
    return new WhatsAppCloudApiError(response.status, retryable)
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
        const media = inboundMedia(message)
        if (text === undefined && media === undefined) {
          if (message.type === 'text' || message.type === 'interactive' || message.type === 'image' || message.type === 'audio' || message.type === 'document') {
            throw new Error('Invalid supported WhatsApp message')
          }
          continue
        }
        const timestamp = typeof message.timestamp === 'string' && /^\d+$/.test(message.timestamp)
          ? Number(message.timestamp) * 1_000
          : receivedAt
        output.push({
          channel: WHATSAPP_CHANNEL_ID,
          conversationKey: message.from,
          providerMessageId: message.id,
          text: text ?? '',
          receivedAt: Number.isSafeInteger(timestamp) ? timestamp : receivedAt,
          ...(media ? { media } : {}),
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

function inboundMedia(message: Record<string, unknown>): InboundChannelMessage['media'] {
  if (message.type !== 'image' && message.type !== 'audio' && message.type !== 'document') return undefined
  const payload = message[message.type]
  if (!isRecord(payload) || typeof payload.id !== 'string' || !payload.id) return undefined
  const kind = message.type === 'image' ? 'image' : message.type === 'audio' ? 'audio' : 'document'
  return {
    kind,
    mediaId: payload.id,
    ...(typeof payload.mime_type === 'string' ? { declaredMimeType: payload.mime_type } : {}),
  }
}

function inboundText(message: Record<string, unknown>): string | undefined {
  if ((message.type === 'image' || message.type === 'document') && isRecord(message[message.type])
    && typeof (message[message.type] as Record<string, unknown>).caption === 'string') {
    return (message[message.type] as Record<string, unknown>).caption as string
  }
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

function safeMediaUrl(value: string): string {
  let url: URL
  try { url = new URL(value) } catch { throw new WhatsAppCloudApiError(0, false) }
  const host = url.hostname.toLowerCase()
  const allowed = ['facebook.com', 'fbcdn.net', 'fbsbx.com', 'whatsapp.net']
  if (url.protocol !== 'https:' || url.username || url.password || !allowed.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) {
    throw new WhatsAppCloudApiError(0, false)
  }
  return url.toString()
}

async function readBoundedResponse(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) throw new WhatsAppCloudApiError(response.status, true)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const item = await reader.read()
      if (item.done) break
      size += item.value.byteLength
      if (size > maxBytes) {
        await reader.cancel()
        throw new WhatsAppCloudApiError(413, false)
      }
      chunks.push(item.value)
    }
  } catch (error) {
    if (error instanceof WhatsAppCloudApiError) throw error
    throw new WhatsAppCloudApiError(0, true)
  } finally {
    reader.releaseLock()
  }
  const output = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength }
  return output
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
