// @vitest-environment node

import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { ASK_USER_ERROR_CODES } from "../../shared/error-codes"
import type { AskUserFormSchema, AskUserQuestion } from "../../shared/types"
import { FileAskUserStore, type AskUserStore } from "../askUserStore"
import type { UiBridge, UiCommand, UiState } from "@hachej/boring-workspace/server"
import { AskUserRuntime, InProcessAskUserCoordinator, requireAskUserRuntime } from "../askUserRuntime"
import { MemoryAskUserStore } from "./testAskUserStore"

const schema: AskUserFormSchema = { wireVersion: 1, fields: [{ type: "text", name: "answer", label: "Answer" }] }

async function makeStore() {
  return new MemoryAskUserStore()
}

function bridge(): UiBridge & { commands: UiCommand[] } {
  let state: UiState | null = null
  const commands: UiCommand[] = []
  return {
    commands,
    async getState() { return state },
    async setState(next) { state = next },
    async postCommand(cmd) { commands.push(cmd); return { seq: commands.length, status: "ok" } },
    subscribeCommands() { return () => undefined },
  }
}

class FailingCancelStore extends MemoryAskUserStore {
  override async cancel(questionId: string): Promise<void> {
    await super.getByQuestionId(questionId)
    throw new Error("cancel write failed")
  }
}

class DelayedAnsweredTranscriptStore extends MemoryAskUserStore {
  readonly answerPersisted: Promise<void>
  private answerPersistedResolve!: () => void
  private readonly transcriptRelease: Promise<void>
  releaseAnsweredTranscript!: () => void

  constructor() {
    super()
    this.answerPersisted = new Promise<void>((resolve) => { this.answerPersistedResolve = resolve })
    this.transcriptRelease = new Promise<void>((resolve) => { this.releaseAnsweredTranscript = resolve })
  }

  override async answer(...args: Parameters<MemoryAskUserStore["answer"]>): Promise<void> {
    await super.answer(...args)
    this.answerPersistedResolve()
  }

  override async cancel(questionId: string): Promise<void> {
    const question = await super.getByQuestionId(questionId)
    if (question?.status === "answered") {
      const error = new Error("question already answered") as Error & { code: string }
      error.code = ASK_USER_ERROR_CODES.ALREADY_ANSWERED
      throw error
    }
    await super.cancel(questionId)
  }

  override async appendTranscriptEvent(...args: Parameters<MemoryAskUserStore["appendTranscriptEvent"]>): Promise<void> {
    if (args[0].type === "answered") await this.transcriptRelease
    await super.appendTranscriptEvent(...args)
  }
}

class DelayedCreateStore extends MemoryAskUserStore {
  readonly createStarted: Promise<void>
  private readonly createRelease: Promise<void>
  private createStartedResolve!: () => void
  releaseCreate!: () => void

  constructor() {
    super()
    this.createStarted = new Promise<void>((resolve) => { this.createStartedResolve = resolve })
    this.createRelease = new Promise<void>((resolve) => { this.releaseCreate = resolve })
  }

  override async createPending(question: AskUserQuestion): Promise<void> {
    this.createStartedResolve()
    await this.createRelease
    await super.createPending(question)
  }
}

class DelayedMarkAbandonedStore extends MemoryAskUserStore {
  readonly markAbandonedStarted: Promise<void>
  releaseMarkAbandoned!: () => void
  private readonly release: Promise<void>
  private startedResolve!: () => void

  constructor() {
    super()
    this.markAbandonedStarted = new Promise<void>((resolve) => { this.startedResolve = resolve })
    this.release = new Promise<void>((resolve) => { this.releaseMarkAbandoned = resolve })
  }

  override async markAbandoned(questionId: string): Promise<boolean> {
    this.startedResolve()
    await this.release
    return super.markAbandoned(questionId)
  }
}

async function pendingQuestion(store: AskUserStore, sessionId: string) {
  const started = Date.now()
  while (Date.now() - started < 10_000) {
    const question = await store.getPending(sessionId)
    if (question) return question
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`timed out waiting for pending question for ${sessionId}`)
}

async function waitForRuntimeWaiter(runtime: AskUserRuntime, questionId: string) {
  await vi.waitFor(() => {
    expect(runtime.coordinator.hasWaiter(questionId)).toBe(true)
  }, { timeout: 10_000 })
}

