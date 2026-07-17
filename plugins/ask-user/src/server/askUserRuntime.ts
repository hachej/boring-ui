import { randomBytes, randomUUID } from "node:crypto"
import { ASK_USER_ERROR_CODES } from "../shared/error-codes"
import { AskUserFormSchemaSchema } from "../shared/schema"
import type {
  AskUserAnswer,
  AskUserCancelReason,
  AskUserQuestion,
  AskUserRequest,
  AskUserToolResult,
} from "../shared/types"
import type { AskUserStore } from "./askUserStore"

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


export type AskUserRuntimeOptions = {
  store: AskUserStore
  coordinator?: AskUserCoordinator
  ownerPrincipalId?: string
  now?: () => Date
  limits?: {
    perSessionPerMinute?: number
    perPrincipalPerHour?: number
  }
}

export class AskUserRuntime {
  readonly coordinator: AskUserCoordinator
  private readonly store: AskUserStore
  private readonly ownerPrincipalId: string
  private readonly now: () => Date
  private readonly perSessionPerMinute: number
  private readonly perPrincipalPerHour: number
  private readonly sessionBuckets = new Map<string, RateLimitBucket>()
  private readonly principalBuckets = new Map<string, RateLimitBucket>()

  constructor(options: AskUserRuntimeOptions) {
    this.store = options.store
    this.coordinator = options.coordinator ?? new InProcessAskUserCoordinator()
    this.ownerPrincipalId = options.ownerPrincipalId ?? "anonymous"
    this.now = options.now ?? (() => new Date())
    this.perSessionPerMinute = options.limits?.perSessionPerMinute ?? 6
    this.perPrincipalPerHour = options.limits?.perPrincipalPerHour ?? 30
  }

  async abandonOrphanedPending(sessionIds: string[]): Promise<void> {
    for (const sessionId of sessionIds) {
      const pending = await this.store.getPending(sessionId)
      if (pending && !this.coordinator.hasWaiter(pending.questionId)) {
        await this.abandon(pending.questionId, pending.sessionId)
      }
    }
  }


  async ask(request: AskUserRequest, signal?: AbortSignal): Promise<AskUserToolResult> {
    const ownerPrincipalId = request.ownerPrincipalId ?? this.ownerPrincipalId
    await this.abandonOrphanedPending([request.sessionId])
    this.assertAllowed(request.sessionId, ownerPrincipalId)
    const question = this.createQuestion({ ...request, ownerPrincipalId })
    const parsed = AskUserFormSchemaSchema.safeParse(request.schema)
    if (!parsed.success) throw new AskUserRuntimeError(ASK_USER_ERROR_CODES.SCHEMA_INVALID, parsed.error.message)
    question.schema = parsed.data

    // Register the waiter before publishing/persisting the question. The UI
    // state publisher can make a question answerable as soon as createPending
    // mutates the store; if the browser answers in that small window before the
    // waiter exists, submitAnswer correctly treats it as abandoned. Cancellation
    // is armed only after persistence so abort/timeout cannot leave a visible
    // question with no waiter.
    const pendingAnswer = this.coordinator.registerWaiter(question.questionId, question.sessionId)
    try {
      await this.store.createPending(question)
      await this.store.appendTranscriptEvent({ type: "created", question, at: this.isoNow() })
      await this.store.appendTranscriptEvent({ type: "ready", questionId: question.questionId, sessionId: question.sessionId, schema: parsed.data, at: this.isoNow() })
      if (signal?.aborted) {
        await this.cancelQuestion(question.questionId, question.sessionId, "aborted")
        return await pendingAnswer
      }
      return await this.waitForAnswer(question, pendingAnswer, request.timeoutMs, signal)
    } catch (error) {
      this.coordinator.resolveCancelled(question.questionId, "abandoned")
      throw error
    }
  }

