import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { AskUserQuestion } from "../../shared/types"
import { createPendingRefreshCoordinator } from "../pendingRefresh"
import { createQuestionsStore } from "../runtime"

const baseQuestion: AskUserQuestion = {
  questionId: "q-active",
  sessionId: "active",
  ownerPrincipalId: "anonymous",
  status: "ready",
  title: "Active question",
  answerToken: "secret",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  artifacts: [],
  schema: { wireVersion: 1, fields: [{ type: "text", name: "answer", label: "Answer" }] },
}

function pendingState(questions: AskUserQuestion[]) {
  return {
    "questions.pending": {
      hint: questions[0]
        ? { questionId: questions[0].questionId, sessionId: questions[0].sessionId, status: questions[0].status }
        : null,
      hintsBySession: Object.fromEntries(questions.map((question) => [
        question.sessionId,
        { questionId: question.questionId, sessionId: question.sessionId, status: question.status },
      ])),
    },
  }
}

function requestedSession(init?: RequestInit): string | undefined {
  if (typeof init?.body !== "string") return undefined
  return (JSON.parse(init.body) as { input?: { sessionId?: string } }).input?.sessionId
}

describe("createPendingRefreshCoordinator", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("refreshes a newly invalidated active question while an unrelated hydration is hung", async () => {
    const store = createQuestionsStore()
    const background = { ...baseQuestion, questionId: "q-background", sessionId: "background" }
    const replacement = { ...baseQuestion, questionId: "q-replacement", title: "Replacement" }
    let activeQuestion = baseQuestion
    let stateReads = 0
    const backgroundSignals: AbortSignal[] = []
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/v1/ui/state")) {
        stateReads += 1
        return Response.json(pendingState([activeQuestion, background]))
      }
      const sessionId = requestedSession(init)
      if (sessionId === "active") return Response.json({ ok: true, output: { pending: activeQuestion } })
      if (sessionId === "background") {
        if (init?.signal) backgroundSignals.push(init.signal)
        return await new Promise<Response>(() => undefined)
      }
      return Response.json({ ok: true, output: { pending: null } })
    })
    vi.stubGlobal("fetch", fetchMock)
    const coordinator = createPendingRefreshCoordinator({
      apiBaseUrl: "",
      store,
      requestTimeoutMs: 100,
    })
    const deactivate = coordinator.activate("active")

    await vi.advanceTimersByTimeAsync(0)
    expect(store.getPending("active")).toMatchObject({ questionId: "q-active" })
    expect(backgroundSignals[0]?.aborted).toBe(false)

    activeQuestion = replacement
    coordinator.request()
    await vi.advanceTimersByTimeAsync(0)

    expect(stateReads).toBe(2)
    expect(store.getPending("active")).toMatchObject({ questionId: "q-replacement" })
    expect(backgroundSignals[0]?.aborted).toBe(false)
    deactivate()
  })

  it("does not restore a background question removed by newer authoritative state", async () => {
    const store = createQuestionsStore()
    const background = { ...baseQuestion, questionId: "q-background", sessionId: "background" }
    let includeBackground = true
    let resolveBackground: ((response: Response) => void) | undefined
    const delayedBackground = new Promise<Response>((resolve) => { resolveBackground = resolve })
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/v1/ui/state")) {
        return Response.json(pendingState(includeBackground ? [baseQuestion, background] : [baseQuestion]))
      }
      if (requestedSession(init) === "background") return await delayedBackground
      if (requestedSession(init) === "active") {
        return Response.json({ ok: true, output: { pending: baseQuestion } })
      }
      return Response.json({ ok: true, output: { pending: null } })
    })
    vi.stubGlobal("fetch", fetchMock)
    const coordinator = createPendingRefreshCoordinator({ apiBaseUrl: "", store })
    const deactivate = coordinator.activate("active")
    await vi.advanceTimersByTimeAsync(0)

    includeBackground = false
    coordinator.request()
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getPending("background")).toBeNull()

    resolveBackground?.(Response.json({ ok: true, output: { pending: background } }))
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getPending("background")).toBeNull()
    deactivate()
  })

  it("coalesces synchronous requests and ignores a superseded hydration", async () => {
    const store = createQuestionsStore()
    let releaseFirstPending: (() => void) | undefined
    const firstPending = new Promise<void>((resolve) => { releaseFirstPending = resolve })
    let stateReads = 0
    let pendingReads = 0
    let coordinator: ReturnType<typeof createPendingRefreshCoordinator>
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/v1/ui/state")) {
        stateReads += 1
        if (stateReads === 1) {
          coordinator.request("active")
          coordinator.request("active")
        }
        return Response.json(pendingState([baseQuestion]))
      }
      if (requestedSession(init) === "active") {
        pendingReads += 1
        if (pendingReads === 1) await firstPending
        return Response.json({ ok: true, output: { pending: baseQuestion } })
      }
      return Response.json({ ok: true, output: { pending: null } })
    })
    vi.stubGlobal("fetch", fetchMock)
    coordinator = createPendingRefreshCoordinator({ apiBaseUrl: "", store })
    const deactivate = coordinator.activate("active")

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(stateReads).toBe(2)
    expect(pendingReads).toBe(2)
    expect(store.getPending("active")).toMatchObject({ questionId: "q-active" })

    releaseFirstPending?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getPending("active")).toMatchObject({ questionId: "q-active" })
    deactivate()
  })

  it("aborts a replaced generation and ignores its late successful response", async () => {
    const store = createQuestionsStore()
    const stale = { ...baseQuestion, questionId: "q-stale", title: "Stale" }
    const replacement = { ...baseQuestion, questionId: "q-replacement", title: "Replacement" }
    let current = stale
    let firstSignal: AbortSignal | undefined
    let resolveStale: ((response: Response) => void) | undefined
    let pendingReads = 0
    const staleResponse = new Promise<Response>((resolve) => { resolveStale = resolve })
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/v1/ui/state")) return Response.json(pendingState([current]))
      if (requestedSession(init) === "active") {
        pendingReads += 1
        if (pendingReads === 1) {
          firstSignal = init?.signal ?? undefined
          return await staleResponse
        }
        return Response.json({ ok: true, output: { pending: replacement } })
      }
      return Response.json({ ok: true, output: { pending: null } })
    })
    vi.stubGlobal("fetch", fetchMock)
    const coordinator = createPendingRefreshCoordinator({ apiBaseUrl: "", store })
    const deactivateStale = coordinator.activate("active")
    await vi.advanceTimersByTimeAsync(0)

    deactivateStale()
    expect(firstSignal?.aborted).toBe(true)
    current = replacement
    const deactivateReplacement = coordinator.activate("active")
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getPending("active")).toMatchObject({ questionId: "q-replacement" })

    resolveStale?.(Response.json({ ok: true, output: { pending: stale } }))
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getPending("active")).toMatchObject({ questionId: "q-replacement" })
    deactivateReplacement()
  })

  it("preserves a cached question when hydration fails or times out", async () => {
    const store = createQuestionsStore()
    store.setPending(baseQuestion)
    let pendingReads = 0
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/v1/ui/state")) return Response.json(pendingState([baseQuestion]))
      if (requestedSession(init) === "active") {
        pendingReads += 1
        if (pendingReads === 1) {
          return Response.json({ error: { code: "unavailable" } }, { status: 503 })
        }
        return await new Promise<Response>(() => undefined)
      }
      return Response.json({ ok: true, output: { pending: null } })
    })
    vi.stubGlobal("fetch", fetchMock)
    const coordinator = createPendingRefreshCoordinator({
      apiBaseUrl: "",
      store,
      requestTimeoutMs: 100,
    })
    const deactivate = coordinator.activate("active")
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getPending("active")).toMatchObject({ questionId: "q-active" })

    coordinator.request("active")
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(100)
    expect(store.getPending("active")).toMatchObject({ questionId: "q-active" })
    deactivate()
  })
})