function makeQuestion(overrides: Partial<AskUserQuestion> = {}): AskUserQuestion {
  const now = new Date().toISOString()
  return {
    questionId: "q1",
    sessionId: "s1",
    ownerPrincipalId: "anonymous",
    status: "ready",
    schema,
    artifacts: [],
    answerToken: "token",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe("InProcessAskUserCoordinator", () => {
  it("resolves answered/cancelled exactly once", async () => {
    const coordinator = new InProcessAskUserCoordinator()
    const promise = coordinator.registerWaiter("q1", "s1")
    expect(coordinator.resolveAnswered("q1", { questionId: "q1", sessionId: "s1", values: { answer: "ok" }, submittedAt: new Date().toISOString() })).toBe(true)
    expect(coordinator.resolveCancelled("q1", "user_cancelled")).toBe(false)
    await expect(promise).resolves.toMatchObject({ status: "answered" })
  })

  it("resolves aborts", async () => {
    const coordinator = new InProcessAskUserCoordinator()
    const controller = new AbortController()
    const promise = coordinator.registerWaiter("q1", "s1", controller.signal)
    controller.abort()
    await expect(promise).resolves.toMatchObject({ status: "cancelled", reason: "aborted" })
  })
})

describe("AskUserRuntime", () => {
  it("creates ready questions with anonymous owner and random answer tokens", async () => {
    const store = await makeStore()
    const runtime = new AskUserRuntime({ store })
    const artifact = { id: "plan", surfaceKind: "file", target: "docs/plan.md", title: "Plan" }
    const first = runtime.ask({ sessionId: "s1", title: "A", schema, artifacts: [artifact] })
    const q1 = await pendingQuestion(store, "s1")
    expect(q1.ownerPrincipalId).toBe("anonymous")
    expect(q1.artifacts).toEqual([artifact])
    expect(q1.status).toBe("ready")
    expect(q1.answerToken.length).toBeGreaterThanOrEqual(22)
    await expect(runtime.ask({ sessionId: "s1", title: "A2", schema })).rejects.toMatchObject({ code: ASK_USER_ERROR_CODES.PENDING_EXISTS })

    const second = runtime.ask({ sessionId: "s2", title: "B", schema })
    const q2 = await pendingQuestion(store, "s2")
    expect(q2.sessionId).toBe("s2")
    await waitForRuntimeWaiter(runtime, q1.questionId)
    await waitForRuntimeWaiter(runtime, q2.questionId)
    await runtime.cancelQuestion(q1.questionId, "s1")
    await runtime.cancelQuestion(q2.questionId, "s2")
    await expect(first).resolves.toMatchObject({ status: "cancelled" })
    await expect(second).resolves.toMatchObject({ status: "cancelled" })
  })

  it("delivers submitted answers to the waiting ask call", async () => {
    const store = await makeStore()
    const runtime = new AskUserRuntime({ store })
    const result = runtime.ask({ sessionId: "s1", title: "T", schema })
    const question = await pendingQuestion(store, "s1")
    await waitForRuntimeWaiter(runtime, question.questionId)
    await runtime.submitAnswer(question.questionId, "s1", { answer: "yes" })
    await expect(result).resolves.toMatchObject({ status: "answered", answer: { values: { answer: "yes" } } })
  }, 30_000)

  it("registers the waiter before publishing the pending question", async () => {
    const store = await makeStore()
    const runtime = new AskUserRuntime({ store })
    const result = runtime.ask({ sessionId: "s1", title: "T", schema })
    const question = await pendingQuestion(store, "s1")
    await runtime.submitAnswer(question.questionId, "s1", { answer: "fast" })
    await expect(result).resolves.toMatchObject({ status: "answered", answer: { values: { answer: "fast" } } })
  }, 30_000)

  it("cancels persisted questions if abort wins while createPending is in flight", async () => {
    const store = new DelayedCreateStore()
    const runtime = new AskUserRuntime({ store })
    const controller = new AbortController()
    const result = runtime.ask({ sessionId: "s1", title: "T", schema }, controller.signal)

    await store.createStarted
    controller.abort()
    store.releaseCreate()

    await expect(result).resolves.toMatchObject({ status: "cancelled", reason: "aborted" })
    await expect(store.getPending("s1")).resolves.toBeNull()
    expect(await store.getPending("s1")).toBeNull()
  })

  it("settles the waiter even if persisting cancellation fails", async () => {
    const store = new FailingCancelStore()
    const runtime = new AskUserRuntime({ store })
    const result = runtime.ask({ sessionId: "s1", title: "T", schema })
    const question = await pendingQuestion(store, "s1")
    await waitForRuntimeWaiter(runtime, question.questionId)

    await expect(runtime.cancelQuestion(question.questionId, "s1", "user_cancelled")).rejects.toThrow("cancel write failed")
    await expect(result).resolves.toMatchObject({ status: "cancelled", reason: "user_cancelled" })
    expect(runtime.coordinator.hasWaiter(question.questionId)).toBe(false)
  })

  it("does not let a concurrent cancel override an already-persisted answer", async () => {
    const store = new DelayedAnsweredTranscriptStore()
    const runtime = new AskUserRuntime({ store })
    const result = runtime.ask({ sessionId: "s1", title: "T", schema })
    const question = await pendingQuestion(store, "s1")
    await waitForRuntimeWaiter(runtime, question.questionId)

    const submit = runtime.submitAnswer(question.questionId, "s1", { answer: "accepted" })
    await store.answerPersisted
    await expect(runtime.cancelQuestion(question.questionId, "s1", "user_cancelled")).rejects.toMatchObject({ code: ASK_USER_ERROR_CODES.ALREADY_ANSWERED })
    store.releaseAnsweredTranscript()

    await expect(submit).resolves.toBe("answered")
    await expect(result).resolves.toMatchObject({ status: "answered", answer: { values: { answer: "accepted" } } })
  })

  it("cancels on timeout and abort", async () => {
    const store = await makeStore()
    const runtime = new AskUserRuntime({ store })
    await expect(runtime.ask({ sessionId: "s1", title: "T", schema, timeoutMs: 1 })).resolves.toMatchObject({ status: "cancelled", reason: "timeout" })

    const controller = new AbortController()
    const promise = runtime.ask({ sessionId: "s2", title: "T", schema }, controller.signal)
    controller.abort()
    await expect(promise).resolves.toMatchObject({ status: "cancelled", reason: "aborted" })
  })

  it("rate limits by per-request owner principal when provided", async () => {
    const store = await makeStore()
    const runtime = new AskUserRuntime({ store, limits: { perSessionPerMinute: 99, perPrincipalPerHour: 1 } })
    const firstController = new AbortController()
    const first = runtime.ask({ sessionId: "s1", schema, ownerPrincipalId: "p1" }, firstController.signal)
    const q1 = await pendingQuestion(store, "s1")
    await waitForRuntimeWaiter(runtime, q1.questionId)
    firstController.abort()
    await expect(first).resolves.toMatchObject({ status: "cancelled", reason: "aborted" })
    await expect(runtime.ask({ sessionId: "s2", schema, ownerPrincipalId: "p1" })).rejects.toMatchObject({ code: ASK_USER_ERROR_CODES.RATE_LIMITED })
    const secondController = new AbortController()
    const second = runtime.ask({ sessionId: "s3", schema, ownerPrincipalId: "p2" }, secondController.signal)
    const q2 = await pendingQuestion(store, "s3")
    await waitForRuntimeWaiter(runtime, q2.questionId)
    secondController.abort()
    await expect(second).resolves.toMatchObject({ status: "cancelled", reason: "aborted" })
  })

  it("rate limits by session", async () => {
    const store = await makeStore()
    const runtime = new AskUserRuntime({ store, limits: { perSessionPerMinute: 1, perPrincipalPerHour: 99 } })
    const controller = new AbortController()
    const first = runtime.ask({ sessionId: "s1", schema }, controller.signal)
    const question = await pendingQuestion(store, "s1")
    await vi.waitFor(() => expect(runtime.coordinator.hasWaiter(question.questionId)).toBe(true))
    await expect(runtime.ask({ sessionId: "s1", schema })).rejects.toMatchObject({ code: ASK_USER_ERROR_CODES.RATE_LIMITED })
    controller.abort()
    await expect(first).resolves.toMatchObject({ status: "cancelled", reason: "aborted" })
  })

  it("keeps an unanswered session's stale pending question abandoned only on explicit supersession", async () => {
    const store = await makeStore()
    const orphan = makeQuestion({ questionId: "orphan-q", sessionId: "s1" })
    await store.createPending(orphan)

    const restarted = new AskUserRuntime({ store })
    await restarted.abandonOrphanedPending(["s1"])
    await expect(store.getByQuestionId(orphan.questionId)).resolves.toMatchObject({ status: "abandoned" })
    await restarted.restoreAbandoned(orphan.questionId)
    await expect(store.getPending("s1")).resolves.toMatchObject({ questionId: "orphan-q", status: "ready" })
  })

  it("abandons an orphaned pending question before creating a new one for the same session", async () => {
    const store = await makeStore()
    const orphan = makeQuestion({ questionId: "orphan-q", sessionId: "s1" })
    await store.createPending(orphan)

    const restarted = new AskUserRuntime({ store })
    const next = restarted.ask({ sessionId: "s1", title: "Fresh question", schema })
    let pending = await pendingQuestion(store, "s1")
    await vi.waitFor(async () => {
      pending = await pendingQuestion(store, "s1")
      expect(pending.questionId).not.toBe(orphan.questionId)
    })

    await expect(store.getByQuestionId(orphan.questionId)).resolves.toMatchObject({ status: "abandoned" })
    await waitForRuntimeWaiter(restarted, pending.questionId)
    await restarted.cancelQuestion(pending.questionId, "s1")
    await expect(next).resolves.toMatchObject({ status: "cancelled" })
  })

  it("answers and cancels persisted questions after a restart even though no waiter exists", async () => {
    const store = await makeStore()
    const question = makeQuestion({ questionId: "durable-q", sessionId: "s1" })
    await store.createPending(question)

    // Fresh process: the in-memory coordinator has no waiter for this question.
    const restarted = new AskUserRuntime({ store })
    await expect(restarted.submitAnswer(question.questionId, "s1", { answer: "approved" })).resolves.toBe("answered")
    await expect(store.getByQuestionId(question.questionId)).resolves.toMatchObject({ status: "answered" })
    const answeredEvents = await store.getTranscriptEventsForQuestion(question.questionId)
    expect(answeredEvents.filter((event) => event.type === "answered")).toHaveLength(1)

    const cancelled = makeQuestion({ questionId: "durable-q2", sessionId: "s2" })
    await store.createPending(cancelled)
    await restarted.cancelQuestion(cancelled.questionId, "s2", "user_cancelled")
    await expect(store.getByQuestionId(cancelled.questionId)).resolves.toMatchObject({ status: "cancelled" })
  })

  it("snapshots riskTier and resolvedBy onto the answer as a thin decision record", async () => {
    const store = await makeStore()
    const question = makeQuestion({ questionId: "decision-q", sessionId: "s1", riskTier: "consequential" })
    await store.createPending(question)

    const runtime = new AskUserRuntime({ store })
    await expect(runtime.submitAnswer(question.questionId, "s1", { answer: "approved" }, "user:owner")).resolves.toBe("answered")

    const answer = await store.getAnswer(question.questionId)
    expect(answer).toMatchObject({ riskTier: "consequential", resolvedBy: "user:owner" })

    const record = await store.getDecisionRecord(question.questionId)
    expect(record).toMatchObject({
      questionId: question.questionId,
      sessionId: "s1",
      values: { answer: "approved" },
      riskTier: "consequential",
      resolvedBy: "user:owner",
    })
    expect(record?.resolvedAt).toBeTruthy()
  })

  it("resolvedBy is undefined when the resolving principal is unknown, and old-shape answers still work", async () => {
    const store = await makeStore()
    const question = makeQuestion({ questionId: "anon-q", sessionId: "s1" })
    await store.createPending(question)

    const runtime = new AskUserRuntime({ store })
    await expect(runtime.submitAnswer(question.questionId, "s1", { answer: "ok" })).resolves.toBe("answered")

    const answer = await store.getAnswer(question.questionId)
    expect(answer?.resolvedBy).toBeUndefined()
    expect(answer?.riskTier).toBeUndefined()
  })

  it("restores abandoned questions to ready (#1348 recovery)", async () => {
    const store = await makeStore()
    const question = makeQuestion({ questionId: "legacy-q", sessionId: "s1" })
    await store.createPending(question)
    await store.markAbandoned("legacy-q")

    const runtime = new AskUserRuntime({ store })
    await runtime.restoreAbandoned("legacy-q")
    await expect(store.getByQuestionId("legacy-q")).resolves.toMatchObject({ status: "ready" })
    await expect(store.getPending("s1")).resolves.toMatchObject({ questionId: "legacy-q" })
    const events = await store.getTranscriptEventsForQuestion("legacy-q")
    expect(events.filter((event) => event.type === "restored")).toHaveLength(1)

    await expect(runtime.restoreAbandoned("missing-q")).rejects.toMatchObject({ code: ASK_USER_ERROR_CODES.QUESTION_NOT_FOUND })
  })

  it("emits no restored event for a no-op restore of an already-ready question (finding 8)", async () => {
    const store = await makeStore()
    const question = makeQuestion({ questionId: "already-ready-q", sessionId: "s1" })
    await store.createPending(question)

    const runtime = new AskUserRuntime({ store })
    // The question is already `ready`; restoreAbandoned must be a truthful no-op.
    await runtime.restoreAbandoned("already-ready-q")
    const events = await store.getTranscriptEventsForQuestion("already-ready-q")
    expect(events.some((event) => event.type === "restored")).toBe(false)
  })

  it("reports runtime unavailable", () => {
    expect(() => requireAskUserRuntime(undefined)).toThrow(expect.objectContaining({ code: ASK_USER_ERROR_CODES.RUNTIME_UNAVAILABLE }))
  })

  it("does not record a false abandoned event when a concurrent answer wins the race (finding 2)", async () => {
    const store = new DelayedMarkAbandonedStore()
    const question = makeQuestion({ questionId: "race-q", sessionId: "s1" })
    await store.createPending(question)

    const runtime = new AskUserRuntime({ store })
    // Simulates abandonOrphanedPending reading the question as pending, then
    // racing a concurrent answer before its markAbandoned call executes.
    const abandonPromise = runtime.abandonOrphanedPending(["s1"])
    await store.markAbandonedStarted

    await expect(runtime.submitAnswer("race-q", "s1", { answer: "yes" })).resolves.toBe("answered")

    store.releaseMarkAbandoned()
    await abandonPromise

    const events = await store.getTranscriptEventsForQuestion("race-q")
    expect(events.some((event) => event.type === "abandoned")).toBe(false)
    expect(events.filter((event) => event.type === "answered")).toHaveLength(1)
    await expect(store.getByQuestionId("race-q")).resolves.toMatchObject({ status: "answered" })
  })

})

describe("AskUserRuntime real restart path (finding 4)", () => {
  it("store A creates, a fresh store B answers, and a fresh store C reopens and verifies durable state + transcript", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ask-user-restart-"))
    const filePath = join(dir, "ask-user.json")
    try {
      // Process A: creates the question and is blocked inside ask().
      const storeA = new FileAskUserStore(filePath)
      const runtimeA = new AskUserRuntime({ store: storeA })
      const controller = new AbortController()
      const pendingResult = runtimeA.ask({ sessionId: "s1", title: "Durable gate", schema, timeoutMs: 60_000 }, controller.signal)
      const question = await pendingQuestion(storeA, "s1")
      await waitForRuntimeWaiter(runtimeA, question.questionId)

      // Process A "dies": storeA/runtimeA are never touched again. Its
      // blocking ask() call never resolves in this test; that's realistic
      // for a killed process and irrelevant to the durable truth on disk.
      pendingResult.catch(() => undefined)

      // Process B: a brand-new FileAskUserStore + AskUserRuntime instance
      // backed by the same file, with no in-memory waiter for this question.
      const storeB = new FileAskUserStore(filePath)
      const runtimeB = new AskUserRuntime({ store: storeB })
      await expect(runtimeB.submitAnswer(question.questionId, "s1", { answer: "approved" }, "user:owner")).resolves.toBe("answered")

      // Process C: a third, independent instance reopening the same file
      // must see the durable truth, not anything held in memory by A or B.
      const storeC = new FileAskUserStore(filePath)
      await expect(storeC.getByQuestionId(question.questionId)).resolves.toMatchObject({ status: "answered" })
      await expect(storeC.getAnswer(question.questionId)).resolves.toMatchObject({
        values: { answer: "approved" },
        resolvedBy: "user:owner",
      })
      const events = await storeC.getTranscriptEventsForQuestion(question.questionId)
      expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(["created", "ready", "answered"]))
      expect(events.filter((event) => event.type === "answered")).toHaveLength(1)

      controller.abort()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("AskUserRuntime expiry (finding 1)", () => {
  it("persists expiresAt on questions created with a timeout", async () => {
    const store = await makeStore()
    const runtime = new AskUserRuntime({ store })
    const controller = new AbortController()
    const result = runtime.ask({ sessionId: "s1", title: "T", schema, timeoutMs: 60_000 }, controller.signal)
    const question = await pendingQuestion(store, "s1")
    expect(question.expiresAt).toBeTruthy()
    expect(new Date(question.expiresAt!).getTime()).toBeGreaterThan(Date.now())
    controller.abort()
    await result
  })

  it("startup reconciliation expires overdue questions and rearms future ones", async () => {
    const store = await makeStore()
    const past = makeQuestion({ questionId: "overdue-q", sessionId: "s1", expiresAt: new Date(Date.now() - 1_000).toISOString() })
    const future = makeQuestion({ questionId: "future-q", sessionId: "s2", expiresAt: new Date(Date.now() + 50).toISOString() })
    await store.createPending(past)
    await store.createPending(future)

    const restarted = new AskUserRuntime({ store })
    const { expired, rearmed } = await restarted.reconcileExpiries()
    expect(expired).toEqual(["overdue-q"])
    expect(rearmed).toEqual(["future-q"])

    await expect(store.getByQuestionId("overdue-q")).resolves.toMatchObject({ status: "cancelled" })
    const overdueEvents = await store.getTranscriptEventsForQuestion("overdue-q")
    expect(overdueEvents).toContainEqual(expect.objectContaining({ type: "cancelled", reason: "timeout" }))

    // The rearmed timer fires the still-future expiry without a live waiter.
    await vi.waitFor(async () => {
      await expect(store.getByQuestionId("future-q")).resolves.toMatchObject({ status: "cancelled" })
    }, { timeout: 5_000 })
    restarted.disposeExpiryTimers()
  })

  it("fail-closes (expires) a question with an unparseable persisted expiresAt (finding 3: NaN early-continue made the fail-closed branch unreachable)", async () => {
    const store = await makeStore()
    const question = makeQuestion({ questionId: "nan-q", sessionId: "s1", expiresAt: "not-a-real-date" })
    await store.createPending(question)

    const runtime = new AskUserRuntime({ store })
    const { expired } = await runtime.reconcileExpiries()
    expect(expired).toEqual(["nan-q"])

    await expect(store.getByQuestionId("nan-q")).resolves.toMatchObject({ status: "cancelled" })
    const events = await store.getTranscriptEventsForQuestion("nan-q")
    expect(events).toContainEqual(expect.objectContaining({ type: "cancelled", reason: "timeout" }))
  })

  it("rejects an answer submitted after the persisted expiry", async () => {
    const store = await makeStore()
    const question = makeQuestion({ questionId: "expired-q", sessionId: "s1", expiresAt: new Date(Date.now() - 1_000).toISOString() })
    await store.createPending(question)
    await expect(store.answer("expired-q", { questionId: "expired-q", sessionId: "s1", values: {}, submittedAt: new Date().toISOString() }))
      .rejects.toMatchObject({ code: ASK_USER_ERROR_CODES.QUESTION_EXPIRED })
  })
})

describe("AskUserRuntime crash-lock vs startup expiry (finding 2)", () => {
  it("retries a failed expiry cancellation and succeeds once a pre-seeded stale lock becomes reclaimable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ask-user-crash-lock-"))
    const filePath = join(dir, "ask-user.json")
    try {
      let clock = new Date("2026-08-22T00:00:00.000Z")
      const store = new FileAskUserStore(filePath, { now: () => clock, lockStaleMs: 50 })
      await store.createPending(makeQuestion({ questionId: "overdue-q", sessionId: "s1", expiresAt: new Date(clock.getTime() - 1_000).toISOString() }))

      // Simulate a writer that crashed mid-write, holding a lock the store
      // does not yet consider stale (per its injected clock).
      await writeFile(`${filePath}.lock`, JSON.stringify({ token: "dead", pid: 999_999, acquiredAtMs: clock.getTime() }), "utf8")

      const runtime = new AskUserRuntime({
        store,
        now: () => clock,
        expiryReconcile: { retryDelaysMs: [5, 5, 5], rearmDelayMs: 20 },
      })

      const { expired } = await runtime.reconcileExpiries()
      expect(expired).toEqual(["overdue-q"])
      // The first attempt could not reclaim the not-yet-stale lock.
      await expect(store.getByQuestionId("overdue-q")).resolves.toMatchObject({ status: "ready" })

      // Time passes past lockStaleMs; the background retry loop's next
      // attempt reclaims the now-stale lock and completes the cancellation.
      clock = new Date(clock.getTime() + 1_000)
      await vi.waitFor(async () => {
        await expect(store.getByQuestionId("overdue-q")).resolves.toMatchObject({ status: "cancelled" })
      }, { timeout: 5_000 })

      runtime.disposeExpiryTimers()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("reports (never swallows) a persistent expiry-cancellation failure and rearms a retry that eventually succeeds", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ask-user-crash-lock-rearm-"))
    const filePath = join(dir, "ask-user.json")
    try {
      let clock = new Date("2026-08-22T00:00:00.000Z")
      // A lock-staleness window long enough that every retry in the first
      // pass still fails.
      const store = new FileAskUserStore(filePath, { now: () => clock, lockStaleMs: 10_000 })
      await store.createPending(makeQuestion({ questionId: "overdue-q", sessionId: "s1", expiresAt: new Date(clock.getTime() - 1_000).toISOString() }))
      await writeFile(`${filePath}.lock`, JSON.stringify({ token: "dead", pid: 999_999, acquiredAtMs: clock.getTime() }), "utf8")

      const failures: Array<{ questionId: string; sessionId: string }> = []
      const runtime = new AskUserRuntime({
        store,
        now: () => clock,
        expiryReconcile: {
          retryDelaysMs: [2, 2],
          rearmDelayMs: 5,
          onPersistentFailure: (info) => failures.push(info),
        },
      })

      await runtime.reconcileExpiries()
      // The failure must be reported, not silently dropped.
      await vi.waitFor(() => expect(failures).toContainEqual(expect.objectContaining({ questionId: "overdue-q", sessionId: "s1" })), { timeout: 3_000 })
      await expect(store.getByQuestionId("overdue-q")).resolves.toMatchObject({ status: "ready" })

      // Advance time past the lock-staleness window; the rearmed timer's
      // next pass reclaims the lock and finishes the job.
      clock = new Date(clock.getTime() + 11_000)
      await vi.waitFor(async () => {
        await expect(store.getByQuestionId("overdue-q")).resolves.toMatchObject({ status: "cancelled" })
      }, { timeout: 5_000 })

      runtime.disposeExpiryTimers()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("stops retrying and never reports a failure once another actor resolves the question during backoff (finding: retry vs concurrent resolution)", async () => {
    class AlwaysFailingCancelStore extends MemoryAskUserStore {
      cancelCalls = 0
      override async cancel(): Promise<void> {
        this.cancelCalls += 1
        throw new Error("simulated transient cancel failure")
      }
    }
    const store = new AlwaysFailingCancelStore()
    await store.createPending(makeQuestion({ questionId: "q1", sessionId: "s1", expiresAt: new Date(Date.now() - 1_000).toISOString() }))

    const failures: Array<{ questionId: string; sessionId: string }> = []
    const runtime = new AskUserRuntime({
      store,
      expiryReconcile: {
        retryDelaysMs: [10, 10, 10, 10, 10],
        rearmDelayMs: 5,
        onPersistentFailure: (info) => failures.push(info),
      },
    })

    const { expired } = await runtime.reconcileExpiries()
    expect(expired).toEqual(["q1"])

    // Another actor entirely -- e.g. the asking session being abandoned via
    // a different code path -- resolves the question while the retry loop
    // is still backing off between attempts. (A real "answer" is not usable
    // here: the store itself rejects answering an already-expired question,
    // by design -- `markAbandoned` has no such guard and is a legitimate
    // terminal transition a concurrent actor can perform.) `cancel` on this
    // store always fails, so without the fix the retry loop would exhaust
    // its schedule and report a persistent failure.
    await new Promise((resolve) => setTimeout(resolve, 15))
    await store.markAbandoned("q1")

    // Give the retry loop enough time to have exhausted its full schedule
    // (50ms) and rearmed at least once (5ms) if it were going to.
    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(failures).toEqual([])
    await expect(store.getByQuestionId("q1")).resolves.toMatchObject({ status: "abandoned" })
    runtime.disposeExpiryTimers()
  })
})

describe("AskUserRuntime transcript reconciliation (finding: transition+transcript separate writes)", () => {
  it("synthesizes a reconciled event for an answered question with no matching transcript event", async () => {
    const store = await makeStore()
    // Directly persisted as already `answered`, with no "answered"
    // transcript event -- simulating a crash between the state-transition
    // write and the paired audit-event write.
    const question = makeQuestion({ questionId: "q1", sessionId: "s1", status: "answered" })
    await store.createPending(question)

    await expect(store.getTranscriptEventsForQuestion("q1")).resolves.toEqual([])

    const runtime = new AskUserRuntime({ store })
    const { synthesized } = await runtime.reconcileTranscripts()
    expect(synthesized).toEqual(["q1"])

    const events = await store.getTranscriptEventsForQuestion("q1")
    expect(events).toEqual([
      expect.objectContaining({ type: "reconciled", questionId: "q1", sessionId: "s1", status: "answered", synthetic: true }),
    ])

    // Idempotent: reconciling again does not duplicate the synthetic event.
    await expect(runtime.reconcileTranscripts()).resolves.toEqual({ synthesized: [] })
    await expect(store.getTranscriptEventsForQuestion("q1")).resolves.toHaveLength(1)
  })

  it("does not synthesize an event for a question whose real transcript event is already present", async () => {
    const store = await makeStore()
    await store.createPending(makeQuestion({ questionId: "q1", sessionId: "s1" }))
    await store.answer("q1", { questionId: "q1", sessionId: "s1", values: { a: "ok" }, submittedAt: new Date().toISOString() })
    await store.appendTranscriptEvent({ type: "answered", answer: { questionId: "q1", sessionId: "s1", values: { a: "ok" }, submittedAt: new Date().toISOString() }, at: new Date().toISOString() })

    const runtime = new AskUserRuntime({ store })
    await expect(runtime.reconcileTranscripts()).resolves.toEqual({ synthesized: [] })
  })

  it("leaves a still-pending (ready) question alone", async () => {
    const store = await makeStore()
    await store.createPending(makeQuestion({ questionId: "q1", sessionId: "s1" }))

    const runtime = new AskUserRuntime({ store })
    await expect(runtime.reconcileTranscripts()).resolves.toEqual({ synthesized: [] })
  })

  it("appends a synthetic reconciled event when starting from a durable file with answered state but no answered event", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ask-user-reconcile-"))
    const filePath = join(dir, "ask-user.json")
    try {
      const answeredQuestion = makeQuestion({ questionId: "q1", sessionId: "s1", status: "answered" })
      const state = {
        version: 1,
        revision: 1,
        questions: { q1: answeredQuestion },
        pendingBySession: {},
        answers: {
          q1: { questionId: "q1", sessionId: "s1", values: { a: "ok" }, submittedAt: new Date().toISOString() },
        },
        transcriptsBySession: {},
      }
      await writeFile(filePath, JSON.stringify(state, null, 2), "utf8")

      const store = new FileAskUserStore(filePath)
      const runtime = new AskUserRuntime({ store })
      const { synthesized } = await runtime.reconcileTranscripts()
      expect(synthesized).toEqual(["q1"])

      const events = await store.getTranscriptEventsForQuestion("q1")
      expect(events).toEqual([
        expect.objectContaining({ type: "reconciled", questionId: "q1", sessionId: "s1", status: "answered", synthetic: true }),
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("recovers a later terminal transition even when an earlier reconciled event exists for a different, prior status (finding 4)", async () => {
    const store = await makeStore()
    // abandoned -> restored -> answered, with only the "abandoned" audit
    // event and a stale synthetic "reconciled" event from an earlier
    // reconciliation pass (when the question really was abandoned). The
    // paired "answered" audit-event write is missing -- a crash between the
    // state transition and the transcript write.
    await store.createPending(makeQuestion({ questionId: "q1", sessionId: "s1", status: "abandoned" }))
    await store.appendTranscriptEvent({ type: "abandoned", questionId: "q1", sessionId: "s1", at: new Date(0).toISOString() })
    await store.appendTranscriptEvent({ type: "reconciled", questionId: "q1", sessionId: "s1", status: "abandoned", synthetic: true, at: new Date(1).toISOString() })

    await store.restoreAbandoned("q1")
    await store.answer("q1", { questionId: "q1", sessionId: "s1", values: { a: "ok" }, submittedAt: new Date(2).toISOString() })

    const runtime = new AskUserRuntime({ store })
    const { synthesized } = await runtime.reconcileTranscripts()
    expect(synthesized).toEqual(["q1"])

    const events = await store.getTranscriptEventsForQuestion("q1")
    // A fresh reconciled event for the current ("answered") status was
    // synthesized -- the stale abandoned-status one did not suppress it.
    expect(events).toContainEqual(expect.objectContaining({ type: "reconciled", status: "answered", synthetic: true }))
    expect(events).toContainEqual(expect.objectContaining({ type: "reconciled", status: "abandoned", synthetic: true }))

    // Idempotent: running again does not add a second "answered" reconciled event.
    await expect(runtime.reconcileTranscripts()).resolves.toEqual({ synthesized: [] })
    expect((await store.getTranscriptEventsForQuestion("q1")).filter((e) => e.type === "reconciled")).toHaveLength(2)
  })

  it("running reconcileTranscripts concurrently across two store instances sharing a file produces exactly one synthetic event (finding 5: atomic check-and-append)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ask-user-reconcile-race-"))
    const filePath = join(dir, "ask-user.json")
    try {
      const seeder = new FileAskUserStore(filePath)
      await seeder.createPending(makeQuestion({ questionId: "q1", sessionId: "s1", status: "answered" }))

      // Two independent store instances over the same file, as two racing
      // processes/reconciliation triggers would use -- neither shares the
      // other's in-memory cache or write-serialization queue, so only the
      // store's on-disk lock/CAS can prevent a duplicate.
      const runtimeA = new AskUserRuntime({ store: new FileAskUserStore(filePath) })
      const runtimeB = new AskUserRuntime({ store: new FileAskUserStore(filePath) })

      const [resultA, resultB] = await Promise.all([runtimeA.reconcileTranscripts(), runtimeB.reconcileTranscripts()])
      expect(resultA.synthesized.length + resultB.synthesized.length).toBe(1)

      const verifier = new FileAskUserStore(filePath)
      const events = await verifier.getTranscriptEventsForQuestion("q1")
      expect(events.filter((e) => e.type === "reconciled")).toHaveLength(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
