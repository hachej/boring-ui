import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { AskUserQuestion } from "../../shared/types"
import { usePendingQuestion } from "../hooks"

const question: AskUserQuestion = {
  questionId: "q1",
  sessionId: "s1",
  ownerPrincipalId: "workspace-bridge",
  status: "ready",
  title: "Pick",
  answerToken: "nonce-secret",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  schema: { wireVersion: 1, fields: [{ type: "text", name: "answer", label: "Answer", required: true }] },
}

afterEach(() => vi.unstubAllGlobals())

describe("usePendingQuestion", () => {
  it("rehydrates through human-input.v1.pending and submits through human-input.v1.answer", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"))
      if (body.op === "human-input.v1.pending") return Response.json({ ok: true, output: { pending: question } })
      if (body.op === "human-input.v1.answer") return Response.json({ ok: true, output: { status: "answered" } })
      return Response.json({ ok: false, error: { code: "unexpected", message: "unexpected" } }, { status: 400 })
    })
    vi.stubGlobal("fetch", fetchMock)
    const { result } = renderHook(() => usePendingQuestion("s1", { headers: { "x-auth": "browser" } }))

    await waitFor(() => expect(result.current.question?.questionId).toBe("q1"))
    await act(async () => { await result.current.submit(result.current.question!, { answer: "redacted-answer" }) })

    const submitCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("human-input.v1.answer"))
    expect(JSON.parse(String(submitCall![1]!.body))).toMatchObject({
      op: "human-input.v1.answer",
      idempotencyKey: expect.stringMatching(/^ask-user-idem:/),
      input: { questionId: "q1", sessionId: "s1", nonce: "nonce-secret", values: { answer: "redacted-answer" } },
    })
    expect(JSON.parse(String(submitCall![1]!.body)).idempotencyKey).not.toBe("nonce-secret")
    expect(JSON.stringify(submitCall![1]!.headers)).not.toContain("Bearer")
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/api/v1/questions/commands"))).toBe(false)
  })

  it("blocks bad local validation before bridge submit", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"))
      if (body.op === "human-input.v1.pending") return Response.json({ ok: true, output: { pending: question } })
      return Response.json({ ok: true, output: {} })
    })
    vi.stubGlobal("fetch", fetchMock)
    const { result } = renderHook(() => usePendingQuestion("s1"))

    await waitFor(() => expect(result.current.question).toBeTruthy())
    await expect(act(async () => { await result.current.submit(result.current.question!, { answer: "" }) })).rejects.toMatchObject({ code: "ASK_USER_ANSWER_INVALID" })
    expect(fetchMock.mock.calls.some(([, init]) => String(init?.body).includes("human-input.v1.answer"))).toBe(false)
  })

  it("shows stable missing nonce and bridge errors", async () => {
    const noNonce = { ...question, answerToken: "" }
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"))
      if (body.op === "human-input.v1.pending") return Response.json({ ok: true, output: { pending: noNonce } })
      if (body.op === "human-input.v1.cancel") return Response.json({ ok: false, error: { code: "BRIDGE_INVALID_REQUEST", message: "bad nonce" } }, { status: 400 })
      return Response.json({ ok: true, output: {} })
    })
    vi.stubGlobal("fetch", fetchMock)
    const { result } = renderHook(() => usePendingQuestion("s1"))
    await waitFor(() => expect(result.current.question).toBeTruthy())

    let thrown: unknown
    await act(async () => {
      try { await result.current.cancel(result.current.question!) } catch (err) { thrown = err }
    })
    expect(thrown).toMatchObject({ code: "ASK_USER_QUESTION_NOT_READY" })
    await waitFor(() => expect(result.current.error?.code).toBe("ASK_USER_QUESTION_NOT_READY"))
  })
})
