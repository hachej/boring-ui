// @vitest-environment node

import { describe, expect, it, vi } from "vitest"
import { ASK_USER_ERROR_CODES } from "../../shared/error-codes"
import type { AskUserFormSchema, AskUserQuestion } from "../../shared/types"
import type { AskUserStore } from "../askUserStore"
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
  it("returns immediately for non-blocking questions and keeps multiple cards pending", async () => {
    const store = await makeStore()
    const runtime = new AskUserRuntime({ store })

    const first = await runtime.ask({ sessionId: "s1", title: "First", schema, blocking: false })
    const second = await runtime.ask({ sessionId: "s1", title: "Second", schema, blocking: false })

    expect(first).toMatchObject({ status: "pending", blocking: false, questionId: expect.any(String) })
    expect(second).toMatchObject({ status: "pending", blocking: false, questionId: expect.any(String) })
    await expect(store.listPending()).resolves.toHaveLength(2)
    if (first.status !== "pending" || second.status !== "pending") throw new Error("non-blocking ask did not return pending")
    expect(runtime.coordinator.hasWaiter(first.questionId)).toBe(false)
    expect(runtime.coordinator.hasWaiter(second.questionId)).toBe(false)
  })

  it("uses a separate higher session quota for non-blocking questions", async () => {
    const store = await makeStore()
    const runtime = new AskUserRuntime({ store, limits: { perPrincipalPerHour: 99 } })

    for (let index = 0; index < 7; index += 1) {
      await expect(runtime.ask({ sessionId: "s1", title: `Background ${index}`, schema, blocking: false }))
        .resolves.toMatchObject({ status: "pending", blocking: false })
    }
    await expect(store.listPending()).resolves.toHaveLength(7)
  })

  it("rate limits abusive non-blocking bursts without consuming the blocking bucket", async () => {
    const store = await makeStore()
    const runtime = new AskUserRuntime({
      store,
      limits: { perSessionPerMinute: 1, perNonBlockingSessionPerMinute: 2, perPrincipalPerHour: 99 },
    })

    await runtime.ask({ sessionId: "s1", schema, blocking: false })
    await runtime.ask({ sessionId: "s1", schema, blocking: false })
    await expect(runtime.ask({ sessionId: "s1", schema, blocking: false }))
      .rejects.toMatchObject({ code: ASK_USER_ERROR_CODES.RATE_LIMITED })

    const controller = new AbortController()
    const blocking = runtime.ask({ sessionId: "s1", schema }, controller.signal)
    const question = await vi.waitFor(async () => {
      const candidate = (await store.listPending()).find((entry) => entry.blocking !== false)
      expect(candidate).toBeDefined()
      return candidate!
    })
    await waitForRuntimeWaiter(runtime, question.questionId)
    controller.abort()
    await expect(blocking).resolves.toMatchObject({ status: "cancelled", reason: "aborted" })
  })

  it("keeps non-blocking questions pending when a later blocking question starts", async () => {
    const store = await makeStore()
    const runtime = new AskUserRuntime({ store })
    const nonBlocking = await runtime.ask({ sessionId: "s1", title: "Later", schema, blocking: false })
    if (nonBlocking.status !== "pending") throw new Error("non-blocking ask did not return pending")

    const blockingResult = runtime.ask({ sessionId: "s1", title: "Now", schema })
    await vi.waitFor(async () => expect(await store.listPending()).toHaveLength(2))
    const pending = await store.listPending()
    expect(pending).toEqual(expect.arrayContaining([
      expect.objectContaining({ questionId: nonBlocking.questionId, status: "ready", blocking: false }),
      expect.objectContaining({ title: "Now", status: "ready", blocking: true }),
    ]))

    const blocking = pending.find((question) => question.blocking !== false)!
    await runtime.cancelQuestion(blocking.questionId, blocking.sessionId)
    await expect(blockingResult).resolves.toMatchObject({ status: "cancelled" })
    await expect(store.getByQuestionId(nonBlocking.questionId)).resolves.toMatchObject({ status: "ready" })
  })

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

  // Inverted deliberately for #1348. This used to assert that a fresh runtime over a
  // persisted store abandons every pending question ("startup orphans"). A hub restart
  // must never void the owner's review queue: waiter presence is in-process state, so
  // after a restart every durable gate looks orphaned. `ready` survives the restart.
  it("keeps persisted pending questions ready and answerable across a restart (#1348)", async () => {
    const store = await makeStore()
    const question = makeQuestion({ questionId: "orphan-q", sessionId: "s1" })
    await store.createPending(question)

    const restarted = new AskUserRuntime({ store })
    await expect(store.listPending()).resolves.toMatchObject([{ questionId: question.questionId, status: "ready" }])
    await expect(store.getPending("s1")).resolves.toMatchObject({ status: "ready" })

    await expect(restarted.submitAnswer(question.questionId, "s1", { answer: "approved" })).resolves.toBe("answered")
    await expect(store.getByQuestionId(question.questionId)).resolves.toMatchObject({ status: "answered" })
    await expect(store.getTranscriptEventsForQuestion(question.questionId)).resolves.toMatchObject([
      { type: "answered", answer: { values: { answer: "approved" } } },
    ])
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

  it("supersedes an orphaned blocking question before every ask, including non-blocking asks", async () => {
    const store = await makeStore()
    const orphan = makeQuestion({ questionId: "orphan-q", sessionId: "s1", blocking: true })
    await store.createPending(orphan)

    const restarted = new AskUserRuntime({ store })
    await expect(restarted.ask({ sessionId: "s1", title: "Background follow-up", schema, blocking: false }))
      .resolves.toMatchObject({ status: "pending", blocking: false })

    await expect(store.getByQuestionId(orphan.questionId)).resolves.toMatchObject({ status: "abandoned" })
    await expect(store.getTranscriptEventsForQuestion(orphan.questionId)).resolves.toMatchObject([
      { type: "abandoned", questionId: orphan.questionId, sessionId: "s1" },
    ])
  })

  // Inverted deliberately for #1348: submit used to convert an answer into an
  // abandonment when the waiter was gone, silently dropping the owner's decision.
  it("persists an answer submitted after the waiter is gone (#1348)", async () => {
    const store = await makeStore()
    const question = makeQuestion()
    await store.createPending(question)

    const restarted = new AskUserRuntime({ store })
    await expect(restarted.submitAnswer(question.questionId, "s1", {})).resolves.toBe("answered")
    await expect(store.getByQuestionId(question.questionId)).resolves.toMatchObject({ status: "answered" })
  })

  it("abandons if cancel discovers a missing waiter", async () => {
    const store = await makeStore()
    const question = makeQuestion()
    await store.createPending(question)

    const restarted = new AskUserRuntime({ store })
    await restarted.cancelQuestion(question.questionId, "s1")
    await expect(store.getByQuestionId(question.questionId)).resolves.toMatchObject({ status: "abandoned" })
  })

  it("records a cancelled non-blocking question even though it has no waiter", async () => {
    const store = await makeStore()
    const runtime = new AskUserRuntime({ store })
    const pending = await runtime.ask({ sessionId: "s1", schema, blocking: false })
    if (pending.status !== "pending") throw new Error("non-blocking ask did not return pending")

    await runtime.cancelQuestion(pending.questionId, "s1")

    await expect(store.getByQuestionId(pending.questionId)).resolves.toMatchObject({ status: "cancelled" })
    await expect(store.getTranscriptEventsForQuestion(pending.questionId)).resolves.toEqual([
      expect.objectContaining({ type: "created" }),
      expect.objectContaining({ type: "ready" }),
      expect.objectContaining({ type: "cancelled", questionId: pending.questionId, reason: "user_cancelled" }),
    ])
  })

  it("reports runtime unavailable", () => {
    expect(() => requireAskUserRuntime(undefined)).toThrow(expect.objectContaining({ code: ASK_USER_ERROR_CODES.RUNTIME_UNAVAILABLE }))
  })

})
