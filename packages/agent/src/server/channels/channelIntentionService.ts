import { randomUUID } from 'node:crypto'
import {
  INTENTION_CLAIM_TTL_MS,
  type ChannelBindingStore,
  type ChannelIntentionRecord,
  type InboundChannelMessage,
} from './channelBindingStore'
import type { ChannelInboundAck, ChannelInboundService } from './channelInboundService'

export interface ChannelIntentionOption {
  readonly value: string
  readonly label: string
  readonly description?: string
}

export interface ChannelIntentionQuestion {
  readonly questionId: string
  readonly sessionId: string
  readonly ownerPrincipalId: string
  readonly status: 'ready' | 'answered' | 'cancelled' | 'abandoned'
  readonly title?: string
  readonly context?: string
  readonly schema?: {
    readonly wireVersion: 1
    readonly fields: readonly ChannelIntentionField[]
  }
}

export type ChannelIntentionField = {
  readonly type: string
  readonly name: string
  readonly label: string
  readonly options?: readonly ChannelIntentionOption[]
}

export interface ChannelIntentionRuntime {
  /** Trusted workspace scope owning this ask_user store. */
  readonly workspaceId: string
  listPending(): Promise<readonly ChannelIntentionQuestion[]>
  getByQuestionId(questionId: string): Promise<ChannelIntentionQuestion | null>
  submitAnswer(questionId: string, sessionId: string, values: Readonly<Record<string, string>>): Promise<unknown>
  subscribe(listener: () => void): () => void
}

export interface ChannelIntentionSource {
  listPending(): Promise<readonly ChannelIntentionQuestion[]>
  getByQuestionId(questionId: string): Promise<ChannelIntentionQuestion | null>
  subscribe(listener: (...args: readonly unknown[]) => void): () => void
}

/** Adapts the real ask_user store/runtime pair without introducing a package cycle. */
export function createChannelIntentionRuntime(
  workspaceId: string,
  source: ChannelIntentionSource,
  answers: Pick<ChannelIntentionRuntime, 'submitAnswer'>,
): ChannelIntentionRuntime {
  return {
    workspaceId,
    listPending: () => source.listPending(),
    getByQuestionId: (questionId) => source.getByQuestionId(questionId),
    submitAnswer: (questionId, sessionId, values) => answers.submitAnswer(questionId, sessionId, values),
    subscribe: (listener) => source.subscribe(listener),
  }
}

export interface ChannelIntentionAdapter {
  readonly serviceWindowMs?: number
  send(input: { readonly conversationKey: string; readonly text: string }): Promise<void>
  sendWindowTemplate?(input: { readonly conversationKey: string }): Promise<void>
}

export type ChannelIntentionAck =
  | { readonly handled: false }
  | { readonly handled: true; readonly accepted: boolean; readonly duplicate: boolean; readonly questionId?: string }

export type ChannelMessageAck =
  | { readonly kind: 'intention'; readonly ack: Exclude<ChannelIntentionAck, { handled: false }> }
  | { readonly kind: 'agent'; readonly ack: ChannelInboundAck }

export interface ChannelIntentionServiceOptions {
  readonly claimTtlMs?: number
  readonly retryDelayMs?: number
}

/**
 * Projects answerable ask_user questions to a bound channel and routes one
 * reply back into the same durable Human Intention. The runtime is an injected
 * seam so the channel core does not depend on the ask-user plugin package.
 */
export class ChannelIntentionService {
  private readonly owner = randomUUID()
  private scan?: Promise<void>
  private rescan = false
  private timer?: ReturnType<typeof setTimeout>
  private unsubscribe?: () => void
  private disposed = false

  constructor(
    private readonly store: ChannelBindingStore,
    private readonly runtime: ChannelIntentionRuntime,
    private readonly adapters: ReadonlyMap<string, ChannelIntentionAdapter>,
    private readonly options: ChannelIntentionServiceOptions = {},
  ) {}

  start(): void {
    if (this.unsubscribe || this.disposed) return
    this.unsubscribe = this.runtime.subscribe(() => this.schedule())
    this.schedule()
  }

