import type { FastifyInstance } from 'fastify'
import {
  ChannelArtifactDeliveryService,
  ChannelInboundMediaService,
  createAgentHostChannelRuntime,
  type AgentHostChannelRuntime,
  type AgentHostChannelStorage,
  type AuthorizedAgentScope,
  type ChannelBatchTranscriber,
  type ChannelHtmlToPdfRenderer,
  type ChannelInboundMediaRuntime,
  type CreatedAgentHost,
  type ProvisionChannelBindingInput,
} from '@hachej/boring-agent/server'
import type { AgentGateway, ShareEntryStore, Workspace } from '@hachej/boring-agent/shared'
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
  /** Test/host transport injection; defaults to global fetch. */
  readonly graphFetch?: typeof fetch
  /** Host-owned authenticated PDF authority; Core supplies the active runtime Workspace. */
  readonly artifactDelivery?: {
    readonly authenticatedOrigin: string
    readonly renderer: ChannelHtmlToPdfRenderer
  }
  /** Bound CH/EU Workspace retention plus a same-region self-hosted batch transcriber. */
  readonly inboundMedia?: {
    readonly storageRegion: ChannelInboundMediaRuntime['storageRegion']
    readonly transcriber: ChannelBatchTranscriber
  }
}

export interface MountedCoreWhatsAppChannel {
  readonly runtime: AgentHostChannelRuntime<WhatsAppCloudMessage>
  readonly webhookPath: string
  close(): Promise<void>
}

type ChannelWorkspaceBinding = {
  readonly workspaceId: string
  readonly authSubjectId: string
  readonly agentTypeId: string
}

type WithAuthorizedChannelWorkspace = <T>(
  binding: ChannelWorkspaceBinding,
  use: (workspace: Workspace) => Promise<T>,
) => Promise<T>

/**
 * Adapts Core membership authority to Agent Host's public Environment lease.
 * This is the only production Workspace source for channel media and artifacts,
 * so remote runtime modes cannot diverge from a reconstructed host filesystem.
 */
export function createCoreWhatsAppWorkspaceRunner(input: {
  readonly agentHost: Pick<CreatedAgentHost, 'acquireEnvironment'>
  readonly resolveAuthorizedScope: (binding: ChannelWorkspaceBinding) => Promise<AuthorizedAgentScope>
}): WithAuthorizedChannelWorkspace {
  return async (binding, use) => {
    const authorizedScope = await input.resolveAuthorizedScope(binding)
    const lease = await input.agentHost.acquireEnvironment({
      authorizedScope,
      intent: {
        kind: 'dispatcher',
        requestId: `channel-workspace:${binding.agentTypeId}:${binding.workspaceId}`,
      },
    })
    try {
      return await use(lease.workspace)
    } finally {
      lease.release()
    }
  }
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
  /** Must be the same store mounted by the authenticated `/a/:id` route. */
  readonly shareEntryStore?: ShareEntryStore
  readonly resolveAuthorizedScope: (binding: {
    readonly workspaceId: string
    readonly authSubjectId: string
    readonly agentTypeId: string
  }) => Promise<AuthorizedAgentScope>
  /** Core-owned bridge to the exact runtime-mode Workspace generation used by the Agent Host. */
  readonly withAuthorizedWorkspace: WithAuthorizedChannelWorkspace
  readonly options: CoreWhatsAppChannelOptions
}): Promise<MountedCoreWhatsAppChannel> {
  const configured = input.options.provisionedBindings ?? []
  const configuredKeys = new Set<string>()
  for (const binding of configured) {
    if (configuredKeys.has(binding.conversationKey)) {
      throw new Error(`Duplicate WhatsApp provisioned binding: ${binding.conversationKey}`)
    }
    configuredKeys.add(binding.conversationKey)
  }
  // Reconcile the authoritative provisioned set before services resume durable
  // queues. Removed senders and bindings under an old configured Agent fail closed.
  for (const current of input.storage.bindings.activeBindings()) {
    if (current.channel !== WHATSAPP_CHANNEL_ID) continue
    if (current.agentTypeId === input.options.agentTypeId && configuredKeys.has(current.conversationKey)) continue
    input.storage.bindings.provision({
      channel: current.channel,
      conversationKey: current.conversationKey,
      agentTypeId: current.agentTypeId,
      workspaceId: current.workspaceId,
      authSubjectId: current.authSubjectId,
      status: 'revoked',
      sessionKey: current.sessionKey,
      outboundCursor: current.outboundCursor,
    })
  }
  for (const binding of configured) {
    const current = input.storage.bindings.getBinding(
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
    input.storage.bindings.provision({
      ...binding,
      channel: WHATSAPP_CHANNEL_ID,
      agentTypeId: input.options.agentTypeId,
    })
  }

  const adapterEdge = createWhatsAppCloudEdge({
    withCredentials: input.options.withCredentials,
    agentTypeId: input.options.agentTypeId,
    // Assigned after runtime construction; webhook traffic cannot arrive before Fastify is ready.
    inbound: { accept: (message, agentTypeId) => runtime.acceptInbound(message, agentTypeId) },
    ...(input.options.bodyLimit === undefined ? {} : { bodyLimit: input.options.bodyLimit }),
    ...(input.options.graphFetch ? { fetch: input.options.graphFetch } : {}),
  })
  const artifactPublisher = input.options.artifactDelivery && input.shareEntryStore
    ? new ChannelArtifactDeliveryService(
        input.shareEntryStore,
        {
          async authorize(binding) {
            await input.resolveAuthorizedScope(binding)
          },
          async withWorkspace(binding, use) {
            return await input.withAuthorizedWorkspace(binding, use)
          },
        },
        input.options.artifactDelivery.renderer,
        adapterEdge.adapter,
        { authenticatedOrigin: input.options.artifactDelivery.authenticatedOrigin },
      )
    : undefined
  if (input.options.artifactDelivery && !artifactPublisher) {
    throw new Error('WhatsApp artifact delivery requires the authenticated share-entry store')
  }
  const inboundMedia = input.options.inboundMedia
    ? new ChannelInboundMediaService(
        {
          storageRegion: input.options.inboundMedia.storageRegion,
          async withWorkspace(binding, use) {
            // Reissue current app membership authority and acquire the Agent Host's active
            // runtime-mode Workspace before any media byte is downloaded or retained.
            return await input.withAuthorizedWorkspace(binding, use)
          },
        },
        new Map([[WHATSAPP_CHANNEL_ID, adapterEdge.adapter]]),
        input.options.inboundMedia.transcriber,
      )
    : undefined
  const runtime = createAgentHostChannelRuntime<WhatsAppCloudMessage>({
    gateway: input.gateway,
    storage: input.storage,
    resolveAuthorizedScope: input.resolveAuthorizedScope,
    outboundAdapters: new Map([[WHATSAPP_CHANNEL_ID, adapterEdge.adapter]]),
    ...(artifactPublisher ? { outbound: { artifactPublisher } } : {}),
    ...(inboundMedia ? { inboundMedia } : {}),
  })
  const webhookPath = input.options.webhookPath ?? CORE_WHATSAPP_WEBHOOK_PATH
  const bodyLimit = input.options.bodyLimit ?? WHATSAPP_WEBHOOK_BODY_LIMIT
  try {
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
