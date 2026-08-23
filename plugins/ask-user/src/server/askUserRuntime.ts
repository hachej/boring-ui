import { randomBytes, randomUUID } from "node:crypto"
import { HumanArtifactListSchema } from "@hachej/boring-workspace/shared"
import { ASK_USER_ERROR_CODES } from "../shared/error-codes"
import { AskUserFormSchemaSchema } from "../shared/schema"
import type {
  AskUserAnswer,
  AskUserCancelReason,
  AskUserQuestion,
  AskUserQuestionStatus,
  AskUserRequest,
  AskUserToolResult,
} from "../shared/types"
import type { AskUserStore } from "./askUserStore"

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

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
  /**
   * Finding 2: startup expiry reconciliation can race a store whose lock is
   * held by a crashed writer that has not yet aged past the store's
   * stale-lock reclamation window (e.g. `FileAskUserStore`'s default
   * 15s). A single unretried attempt can permanently miss expiring an
   * overdue question. `retryDelaysMs` backs off across attempts whose total
   * duration is expected to exceed that window; if every attempt still
   * fails, the failure is reported via `onPersistentFailure` (never
   * swallowed) and a timer is rearmed after `rearmDelayMs` to try the whole
   * sequence again, rather than giving up.
   */
  expiryReconcile?: {
    retryDelaysMs?: number[]
    rearmDelayMs?: number
    onPersistentFailure?: (info: { questionId: string; sessionId: string; error: unknown }) => void
  }
}

/**
 * Default backoff schedule for retrying a failed expiry cancellation.
 * Total ~15.75s, chosen to comfortably exceed `FileAskUserStore`'s default
 * 15s lock-staleness window so a cancellation blocked only by a crashed
 * writer's not-yet-reclaimable lock has a good chance of succeeding once
 * that lock becomes reclaimable, without a dedicated cross-module coupling
 * to the store's internal staleness constant.
 */
const DEFAULT_EXPIRY_RETRY_DELAYS_MS = [250, 500, 1_000, 2_000, 4_000, 8_000]
const DEFAULT_EXPIRY_REARM_DELAY_MS = 30_000

export class AskUserRuntime {
  readonly coordinator: AskUserCoordinator
  readonly store: AskUserStore
  private readonly ownerPrincipalId: string
  private readonly now: () => Date
  private readonly perSessionPerMinute: number
  private readonly perPrincipalPerHour: number
  private readonly sessionBuckets = new Map<string, RateLimitBucket>()
  private readonly principalBuckets = new Map<string, RateLimitBucket>()
  /**
   * Timers that enforce a persisted `expiresAt` after this process has no
   * live `waitForAnswer` call for the question (e.g. rearmed at startup for
   * questions that survived a restart). Cleared whenever the question
   * resolves through any path so a stale timer cannot double-cancel.
   */
  private readonly expiryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly expiryRetryDelaysMs: number[]
  private readonly expiryRearmDelayMs: number
  private readonly onExpiryPersistentFailure: (info: { questionId: string; sessionId: string; error: unknown }) => void

  constructor(options: AskUserRuntimeOptions) {
    this.store = options.store
    this.coordinator = options.coordinator ?? new InProcessAskUserCoordinator()
    this.ownerPrincipalId = options.ownerPrincipalId ?? "anonymous"
    this.now = options.now ?? (() => new Date())
    this.perSessionPerMinute = options.limits?.perSessionPerMinute ?? 6
    this.perPrincipalPerHour = options.limits?.perPrincipalPerHour ?? 30
    this.expiryRetryDelaysMs = options.expiryReconcile?.retryDelaysMs ?? DEFAULT_EXPIRY_RETRY_DELAYS_MS
    this.expiryRearmDelayMs = options.expiryReconcile?.rearmDelayMs ?? DEFAULT_EXPIRY_REARM_DELAY_MS
    this.onExpiryPersistentFailure = options.expiryReconcile?.onPersistentFailure ?? (({ questionId, sessionId, error }) => {
      // eslint-disable-next-line no-console
      console.error(
        `[ask-user] failed to expire overdue question ${questionId} (session ${sessionId}) after retrying; rearming a retry timer`,
        error,
      )
    })
  }

