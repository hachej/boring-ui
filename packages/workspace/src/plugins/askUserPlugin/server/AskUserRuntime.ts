import { randomBytes, randomUUID } from "node:crypto"
import { ASK_USER_ERROR_CODES } from "../shared/error-codes"
import { AskUserFormSchemaSchema } from "../shared/schema"
import { ASK_USER_SCHEMA_LIMITS, ASK_USER_SURFACE_KIND } from "../shared/constants"
import type { UiBridge } from "../../../shared/ui-bridge"
import type {
  AskUserAnswer,
  AskUserCancelReason,
  AskUserQuestion,
  AskUserRequest,
  AskUserToolResult,
} from "../shared/types"
import type { AskUserStore } from "./AskUserStore"

export class AskUserRuntimeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

type Waiter = {
  sessionId: string
  settled: boolean
  cleanup: () => void
  resolve: (result: AskUserToolResult) => void
}

export interface AskUserCoordinator {
  registerWaiter(questionId: string, sessionId: string, signal?: AbortSignal): Promise<AskUserToolResult>
  hasWaiter(questionId: string): boolean
  resolveAnswered(questionId: string, answer: AskUserAnswer): boolean
  resolveCancelled(questionId: string, reason: AskUserCancelReason): boolean
}

export class InProcessAskUserCoordinator implements AskUserCoordinator {
  private readonly waiters = new Map<string, Waiter>()

  registerWaiter(questionId: string, sessionId: string, signal?: AbortSignal): Promise<AskUserToolResult> {
    if (this.waiters.has(questionId)) {
      throw new AskUserRuntimeError(ASK_USER_ERROR_CODES.PENDING_EXISTS, `waiter already exists for ${questionId}`)
    }
    if (signal?.aborted) return Promise.resolve({ status: "cancelled", questionId, sessionId, reason: "aborted" })

    return new Promise((resolve) => {
      const onAbort = () => this.resolveCancelled(questionId, "aborted")
      const waiter: Waiter = {
        sessionId,
        settled: false,
        resolve,
        cleanup: () => signal?.removeEventListener("abort", onAbort),
      }
      this.waiters.set(questionId, waiter)
      signal?.addEventListener("abort", onAbort, { once: true })
    })
  }

  hasWaiter(questionId: string): boolean {
    return this.waiters.has(questionId)
  }

  resolveAnswered(questionId: string, answer: AskUserAnswer): boolean {
    return this.resolve(questionId, { status: "answered", answer })
  }

  resolveCancelled(questionId: string, reason: AskUserCancelReason): boolean {
    const waiter = this.waiters.get(questionId)
    const sessionId = waiter?.sessionId ?? ""
    return this.resolve(questionId, { status: "cancelled", questionId, sessionId, reason })
  }

  private resolve(questionId: string, result: AskUserToolResult): boolean {
    const waiter = this.waiters.get(questionId)
    if (!waiter || waiter.settled) return false
    waiter.settled = true
    this.waiters.delete(questionId)
    waiter.cleanup()
    waiter.resolve(result)
    return true
  }
}

type RateLimitBucket = { count: number; resetAt: number }

export type AskUserRuntimeEvent =
  | { type: "created"; questionId: string; sessionId: string; ownerPrincipalId: string }
  | { type: "ready"; questionId: string; sessionId: string }
  | { type: "answered"; questionId: string; sessionId: string }
  | { type: "cancelled"; questionId: string; sessionId: string; reason: AskUserCancelReason }
  | { type: "abandoned"; questionId: string; sessionId: string }
  | { type: "rate_limited"; sessionId: string; ownerPrincipalId: string }

export type AskUserRuntimeOptions = {
  store: AskUserStore
  coordinator?: AskUserCoordinator
  ownerPrincipalId?: string
  now?: () => Date
  emitEvent?: (event: AskUserRuntimeEvent) => void
  limits?: {
    perSessionPerMinute?: number
    perPrincipalPerHour?: number
  }
  uiBridge?: UiBridge
  askUserOpenAckTimeoutMs?: number
}

export class AskUserRuntime {
  readonly coordinator: AskUserCoordinator
  private readonly store: AskUserStore
  private readonly ownerPrincipalId: string
  private readonly now: () => Date
  private readonly emitEvent: (event: AskUserRuntimeEvent) => void
  private readonly perSessionPerMinute: number
  private readonly perPrincipalPerHour: number
  private readonly uiBridge?: UiBridge
  private readonly openAckTimeoutMs: number
  private readonly openWaiters = new Map<string, { ack: () => void; cancel: () => void }>()
  private readonly sessionBuckets = new Map<string, RateLimitBucket>()
  private readonly principalBuckets = new Map<string, RateLimitBucket>()