  async waitForIdle(): Promise<void> {
    while (this.scan) await this.scan
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.unsubscribe?.()
    this.unsubscribe = undefined
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    await this.scan
  }

  notifyInbound(binding: { channel: string; conversationKey: string; agentTypeId: string; bindingVersion: number }): void {
    this.store.releaseWindowHeldIntentions(binding)
    this.schedule()
  }

  async accept(message: InboundChannelMessage, agentTypeId: string): Promise<ChannelIntentionAck> {
    const intention = this.store.activeIntention(message.channel, message.conversationKey, agentTypeId)
    if (!intention) {
      if (this.store.hasIntentionReply(message.channel, message.providerMessageId)) {
        return { handled: true, accepted: true, duplicate: true }
      }
      const terminal = this.store.terminalIntention(message.channel, message.conversationKey, agentTypeId)
      return terminal && parseChoice(message.text, terminal.options)
        ? { handled: true, accepted: false, duplicate: false, questionId: terminal.questionId }
        : { handled: false }
    }
    const question = await this.runtime.getByQuestionId(intention.questionId)
    if (question?.status === 'answered') {
      this.store.reconcileIntentionAnswered(intention.questionId)
      return parseChoice(message.text, intention.options)
        ? {
            handled: true,
            accepted: false,
            duplicate: this.store.hasIntentionReply(message.channel, message.providerMessageId),
            questionId: intention.questionId,
          }
        : { handled: false }
    }
    if (!question || question.status !== 'ready') {
      this.store.reconcileIntentionClosed(intention.questionId)
      return parseChoice(message.text, intention.options)
        ? { handled: true, accepted: false, duplicate: false, questionId: intention.questionId }
        : { handled: false }
    }
    const choice = parseChoice(message.text, intention.options)
    const adapter = this.adapters.get(message.channel)
    if (!choice) {
      const claimed = this.store.claimInvalidIntentionReply(
        intention,
        message.providerMessageId,
        this.owner,
        this.options.claimTtlMs ?? INTENTION_CLAIM_TTL_MS,
      )
      if (claimed.disposition === 'claimed' && adapter) {
        try {
          await adapter.send({ conversationKey: message.conversationKey, text: invalidChoiceText(intention) })
          this.store.completeInvalidIntentionReply(message.channel, message.providerMessageId, this.owner)
        } catch (error) {
          this.armRetry()
          throw error
        }
      }
      return {
        handled: true,
        accepted: false,
        duplicate: claimed.disposition === 'duplicate',
        questionId: intention.questionId,
      }
    }

    const result = this.store.claimIntentionReply(
      intention,
      message.providerMessageId,
      { [intention.fieldName]: choice.value },
      this.owner,
      this.options.claimTtlMs ?? INTENTION_CLAIM_TTL_MS,
    )
    if (result.disposition === 'duplicate') {
      return { handled: true, accepted: true, duplicate: true, questionId: intention.questionId }
    }
    if (result.disposition === 'no_intention') {
      return { handled: true, accepted: false, duplicate: false, questionId: intention.questionId }
    }
    await this.consumeAnswer(result.intention)
    return { handled: true, accepted: true, duplicate: false, questionId: intention.questionId }
  }

  private schedule(): void {
    if (this.disposed) return
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    if (this.scan) {
      this.rescan = true
      return
    }
    const scan = Promise.resolve().then(() => this.scanOnce()).finally(() => {
      if (this.scan === scan) this.scan = undefined
      if (this.rescan) {
        this.rescan = false
        this.schedule()
      }
    })
    this.scan = scan
  }

