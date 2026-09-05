import { join } from 'node:path'
import type { AgentGateway, AuthorizedAgentScope } from '../../shared/gateway/types'
import type { OriginChannel } from '../../shared/channel'
import { ChannelBindingStore, type ChannelBinding, type InboundChannelMessage, type ProvisionChannelBindingInput } from '../channels/channelBindingStore'
import { ChannelInboundService, type ChannelAgentInvocation } from '../channels/channelInboundService'
import {
  ChannelOutboundService,
  type ChannelOutboundAdapter,
  type ChannelOutboundServiceOptions,
} from '../channels/channelOutboundService'
import { findSessionEventStream, SqliteEventStreamStore, type EventStreamStore } from '../events/eventStreamStore'
import { openDatabase } from '../events/sqlStorage'

export const CHANNEL_RUNTIME_FILE_NAME = '.agent-channel-runtime.sqlite'

export interface AgentHostChannelStorage {
  readonly bindings: ChannelBindingStore
  readonly events: EventStreamStore
  close(): void
}

/**
 * Opens the host-owned durable state shared by Agent Host event production and
 * channel delivery. App hosts pass `events` to their Agent Host composition and
 * the complete storage handle to {@link createAgentHostChannelRuntime}.
 */
export function createAgentHostChannelStorage(input: {
  readonly sessionRoot: string
  readonly fileName?: string
}): AgentHostChannelStorage {
  const opened = openDatabase(join(input.sessionRoot, input.fileName ?? CHANNEL_RUNTIME_FILE_NAME))
  let closed = false
  return {
    bindings: new ChannelBindingStore(opened.sql, opened.runTransaction),
    events: new SqliteEventStreamStore(opened.sql, opened.runTransaction),
    close() {
      if (closed) return
      closed = true
      opened.db.close()
    },
  }
}

export interface CreateAgentHostChannelRuntimeOptions<Message> {
  readonly gateway: AgentGateway
  readonly storage: AgentHostChannelStorage
  /** Reissues an app-owned capability after validating the durable binding. */
  readonly resolveAuthorizedScope: (binding: Pick<ChannelBinding,
    'workspaceId' | 'authSubjectId' | 'agentTypeId'>) => Promise<AuthorizedAgentScope>
  readonly outboundAdapters: ReadonlyMap<string, ChannelOutboundAdapter<Message>>
  readonly outbound?: ChannelOutboundServiceOptions
}

export interface AgentHostChannelRuntime<Message> {
  readonly bindings: ChannelBindingStore
  readonly events: EventStreamStore
  readonly outboundAdapters: ReadonlyMap<string, ChannelOutboundAdapter<Message>>
  provision(input: ProvisionChannelBindingInput): ChannelBinding
  /** Durable enqueue is the acknowledgement boundary; delivery continues asynchronously. */
  acceptInbound(message: InboundChannelMessage, agentTypeId: string): ReturnType<ChannelInboundService['accept']>
  waitForIdle(): Promise<void>
  close(): Promise<void>
}

/**
 * Concrete, provider-neutral app-host composition for channel state, session
 * invocation, durable event tails, outbound adapter lookup, restart recovery,
 * and lifecycle disposal. Provider packages only supply adapters and webhook
 * parsing; they never own workspace authority or durable state.
 */
