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
  request(sessionId?: string): void
}

export function createPendingRefreshCoordinator({
  apiBaseUrl,
  authHeaders,
  store,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
}: PendingRefreshOptions): PendingRefreshCoordinator {
  const client = createQuestionsClient({ apiBaseUrl, headers: authHeaders })
  const requestedSessions = new Set<string>()
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

  async function fetchPending(sessionId: string): Promise<PendingResult> {
    try {
      return {
        sessionId,
        pending: await runBounded((signal) => client.pending(sessionId, signal)),
        succeeded: true,
      }
    } catch {
      return { sessionId, pending: null, succeeded: false }
    }
  }

  function hydrateSession(sessionId: string, key: string, runGeneration: number, force: boolean): void {
    const current = hydrationRuns.get(sessionId)
    if (!force && current?.generation === runGeneration && current.key === key) return

    const hydration: HydrationRun = { generation: runGeneration, key }
    hydrationRuns.set(sessionId, hydration)
    void fetchPending(sessionId)
      .then((result) => {
        if (isActive(runGeneration) && hydrationRuns.get(sessionId) === hydration && result.succeeded) {
          store.setPending(result.pending, result.sessionId)
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (hydrationRuns.get(sessionId) === hydration) hydrationRuns.delete(sessionId)
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

    const hintsBySession = new Map(hints.map((hint) => [hint.sessionId, hint]))
    const sessionsToHydrate = new Set(run.requestedSessions)
    if (run.activeSessionId) sessionsToHydrate.add(run.activeSessionId)
    for (const hint of hints) sessionsToHydrate.add(hint.sessionId)
    if (hasAuthoritativeHints) {
      for (const sessionId of hydrationRuns.keys()) {
        if (!sessionsToHydrate.has(sessionId)) hydrationRuns.delete(sessionId)
      }
    }
    for (const sessionId of sessionsToHydrate) {
      const hint = hintsBySession.get(sessionId)
      const key = hint ? `${hint.questionId}:${hint.status ?? ""}` : "no-hint"
      hydrateSession(sessionId, key, run.generation, run.requestedSessions.has(sessionId))
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
      }
      requestedSessions.clear()
      latestRefresh = run
      void runRefresh(run).catch(() => undefined)
    }, 0)
  }

  function request(sessionId?: string): void {
    if (sessionId) requestedSessions.add(sessionId)
    schedule()
  }

  function deactivate(runGeneration: number): void {
    if (activeGeneration !== runGeneration) return
    if (startTimer) clearTimeout(startTimer)
    startTimer = null
    for (const controller of requestControllers) controller.abort()
    requestControllers.clear()
    hydrationRuns.clear()
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
