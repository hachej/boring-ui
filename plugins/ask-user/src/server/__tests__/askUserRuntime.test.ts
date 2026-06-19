// @vitest-environment node

import { describe, expect, it, vi } from "vitest"
import { ASK_USER_ERROR_CODES } from "../../shared/error-codes"
import type { AskUserFormSchema, AskUserQuestion } from "../../shared/types"
import type { AskUserStore } from "../askUserStore"
import { AskUserRuntime, InProcessAskUserCoordinator, requireAskUserRuntime } from "../askUserRuntime"
import { MemoryAskUserStore } from "./testAskUserStore"

const schema: AskUserFormSchema = { wireVersion: 1, fields: [{ type: "text", name: "answer", label: "Answer" }] }

async function makeStore() {
  return new MemoryAskUserStore()
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
    const first = runtime.ask({ sessionId: "s1", title: "A", schema })
    const q1 = await pendingQuestion(store, "s1")
    expect(q1.ownerPrincipalId).toBe("anonymous")
    expect(q1.status).toBe("ready")
    expect(q1.answerToken.length).toBeGreaterThanOrEqual(22)
    await expect(runtime.ask({ sessionId: "s2", title: "B", schema })).rejects.toMatchObject({ code: ASK_USER_ERROR_CODES.PENDING_EXISTS })
    await waitForRuntimeWaiter(runtime, q1.questionId)
    await runtime.cancelQuestion(q1.questionId, "s1")
    await expect(first).resolves.toMatchObject({ status: "cancelled" })
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

  it("cancels on timeout and abort", async () => {
    const store = await makeStore()
    const runtime = new AskUserRuntime({ store })
    await expect(runtime.ask({ sessionId: "s1", title: "T", schema, timeoutMs: 1 })).resolves.toMatchObject({ status: "cancelled", reason: "timeout" })

    const controller = new AbortController()
    const promise = runtime.ask({ sessionId: "s2", title: "T", schema }, controller.signal)
    controller.abort()
    await expect(promise).resolves.toMatchObject({ status: "cancelled", reason: "aborted" })
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

  it("abandons persisted startup orphans", async () => {
    const store = await makeStore()
    const question = makeQuestion({ questionId: "orphan-q", sessionId: "s1" })
    await store.createPending(question)

    const restarted = new AskUserRuntime({ store })
    await restarted.abandonOrphanedPending(["s1"])
    await expect(store.getByQuestionId(question.questionId)).resolves.toMatchObject({ status: "abandoned" })
  })

  it("abandons if submit/cancel discovers a missing waiter", async () => {
    const store = await makeStore()
    const question = makeQuestion()
    await store.createPending(question)

    const restarted = new AskUserRuntime({ store })
    await restarted.submitAnswer(question.questionId, "s1", {})
    await expect(store.getByQuestionId(question.questionId)).resolves.toMatchObject({ status: "abandoned" })
  })

  it("reports runtime unavailable", () => {
    expect(() => requireAskUserRuntime(undefined)).toThrow(expect.objectContaining({ code: ASK_USER_ERROR_CODES.RUNTIME_UNAVAILABLE }))
  })

})
