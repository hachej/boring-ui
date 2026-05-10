import { mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ASK_USER_ERROR_CODES } from "../../shared/error-codes"
import type { AskUserQuestion } from "../../shared/types"
import { AskUserStoreError, FileAskUserStore } from "../AskUserStore"

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
    status: "draft",
    title: "Question",
    context: "Context",
    draftFields: [],
    draftVersion: 0,
    answerToken: "token",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe("FileAskUserStore", () => {
  it("creates and reloads a pending question", async () => {
    await store.createPending(question())
    await expect(store.getPending("s1")).resolves.toMatchObject({ questionId: "q1", status: "draft" })

    const reloaded = new FileAskUserStore(join(dir, "ask-user.json"))
    await expect(reloaded.getByQuestionId("q1")).resolves.toMatchObject({ questionId: "q1", sessionId: "s1" })
  })

  it("enforces one pending question per session", async () => {
    await store.createPending(question())
    await expect(store.createPending(question({ questionId: "q2" }))).rejects.toMatchObject({
      code: ASK_USER_ERROR_CODES.PENDING_EXISTS,
    })
  })

  it("applies patches with version increments and idempotent patchId dedup", async () => {
    await store.createPending(question())
    const patched = await store.applyPatch("q1", { patchId: "p1", type: "set_title", title: "New" }, 0)
    expect(patched.title).toBe("New")
    expect(patched.draftVersion).toBe(1)

    const duplicate = await store.applyPatch("q1", { patchId: "p1", type: "set_title", title: "Ignored" }, 1)
    expect(duplicate.title).toBe("New")
    expect(duplicate.draftVersion).toBe(1)
  })

  it("rejects stale patch versions and invalid field mutations", async () => {
    await store.createPending(question())
    await store.applyPatch("q1", { patchId: "p1", type: "set_title", title: "New" }, 0)
    await expect(store.applyPatch("q1", { patchId: "p2", type: "set_context", context: "Later" }, 0)).rejects.toMatchObject({
      code: ASK_USER_ERROR_CODES.PATCH_STALE,
    })
    await expect(
      store.applyPatch("q1", {
        patchId: "p3",
        type: "update_field",
        name: "missing",
        patch: { label: "Nope" },
      }, 1),
    ).rejects.toMatchObject({ code: ASK_USER_ERROR_CODES.PATCH_INVALID })
  })

  it("finalizes atomically with schema validation", async () => {
    await store.createPending(question())
    await store.applyPatch("q1", {
      patchId: "p1",
      type: "add_field",
      field: { type: "text", name: "answer", label: "Answer" },
    }, 0)
    const ready = await store.finalize("q1", "Submit", 1)
    expect(ready.status).toBe("ready")
    expect(ready.schema).toMatchObject({ wireVersion: 1, submitLabel: "Submit" })

    await expect(store.applyPatch("q1", { patchId: "p2", type: "set_title", title: "Too late" })).rejects.toMatchObject({
      code: ASK_USER_ERROR_CODES.PATCH_INVALID,
    })
  })

  it("rejects finalize when assembled schema is invalid", async () => {
    await store.createPending(question())
    await expect(store.finalize("q1")).rejects.toMatchObject({ code: ASK_USER_ERROR_CODES.SCHEMA_INVALID })
  })

  it("rejects answers that do not match the question/session", async () => {
    await store.createPending(question({ status: "ready", schema: { wireVersion: 1, fields: [{ type: "text", name: "a", label: "A" }] } }))
    await expect(store.answer("q1", { questionId: "other", sessionId: "s1", values: {}, submittedAt: new Date().toISOString() })).rejects.toMatchObject({
      code: ASK_USER_ERROR_CODES.SESSION_MISMATCH,
    })
    await expect(store.answer("q1", { questionId: "q1", sessionId: "other", values: {}, submittedAt: new Date().toISOString() })).rejects.toMatchObject({
      code: ASK_USER_ERROR_CODES.SESSION_MISMATCH,
    })
  })

  it("answers, cancels, and abandons with terminal state guards", async () => {
    await store.createPending(question({ status: "ready", schema: { wireVersion: 1, fields: [{ type: "text", name: "a", label: "A" }] } }))
    await store.answer("q1", { questionId: "q1", sessionId: "s1", values: { a: "ok" }, submittedAt: new Date().toISOString() })
    await expect(store.getPending("s1")).resolves.toBeNull()
    await expect(store.cancel("q1")).rejects.toMatchObject({ code: ASK_USER_ERROR_CODES.ALREADY_ANSWERED })

    await store.createPending(question({ questionId: "q2", status: "ready", schema: { wireVersion: 1, fields: [{ type: "text", name: "a", label: "A" }] } }))
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
    await store.applyPatch("q1", { patchId: "p1", type: "set_title", title: "New" })
    await store.clearPending("s1")
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ reason: "create", questionId: "q1" }))
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ reason: "patch", questionId: "q1" }))
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ reason: "clear", questionId: "q1" }))
  })

  it("appends, lists, filters, and persists transcript events", async () => {
    await store.createPending(question())
    await store.appendTranscriptEvent({ type: "created", question: question(), at: new Date(0).toISOString() })
    await store.appendTranscriptEvent({
      type: "patched",
      questionId: "q1",
      sessionId: "s1",
      patch: { patchId: "p1", type: "set_title", title: "New" },
      draftVersion: 1,
      at: new Date(1).toISOString(),
    })
    await store.appendTranscriptEvent({ type: "abandoned", questionId: "other", sessionId: "s1", at: new Date(2).toISOString() })

    await expect(store.listTranscriptEvents("s1")).resolves.toHaveLength(3)
    await expect(store.getTranscriptEventsForQuestion("q1")).resolves.toHaveLength(2)

    const raw = JSON.parse(await readFile(join(dir, "ask-user.json"), "utf8"))
    expect(raw.transcriptsBySession.s1).toHaveLength(3)
  })
})
