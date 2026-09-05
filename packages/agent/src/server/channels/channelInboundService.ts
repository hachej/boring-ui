import { randomUUID } from 'node:crypto'
import type { OriginChannel } from '../../shared/channel'
import { ErrorCode } from '../../shared/error-codes'
import { INBOUND_CLAIM_TTL_MS, type ChannelBinding, type ChannelBindingStore, type InboundChannelMessage } from './channelBindingStore'

export const CHANNEL_UNKNOWN_BINDING = ErrorCode.enum.CHANNEL_UNKNOWN_BINDING
export const CHANNEL_INBOUND_PARKED = ErrorCode.enum.CHANNEL_INBOUND_PARKED

export interface ChannelAdapter {
  readonly channelId: string
  parseInbound(request: Request): Promise<readonly InboundChannelMessage[]>
  renderOutbound(turn: unknown): readonly unknown[]
  send(message: unknown): Promise<void>
}

/**
 * Trusted, host-injected seam. Implementations resolve workspace membership
 * from the binding and never receive the adapter-owned conversation key.
 */
export interface ChannelAgentInvoker {
  createSession(input: {
    readonly workspaceId: string
    readonly authSubjectId: string
    readonly agentTypeId: string
    readonly originChannel: OriginChannel
  }): Promise<string>
  isSessionBusy(input: {
    readonly workspaceId: string
    readonly authSubjectId: string
    readonly agentTypeId: string
    readonly sessionKey: string
  }): Promise<boolean>
  /**
   * Implementations MUST durably deduplicate requestId and serialize
   * deliverySequence for a session before resolving. This is the downstream
   * fence that makes an expired queue lease safe to replay.
   */
  prompt(input: ChannelAgentInvocation): Promise<void>
  /** Same durable idempotency and sequence contract as prompt. */
  followUp(input: ChannelAgentInvocation): Promise<void>
}

export interface ChannelAgentInvocation {
  readonly workspaceId: string
  readonly authSubjectId: string
  readonly agentTypeId: string
  readonly sessionKey: string
  readonly requestId: string
  /** Monotonic durable queue id; stale/lower deliveries must be a no-op. */
  readonly deliverySequence: number
  readonly text: string
}

export type ChannelInboundAck =
  | { readonly accepted: true; readonly duplicate: boolean; readonly code: typeof ErrorCode.enum.CHANNEL_INBOUND_ACCEPTED }
  | { readonly accepted: false; readonly duplicate: boolean; readonly code: typeof CHANNEL_UNKNOWN_BINDING }

export class ChannelInboundService {
  private readonly drains = new Map<string, Promise<void>>()
  private readonly claimOwner = randomUUID()

  constructor(
    private readonly store: ChannelBindingStore,
    private readonly invoker: ChannelAgentInvoker,
    private readonly options: {
      readonly maxAttempts?: number
      readonly inboundClaimTtlMs?: number
      readonly drainRetryMs?: number
    } = {},
  ) {
    // Durable acknowledgement must not depend on a provider replay. The store
    // recovers interrupted claims during migration; every new service resumes
    // all active bindings with unfinished work.
    for (const binding of this.store.pendingBindings()) this.scheduleDrain(binding)
  }

  /** Durable enqueue is the acknowledgement boundary; agent work stays async. */
  accept(message: InboundChannelMessage, agentTypeId: string): ChannelInboundAck {
    const result = this.store.enqueueInbound(message, agentTypeId)
    if (result.disposition === 'duplicate') {
      // A provider replay may be the first request after a crash that happened
      // after commit but before the background drain started.
      if (result.binding) this.scheduleDrain(result.binding)
      return { accepted: true, duplicate: true, code: ErrorCode.enum.CHANNEL_INBOUND_ACCEPTED }
    }
    if (result.disposition === 'unknown_binding') {
      return { accepted: false, duplicate: false, code: CHANNEL_UNKNOWN_BINDING }
    }
    this.scheduleDrain(result.binding)
    return { accepted: true, duplicate: false, code: ErrorCode.enum.CHANNEL_INBOUND_ACCEPTED }
  }

  waitForIdle(): Promise<void> {
    return Promise.allSettled([...this.drains.values()]).then(() => undefined)
  }

  resume(binding: ChannelBinding): void {
    if (binding.status === 'active') this.scheduleDrain(binding)
  }

