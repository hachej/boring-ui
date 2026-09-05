import type { FastifyInstance } from 'fastify'
import {
  createAgentHostChannelRuntime,
  type AgentHostChannelRuntime,
  type AgentHostChannelStorage,
  type AuthorizedAgentScope,
  type ProvisionChannelBindingInput,
} from '@hachej/boring-agent/server'
import type { AgentGateway } from '@hachej/boring-agent/shared'
import {
  createWhatsAppCloudEdge,
  WHATSAPP_CHANNEL_ID,
  WHATSAPP_WEBHOOK_BODY_LIMIT,
  type WhatsAppCloudCredentials,
  type WhatsAppCloudMessage,
  type WithWhatsAppCloudCredentials,
} from '@hachej/channel-whatsapp'

export const CORE_WHATSAPP_WEBHOOK_PATH = '/api/channels/whatsapp/webhook'

export interface CoreWhatsAppChannelOptions {
  readonly withCredentials: WithWhatsAppCloudCredentials
  readonly agentTypeId: string
  /** Pilot bindings are provisioned by the trusted app host; unknown senders remain unbound. */
  readonly provisionedBindings?: readonly Omit<ProvisionChannelBindingInput, 'channel' | 'agentTypeId'>[]
  readonly webhookPath?: string
  readonly bodyLimit?: number
}

export interface MountedCoreWhatsAppChannel {
  readonly runtime: AgentHostChannelRuntime<WhatsAppCloudMessage>
  readonly webhookPath: string
  close(): Promise<void>
}

export function assertCoreWhatsAppAgentAvailable(
  options: CoreWhatsAppChannelOptions | undefined,
  agentTypeIds: readonly string[],
): void {
  if (options && !agentTypeIds.includes(options.agentTypeId)) {
    throw new Error(`WhatsApp channel Agent is not in the validated fleet: ${options.agentTypeId}`)
  }
}

/**
 * Mounts the Meta edge into the app-owned Fastify host. The caller owns storage,
 * workspace authorization, credentials, and lifecycle; the provider owns only
 * wire parsing and Graph delivery.
 */
export async function mountCoreWhatsAppChannel(input: {
  readonly app: FastifyInstance
  readonly gateway: AgentGateway
  readonly storage: AgentHostChannelStorage
  readonly resolveAuthorizedScope: (binding: {
    readonly workspaceId: string
    readonly authSubjectId: string
    readonly agentTypeId: string
  }) => Promise<AuthorizedAgentScope>
  readonly options: CoreWhatsAppChannelOptions
}): Promise<MountedCoreWhatsAppChannel> {
  const adapterEdge = createWhatsAppCloudEdge({
    withCredentials: input.options.withCredentials,
    agentTypeId: input.options.agentTypeId,
    // Assigned after runtime construction; webhook traffic cannot arrive before Fastify is ready.
    inbound: { accept: (message, agentTypeId) => runtime.acceptInbound(message, agentTypeId) },
    ...(input.options.bodyLimit === undefined ? {} : { bodyLimit: input.options.bodyLimit }),
  })
  const runtime = createAgentHostChannelRuntime<WhatsAppCloudMessage>({
    gateway: input.gateway,
    storage: input.storage,
    resolveAuthorizedScope: input.resolveAuthorizedScope,
    outboundAdapters: new Map([[WHATSAPP_CHANNEL_ID, adapterEdge.adapter]]),
  })
  const webhookPath = input.options.webhookPath ?? CORE_WHATSAPP_WEBHOOK_PATH
  const bodyLimit = input.options.bodyLimit ?? WHATSAPP_WEBHOOK_BODY_LIMIT
  try {
    for (const binding of input.options.provisionedBindings ?? []) {
      const current = runtime.bindings.getBinding(
        WHATSAPP_CHANNEL_ID,
        binding.conversationKey,
        input.options.agentTypeId,
      )
      // Startup config is declarative. Re-applying an unchanged binding must not
      // create a new generation, because acknowledged queue rows retain the old one.
      if (current
        && current.workspaceId === binding.workspaceId
        && current.authSubjectId === binding.authSubjectId
        && (binding.sessionKey === undefined || current.sessionKey === binding.sessionKey)
        && current.status === (binding.status ?? 'active')) continue
      runtime.provision({
        ...binding,
        channel: WHATSAPP_CHANNEL_ID,
        agentTypeId: input.options.agentTypeId,
      })
    }

    await input.app.register(async (routes) => {
      routes.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit }, (_request, body, done) => {
        done(null, body)
      })
      routes.route({
        method: ['GET', 'POST'],
        url: webhookPath,
        handler: async (request, reply) => {
          const method = request.method === 'GET' ? 'GET' : 'POST'
          const headers = new Headers()
          for (const [name, value] of Object.entries(request.headers)) {
            if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(',') : value)
          }
          const body = method === 'POST'
            ? request.body instanceof Uint8Array
              ? Uint8Array.from(request.body).buffer
              : new ArrayBuffer(0)
            : undefined
          const response = await adapterEdge.webhook(new Request(
            new URL(request.raw.url ?? webhookPath, 'http://channel.invalid'),
            { method, headers, ...(body === undefined ? {} : { body }) },
          ))
          reply.code(response.status).type(response.headers.get('content-type') ?? 'text/plain')
          return await response.text()
        },
      })
    })
  } catch (error) {
    await runtime.close()
    throw error
  }

  let closed = false
  return {
    runtime,
    webhookPath,
    async close() {
      if (closed) return
      closed = true
      await runtime.close()
    },
  }
}
