import { randomUUID } from 'node:crypto'
import type { PiChatEvent } from '../../shared/chat'
import type { AgentEvent } from '../../shared/events'
import { ErrorCode } from '../../shared/error-codes'
import type { EventStreamStore } from '../events/eventStreamStore'
import { OUTBOUND_CLAIM_TTL_MS, type ChannelBinding, type ChannelBindingStore } from './channelBindingStore'

export const CHANNEL_OUTBOUND_PARKED = ErrorCode.enum.CHANNEL_OUTBOUND_PARKED
export const CHANNEL_TURN_STALLED = ErrorCode.enum.CHANNEL_TURN_STALLED
export const DEFAULT_WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1_000
export const DEFAULT_CHANNEL_STALL_TIMEOUT_MS = 5 * 60 * 1_000

export interface ChannelOutboundTurn {
  readonly turnId: string
  readonly status: 'ok' | 'aborted' | 'error' | 'stalled'
  readonly text: string
}

export interface ChannelOutboundAdapter<Message = unknown> {
  /** Adapter-owned delivery constraint; omit for channels without a service window. */
  readonly serviceWindowMs?: number
  renderOutbound(turn: ChannelOutboundTurn): readonly Message[]
  send(input: {
    readonly conversationKey: string
    readonly message: Message
  }): Promise<void>
  sendWindowTemplate?(input: { readonly conversationKey: string }): Promise<void>
}

export interface ChannelOutboundRuntime {
  /** Returns undefined only when the persisted session no longer exists. */
  resolveStreamPath(binding: ChannelBinding): Promise<string | undefined>
  createSession(binding: ChannelBinding): Promise<string>
}

export interface ChannelOutboundServiceOptions {
  readonly maxSendAttempts?: number
  readonly retryDelayMs?: number
  readonly stallTimeoutMs?: number
  readonly outboundClaimTtlMs?: number
  readonly now?: () => number
}

interface AssembledTurn {
  readonly turn: ChannelOutboundTurn
  readonly terminalOffset: string
}

export class ChannelOutboundService<Message = unknown> {
  private readonly drains = new Map<string, Promise<void>>()
  private readonly pendingDrains = new Set<string>()
  private readonly subscriptions = new Map<string, { path: string; unsubscribe: () => void }>()
  private readonly stallTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly claimTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private disposed = false

  constructor(
    private readonly store: ChannelBindingStore,
    private readonly events: EventStreamStore,
    private readonly runtime: ChannelOutboundRuntime,
    private readonly adapters: ReadonlyMap<string, ChannelOutboundAdapter<Message>>,
    private readonly options: ChannelOutboundServiceOptions = {},
  ) {}

  start(): void {
    for (const binding of this.store.activeBindings()) this.schedule(binding)
  }

  notifyInbound(binding: ChannelBinding): void {
    this.schedule(binding)
  }