  private async scanOnce(): Promise<void> {
    let retryAt: number | undefined
    for (const pendingReply of this.store.pendingInvalidIntentionReplies()) {
      if (pendingReply.retryAt > Date.now()) {
        retryAt = retryAt === undefined ? pendingReply.retryAt : Math.min(retryAt, pendingReply.retryAt)
        continue
      }
      const question = await this.runtime.getByQuestionId(pendingReply.intention.questionId)
      if (!question || question.status !== 'ready') {
        if (question?.status === 'answered') this.store.reconcileIntentionAnswered(pendingReply.intention.questionId)
        else this.store.reconcileIntentionClosed(pendingReply.intention.questionId)
        continue
      }
      const claimed = this.store.claimInvalidIntentionReply(
        pendingReply.intention,
        pendingReply.providerMessageId,
        this.owner,
        this.options.claimTtlMs ?? INTENTION_CLAIM_TTL_MS,
      )
      if (claimed.disposition !== 'claimed') continue
      const adapter = this.adapters.get(pendingReply.intention.channel)
      if (!adapter) {
        retryAt = Date.now() + (this.options.claimTtlMs ?? INTENTION_CLAIM_TTL_MS)
        continue
      }
      try {
        await adapter.send({
          conversationKey: pendingReply.intention.conversationKey,
          text: invalidChoiceText(pendingReply.intention),
        })
        this.store.completeInvalidIntentionReply(
          pendingReply.intention.channel,
          pendingReply.providerMessageId,
          this.owner,
        )
      } catch {
        retryAt = Date.now() + (this.options.claimTtlMs ?? INTENTION_CLAIM_TTL_MS)
      }
    }

    const pending = await this.runtime.listPending()
    for (const question of pending) {
      const binding = this.store.bindingForSession(question.sessionId, this.runtime.workspaceId)
      const field = answerableField(question)
      if (!binding || binding.authSubjectId !== question.ownerPrincipalId || !field) continue
      this.store.recordIntention({
        questionId: question.questionId,
        sessionId: question.sessionId,
        channel: binding.channel,
        conversationKey: binding.conversationKey,
        agentTypeId: binding.agentTypeId,
        bindingVersion: binding.bindingVersion,
        fieldName: field.name,
        options: field.options!,
        ...(question.title ? { title: question.title } : {}),
        ...(question.context ? { context: question.context } : {}),
      })
    }

    for (const intention of this.store.openIntentions()) {
      const question = await this.runtime.getByQuestionId(intention.questionId)
      if (question?.status === 'answered') {
        this.store.reconcileIntentionAnswered(intention.questionId)
        continue
      }
      if (!question || question.status !== 'ready') {
        this.store.reconcileIntentionClosed(intention.questionId)
        continue
      }
      if (intention.status === 'pending' || intention.status === 'projecting') {
        const claimed = this.store.claimIntentionProjection(
          intention.questionId,
          this.owner,
          this.options.claimTtlMs ?? INTENTION_CLAIM_TTL_MS,
        )
        if (claimed) {
          const adapter = this.adapters.get(claimed.channel)
          if (!adapter) {
            retryAt = Date.now() + (this.options.claimTtlMs ?? INTENTION_CLAIM_TTL_MS)
            continue
          }
          const ttlMs = this.options.claimTtlMs ?? INTENTION_CLAIM_TTL_MS
          const binding = this.store.getBinding(claimed.channel, claimed.conversationKey, claimed.agentTypeId)
          if (adapter.serviceWindowMs !== undefined
            && (!binding?.lastInboundAt || Date.now() - binding.lastInboundAt > adapter.serviceWindowMs)) {
            try {
              if (adapter.sendWindowTemplate) {
                await adapter.sendWindowTemplate({ conversationKey: claimed.conversationKey })
              }
              this.store.holdIntentionForWindow(claimed.questionId, this.owner)
            } catch {
              retryAt = Date.now() + ttlMs
            }
            continue
          }
          const heartbeat = setInterval(() => {
            try { this.store.renewIntentionClaim(claimed.questionId, this.owner, ttlMs) } catch { /* retry after lease */ }
          }, Math.max(1, Math.floor(ttlMs / 3)))
          try {
            await adapter.send({ conversationKey: claimed.conversationKey, text: projectionText(claimed) })
            if (this.store.ownsIntentionClaim(claimed.questionId, this.owner)) {
              this.store.completeIntentionProjection(claimed.questionId, this.owner)
            }
          } catch {
            retryAt = Date.now() + ttlMs
          } finally {
            clearInterval(heartbeat)
          }
        } else {
          retryAt = Date.now() + (this.options.retryDelayMs ?? 50)
        }
      } else if (intention.status === 'answering') {
        const claimed = this.store.claimRecoverableIntentionAnswer(
          intention.questionId,
          this.owner,
          this.options.claimTtlMs ?? INTENTION_CLAIM_TTL_MS,
        )
        if (claimed) {
          try { await this.consumeAnswer(claimed) } catch { /* durable row retries after its claim lease */ }
        } else retryAt = Date.now() + (this.options.retryDelayMs ?? 50)
      }
    }
    if (retryAt !== undefined && !this.disposed) {
      this.timer = setTimeout(() => this.schedule(), Math.max(1, retryAt - Date.now()))
    }
  }

