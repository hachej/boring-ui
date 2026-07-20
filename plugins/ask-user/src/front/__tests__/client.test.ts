import { afterEach, describe, expect, it, vi } from "vitest"
import { createQuestionsClient, deriveIdempotencyKey, normalizeQuestion, readPendingQuestionHintFromState, readPendingQuestionHintsFromState } from "../client"
import { ASK_USER_UI_STATE_SLOTS } from "../../shared/constants"
import type { AskUserQuestion } from "../../shared/types"

afterEach(() => {
  vi.unstubAllGlobals()
})

const question: AskUserQuestion = {
  questionId: "q1",
  sessionId: "default",
  ownerPrincipalId: "anonymous",
  status: "ready",
  answerToken: "secret",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  artifacts: [],
  schema: { wireVersion: 1, fields: [{ type: "text", name: "answer", label: "Answer" }] },
}

describe("ask-user front client", () => {
  it("derives deterministic idempotency keys when crypto.subtle is unavailable", async () => {
    vi.stubGlobal("crypto", {})

    const first = await deriveIdempotencyKey("ask-user.v1.answer", { b: 2, a: 1 })
    const second = await deriveIdempotencyKey("ask-user.v1.answer", { a: 1, b: 2 })
    const different = await deriveIdempotencyKey("ask-user.v1.answer", { a: 1, b: 3 })

    expect(first).toMatch(/^ask-user-idem:[0-9a-f]{32}$/)
    expect(first).toBe(second)
    expect(first).not.toBe(different)
  })

  it("reads session-indexed pending hints from UI state", () => {
    const state = {
      [ASK_USER_UI_STATE_SLOTS.PENDING]: {
        hint: { questionId: "legacy", sessionId: "s-legacy", status: "ready" },
        hintsBySession: {
          s1: { questionId: "q1", sessionId: "s1", status: "ready" },
          s2: { questionId: "q2", sessionId: "s2", status: "ready" },
        },
      },
    }

    expect(readPendingQuestionHintsFromState(state)).toEqual([
      { questionId: "legacy", sessionId: "s-legacy", status: "ready" },
      { questionId: "q1", sessionId: "s1", status: "ready" },
      { questionId: "q2", sessionId: "s2", status: "ready" },
    ])
    expect(readPendingQuestionHintFromState(state)).toEqual({ questionId: "legacy", sessionId: "s-legacy", status: "ready" })
  })

  it("hydrates plural associated artifacts atomically without accepting malformed values", () => {
    const artifact = { id: "plan", surfaceKind: "file", target: "docs/plan.md", title: "Plan" }
    const base = { ...question, artifacts: [artifact] }
    expect(normalizeQuestion(base)?.artifacts).toEqual([artifact])
    expect(normalizeQuestion({ ...base, artifacts: [{ ...artifact, target: 42 }] })?.artifacts).toEqual([])
    expect(normalizeQuestion({ ...question, artifact })?.artifacts).toEqual([])
  })

  it("cancels through the bridge when crypto.subtle is unavailable", async () => {
    vi.stubGlobal("crypto", {})
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ ok: true, output: { ok: true, status: "cancelled" } }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(createQuestionsClient().cancel(question)).resolves.toEqual({ ok: true, status: "cancelled" })

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))
    expect(body).toMatchObject({
      op: "ask-user.v1.cancel",
      input: { questionId: "q1", sessionId: "default", answerToken: "secret" },
    })
    expect(body.idempotencyKey).toMatch(/^ask-user-idem:[0-9a-f]{32}$/)
  })
})
