import { randomBytes, randomUUID } from "node:crypto"
import { ASK_USER_ERROR_CODES } from "../shared/error-codes"
import { AskUserFormSchemaSchema } from "../shared/schema"
import { ASK_USER_SURFACE_KIND } from "../shared/constants"
import type { UiBridge } from "@hachej/boring-workspace/server"
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
  uiBridge?: UiBridge
}

export class AskUserRuntime {
  readonly coordinator: AskUserCoordinator
  private readonly store: AskUserStore
  private readonly ownerPrincipalId: string
  private readonly now: () => Date
  private readonly perSessionPerMinute: number
  private readonly perPrincipalPerHour: number
  private readonly uiBridge?: UiBridge
  private readonly sessionBuckets = new Map<string, RateLimitBucket>()
  private readonly principalBuckets = new Map<string, RateLimitBucket>()

  constructor(options: AskUserRuntimeOptions) {
    this.store = options.store
    this.coordinator = options.coordinator ?? new InProcessAskUserCoordinator()
    this.ownerPrincipalId = options.ownerPrincipalId ?? "anonymous"
    this.now = options.now ?? (() => new Date())
    this.perSessionPerMinute = options.limits?.perSessionPerMinute ?? 6
    this.perPrincipalPerHour = options.limits?.perPrincipalPerHour ?? 30
    this.uiBridge = options.uiBridge
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
    this.assertAllowed(request.sessionId)
    const question = this.createQuestion(request)
    const parsed = AskUserFormSchemaSchema.safeParse(request.schema)
    if (!parsed.success) throw new AskUserRuntimeError(ASK_USER_ERROR_CODES.SCHEMA_INVALID, parsed.error.message)
    question.schema = parsed.data
    await this.store.createPending(question)
    await this.store.appendTranscriptEvent({ type: "created", question, at: this.isoNow() })
    await this.store.appendTranscriptEvent({ type: "ready", questionId: question.questionId, sessionId: question.sessionId, schema: parsed.data, at: this.isoNow() })
    return this.waitForAnswerWithOpen(question, request.timeoutMs, signal)
  }

  async submitAnswer(questionId: string, sessionId: string, values: AskUserAnswer["values"]): Promise<"answered" | "abandoned"> {
    const question = await this.store.getByQuestionId(questionId)
    if (!question || question.sessionId !== sessionId) throw new AskUserRuntimeError(ASK_USER_ERROR_CODES.QUESTION_NOT_FOUND, "question not found")
    if (!this.coordinator.hasWaiter(questionId)) {
      await this.abandon(questionId, sessionId)
      return "abandoned"
    }
    const answer: AskUserAnswer = { questionId, sessionId, values, submittedAt: this.isoNow() }
    await this.store.answer(questionId, answer)
    await this.store.appendTranscriptEvent({ type: "answered", answer, at: this.isoNow() })
    this.coordinator.resolveAnswered(questionId, answer)
    return "answered"
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
  }

  private async waitForAnswerWithOpen(question: AskUserQuestion, timeoutMs?: number, signal?: AbortSignal): Promise<AskUserToolResult> {
    const pendingAnswer = this.waitForAnswer(question, timeoutMs, signal)
    void this.openQuestionSurface(question)
    return pendingAnswer
  }

  private async openQuestionSurface(question: AskUserQuestion): Promise<void> {
    if (!this.uiBridge) return
    try {
      await this.uiBridge.postCommand({ kind: "openSurface", params: { kind: ASK_USER_SURFACE_KIND, target: question.questionId, meta: { question } } })
    } catch {
      // Opening the pane is best-effort. The pending question is already persisted
      // and published via UI state, so a stale/disconnected browser can refresh and answer.
    }
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
  }

  private createQuestion(request: Pick<AskUserRequest, "sessionId" | "title" | "context">): AskUserQuestion {
    const at = this.isoNow()
    return {
      questionId: randomUUID(),
      sessionId: request.sessionId,
      ownerPrincipalId: this.ownerPrincipalId,
      status: "ready",
      title: request.title,
      context: request.context,
      answerToken: randomBytes(32).toString("base64url"),
      createdAt: at,
      updatedAt: at,
    }
  }

  private assertAllowed(sessionId: string): void {
    const principalId = this.ownerPrincipalId
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