  private async consumeAnswer(intention: ChannelIntentionRecord): Promise<void> {
    if (!intention.answerValues) return
    const ttlMs = this.options.claimTtlMs ?? INTENTION_CLAIM_TTL_MS
    const heartbeat = setInterval(() => {
      try { this.store.renewIntentionClaim(intention.questionId, this.owner, ttlMs) } catch { /* reconcile below */ }
    }, Math.max(1, Math.floor(ttlMs / 3)))
    try {
      await this.runtime.submitAnswer(
        intention.questionId,
        intention.sessionId,
        intention.answerValues as Readonly<Record<string, string>>,
      )
      if (this.store.ownsIntentionClaim(intention.questionId, this.owner)) {
        this.store.completeIntentionAnswer(intention.questionId, this.owner)
      } else {
        this.store.reconcileIntentionAnswered(intention.questionId)
      }
    } catch (error) {
      const question = await this.runtime.getByQuestionId(intention.questionId).catch(() => null)
      if (question?.status === 'answered') {
        this.store.reconcileIntentionAnswered(intention.questionId)
        return
      }
      this.armRetry()
      throw error
    } finally {
      clearInterval(heartbeat)
    }
  }

  private armRetry(): void {
    if (this.disposed || this.timer) return
    this.timer = setTimeout(() => this.schedule(), this.options.claimTtlMs ?? INTENTION_CLAIM_TTL_MS)
  }
}

/** Canonical ingress composition: approval replies never fall through to the agent prompt queue. */
export class ChannelMessageRouter {
  constructor(
    private readonly intentions: ChannelIntentionService,
    private readonly inbound: ChannelInboundService,
  ) {}

  async accept(message: InboundChannelMessage, agentTypeId: string): Promise<ChannelMessageAck> {
    const intention = await this.intentions.accept(message, agentTypeId)
    if (intention.handled) return { kind: 'intention', ack: intention }
    return { kind: 'agent', ack: this.inbound.accept(message, agentTypeId) }
  }
}

function answerableField(question: ChannelIntentionQuestion): ChannelIntentionField | undefined {
  if (question.status !== 'ready' || question.schema?.wireVersion !== 1 || question.schema.fields.length !== 1) return undefined
  const field = question.schema.fields[0]
  return field && (field.type === 'radio' || field.type === 'select') && field.options && field.options.length >= 2
    ? field
    : undefined
}

function parseChoice(text: string, options: readonly ChannelIntentionOption[]): ChannelIntentionOption | undefined {
  const normalized = text.trim().toLocaleLowerCase()
  const ordinal = /^([1-9][0-9]*)[.)]?$/.exec(normalized)
  if (ordinal) return options[Number(ordinal[1]) - 1]
  return options.find((option) => option.value.toLocaleLowerCase() === normalized
    || option.label.toLocaleLowerCase() === normalized)
}

function projectionText(intention: ChannelIntentionRecord): string {
  return [
    intention.title ?? 'Your approval is needed',
    ...(intention.context ? [intention.context] : []),
    ...intention.options.map((option, index) => `${index + 1}. ${option.label}${option.description ? ` — ${option.description}` : ''}`),
    'Reply with the option number or label.',
  ].join('\n')
}

function invalidChoiceText(intention: ChannelIntentionRecord): string {
  return `That is not a valid choice. Reply with ${intention.options.map((_, index) => index + 1).join(' or ')}.`
}
