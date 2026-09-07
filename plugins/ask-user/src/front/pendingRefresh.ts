import { ASK_USER_UI_STATE_SLOTS } from "../shared/constants"
import type { AskUserQuestion } from "../shared/types"
import { createQuestionsClient, readPendingQuestionHintsFromState, type PendingQuestionHint } from "./client"
import type { QuestionsStore } from "./runtime"

type PendingRefreshOptions = {
  apiBaseUrl: string
  authHeaders?: Record<string, string>
  store: QuestionsStore
  requestTimeoutMs?: number
}

type RefreshRun = {
  generation: number
  activeSessionId: string | null
  requestedSessions: Set<string>
  requestedQuestions: Map<string, string>
}

type HydrationRun = {
  generation: number
  key: string
}

type PendingResult = {
  sessionId: string
  pending: AskUserQuestion | null
  succeeded: boolean
}

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000

export type PendingRefreshCoordinator = {
  activate(activeSessionId?: string | null): () => void
  request(sessionId?: string, questionId?: string): void
}

export function createPendingRefreshCoordinator({
  apiBaseUrl,
  authHeaders,
  store,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
}: PendingRefreshOptions): PendingRefreshCoordinator {
  const client = createQuestionsClient({ apiBaseUrl, headers: authHeaders })
  const requestedSessions = new Set<string>()
  const requestedQuestions = new Map<string, string>()
  const hydrationRuns = new Map<string, HydrationRun>()
  let generation = 0
  let activeGeneration: number | null = null
  let activeSessionId: string | null = null
  let latestRefresh: RefreshRun | null = null
  let startTimer: ReturnType<typeof setTimeout> | null = null
  const requestControllers = new Set<AbortController>()

  function isActive(runGeneration: number): boolean {
    return activeGeneration === runGeneration
  }

  function isLatestRefresh(run: RefreshRun): boolean {
    return isActive(run.generation) && latestRefresh === run
  }

  async function runBounded<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController()
    requestControllers.add(controller)
    let rejectCancellation: ((error: Error) => void) | undefined
    const cancellation = new Promise<never>((_resolve, reject) => {
      rejectCancellation = reject
    })
    const cancel = () => {
      const error = new Error("Pending question refresh was cancelled")
      error.name = "AbortError"
      rejectCancellation?.(error)
    }
    controller.signal.addEventListener("abort", cancel, { once: true })
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs)
    try {
      return await Promise.race([run(controller.signal), cancellation])
    } finally {
      clearTimeout(timeout)
      controller.signal.removeEventListener("abort", cancel)
      requestControllers.delete(controller)
      controller.abort()
    }
  }

  async function fetchPending(sessionId: string, questionId?: string): Promise<PendingResult> {
    try {
      return {
        sessionId,
        pending: await runBounded((signal) => client.pending(sessionId, signal, questionId)),
        succeeded: true,
      }
    } catch {
      return { sessionId, pending: null, succeeded: false }
    }
  }

  function hydrateQuestion(sessionId: string, questionId: string | undefined, key: string, runGeneration: number, force: boolean): void {
    const targetKey = questionId ?? `session:${sessionId}`
    const current = hydrationRuns.get(targetKey)
    if (!force && current?.generation === runGeneration && current.key === key) return

    const hydration: HydrationRun = { generation: runGeneration, key }
    hydrationRuns.set(targetKey, hydration)
    void fetchPending(sessionId, questionId)
      .then((result) => {
        if (isActive(runGeneration) && hydrationRuns.get(targetKey) === hydration && result.succeeded) {
          if (result.pending) store.setPending(result.pending)
          else if (questionId) store.removePending(questionId)
          else store.setPending(null, result.sessionId)
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (hydrationRuns.get(targetKey) === hydration) hydrationRuns.delete(targetKey)
      })
  }

  async function runRefresh(run: RefreshRun): Promise<void> {
    let hints: PendingQuestionHint[] = []
    let hasAuthoritativeHints = false
    try {
      const state = await runBounded(async (signal) => {
        const response = await fetch(`${apiBaseUrl}/api/v1/ui/state`, {
          headers: authHeaders,
          signal,
        })
        return await response.json().catch(() => null) as Record<string, unknown> | null
      })
      hints = readPendingQuestionHintsFromState(state)
      hasAuthoritativeHints = hasPendingStateSlot(state)
    } catch {
      // UI state is a hint channel only; keep already-hydrated pending payloads.
    }

    if (!isLatestRefresh(run)) return
    if (hasAuthoritativeHints) store.setPendingHints(hints)

    const hintedSessions = new Set(hints.map((hint) => hint.sessionId))
    const activeHydrationTargets = new Set<string>()
    for (const hint of hints) {
      activeHydrationTargets.add(hint.questionId)
      hydrateQuestion(
        hint.sessionId,
        hint.questionId,
        `${hint.questionId}:${hint.status ?? ""}`,
        run.generation,
        run.requestedQuestions.has(hint.questionId) || run.requestedSessions.has(hint.sessionId),
      )
    }
    for (const [questionId, sessionId] of run.requestedQuestions) {
      activeHydrationTargets.add(questionId)
      if (!hints.some((hint) => hint.questionId === questionId)) {
        hydrateQuestion(sessionId, questionId, `${questionId}:requested`, run.generation, true)
      }
    }
    const fallbackSessions = new Set(run.requestedSessions)
    if (run.activeSessionId) fallbackSessions.add(run.activeSessionId)
    const exactRequestedSessions = new Set(run.requestedQuestions.values())
    for (const sessionId of fallbackSessions) {
      if (!hintedSessions.has(sessionId) && !exactRequestedSessions.has(sessionId)) {
        activeHydrationTargets.add(`session:${sessionId}`)
        hydrateQuestion(sessionId, undefined, "no-hint", run.generation, run.requestedSessions.has(sessionId))
      }
    }
    if (hasAuthoritativeHints) {
      for (const targetKey of hydrationRuns.keys()) {
        if (!activeHydrationTargets.has(targetKey)) hydrationRuns.delete(targetKey)
      }
    }
  }

  function schedule(): void {
    if (activeGeneration === null || startTimer) return
    startTimer = setTimeout(() => {
      startTimer = null
      if (activeGeneration === null) return

      const run: RefreshRun = {
        generation: activeGeneration,
        activeSessionId,
        requestedSessions: new Set(requestedSessions),
        requestedQuestions: new Map(requestedQuestions),
      }
      requestedSessions.clear()
      requestedQuestions.clear()
      latestRefresh = run
      void runRefresh(run).catch(() => undefined)
    }, 0)
  }

  function request(sessionId?: string, questionId?: string): void {
    if (sessionId && questionId) requestedQuestions.set(questionId, sessionId)
    else if (sessionId) requestedSessions.add(sessionId)
    schedule()
  }

  function deactivate(runGeneration: number): void {
    if (activeGeneration !== runGeneration) return
    if (startTimer) clearTimeout(startTimer)
    startTimer = null
    for (const controller of requestControllers) controller.abort()
    requestControllers.clear()
    hydrationRuns.clear()
    requestedSessions.clear()
    requestedQuestions.clear()
    latestRefresh = null
    activeGeneration = null
    activeSessionId = null
  }

  return {
    activate(nextActiveSessionId) {
      const runGeneration = ++generation
      activeGeneration = runGeneration
      activeSessionId = nextActiveSessionId ?? null
      request()
      return () => deactivate(runGeneration)
    },
    request,
  }
}

function hasPendingStateSlot(state: Record<string, unknown> | null): boolean {
  return !!state && Object.prototype.hasOwnProperty.call(state, ASK_USER_UI_STATE_SLOTS.PENDING)
}