  async submitAnswer(questionId: string, sessionId: string, values: AskUserAnswer["values"]): Promise<"answered" | "abandoned"> {
    const question = await this.store.getByQuestionId(questionId)
    if (!question || question.sessionId !== sessionId) throw new AskUserRuntimeError(ASK_USER_ERROR_CODES.QUESTION_NOT_FOUND, "question not found")
    if (!this.coordinator.hasWaiter(questionId)) {
      await this.abandon(questionId, sessionId)
      return "abandoned"
    }
    const answer: AskUserAnswer = { questionId, sessionId, values, submittedAt: this.isoNow() }
    let answerPersisted = false
    try {
      await this.store.answer(questionId, answer)
      answerPersisted = true
      await this.store.appendTranscriptEvent({ type: "answered", answer, at: this.isoNow() })
    } finally {
      if (answerPersisted) this.coordinator.resolveAnswered(questionId, answer)
    }
    return "answered"
  }

  async cancelQuestion(questionId: string, sessionId: string, reason: AskUserCancelReason = "user_cancelled"): Promise<void> {
    const question = await this.store.getByQuestionId(questionId)
    if (!question || question.sessionId !== sessionId) throw new AskUserRuntimeError(ASK_USER_ERROR_CODES.QUESTION_NOT_FOUND, "question not found")
    if (!this.coordinator.hasWaiter(questionId)) {
      await this.abandon(questionId, sessionId)
      return
    }
    let cancelPersisted = false
    try {
      await this.store.cancel(questionId)
      cancelPersisted = true
      await this.store.appendTranscriptEvent({ type: "cancelled", questionId, sessionId, reason, at: this.isoNow() })
    } catch (error) {
      if (!cancelPersisted) await this.resolveCancelledUnlessAnswered(questionId, reason)
      throw error
    } finally {
      if (cancelPersisted) this.coordinator.resolveCancelled(questionId, reason)
    }
  }

  private async waitForAnswer(
    question: AskUserQuestion,
    pendingAnswer: Promise<AskUserToolResult>,
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<AskUserToolResult> {
    let settled = false
    const cancel = (reason: AskUserCancelReason) => {
      if (settled) return
      void this.cancelQuestion(question.questionId, question.sessionId, reason).catch(() => undefined)
    }
    const onAbort = () => cancel("aborted")
    signal?.addEventListener("abort", onAbort, { once: true })
    if (signal?.aborted) cancel("aborted")
    const timeout = timeoutMs ? setTimeout(() => cancel("timeout"), timeoutMs) : undefined
    try {
      const result = await pendingAnswer
      settled = true
      return result
    } finally {
      settled = true
      signal?.removeEventListener("abort", onAbort)
      if (timeout) clearTimeout(timeout)
    }
  }

  private async resolveCancelledUnlessAnswered(questionId: string, reason: AskUserCancelReason): Promise<void> {
    const latest = await this.store.getByQuestionId(questionId).catch(() => null)
    if (latest?.status === "answered") return
    this.coordinator.resolveCancelled(questionId, reason)
  }

  private async abandon(questionId: string, sessionId: string): Promise<void> {
    await this.store.markAbandoned(questionId)
    await this.store.appendTranscriptEvent({ type: "abandoned", questionId, sessionId, at: this.isoNow() })
    this.coordinator.resolveCancelled(questionId, "abandoned")
  }

  private createQuestion(request: Pick<AskUserRequest, "sessionId" | "title" | "context" | "ownerPrincipalId">): AskUserQuestion {
    const at = this.isoNow()
    return {
      questionId: randomUUID(),
      sessionId: request.sessionId,
      ownerPrincipalId: request.ownerPrincipalId ?? this.ownerPrincipalId,
      status: "ready",
      title: request.title,
      context: request.context,
      answerToken: randomBytes(32).toString("base64url"),
      createdAt: at,
      updatedAt: at,
    }
  }

  private assertAllowed(sessionId: string, principalId: string): void {
    if (!this.consume(this.sessionBuckets, sessionId, 60_000, this.perSessionPerMinute) || !this.consume(this.principalBuckets, principalId, 3_600_000, this.perPrincipalPerHour)) {
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
