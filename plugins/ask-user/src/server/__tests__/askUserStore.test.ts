import { mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ASK_USER_ERROR_CODES } from "../../shared/error-codes"
import type { AskUserQuestion } from "../../shared/types"
import { FileAskUserStore } from "../askUserStore"

let dir: string
let store: FileAskUserStore

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ask-user-store-"))
  store = new FileAskUserStore(join(dir, "ask-user.json"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function question(overrides: Partial<AskUserQuestion> = {}): AskUserQuestion {
  const now = new Date(0).toISOString()
  return {
    questionId: "q1",
    sessionId: "s1",
    ownerPrincipalId: "anonymous",
    status: "ready",
    title: "Question",
    context: "Context",
    schema: { wireVersion: 1, fields: [{ type: "text", name: "a", label: "A" }] },
    artifacts: [],
    answerToken: "token",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe("FileAskUserStore", () => {
  it("creates and reloads a pending question", async () => {
    await store.createPending(question())
    await expect(store.getPending("s1")).resolves.toMatchObject({ questionId: "q1", status: "ready" })

    const reloaded = new FileAskUserStore(join(dir, "ask-user.json"))
    await expect(reloaded.getByQuestionId("q1")).resolves.toMatchObject({ questionId: "q1", sessionId: "s1" })
    await expect(reloaded.getPending("s1")).resolves.toMatchObject({ questionId: "q1", sessionId: "s1", status: "ready" })
  })

  it("shares one initial load across concurrent first read/write callers", async () => {
    const initialRead = store.listPending()
    await Promise.all([
      initialRead,
      store.createPending(question()),
    ])
    await store.appendTranscriptEvent({ type: "created", question: question(), at: new Date(0).toISOString() })

    await expect(store.getPending("s1")).resolves.toMatchObject({ questionId: "q1", status: "ready" })
    const raw = JSON.parse(await readFile(join(dir, "ask-user.json"), "utf8"))
    expect(raw.questions.q1).toMatchObject({ sessionId: "s1", status: "ready" })
    expect(raw.transcriptsBySession.s1).toHaveLength(1)
  })

  it("enforces one pending question per session and persists multiple pending sessions", async () => {
    await store.createPending(question())
    await expect(store.createPending(question({ questionId: "q2" }))).rejects.toMatchObject({
      code: ASK_USER_ERROR_CODES.PENDING_EXISTS,
    })
    await expect(store.createPending(question({ questionId: "q3", sessionId: "s2" }))).resolves.toBeUndefined()

    await expect(store.getPending("s1")).resolves.toMatchObject({ questionId: "q1" })
    await expect(store.getPending("s2")).resolves.toMatchObject({ questionId: "q3" })
    const reloaded = new FileAskUserStore(join(dir, "ask-user.json"))
    await expect(reloaded.getPending("s1")).resolves.toMatchObject({ questionId: "q1" })
    await expect(reloaded.getPending("s2")).resolves.toMatchObject({ questionId: "q3" })
  })

  it("rejects answers that do not match the question/session", async () => {
    await store.createPending(question())
    await expect(store.answer("q1", { questionId: "other", sessionId: "s1", values: {}, submittedAt: new Date().toISOString() })).rejects.toMatchObject({
      code: ASK_USER_ERROR_CODES.SESSION_MISMATCH,
    })
    await expect(store.answer("q1", { questionId: "q1", sessionId: "other", values: {}, submittedAt: new Date().toISOString() })).rejects.toMatchObject({
      code: ASK_USER_ERROR_CODES.SESSION_MISMATCH,
    })
  })

  it("answers, cancels, and abandons with terminal state guards", async () => {
    await store.createPending(question())
    await store.answer("q1", { questionId: "q1", sessionId: "s1", values: { a: "ok" }, submittedAt: new Date().toISOString() })
    await expect(store.getPending("s1")).resolves.toBeNull()
    await expect(store.cancel("q1")).rejects.toMatchObject({ code: ASK_USER_ERROR_CODES.ALREADY_ANSWERED })

    await store.createPending(question({ questionId: "q2" }))
    await store.cancel("q2")
    await expect(store.answer("q2", { questionId: "q2", sessionId: "s1", values: {}, submittedAt: new Date().toISOString() })).rejects.toMatchObject({
      code: ASK_USER_ERROR_CODES.ALREADY_CANCELLED,
    })

    await store.createPending(question({ questionId: "q3" }))
    await store.markAbandoned("q3")
    await expect(store.getByQuestionId("q3")).resolves.toMatchObject({ status: "abandoned" })
  })

  it("emits changes for mutations", async () => {
    const listener = vi.fn()
    store.subscribe(listener)
    await store.createPending(question())
    await store.clearPending("s1")
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ reason: "create", questionId: "q1" }))
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ reason: "clear", questionId: "q1" }))
  })

  it("does not let listener failures roll back mutations", async () => {
    store.subscribe(() => { throw new Error("listener failed") })
    store.subscribe((() => Promise.reject(new Error("async listener failed"))) as never)
    await expect(store.createPending(question())).resolves.toBeUndefined()
    await expect(store.getPending("s1")).resolves.toMatchObject({ questionId: "q1" })
  })

  it("appends, lists, filters, and persists transcript events", async () => {
    await store.createPending(question())
    await store.appendTranscriptEvent({ type: "created", question: question(), at: new Date(0).toISOString() })
    await store.appendTranscriptEvent({ type: "abandoned", questionId: "other", sessionId: "s1", at: new Date(2).toISOString() })

    await expect(store.listTranscriptEvents("s1")).resolves.toHaveLength(2)
    await expect(store.getTranscriptEventsForQuestion("q1")).resolves.toHaveLength(1)

    const raw = JSON.parse(await readFile(join(dir, "ask-user.json"), "utf8"))
    expect(raw.transcriptsBySession.s1).toHaveLength(2)
  })
})