  private scheduleDrain(binding: ChannelBinding): void {
    const key = bindingKey(binding)
    if (this.drains.has(key)) return
    let failed = false
    const drain = Promise.resolve().then(() => this.drain(binding)).catch(() => {
      failed = true
    }).finally(() => {
      if (this.drains.get(key) === drain) this.drains.delete(key)
      if (failed) {
        setTimeout(() => this.scheduleDrain(binding), this.options.drainRetryMs ?? 50)
      }
    })
    this.drains.set(key, drain)
  }

  private async drain(initialBinding: ChannelBinding): Promise<void> {
    let binding = initialBinding
    for (;;) {
      const claimTtlMs = this.options.inboundClaimTtlMs ?? INBOUND_CLAIM_TTL_MS
      let claimed
      try {
        claimed = this.store.nextPending(
          binding.channel,
          binding.conversationKey,
          binding.agentTypeId,
          this.claimOwner,
          claimTtlMs,
        )
      } catch {
        await delay(this.options.drainRetryMs ?? 50)
        continue
      }
      if (claimed.disposition === 'empty') return
      if (claimed.disposition === 'blocked') {
        await delay(Math.max(1, claimed.retryAt - Date.now()))
        continue
      }
      const queued = claimed.inbound
      binding = this.store.getBinding(binding.channel, binding.conversationKey, binding.agentTypeId) ?? binding
      if (binding.status !== 'active' || binding.bindingVersion !== queued.bindingVersion
        || binding.workspaceId !== queued.workspaceId || binding.authSubjectId !== queued.authSubjectId) {
        // Queue rows are tenant snapshots. Re-provisioning creates a new
        // generation and can never redirect already accepted content.
        this.store.parkInbound(queued.id, ErrorCode.enum.CHANNEL_BINDING_REVOKED, queued.claimOwner)
        continue
      }
      let claimLost = false
      const heartbeat = setInterval(() => {
        try {
          if (!this.store.renewInbound(queued.id, queued.claimOwner, claimTtlMs)) claimLost = true
        } catch {
          // The downstream sequence fence makes a replay safe, but this owner
          // must stop advancing the binding after it loses renewal.
          claimLost = true
        }
      }, Math.max(1, Math.floor(claimTtlMs / 3)))
      try {
        const ensured = await this.store.ensureSession(binding, {
          allocate: () => this.invoker.createSession({
            workspaceId: binding.workspaceId,
            authSubjectId: binding.authSubjectId,
            agentTypeId: binding.agentTypeId,
            originChannel: binding.channel,
          }),
          admit: async (sessionKey) => this.invoker.prompt(invocation(binding, sessionKey, queued)),
        })
        if (!ensured.created) {
          const call = invocation(binding, ensured.sessionKey, queued)
          const busy = await this.invoker.isSessionBusy({
            workspaceId: binding.workspaceId,
            authSubjectId: binding.authSubjectId,
            agentTypeId: binding.agentTypeId,
            sessionKey: ensured.sessionKey,
          })
          await (busy ? this.invoker.followUp(call) : this.invoker.prompt(call))
        }
        if (claimLost || !this.store.completeInbound(queued.id, queued.claimOwner)) {
          // The row remains durably processing until its last possible lease
          // expires. Stay alive and reclaim it without requiring new inbound.
          await delay(claimTtlMs)
          continue
        }
        binding = this.store.getBinding(binding.channel, binding.conversationKey, binding.agentTypeId) ?? binding
      } catch (error) {
        const code = stableErrorCode(error)
        if (queued.attempts < (this.options.maxAttempts ?? 3)) {
          this.store.retryInbound(queued.id, queued.claimOwner, code)
        } else {
          this.store.parkInbound(queued.id, code || CHANNEL_INBOUND_PARKED, queued.claimOwner)
        }
      } finally {
        clearInterval(heartbeat)
      }
    }
  }
}

function invocation(
  binding: ChannelBinding,
  sessionKey: string,
  queued: { id: number; providerMessageId: string; text: string },
): ChannelAgentInvocation {
  return {
    workspaceId: binding.workspaceId,
    authSubjectId: binding.authSubjectId,
    agentTypeId: binding.agentTypeId,
    sessionKey,
    requestId: `channel:${binding.channel}:${queued.providerMessageId}`,
    deliverySequence: queued.id,
    text: queued.text,
  }
}

function bindingKey(binding: ChannelBinding): string {
  return JSON.stringify([binding.channel, binding.conversationKey, binding.agentTypeId])
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function stableErrorCode(error: unknown): string {
  const code = (error as { code?: unknown })?.code
  return typeof code === 'string' && code.length > 0 ? code : CHANNEL_INBOUND_PARKED
}
