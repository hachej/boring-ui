import { mkdtemp } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { describe, expect, it, vi } from "vitest"
import { ASK_USER_ERROR_CODES } from "../../shared/error-codes"
import type { AskUserFormSchema } from "../../shared/types"
import { FileAskUserStore } from "../AskUserStore"
import { AskUserRuntime, InProcessAskUserCoordinator, requireAskUserRuntime } from "../AskUserRuntime"

const schema: AskUserFormSchema = { wireVersion: 1, fields: [{ type: "text", name: "answer", label: "Answer" }] }

async function makeStore() {
  const dir = await mkdtemp(join(tmpdir(), "ask-user-runtime-"))
  return new FileAskUserStore(join(dir, "questions.json"))
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
    const first = runtime.beginAskUserStream({ sessionId: "s1", title: "A" })
    const second = runtime.beginAskUserStream({ sessionId: "s2", title: "B" })
    const [{ question: q1 }, { question: q2 }] = await Promise.all([first, second])
    expect(q1.ownerPrincipalId).toBe("anonymous")
    expect(q1.answerToken).not.toBe(q2.answerToken)
    expect(q1.answerToken.length).toBeGreaterThanOrEqual(22)
    await runtime.cancelQuestion(q1.questionId, "s1")
    await runtime.cancelQuestion(q2.questionId, "s2")
  })

  it("delivers submitted answers to the waiting ask call", async () => {
    const store = await makeStore()
    const runtime = new AskUserRuntime({ store })
    const { question, result } = await runtime.beginAskUserStream({ sessionId: "s1", title: "T" })
    await store.applyPatch(question.questionId, { patchId: "p1", type: "add_field", field: { type: "text", name: "answer", label: "Answer" } }, 0)
    await store.finalize(question.questionId, "Send", 1)
    await runtime.submitAnswer(question.questionId, "s1", { answer: "yes" })
    await expect(result).resolves.toMatchObject({ status: "answered", answer: { values: { answer: "yes" } } })
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

  it("rate limits by session", async () => {
    const store = await makeStore()
    const runtime = new AskUserRuntime({ store, limits: { perSessionPerMinute: 1, perPrincipalPerHour: 99 } })
    const { question } = await runtime.beginAskUserStream({ sessionId: "s1" })
    await expect(runtime.beginAskUserStream({ sessionId: "s1" })).rejects.toMatchObject({ code: ASK_USER_ERROR_CODES.RATE_LIMITED })
    await runtime.cancelQuestion(question.questionId, "s1")
  })

  it("abandons persisted startup orphans", async () => {
    const store = await makeStore()
    const runtime = new AskUserRuntime({ store })
    const { question } = await runtime.beginAskUserStream({ sessionId: "s1" })
    const restarted = new AskUserRuntime({ store })
    await restarted.abandonOrphanedPending(["s1"])
    await expect(store.getByQuestionId(question.questionId)).resolves.toMatchObject({ status: "abandoned" })
  })

  it("abandons if submit/cancel discovers a missing waiter", async () => {
    const store = await makeStore()
    const runtime = new AskUserRuntime({ store })
    const { question } = await runtime.beginAskUserStream({ sessionId: "s1" })
    const restarted = new AskUserRuntime({ store })
    await restarted.submitAnswer(question.questionId, "s1", {})
    await expect(store.getByQuestionId(question.questionId)).resolves.toMatchObject({ status: "abandoned" })
  })

  it("reports runtime unavailable", () => {
    expect(() => requireAskUserRuntime(undefined)).toThrow(expect.objectContaining({ code: ASK_USER_ERROR_CODES.RUNTIME_UNAVAILABLE }))
  })

  it("emits operational events without answer values", async () => {
    const emitEvent = vi.fn()
    const store = await makeStore()
    const runtime = new AskUserRuntime({ store, emitEvent })
    const { question, result } = await runtime.beginAskUserStream({ sessionId: "s1" })
    await store.applyPatch(question.questionId, { patchId: "p1", type: "add_field", field: { type: "text", name: "answer", label: "Answer" } }, 0)
    await store.finalize(question.questionId, undefined, 1)
    await runtime.submitAnswer(question.questionId, "s1", { answer: "secret" })
    await result
    expect(JSON.stringify(emitEvent.mock.calls)).not.toContain("secret")
  })
})
