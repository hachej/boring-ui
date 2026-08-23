import { afterEach, describe, expect, it, vi } from "vitest"
import { __resetQuestionsClientTransportCacheForTests, createQuestionsClient, deriveIdempotencyKey, normalizeQuestion, readPendingQuestionHintFromState, readPendingQuestionHintsFromState } from "../client"
import { ASK_USER_UI_STATE_SLOTS } from "../../shared/constants"
import type { AskUserQuestion } from "../../shared/types"

afterEach(() => {
  vi.unstubAllGlobals()
  __resetQuestionsClientTransportCacheForTests()
})

/** Bridge-shaped success envelope for `ask-user.v1.list`. */
function bridgeListResponse(questions: AskUserQuestion[]) {
  return Response.json({ ok: true, output: { questions } })
}

/** Bridge-shaped `OpNotFound` failure, as `httpRoutes.ts` maps it to HTTP 404. */
function bridgeOpNotFoundResponse() {
  return Response.json({ ok: false, error: { code: "BRIDGE_OP_NOT_FOUND", message: "unknown op" } }, { status: 404 })
}

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

  it("lists and normalizes every ready question through the bridge, the canonical transport", async () => {
    const second = { ...question, questionId: "q2", sessionId: "headless", title: "Headless approval" }
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe("/hub/api/v1/workspace-bridge/call")
      expect(JSON.parse(String(init?.body))).toMatchObject({ op: "ask-user.v1.list", input: { status: "ready" } })
      return bridgeListResponse([question, second])
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(createQuestionsClient({ apiBaseUrl: "/hub", headers: { "x-boring-workspace-id": "w1" } }).listReady())
      .resolves.toEqual([question, second])
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/v1/questions?status=ready"))).toBe(false)
  })

  it("falls back to the legacy REST endpoint only when the bridge answers OpNotFound", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => (
      String(url).endsWith("/api/v1/workspace-bridge/call")
        ? bridgeOpNotFoundResponse()
        : Response.json({ questions: [question] })
    ))
    vi.stubGlobal("fetch", fetchMock)

    await expect(createQuestionsClient({ apiBaseUrl: "/legacy-host" }).listReady()).resolves.toEqual([question])
    const restCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/api/v1/questions?status=ready"))
    expect(restCall).toBeDefined()
    expect(restCall![1]).toMatchObject({ credentials: "include", cache: "no-store" })
  })

  it("does not label a malformed successful bridge list as OpNotFound", async () => {
    const fetchMock = vi.fn(async (url: string) => (
      String(url).endsWith("/api/v1/workspace-bridge/call") ? Response.json({ ok: true, output: {} }) : Response.json({})
    ))
    vi.stubGlobal("fetch", fetchMock)

    await expect(createQuestionsClient().listReady()).rejects.toMatchObject({
      message: "Invalid pending questions response",
      statusCode: 200,
    })
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/v1/questions?status=ready"))).toBe(false)
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
