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

  it("lists and normalizes every ready question over the bridge, without touching the legacy route", async () => {
    const second = { ...question, questionId: "q2", sessionId: "headless", title: "Headless approval" }
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      void init
      return String(url).endsWith("/api/v1/workspace-bridge/call")
        ? Response.json({ ok: true, output: { questions: [question, second] } })
        : Response.json({ error: "not_found" }, { status: 404 })
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(createQuestionsClient({ apiBaseUrl: "/hub", headers: { "x-boring-workspace-id": "w1" } }).listReady())
      .resolves.toEqual([question, second])
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("/hub/api/v1/workspace-bridge/call")
    expect(String(init?.body)).toContain("ask-user.v1.list")
    // Hosts that mount the bridge must never see a request for the legacy
    // route: it 404s there, and a guaranteed-404 poll trips the UI review
    // console/network hard gates.
    expect(fetchMock.mock.calls.some(([called]) => String(called).includes("/api/v1/questions?status=ready"))).toBe(false)
  })

  it("falls back to the legacy route only when the bridge has no list op", async () => {
    const fetchMock = vi.fn(async (url: string) => (
      String(url).endsWith("/api/v1/workspace-bridge/call")
        // WorkspaceBridgeErrorCode.OpNotFound maps to 404 in httpRoutes.
        ? Response.json({ ok: false, error: { code: "op_not_found" } }, { status: 404 })
        : Response.json({ questions: [question] })
    ))
    vi.stubGlobal("fetch", fetchMock)

    await expect(createQuestionsClient({ apiBaseUrl: "/hub", headers: { "x-boring-workspace-id": "w1" } }).listReady())
      .resolves.toEqual([question])
    expect(fetchMock).toHaveBeenCalledWith("/hub/api/v1/questions?status=ready", {
      headers: { "x-boring-workspace-id": "w1" },
      credentials: "include",
      cache: "no-store",
    })
  })

  it("surfaces a real bridge failure instead of retrying it on the legacy route", async () => {
    const fetchMock = vi.fn(async (url: string) => (
      String(url).endsWith("/api/v1/workspace-bridge/call")
        ? Response.json({ ok: false, error: { code: "boom", message: "bridge exploded" } }, { status: 500 })
        : Response.json({ questions: [question] })
    ))
    vi.stubGlobal("fetch", fetchMock)

    await expect(createQuestionsClient().listReady()).rejects.toMatchObject({ code: "boom", statusCode: 500 })
    expect(fetchMock.mock.calls.some(([called]) => String(called).includes("/api/v1/questions?status=ready"))).toBe(false)
  })

  it("does not label a malformed successful bridge list as a missing transport", async () => {
    const fetchMock = vi.fn(async (url: string) => (
      String(url).includes("/api/v1/questions?status=ready")
        ? Response.json({ error: "not_found" }, { status: 404 })
        : Response.json({ ok: true, output: {} })
    ))
    vi.stubGlobal("fetch", fetchMock)

    await expect(createQuestionsClient().listReady()).rejects.toMatchObject({
      message: "Invalid pending questions response",
      statusCode: 200,
    })
  })

  it("allows hosts to override the stock browser CSRF proof", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ ok: true, output: { pending: null } }))
    vi.stubGlobal("fetch", fetchMock)

    await createQuestionsClient({ headers: { "x-csrf-token": "signed-proof" } }).pending("default")

    expect(fetchMock.mock.calls[0]![1]!.headers).toMatchObject({
      "x-csrf-token": "signed-proof",
      "x-boring-session-id": "default",
    })
  })

  it("cancels through the bridge when crypto.subtle is unavailable", async () => {
    vi.stubGlobal("crypto", {})
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ ok: true, output: { ok: true, status: "cancelled" } }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(createQuestionsClient().cancel(question)).resolves.toEqual({ ok: true, status: "cancelled" })

    const request = fetchMock.mock.calls[0]![1]!
    expect(request.headers).toMatchObject({
      "x-csrf-token": "browser",
      "x-boring-session-id": "default",
    })
    const body = JSON.parse(String(request.body))
    expect(body).toMatchObject({
      op: "ask-user.v1.cancel",
      input: { questionId: "q1", sessionId: "default", answerToken: "secret" },
    })
    expect(body.idempotencyKey).toMatch(/^ask-user-idem:[0-9a-f]{32}$/)
  })
})