  constructor(options: AskUserRuntimeOptions) {
    this.store = options.store
    this.coordinator = options.coordinator ?? new InProcessAskUserCoordinator()
    this.ownerPrincipalId = options.ownerPrincipalId ?? "anonymous"
    this.now = options.now ?? (() => new Date())
    this.emitEvent = options.emitEvent ?? (() => undefined)
    this.perSessionPerMinute = options.limits?.perSessionPerMinute ?? 6
    this.perPrincipalPerHour = options.limits?.perPrincipalPerHour ?? 30
    this.uiBridge = options.uiBridge
    this.openAckTimeoutMs = clampOpenAckTimeout(options.askUserOpenAckTimeoutMs)
  }

  async abandonOrphanedPending(sessionIds: string[]): Promise<void> {
    for (const sessionId of sessionIds) {
      const pending = await this.store.getPending(sessionId)
      if (pending && !this.coordinator.hasWaiter(pending.questionId)) {
        await this.abandon(pending.questionId, pending.sessionId)
      }
    }
  }

  markOpened(questionId: string): void {
    const waiter = this.openWaiters.get(questionId)
    if (!waiter) return
    this.openWaiters.delete(questionId)
    waiter.ack()
  }

  async ask(request: AskUserRequest, signal?: AbortSignal): Promise<AskUserToolResult> {
    this.assertAllowed(request.sessionId)
    const question = this.createQuestion(request, "ready")
    const parsed = AskUserFormSchemaSchema.safeParse(request.schema)
    if (!parsed.success) throw new AskUserRuntimeError(ASK_USER_ERROR_CODES.SCHEMA_INVALID, parsed.error.message)
    question.schema = parsed.data
    await this.store.createPending(question)
    await this.store.appendTranscriptEvent({ type: "created", question, at: this.isoNow() })
    await this.store.appendTranscriptEvent({ type: "ready", questionId: question.questionId, sessionId: question.sessionId, schema: parsed.data, at: this.isoNow() })
    this.emitEvent({ type: "created", questionId: question.questionId, sessionId: question.sessionId, ownerPrincipalId: question.ownerPrincipalId })
    this.emitEvent({ type: "ready", questionId: question.questionId, sessionId: question.sessionId })
    return this.waitForAnswerWithOpen(question, request.timeoutMs, signal)
  }

  async beginAskUserStream(request: Omit<AskUserRequest, "schema">, signal?: AbortSignal): Promise<{ question: AskUserQuestion; result: Promise<AskUserToolResult> }> {
    this.assertAllowed(request.sessionId)
    const question = this.createQuestion(request, "draft")
    await this.store.createPending(question)
    await this.store.appendTranscriptEvent({ type: "created", question, at: this.isoNow() })
    this.emitEvent({ type: "created", questionId: question.questionId, sessionId: question.sessionId, ownerPrincipalId: question.ownerPrincipalId })
    return { question, result: this.waitForAnswerWithOpen(question, request.timeoutMs, signal) }
  }

  async submitAnswer(questionId: string, sessionId: string, values: AskUserAnswer["values"]): Promise<void> {
    const question = await this.store.getByQuestionId(questionId)
    if (!question || question.sessionId !== sessionId) throw new AskUserRuntimeError(ASK_USER_ERROR_CODES.QUESTION_NOT_FOUND, "question not found")
    if (!this.coordinator.hasWaiter(questionId)) {
      await this.abandon(questionId, sessionId)
      return
    }
    const answer: AskUserAnswer = { questionId, sessionId, values, submittedAt: this.isoNow() }
    await this.store.answer(questionId, answer)
    await this.store.appendTranscriptEvent({ type: "answered", answer, at: this.isoNow() })
    this.coordinator.resolveAnswered(questionId, answer)
    this.emitEvent({ type: "answered", questionId, sessionId })
  }

  async cancelQuestion(questionId: string, sessionId: string, reason: AskUserCancelReason = "user_cancelled"): Promise<void> {
    const question = await this.store.getByQuestionId(questionId)
    if (!question || question.sessionId !== sessionId) throw new AskUserRuntimeError(ASK_USER_ERROR_CODES.QUESTION_NOT_FOUND, "question not found")
    if (!this.coordinator.hasWaiter(questionId)) {
      await this.abandon(questionId, sessionId)
      return
    }
    await this.store.cancel(questionId)
    await this.store.appendTranscriptEvent({ type: "cancelled", questionId, sessionId, reason, at: this.isoNow() })
    this.coordinator.resolveCancelled(questionId, reason)
    this.emitEvent({ type: "cancelled", questionId, sessionId, reason })
  }

  private async waitForAnswerWithOpen(question: AskUserQuestion, timeoutMs?: number, signal?: AbortSignal): Promise<AskUserToolResult> {
    const answer = this.waitForAnswer(question, timeoutMs, signal)
    const unavailable = await this.openQuestionSurface(question)
    if (unavailable) return unavailable
    return answer
  }

  private async openQuestionSurface(question: AskUserQuestion): Promise<AskUserToolResult | null> {
    if (!this.uiBridge) return null
    const openedPromise = this.waitForOpened(question.questionId)
    try {
      await this.uiBridge.postCommand({ kind: "openSurface", params: { kind: ASK_USER_SURFACE_KIND, target: question.questionId } })
      const opened = await openedPromise
      if (opened) return null
    } catch {
      this.openWaiters.get(question.questionId)?.cancel()
      this.openWaiters.delete(question.questionId)
    }
    return this.cancelUiUnavailable(question)
  }

