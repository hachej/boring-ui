import { describe, expect, test } from "vitest"
import { InMemoryPendingQuestionStore, PENDING_QUESTION_ERROR_CODES, PendingQuestionStoreError } from "../pendingQuestionStore"
import { PendingQuestionRuntime } from "../pendingQuestionRuntime"

function runtime() {
  const store = new InMemoryPendingQuestionStore()
  return { store, runtime: new PendingQuestionRuntime(store, () => new Date("2026-05-24T00:00:00.000Z")) }
}

describe("workspace pending-question runtime", () => {
  test("creates pending records and redacted transcript events", async () => {
    const ctx = runtime()
    const question = await ctx.runtime.createPending({
      requestId: "req-1",
      sessionId: "sess-1",
      toolCallId: "tool-1",
      actor: { actorKind: "agent", performedBy: { label: "agent" } },
      payload: { prompt: "redacted in logs by callers" },
    })

    expect(question).toMatchObject({ requestId: "req-1", sessionId: "sess-1", toolCallId: "tool-1", actorKind: "agent", status: "pending" })
    expect(await ctx.store.getPending("sess-1")).toMatchObject({ questionId: question.questionId })
    expect(await ctx.store.listTranscriptEvents("sess-1")).toEqual([expect.objectContaining({ type: "created" })])
  })

  test("duplicate request id returns the same record before and after final answer", async () => {
    const ctx = runtime()
    const first = await ctx.runtime.createPending({ requestId: "req-dupe", sessionId: "sess-1" })
    const duplicatePending = await ctx.runtime.createPending({ requestId: "req-dupe", sessionId: "sess-1" })
    expect(duplicatePending.questionId).toBe(first.questionId)

    await ctx.runtime.answer(first.questionId, first.sessionId, first.nonce, { secretAnswer: "do-not-log" })
    const duplicateFinal = await ctx.runtime.createPending({ requestId: "req-dupe", sessionId: "sess-1" })
    expect(duplicateFinal).toMatchObject({ questionId: first.questionId, status: "answered" })
    await expect(ctx.store.getAnswer(first.questionId)).resolves.toMatchObject({ values: { secretAnswer: "do-not-log" } })
    await expect(ctx.runtime.wait(duplicateFinal)).resolves.toMatchObject({ status: "answered", answer: { questionId: first.questionId } })
    await expect(ctx.runtime.cancel(first.questionId, "aborted")).resolves.toBeUndefined()
    expect(JSON.stringify(await ctx.store.listTranscriptEvents("sess-1"))).not.toContain("do-not-log")
  })

  test("pins one pending question per session", async () => {
    const ctx = runtime()
    await ctx.runtime.createPending({ requestId: "req-1", sessionId: "sess-1" })
    await expect(ctx.runtime.createPending({ requestId: "req-2", sessionId: "sess-1" })).rejects.toMatchObject({
      code: PENDING_QUESTION_ERROR_CODES.PendingExists,
    } satisfies Partial<PendingQuestionStoreError>)
  })

  test("answer validates nonce and session", async () => {
    const ctx = runtime()
    const question = await ctx.runtime.createPending({ requestId: "req-1", sessionId: "sess-1" })
    await expect(ctx.runtime.answer(question.questionId, "other", question.nonce, {})).rejects.toMatchObject({
      code: PENDING_QUESTION_ERROR_CODES.SessionMismatch,
    })
    await expect(ctx.runtime.answer(question.questionId, question.sessionId, "bad-nonce", {})).rejects.toMatchObject({
      code: PENDING_QUESTION_ERROR_CODES.NonceMismatch,
    })
  })

  test("wait resolves on answer, cancel, timeout, and abort", async () => {
    const answered = runtime()
    const q1 = await answered.runtime.createPending({ requestId: "req-answer", sessionId: "sess-answer" })
    const waitAnswer = answered.runtime.wait(q1)
    await answered.runtime.answer(q1.questionId, q1.sessionId, q1.nonce, { value: "secret" })
    await expect(waitAnswer).resolves.toMatchObject({ status: "answered", answer: { questionId: q1.questionId } })

    const cancelled = runtime()
    const q2 = await cancelled.runtime.createPending({ requestId: "req-cancel", sessionId: "sess-cancel" })
    const waitCancel = cancelled.runtime.wait(q2)
    await cancelled.runtime.cancel(q2.questionId, "user_cancelled")
    await expect(waitCancel).resolves.toMatchObject({ status: "cancelled", reason: "user_cancelled" })

    const timedOut = runtime()
    const q3 = await timedOut.runtime.createPending({ requestId: "req-timeout", sessionId: "sess-timeout" })
    await timedOut.runtime.cancel(q3.questionId, "timeout")
    const finalTimedOut = await timedOut.store.getByQuestionId(q3.questionId)
    expect(finalTimedOut).toMatchObject({ status: "timed_out" })
    await expect(timedOut.runtime.wait(finalTimedOut!)).resolves.toMatchObject({ status: "cancelled", reason: "timeout" })

    const aborted = runtime()
    const q4 = await aborted.runtime.createPending({ requestId: "req-abort", sessionId: "sess-abort" })
    const controller = new AbortController()
    const waitAbort = aborted.runtime.wait(q4, controller.signal)
    controller.abort()
    await expect(waitAbort).resolves.toMatchObject({ status: "cancelled", reason: "aborted" })
  })

  test("server restart abandons stale pending questions", async () => {
    const ctx = runtime()
    const question = await ctx.runtime.createPending({ requestId: "req-restart", sessionId: "sess-restart" })
    await expect(ctx.runtime.abandonServerRestart()).resolves.toEqual([question.questionId])
    await expect(ctx.store.getByQuestionId(question.questionId)).resolves.toMatchObject({ status: "abandoned" })
    await expect(ctx.store.getPending("sess-restart")).resolves.toBeNull()
    expect(await ctx.store.listTranscriptEvents("sess-restart")).toContainEqual(expect.objectContaining({ type: "abandoned", reason: "server_restart" }))
  })
})