export function createAgentHostChannelRuntime<Message>(
  options: CreateAgentHostChannelRuntimeOptions<Message>,
): AgentHostChannelRuntime<Message> {
  const adapters = new Map(options.outboundAdapters)
  let closed = false

  const withConnection = async <T>(
    binding: Pick<ChannelBinding, 'workspaceId' | 'authSubjectId' | 'agentTypeId'>,
    sessionKey: string,
    run: (connection: Awaited<ReturnType<AgentGateway['connectSession']>>) => Promise<T>,
  ): Promise<T> => {
    const scope = await options.resolveAuthorizedScope(binding)
    const connection = await options.gateway.connectSession({
      scope,
      ref: { agentTypeId: binding.agentTypeId, sessionId: sessionKey },
    })
    try {
      return await run(connection)
    } finally {
      await connection.close()
    }
  }

  let notifyOutbound = (_binding: ChannelBinding): void => {}
  const inbound = new ChannelInboundService(options.storage.bindings, {
    async createSession(input) {
      const scope = await options.resolveAuthorizedScope(input)
      const ref = await options.gateway.createSession({
        scope,
        agentTypeId: input.agentTypeId,
        requestId: input.requestId,
        originChannel: input.originChannel,
      })
      return ref.sessionId
    },
    async isSessionBusy(input) {
      const scope = await options.resolveAuthorizedScope(input)
      const snapshot = await options.gateway.readSessionState({
        scope,
        ref: { agentTypeId: input.agentTypeId, sessionId: input.sessionKey },
      })
      return snapshot.summary.status === 'running' || snapshot.summary.status === 'aborting'
    },
    prompt(input) {
      return sendToSession(input, 'prompt')
    },
    followUp(input) {
      return sendToSession(input, 'followup')
    },
  }, {
    onInboundDelivered: (binding) => notifyOutbound(binding),
  })

  async function sendToSession(input: ChannelAgentInvocation, kind: 'prompt' | 'followup'): Promise<void> {
    await withConnection(input, input.sessionKey, async (connection) => {
      if (kind === 'prompt') {
        await connection.send({
          kind,
          requestId: input.requestId,
          clientNonce: input.requestId,
          content: input.text,
        })
      } else {
        await connection.send({
          kind,
          requestId: input.requestId,
          clientNonce: input.requestId,
          clientSeq: input.deliverySequence,
          content: input.text,
        })
      }
    })
  }

  const outbound = new ChannelOutboundService(
    options.storage.bindings,
    options.storage.events,
    {
      async resolveStreamPath(binding) {
        if (!binding.sessionKey) return undefined
        await options.resolveAuthorizedScope(binding)
        const path = await findSessionEventStream(options.storage.events, {
          workspaceScopeId: binding.workspaceId,
          sessionId: binding.sessionKey,
        })
        if (!path) return undefined
        const owner = await options.storage.events.readStreamOwner(path)
        if (owner?.agentTypeId !== binding.agentTypeId || owner.authSubjectId !== binding.authSubjectId) {
          return undefined
        }
        return path
      },
      async createSession(binding) {
        const scope = await options.resolveAuthorizedScope(binding)
        const ref = await options.gateway.createSession({
          scope,
          agentTypeId: binding.agentTypeId,
          requestId: `channel:recover:${JSON.stringify([
            binding.channel,
            binding.conversationKey,
            binding.agentTypeId,
            binding.bindingVersion,
          ])}`,
          originChannel: binding.channel as OriginChannel,
        })
        return ref.sessionId
      },
    },
    adapters,
    options.outbound,
  )
  notifyOutbound = (binding) => outbound.notifyInbound(binding)
  outbound.start()

  return {
    bindings: options.storage.bindings,
    events: options.storage.events,
    outboundAdapters: adapters,
    provision(input) {
      if (closed) throw new Error('Agent Host channel runtime is closed')
      return options.storage.bindings.provision(input)
    },
    acceptInbound(message, agentTypeId) {
      if (closed) throw new Error('Agent Host channel runtime is closed')
      const acknowledgement = inbound.accept(message, agentTypeId)
      if (acknowledgement.accepted) {
        void inbound.waitForIdle().then(() => {
          const binding = options.storage.bindings.getBinding(message.channel, message.conversationKey, agentTypeId)
          if (binding) outbound.notifyInbound(binding)
        })
      }
      return acknowledgement
    },
    async waitForIdle() {
      await inbound.waitForIdle()
      await outbound.waitForIdle()
    },
    async close() {
      if (closed) return
      closed = true
      await inbound.dispose()
      await outbound.dispose()
      // Storage is host-owned and may still back live Agent compositions.
      // The app closes the Agent Host first, then storage.close().
    },
  }
}