  private async cancelUiUnavailable(question: AskUserQuestion): Promise<AskUserToolResult | null> {
    try {
      await this.store.cancel(question.questionId)
      await this.store.appendTranscriptEvent({ type: "cancelled", questionId: question.questionId, sessionId: question.sessionId, reason: "ui_unavailable", at: this.isoNow() })
      this.coordinator.resolveCancelled(question.questionId, "ui_unavailable")
      this.emitEvent({ type: "cancelled", questionId: question.questionId, sessionId: question.sessionId, reason: "ui_unavailable" })
      return { status: "cancelled", questionId: question.questionId, sessionId: question.sessionId, reason: "ui_unavailable" }
    } catch {
      // A submit/cancel may have won the race while the open acknowledgement timed out.
      // Let the already-registered waiter deliver that terminal result instead.
      return null
    }
  }

  private waitForOpened(questionId: string): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.openWaiters.delete(questionId)
        resolve(false)
      }, this.openAckTimeoutMs)
      this.openWaiters.set(questionId, {
        ack: () => {
          clearTimeout(timer)
          resolve(true)
        },
        cancel: () => {
          clearTimeout(timer)
          resolve(false)
        },
      })
    })
  }

  private async waitForAnswer(question: AskUserQuestion, timeoutMs?: number, signal?: AbortSignal): Promise<AskUserToolResult> {
    const controller = new AbortController()
    const relayAbort = () => controller.abort()
    signal?.addEventListener("abort", relayAbort, { once: true })
    if (signal?.aborted) controller.abort()
    const timeout = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : undefined
    const result = await this.coordinator.registerWaiter(question.questionId, question.sessionId, controller.signal)
    signal?.removeEventListener("abort", relayAbort)
    if (timeout) clearTimeout(timeout)
    if (result.status === "cancelled" && result.reason === "aborted") {
      const reason: AskUserCancelReason = signal?.aborted ? "aborted" : "timeout"
      try {
        await this.store.cancel(question.questionId)
        await this.store.appendTranscriptEvent({ type: "cancelled", questionId: question.questionId, sessionId: question.sessionId, reason, at: this.isoNow() })
        this.emitEvent({ type: "cancelled", questionId: question.questionId, sessionId: question.sessionId, reason })
      } catch {
        // The browser may have submitted/cancelled or another startup path may have abandoned the
        // question in the small window after the waiter settled but before the store transition.
      }
      return { status: "cancelled", questionId: question.questionId, sessionId: question.sessionId, reason }
    }
    return result
  }

  private async abandon(questionId: string, sessionId: string): Promise<void> {
    await this.store.markAbandoned(questionId)
    await this.store.appendTranscriptEvent({ type: "abandoned", questionId, sessionId, at: this.isoNow() })
    this.coordinator.resolveCancelled(questionId, "abandoned")
    this.emitEvent({ type: "abandoned", questionId, sessionId })
  }

  private createQuestion(request: Pick<AskUserRequest, "sessionId" | "title" | "context">, status: "draft" | "ready"): AskUserQuestion {
    const at = this.isoNow()
    return {
      questionId: randomUUID(),
      sessionId: request.sessionId,
      ownerPrincipalId: this.ownerPrincipalId,
      status,
      title: request.title,
      context: request.context,
      draftFields: [],
      draftVersion: 0,
      answerToken: randomBytes(32).toString("base64url"),
      createdAt: at,
      updatedAt: at,
    }
  }

  private assertAllowed(sessionId: string): void {
    const principalId = this.ownerPrincipalId
    if (!this.consume(this.sessionBuckets, sessionId, 60_000, this.perSessionPerMinute) || !this.consume(this.principalBuckets, principalId, 3_600_000, this.perPrincipalPerHour)) {
      this.emitEvent({ type: "rate_limited", sessionId, ownerPrincipalId: principalId })
      throw new AskUserRuntimeError(ASK_USER_ERROR_CODES.RATE_LIMITED, "ask_user rate limit exceeded")
    }
  }

  private consume(buckets: Map<string, RateLimitBucket>, key: string, windowMs: number, limit: number): boolean {
    const now = this.now().getTime()
    const bucket = buckets.get(key)
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs })
      return true
    }
    if (bucket.count >= limit) return false
    bucket.count += 1
    return true
  }

  private isoNow(): string {
    return this.now().toISOString()
  }
}

export function requireAskUserRuntime(runtime: AskUserRuntime | null | undefined): AskUserRuntime {
  if (!runtime) throw new AskUserRuntimeError(ASK_USER_ERROR_CODES.RUNTIME_UNAVAILABLE, "ask_user runtime unavailable")
  return runtime
}

function clampOpenAckTimeout(value: number | undefined): number {
  const raw = value ?? 8_000
  return Math.max(ASK_USER_SCHEMA_LIMITS.minTimeoutMs, Math.min(60_000, Math.floor(raw)))
}