  /**
   * Startup reconciliation (finding 1): a question's `expiresAt` was only
   * ever enforced by a process-local `setTimeout` tied to the in-flight
   * `ask()` call, so a restart before the deadline dropped enforcement
   * entirely. Called once when a process attaches to a durable store:
   * overdue `ready` questions are cancelled immediately, and questions with
   * a still-future `expiresAt` get a timer rearmed for the remaining delay.
   */
  async reconcileExpiries(): Promise<{ expired: string[]; rearmed: string[] }> {
    const expired: string[] = []
    const rearmed: string[] = []
    const pending = await this.store.listPending()
    const nowMs = this.now().getTime()
    for (const question of pending) {
      if (!question.expiresAt) continue
      const expiresAtMs = new Date(question.expiresAt).getTime()
      if (Number.isNaN(expiresAtMs)) continue
      // Finding 5: an unparseable expiresAt is fail-closed, not skipped --
      // treat it as already expired rather than leaving it perpetually
      // enforceable-but-never-reconciled.
      if (Number.isNaN(expiresAtMs) || expiresAtMs <= nowMs) {
        expired.push(question.questionId)
        await this.cancelQuestion(question.questionId, question.sessionId, "timeout").catch((error) => {
          // Finding 2: do not swallow. Retry with backoff past a typical
          // stale-lock reclamation window in the background so reconciliation
          // itself does not block startup on every retry.
          void this.cancelExpiredWithRetry(question.questionId, question.sessionId, error)
        })
      } else {
        rearmed.push(question.questionId)
        this.armExpiryTimer(question.questionId, question.sessionId, expiresAtMs - nowMs)
      }
    }
    return { expired, rearmed }
  }

  /**
   * Finding 2: crash-lock vs startup expiry. A single failed cancellation
   * attempt at startup does not mean the question can never be expired --
   * it may simply mean another process's crashed writer still holds a lock
   * that has not yet aged into the store's reclamation window. Retries with
   * backoff across `expiryRetryDelaysMs`; if every attempt in this pass
   * still fails, reports the failure (never silently) and rearms a timer to
   * run the whole sequence again after `expiryRearmDelayMs`, indefinitely,
   * rather than permanently abandoning the overdue question.
   */
  private async cancelExpiredWithRetry(questionId: string, sessionId: string, lastError: unknown): Promise<void> {
    let error = lastError
    for (const delayMs of this.expiryRetryDelaysMs) {
      await delay(delayMs)
      try {
        await this.cancelQuestion(questionId, sessionId, "timeout")
        return
      } catch (retryError) {
        error = retryError
      }
    }
    this.onExpiryPersistentFailure({ questionId, sessionId, error })
    const timer = setTimeout(() => {
      this.expiryTimers.delete(questionId)
      void this.cancelExpiredWithRetry(questionId, sessionId, error)
    }, this.expiryRearmDelayMs)
    if (typeof timer.unref === "function") timer.unref()
    this.expiryTimers.set(questionId, timer)
  }

  /**
   * Finding: transition+transcript are separate durable writes. On startup
   * (or whenever an operator wants to audit for drift), find every
   * terminal-state question whose transcript has no event matching its
   * current status -- the signature of a crash landing the state-transition
   * write but not the paired audit-event write -- and append a synthetic
   * `reconciled` event so the audit trail still reflects the true outcome.
   */
  async reconcileTranscripts(): Promise<{ synthesized: string[] }> {
    const synthesized: string[] = []
    const resolved = await this.store.listResolved()
    for (const question of resolved) {
      const events = await this.store.getTranscriptEventsForQuestion(question.questionId)
      // A terminal status never changes again (answer()/cancel() reject once
      // a question has left `ready`), so a previously synthesized
      // `reconciled` event for this question is itself sufficient proof of
      // reconciliation -- this keeps the pass idempotent.
      if (events.some((event) => event.type === "reconciled" || transcriptEventMatchesStatus(event.type, question.status))) continue
      await this.store.appendTranscriptEvent({
        type: "reconciled",
        questionId: question.questionId,
        sessionId: question.sessionId,
        status: question.status,
        synthetic: true,
        at: this.isoNow(),
      })
      synthesized.push(question.questionId)
    }
    return { synthesized }
  }

  /** Stops all reconciliation timers; call on process/plugin shutdown. */
  disposeExpiryTimers(): void {
    for (const timer of this.expiryTimers.values()) clearTimeout(timer)
    this.expiryTimers.clear()
  }

  private armExpiryTimer(questionId: string, sessionId: string, delayMs: number): void {
    this.clearExpiryTimer(questionId)
    const timer = setTimeout(() => {
      this.expiryTimers.delete(questionId)
      void this.cancelQuestion(questionId, sessionId, "timeout").catch(() => undefined)
    }, delayMs)
    if (typeof timer.unref === "function") timer.unref()
    this.expiryTimers.set(questionId, timer)
  }

  private clearExpiryTimer(questionId: string): void {
    const timer = this.expiryTimers.get(questionId)
    if (timer) {
      clearTimeout(timer)
      this.expiryTimers.delete(questionId)
    }
  }