  async waitForIdle(): Promise<void> {
    while (this.drains.size > 0 || this.pendingDrains.size > 0) {
      await Promise.allSettled([...this.drains.values()])
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true
    for (const subscription of this.subscriptions.values()) subscription.unsubscribe()
    this.subscriptions.clear()
    for (const timer of this.stallTimers.values()) clearTimeout(timer)
    this.stallTimers.clear()
    for (const timer of this.claimTimers.values()) clearTimeout(timer)
    this.claimTimers.clear()
    await Promise.allSettled([...this.drains.values()])
  }

  private schedule(binding: ChannelBinding): void {
    if (this.disposed || binding.status !== 'active' || binding.outboundStatus !== 'active') return
    const key = bindingKey(binding)
    if (this.drains.has(key)) {
      this.pendingDrains.add(key)
      return
    }
    const drain = Promise.resolve().then(() => this.drain(binding)).finally(() => {
      if (this.drains.get(key) === drain) this.drains.delete(key)
      if (this.pendingDrains.delete(key)) {
        const current = this.current(binding)
        if (current) this.schedule(current)
      }
    })
    this.drains.set(key, drain)
  }

  private async drain(initialBinding: ChannelBinding): Promise<void> {
    let binding = this.current(initialBinding)
    if (!binding?.sessionKey) return
    const adapter = this.adapters.get(binding.channel)
    if (!adapter) return
    const claimOwner = randomUUID()
    const claimTtlMs = this.options.outboundClaimTtlMs ?? OUTBOUND_CLAIM_TTL_MS
    if (!this.store.claimOutbound(binding, claimOwner, claimTtlMs)) {
      this.scheduleClaimRetry(binding)
      return
    }
    let claimLost = false
    const heartbeat = setInterval(() => {
      try {
        if (!this.store.renewOutbound(claimOwner, claimTtlMs)) claimLost = true
      } catch {
        claimLost = true
      }
    }, Math.max(1, Math.floor(claimTtlMs / 3)))

    try {
      let streamPath = await this.runtime.resolveStreamPath(binding)
      if (claimLost) return
      if (!streamPath) {
        if (!this.store.markSessionGone(binding)) return
        const cleared = this.current(binding)
        if (!cleared) return
        const ensured = await this.store.ensureSession(cleared, {
          allocate: () => this.runtime.createSession(cleared),
          admit: async () => undefined,
        })
        binding = this.current(cleared)
        if (claimLost || !binding || binding.sessionKey !== ensured.sessionKey) return
        streamPath = await this.runtime.resolveStreamPath(binding)
        if (!streamPath || claimLost) return
      }

      this.ensureSubscription(binding, streamPath)
      for (;;) {
        const current = this.current(binding)
        if (!current?.sessionKey || !sameBindingGeneration(binding, current)
          || current.status !== 'active' || current.outboundStatus !== 'active' || claimLost) return
        binding = current
        if (binding.sessionResetPending) {
          try {
            if (!this.isInsideServiceWindow(binding, adapter)) {
              await this.sendWindowTemplate(adapter, binding, claimOwner)
              return
            }
            await this.sendWithRetry(adapter, binding, {
              turnId: 'session-reset',
              status: 'error',
              text: 'The previous session is no longer available. I started a new conversation.',
            }, claimOwner)
          } catch (error) {
            if (!this.store.ownsOutboundClaim(claimOwner)) return
            this.store.parkOutboundBinding(binding, stableErrorCode(error))
            return
          }
          if (claimLost || !this.store.ownsOutboundClaim(claimOwner)
            || !this.store.acknowledgeSessionReset(binding)) return
          binding = this.current(binding) ?? binding
        }
        const unread = await this.readUnreadEvents(streamPath, binding.outboundCursor)
        const assembled = unread.assembled
        if (!assembled) {
          this.scheduleStall(binding, unread.entries)
          return
        }
        this.clearStall(binding)

        if (!this.isInsideServiceWindow(binding, adapter)) {
          try {
            await this.sendWindowTemplate(adapter, binding, claimOwner)
          } catch (error) {
            if (!this.store.ownsOutboundClaim(claimOwner)) return
            this.store.parkOutboundBinding(binding, stableErrorCode(error))
          }
          return
        }

        try {
          if (claimLost) return
          await this.sendWithRetry(adapter, binding, assembled.turn, claimOwner)
        } catch (error) {
          if (!this.store.ownsOutboundClaim(claimOwner)) return
          this.store.parkOutbound(binding, assembled.terminalOffset, stableErrorCode(error))
          continue
        }
        if (claimLost || !this.store.ownsOutboundClaim(claimOwner)) return
        if (assembled.turn.status === 'stalled') {
          if (!this.store.parkOutbound(binding, assembled.terminalOffset, CHANNEL_TURN_STALLED)) return
          continue
        }
        if (!this.store.compareAndSetOutboundCursor(binding, assembled.terminalOffset)) return
      }
    } finally {
      clearInterval(heartbeat)
      this.store.releaseOutbound(claimOwner)
    }
  }

  private async readUnreadEvents(streamPath: string, durableCursor: string): Promise<{
    entries: Array<{ data: unknown; offset: string }>
    assembled?: AssembledTurn
  }> {
    const entries: Array<{ data: unknown; offset: string }> = []
    let readCursor = durableCursor
    let lastOffset = durableCursor
    for (;;) {
      const page = await this.events.readEvents(streamPath, { offset: readCursor, limit: 1_000 })
      for (const entry of page.events) {
        lastOffset = entry.offset
        if (isAssemblyEvent(entry.data)) entries.push(entry)
      }
      const assembled = assembleNextTurn(entries, this.now(), this.stallTimeoutMs())
      if (assembled) {
        return {
          entries,
          assembled: assembled.turn.status === 'stalled'
            ? { ...assembled, terminalOffset: lastOffset }
            : assembled,
        }
      }
      if (page.upToDate || page.nextOffset === readCursor) return { entries }
      readCursor = page.nextOffset
    }
  }

  private scheduleClaimRetry(binding: ChannelBinding): void {
    const retryAt = this.store.outboundClaimRetryAt(binding)
    if (retryAt === undefined || this.disposed) return
    const key = bindingKey(binding)
    if (this.claimTimers.has(key)) return
    this.claimTimers.set(key, setTimeout(() => {
      this.claimTimers.delete(key)
      const current = this.current(binding)
      if (current) this.schedule(current)
    }, Math.max(1, retryAt - Date.now())))
  }

  private ensureSubscription(binding: ChannelBinding, streamPath: string): void {
    const key = bindingKey(binding)
    const existing = this.subscriptions.get(key)
    if (existing?.path === streamPath) return
    existing?.unsubscribe()
    const unsubscribe = this.events.subscribe(streamPath, () => {
      const current = this.current(binding)
      if (current) this.schedule(current)
    })
    this.subscriptions.set(key, { path: streamPath, unsubscribe })
  }

  private scheduleStall(binding: ChannelBinding, events: Array<{ data: unknown; offset: string }>): void {
    const first = events.find((entry) => isAgentEvent(entry.data) && entry.data.chunk.type === 'agent-start')
    if (!first || !isAgentEvent(first.data)) return
    const timeout = this.stallTimeoutMs()
    const remaining = Math.max(1, first.data.timestamp + timeout - this.now())
    const key = bindingKey(binding)
    if (this.stallTimers.has(key)) return
    this.stallTimers.set(key, setTimeout(() => {
      this.stallTimers.delete(key)
      const current = this.current(binding)
      if (current) this.schedule(current)
    }, remaining))
  }

  private clearStall(binding: ChannelBinding): void {
    const key = bindingKey(binding)
    const timer = this.stallTimers.get(key)
    if (timer) clearTimeout(timer)
    this.stallTimers.delete(key)
  }

  private async sendWindowTemplate(
    adapter: ChannelOutboundAdapter<Message>,
    binding: ChannelBinding,
    claimOwner: string,
  ): Promise<void> {
    if (binding.templateSentForInboundAt === binding.lastInboundAt) return
    if (!adapter.sendWindowTemplate) {
      throw Object.assign(new Error('Channel adapter has a service window but no fallback template.'), {
        code: CHANNEL_OUTBOUND_PARKED,
        retryable: false,
      })
    }
    let attempt = 0
    for (;;) {
      attempt += 1
      try {
        if (!this.store.ownsOutboundClaim(claimOwner)) throw lostClaimError()
        await adapter.sendWindowTemplate({ conversationKey: binding.conversationKey })
        if (!this.store.ownsOutboundClaim(claimOwner)) throw lostClaimError()
        this.store.markTemplateSent(binding)
        return
      } catch (error) {
        const retryable = (error as { retryable?: unknown })?.retryable !== false
        if (!retryable || attempt >= (this.options.maxSendAttempts ?? 3)) throw error
        await delay(this.options.retryDelayMs ?? 25)
      }
    }
  }

  private async sendWithRetry(
    adapter: ChannelOutboundAdapter<Message>,
    binding: ChannelBinding,
    turn: ChannelOutboundTurn,
    claimOwner: string,
  ): Promise<void> {
    const messages = adapter.renderOutbound(turn)
    for (const message of messages) {
      let attempt = 0
      for (;;) {
        attempt += 1
        try {
          if (!this.store.ownsOutboundClaim(claimOwner)) throw lostClaimError()
          await adapter.send({ conversationKey: binding.conversationKey, message })
          break
        } catch (error) {
          const retryable = (error as { retryable?: unknown })?.retryable !== false
          if (!retryable || attempt >= (this.options.maxSendAttempts ?? 3)) throw error
          await delay(this.options.retryDelayMs ?? 25)
        }
      }
    }
  }

  private current(binding: ChannelBinding): ChannelBinding | undefined {
    return this.store.getBinding(binding.channel, binding.conversationKey, binding.agentTypeId)
  }

  private isInsideServiceWindow(binding: ChannelBinding, adapter: ChannelOutboundAdapter<Message>): boolean {
    if (adapter.serviceWindowMs === undefined) return true
    const age = binding.lastInboundAt === undefined ? Number.POSITIVE_INFINITY : this.now() - binding.lastInboundAt
    return age >= 0 && age <= adapter.serviceWindowMs
  }

  private stallTimeoutMs(): number {
    return this.options.stallTimeoutMs ?? DEFAULT_CHANNEL_STALL_TIMEOUT_MS
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }
}

export function assembleNextTurn(
  entries: ReadonlyArray<{ data: unknown; offset: string }>,
  now = Date.now(),
  stallTimeoutMs = DEFAULT_CHANNEL_STALL_TIMEOUT_MS,
): AssembledTurn | undefined {
  let active: { turnId: string; startedAt: number; assistantText: string } | undefined
  for (const entry of entries) {
    if (!isAgentEvent(entry.data)) continue
    const { chunk } = entry.data
    if (chunk.type === 'agent-start') {
      if (!active) active = { turnId: chunk.turnId, startedAt: entry.data.timestamp, assistantText: '' }
      continue
    }
    if (!active) continue
    if (chunk.type === 'error' && (!chunk.turnId || chunk.turnId === active.turnId)) {
      return {
        terminalOffset: entry.offset,
        turn: {
          turnId: active.turnId,
          status: 'error',
          text: 'I could not complete that request. Please try again.',
        },
      }
    }
    if (chunk.type === 'message-end' && chunk.final.role === 'assistant'
      && (!chunk.final.turnId || chunk.final.turnId === active.turnId)) {
      active.assistantText = displayText(chunk.final)
      continue
    }
    if (chunk.type === 'agent-end' && chunk.turnId === active.turnId && chunk.willRetry !== true) {
      const status = chunk.status
      return {
        terminalOffset: entry.offset,
        turn: {
          turnId: active.turnId,
          status,
          text: status === 'ok'
            ? active.assistantText
            : status === 'aborted'
              ? 'That request was stopped before it completed. Please try again.'
              : 'I could not complete that request. Please try again.',
        },
      }
    }
  }
  if (active && now - active.startedAt >= stallTimeoutMs) {
    return {
      terminalOffset: entries.at(-1)?.offset ?? '-1',
      turn: {
        turnId: active.turnId,
        status: 'stalled',
        text: 'That request did not finish in time. Please try again.',
      },
    }
  }
  return undefined
}

export function shapeChannelText(text: string, dialect: string, maxLength = 4_096): string[] {
  const rendered = dialect === 'whatsapp/markdown'
    ? text.replace(/^#{1,6}\s+/gm, '').replace(/\*\*([^*]+)\*\*/g, '*$1*')
    : text
  if (rendered.length <= maxLength) return [rendered]
  const chunks: string[] = []
  let remaining = rendered
  while (remaining.length > maxLength) {
    let split = remaining.lastIndexOf('\n\n', maxLength)
    if (split < Math.floor(maxLength / 2)) split = remaining.lastIndexOf('\n', maxLength)
    if (split < Math.floor(maxLength / 2)) split = maxLength
    let chunk = remaining.slice(0, split)
    remaining = remaining.slice(split).replace(/^\n+/, '')
    if ((chunk.match(/```/g) ?? []).length % 2 === 1) {
      const closeFence = '\n```'
      if (chunk.length + closeFence.length > maxLength) {
        const keep = maxLength - closeFence.length
        remaining = chunk.slice(keep) + remaining
        chunk = chunk.slice(0, keep)
      }
      chunk += closeFence
      remaining = `\`\`\`\n${remaining}`
    }
    chunks.push(chunk)
  }
  if (remaining.length > 0) chunks.push(remaining)
  return chunks
}

function displayText(message: { parts: readonly { type: string; text?: string }[] }): string {
  return message.parts
    .filter((part): part is { type: 'text' | 'notice'; text: string } =>
      (part.type === 'text' || part.type === 'notice') && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
}

function isAssemblyEvent(value: unknown): value is AgentEvent {
  if (!isAgentEvent(value)) return false
  return value.chunk.type === 'agent-start'
    || value.chunk.type === 'message-end'
    || value.chunk.type === 'agent-end'
    || value.chunk.type === 'error'
}

function isAgentEvent(value: unknown): value is AgentEvent {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<AgentEvent>
  return candidate.v === 1 && typeof candidate.timestamp === 'number'
    && !!candidate.chunk && typeof candidate.chunk === 'object'
    && typeof (candidate.chunk as Partial<PiChatEvent>).type === 'string'
}

function sameBindingGeneration(left: ChannelBinding, right: ChannelBinding): boolean {
  return left.channel === right.channel
    && left.conversationKey === right.conversationKey
    && left.agentTypeId === right.agentTypeId
    && left.bindingVersion === right.bindingVersion
    && left.workspaceId === right.workspaceId
    && left.authSubjectId === right.authSubjectId
}

function bindingKey(binding: ChannelBinding): string {
  return JSON.stringify([binding.channel, binding.conversationKey, binding.agentTypeId])
}

function lostClaimError(): Error {
  return Object.assign(new Error('Channel outbound delivery lease was lost.'), {
    code: CHANNEL_OUTBOUND_PARKED,
    retryable: false,
  })
}

function stableErrorCode(error: unknown): string {
  const code = (error as { code?: unknown })?.code
  return typeof code === 'string' && code.length > 0 ? code : CHANNEL_OUTBOUND_PARKED
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
