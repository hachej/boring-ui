import Fastify from "fastify"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ASK_USER_ERROR_CODES } from "../../shared/error-codes"
import { FileAskUserStore } from "../askUserStore"
import { AskUserRuntime } from "../askUserRuntime"
import { constantTimeEqual, QuestionsBridge } from "../questionsBridge"
import { questionsRoutes } from "../questionsRoutes"

const schema = { wireVersion: 1 as const, fields: [{ type: "text" as const, name: "answer", label: "Answer", required: true }] }
const controllers: AbortController[] = []

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.abort()
})

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "ask-user-routes-"))
  const store = new FileAskUserStore(join(dir, "questions.json"))
  const runtime = new AskUserRuntime({ store, ownerPrincipalId: "p1" })
  const controller = new AbortController()
  controllers.push(controller)
  const result = runtime.ask({ sessionId: "s1", title: "T", schema }, controller.signal)
  const question = await vi.waitFor(async () => {
    const pending = await store.getPending("s1")
    expect(pending).not.toBeNull()
    return pending!
  })
  return { store, runtime, question, result }
}

describe("QuestionsBridge", () => {
  it("compares tokens in constant time helper without length throws", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true)
    expect(constantTimeEqual("abc", "ab")).toBe(false)
    expect(constantTimeEqual("abc", "abd")).toBe(false)
  })

  it("rejects auth/session mismatch and bad token", async () => {
    const { store, runtime, question } = await fixture()
    const bridge = new QuestionsBridge({ store, runtime, getAuthContext: () => ({ sessionId: "other", principalId: "p1" }) })
    await expect(bridge.handle({ kind: "questions.cancel", params: { questionId: question.questionId, sessionId: "s1", answerToken: question.answerToken } })).rejects.toMatchObject({ code: ASK_USER_ERROR_CODES.SESSION_MISMATCH })

    const authed = new QuestionsBridge({ store, runtime, getAuthContext: () => ({ sessionId: "s1", principalId: "p1" }) })
    await expect(authed.handle({ kind: "questions.cancel", params: { questionId: question.questionId, sessionId: "s1", answerToken: "bad" } })).rejects.toMatchObject({ code: ASK_USER_ERROR_CODES.UNAUTHORIZED })
  })

  it("rejects invalid answer payload", async () => {
    const { store, runtime, question } = await fixture()
    const bridge = new QuestionsBridge({ store, runtime, getAuthContext: () => ({ sessionId: "s1", principalId: "p1" }) })
    await expect(bridge.handle({ kind: "questions.submit", params: { questionId: question.questionId, sessionId: "s1", answerToken: question.answerToken, values: {} } })).rejects.toMatchObject({ code: ASK_USER_ERROR_CODES.ANSWER_INVALID })
  })

  it("accepts submit, duplicate submit, and rejects cancel after answer", async () => {
    const { store, runtime, question, result } = await fixture()
    const bridge = new QuestionsBridge({ store, runtime, getAuthContext: () => ({ sessionId: "s1", principalId: "p1" }) })
    const command = { kind: "questions.submit" as const, params: { questionId: question.questionId, sessionId: "s1", answerToken: question.answerToken, values: { answer: "ok" } } }
    await expect(bridge.handle(command)).resolves.toEqual({ ok: true, status: "answered" })
    await expect(result).resolves.toMatchObject({ status: "answered" })
    await expect(bridge.handle(command)).resolves.toEqual({ ok: true, status: "answered" })
    await expect(bridge.handle({ kind: "questions.cancel", params: { questionId: question.questionId, sessionId: "s1", answerToken: question.answerToken } })).rejects.toMatchObject({ code: ASK_USER_ERROR_CODES.ALREADY_ANSWERED })
  })

  it("rejects submit when the runtime waiter is gone", async () => {
    const { store, question } = await fixture()
    const orphanRuntime = new AskUserRuntime({ store, ownerPrincipalId: "p1" })
    const bridge = new QuestionsBridge({ store, runtime: orphanRuntime, getAuthContext: () => ({ sessionId: "s1", principalId: "p1" }) })
    await expect(bridge.handle({ kind: "questions.submit", params: { questionId: question.questionId, sessionId: "s1", answerToken: question.answerToken, values: { answer: "ok" } } })).rejects.toMatchObject({ statusCode: 409 })
  })

  it("rejects submit after cancel", async () => {
    const { store, runtime, question } = await fixture()
    const bridge = new QuestionsBridge({ store, runtime, getAuthContext: () => ({ sessionId: "s1", principalId: "p1" }) })
    await bridge.handle({ kind: "questions.cancel", params: { questionId: question.questionId, sessionId: "s1", answerToken: question.answerToken } })
    await expect(bridge.handle({ kind: "questions.submit", params: { questionId: question.questionId, sessionId: "s1", answerToken: question.answerToken, values: { answer: "ok" } } })).rejects.toMatchObject({ code: ASK_USER_ERROR_CODES.ALREADY_CANCELLED })
  })

  it("first submit wins concurrent duplicate tabs", async () => {
    const { store, runtime, question } = await fixture()
    const bridge = new QuestionsBridge({ store, runtime, getAuthContext: () => ({ sessionId: "s1", principalId: "p1" }) })
    const [first, second] = await Promise.allSettled([
      bridge.handle({ kind: "questions.submit", params: { questionId: question.questionId, sessionId: "s1", answerToken: question.answerToken, values: { answer: "a" } } }),
      bridge.handle({ kind: "questions.submit", params: { questionId: question.questionId, sessionId: "s1", answerToken: question.answerToken, values: { answer: "b" } } }),
    ])
    expect(first.status).toBe("fulfilled")
    expect(second.status).toBe("fulfilled")
    await expect(store.getByQuestionId(question.questionId)).resolves.toMatchObject({ status: "answered" })
    const answers = await store.getTranscriptEventsForQuestion(question.questionId)
    expect(answers.filter((event) => event.type === "answered")).toHaveLength(1)
  })

})

describe("questionsRoutes", () => {
  it("enforces origin/csrf and dispatches commands", async () => {
    const { store, runtime, question } = await fixture()
    const app = Fastify()
    app.register(questionsRoutes, {
      store,
      runtime,
      allowedOrigins: ["https://app.test"],
      csrfToken: "token",
      getAuthContext: () => ({ sessionId: "s1", principalId: "p1" }),
    })
    const body = { kind: "questions.cancel", params: { questionId: question.questionId, sessionId: "s1", answerToken: question.answerToken } }
    expect((await app.inject({ method: "POST", url: "/api/v1/questions/commands", payload: body })).statusCode).toBe(403)
    const res = await app.inject({ method: "POST", url: "/api/v1/questions/commands", headers: { origin: "https://app.test", "x-csrf-token": "token" }, payload: body })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, status: "cancelled" })
    await app.close()
  })
})