  /**
   * Abandons a session's stale pending question when the same session asks
   * again without a live waiter. This is explicit supersession by the asking
   * session — the only path left that may transition a question to
   * `abandoned` (#1348: process restarts must not).
   */
  async abandonOrphanedPending(sessionIds: string[]): Promise<void> {
    for (const sessionId of sessionIds) {
      const pending = await this.store.getPending(sessionId)
      if (pending && !this.coordinator.hasWaiter(pending.questionId)) {
        await this.abandon(pending.questionId, pending.sessionId)
      }
    }
  }


  /**
   * Re-raises an abandoned question as `ready` (#1348 recovery for records
   * wiped by pre-fix restarts). The owner or an operator picks these up; a
   * restored question is answerable regardless of session liveness.
   */
  async restoreAbandoned(questionId: string): Promise<void> {
    const question = await this.store.getByQuestionId(questionId)
    if (!question) throw new AskUserRuntimeError(ASK_USER_ERROR_CODES.QUESTION_NOT_FOUND, "question not found")
    // Finding 8: the store transition is compare-and-set. Only append the
    // "restored" audit event when this call actually flipped abandoned ->
    // ready; a no-op restore (question was already ready) must emit nothing.
    const won = await this.store.restoreAbandoned(questionId)
    if (!won) return
    await this.store.appendTranscriptEvent({ type: "restored", questionId, sessionId: question.sessionId, at: this.isoNow() })
  }

  async ask(request: AskUserRequest, signal?: AbortSignal): Promise<AskUserToolResult> {
    const ownerPrincipalId = request.ownerPrincipalId ?? this.ownerPrincipalId
    await this.abandonOrphanedPending([request.sessionId])
    this.assertAllowed(request.sessionId, ownerPrincipalId)
    const parsedArtifacts = HumanArtifactListSchema.safeParse(request.artifacts ?? [])
    if (!parsedArtifacts.success) throw new AskUserRuntimeError(ASK_USER_ERROR_CODES.SCHEMA_INVALID, parsedArtifacts.error.message)
    const question = this.createQuestion({ ...request, artifacts: parsedArtifacts.data, ownerPrincipalId })
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

  async submitAnswer(questionId: string, sessionId: string, values: AskUserAnswer["values"], resolvedBy?: string): Promise<"answered"> {
    const question = await this.store.getByQuestionId(questionId)
    if (!question || question.sessionId !== sessionId) throw new AskUserRuntimeError(ASK_USER_ERROR_CODES.QUESTION_NOT_FOUND, "question not found")
    this.clearExpiryTimer(questionId)
    // #1348: a missing waiter means the asking session is gone (e.g. hub
    // restart), not that the question is void. The decision is still recorded
    // durably; resolving the coordinator below is a no-op without a waiter.
    // Decision-record fields (#1348 follow-up): snapshot the question's
    // declared risk tier and, when known, the resolving principal.
    const answer: AskUserAnswer = {
      questionId,
      sessionId,
      values,
      submittedAt: this.isoNow(),
      riskTier: question.riskTier,
      resolvedBy,
    }
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
    this.clearExpiryTimer(questionId)
    // #1348: like submitAnswer, cancellation persists even when the asking
    // session's waiter is gone — an owner dismissal after a restart is a real
    // decision, never downgraded to `abandoned`.
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
    // Finding 2: markAbandoned is compare-and-set. If a concurrent answer or
    // cancel already resolved this question, the transition loses and we
    // must not append a false "abandoned" audit event or resolve the
    // coordinator with a stale cancellation.
    const won = await this.store.markAbandoned(questionId)
    if (!won) return
    this.clearExpiryTimer(questionId)
    await this.store.appendTranscriptEvent({ type: "abandoned", questionId, sessionId, at: this.isoNow() })
    this.coordinator.resolveCancelled(questionId, "abandoned")
  }

  private createQuestion(
    request: Pick<AskUserRequest, "sessionId" | "title" | "context" | "artifacts" | "toolCallId" | "ownerPrincipalId" | "riskTier" | "timeoutMs">,
  ): AskUserQuestion {
    const at = this.isoNow()
    return {
      questionId: randomUUID(),
      sessionId: request.sessionId,
      toolCallId: request.toolCallId,
      ownerPrincipalId: request.ownerPrincipalId ?? this.ownerPrincipalId,
      status: "ready",
      title: request.title,
      context: request.context,
      artifacts: request.artifacts ?? [],
      answerToken: randomBytes(32).toString("base64url"),
      createdAt: at,
      updatedAt: at,
      riskTier: request.riskTier,
      expiresAt: request.timeoutMs ? new Date(this.now().getTime() + request.timeoutMs).toISOString() : undefined,
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

/** Whether a transcript event type is the "real" audit record for a terminal question status. */
function transcriptEventMatchesStatus(eventType: string, status: AskUserQuestionStatus): boolean {
  switch (status) {
    case "answered": return eventType === "answered"
    case "cancelled": return eventType === "cancelled"
    case "abandoned": return eventType === "abandoned"
    default: return true
  }
}
