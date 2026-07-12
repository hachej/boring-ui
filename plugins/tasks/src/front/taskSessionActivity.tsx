import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useWorkspacePluginClient } from "@hachej/boring-workspace"

export type TaskSessionActivityStatus = "idle" | "queued" | "working" | "error" | "missing"
export interface TaskSessionActivity { status: TaskSessionActivityStatus; source?: "live-runtime" | "persisted"; updatedAt?: string }
export type TaskSessionActivityRefreshResult =
  | { status: "fresh"; activities: Record<string, TaskSessionActivity> }
  | { status: "stale" }

interface SessionActivityResponse {
  activities?: Array<{ sessionId: string; status: "idle" | "queued" | "working" | "error"; source: "live-runtime" | "persisted"; updatedAt?: string }>
  omittedSessionIds?: string[]
}

type WorkspacePluginClient = ReturnType<typeof useWorkspacePluginClient>

export const TASK_SESSION_ACTIVITY_POLL_MS = 15_000
export const TASK_SESSION_ACTIVITY_MAX_IDS = 100
const TASK_SESSION_ACTIVITY_REGISTER_DEBOUNCE_MS = 25

export interface TaskSessionActivityController {
  activities: Record<string, TaskSessionActivity>
  registerSessionIds(sessionIds: readonly string[]): () => void
  refreshSessionIds(sessionIds: readonly string[]): Promise<TaskSessionActivityRefreshResult>
  setOptimisticActivity(sessionId: string, activity: TaskSessionActivity): void
  clearSessionActivity(sessionId: string): void
  isLoading(sessionIds: readonly string[]): boolean
  getError(sessionIds: readonly string[]): string | null
}

const TaskSessionActivityContext = createContext<TaskSessionActivityController | null>(null)

function uniqueSessionIds(sessionIds: readonly string[]): string[] {
  return [...new Set(sessionIds.filter((sessionId) => sessionId.length > 0))]
}

function chunkSessionIds(sessionIds: readonly string[]): string[][] {
  const chunks: string[][] = []
  for (let index = 0; index < sessionIds.length; index += TASK_SESSION_ACTIVITY_MAX_IDS) {
    chunks.push(sessionIds.slice(index, index + TASK_SESSION_ACTIVITY_MAX_IDS))
  }
  return chunks
}

async function fetchSessionActivities(pluginClient: WorkspacePluginClient, sessionIds: readonly string[]): Promise<Record<string, TaskSessionActivity>> {
  const next: Record<string, TaskSessionActivity> = {}
  for (const chunk of chunkSessionIds(sessionIds)) {
    const body = await pluginClient.postJson<SessionActivityResponse>("/api/v1/agent/pi-chat/sessions/activity", { sessionIds: chunk })
    for (const entry of body.activities ?? []) {
      next[entry.sessionId] = { status: entry.status, source: entry.source, updatedAt: entry.updatedAt }
    }
    for (const sessionId of body.omittedSessionIds ?? []) next[sessionId] = { status: "missing" }
    for (const sessionId of chunk) next[sessionId] ??= { status: "missing" }
  }
  return next
}

function useTaskSessionActivityController(enabled: boolean): TaskSessionActivityController {
  const pluginClient = useWorkspacePluginClient()
  const [activities, setActivities] = useState<Record<string, TaskSessionActivity>>({})
  const [errorsBySessionId, setErrorsBySessionId] = useState<Record<string, string>>({})
  const [registeredSessionIds, setRegisteredSessionIds] = useState<ReadonlySet<string>>(new Set())
  const [loadingSessionIds, setLoadingSessionIds] = useState<ReadonlySet<string>>(new Set())
  const registrationsRef = useRef(new Map<number, string[]>())
  const nextRegistrationIdRef = useRef(0)
  const requestSeqRef = useRef(0)
  const latestRequestBySessionIdRef = useRef(new Map<string, number>())
  const pollingGenerationRef = useRef(0)
  const pollingInFlightRef = useRef<Promise<void> | null>(null)
  const mountedRef = useRef(false)
  const loadingCountsRef = useRef(new Map<string, number>())

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestSeqRef.current += 1
      latestRequestBySessionIdRef.current.clear()
      pollingGenerationRef.current += 1
      registrationsRef.current.clear()
      loadingCountsRef.current.clear()
      pollingInFlightRef.current = null
    }
  }, [])

  const publishRegisteredSessionIds = useCallback(() => {
    const next = new Set<string>()
    for (const sessionIds of registrationsRef.current.values()) {
      for (const sessionId of sessionIds) next.add(sessionId)
    }
    setRegisteredSessionIds(next)
  }, [])

  const registerSessionIds = useCallback((sessionIds: readonly string[]) => {
    if (!enabled) return () => undefined
    const id = nextRegistrationIdRef.current + 1
    nextRegistrationIdRef.current = id
    registrationsRef.current.set(id, uniqueSessionIds(sessionIds))
    publishRegisteredSessionIds()
    return () => {
      registrationsRef.current.delete(id)
      publishRegisteredSessionIds()
    }
  }, [enabled, publishRegisteredSessionIds])

  const addLoading = useCallback((sessionIds: readonly string[]) => {
    for (const sessionId of sessionIds) loadingCountsRef.current.set(sessionId, (loadingCountsRef.current.get(sessionId) ?? 0) + 1)
    if (mountedRef.current) setLoadingSessionIds(new Set(loadingCountsRef.current.keys()))
  }, [])

  const removeLoading = useCallback((sessionIds: readonly string[]) => {
    for (const sessionId of sessionIds) {
      const next = (loadingCountsRef.current.get(sessionId) ?? 0) - 1
      if (next > 0) loadingCountsRef.current.set(sessionId, next)
      else loadingCountsRef.current.delete(sessionId)
    }
    if (mountedRef.current) setLoadingSessionIds(new Set(loadingCountsRef.current.keys()))
  }, [])

  const refreshSessionIds = useCallback(async (
    rawSessionIds: readonly string[],
    options: { pollingGeneration?: number } = {},
  ): Promise<TaskSessionActivityRefreshResult> => {
    const sessionIds = uniqueSessionIds(rawSessionIds)
    if (sessionIds.length === 0) return { status: "fresh", activities: {} }
    const requestId = requestSeqRef.current + 1
    requestSeqRef.current = requestId
    for (const sessionId of sessionIds) latestRequestBySessionIdRef.current.set(sessionId, requestId)
    const isGenerationCurrent = () => options.pollingGeneration === undefined || pollingGenerationRef.current === options.pollingGeneration
    const currentSessionIdsForRequest = () => sessionIds.filter((sessionId) => latestRequestBySessionIdRef.current.get(sessionId) === requestId)
    addLoading(sessionIds)
    try {
      const next = await fetchSessionActivities(pluginClient, sessionIds)
      const currentSessionIds = mountedRef.current && isGenerationCurrent() ? currentSessionIdsForRequest() : []
      if (currentSessionIds.length > 0) {
        setActivities((current) => {
          const merged = { ...current }
          for (const sessionId of currentSessionIds) {
            const activity = next[sessionId]
            if (activity) merged[sessionId] = activity
          }
          return merged
        })
        setErrorsBySessionId((current) => {
          let changed = false
          const merged = { ...current }
          for (const sessionId of currentSessionIds) {
            if (sessionId in merged) {
              delete merged[sessionId]
              changed = true
            }
          }
          return changed ? merged : current
        })
      }
      return currentSessionIds.length === sessionIds.length ? { status: "fresh", activities: next } : { status: "stale" }
    } catch (cause) {
      const currentSessionIds = mountedRef.current && isGenerationCurrent() ? currentSessionIdsForRequest() : []
      if (currentSessionIds.length === 0) return { status: "stale" }
      const message = cause instanceof Error ? cause.message : "Failed to load chat activity"
      setErrorsBySessionId((current) => {
        const merged = { ...current }
        for (const sessionId of currentSessionIds) merged[sessionId] = message
        return merged
      })
      throw cause
    } finally {
      removeLoading(sessionIds)
    }
  }, [addLoading, pluginClient, removeLoading])

  const registeredIdList = useMemo(() => [...registeredSessionIds], [registeredSessionIds])
  const registeredIdKey = registeredIdList.join("\u0000")

  useEffect(() => {
    if (!enabled || registeredIdList.length === 0) return
    let cancelled = false
    let timer: number | undefined
    const pollingGeneration = pollingGenerationRef.current + 1
    pollingGenerationRef.current = pollingGeneration
    const schedule = (delayMs: number) => {
      timer = window.setTimeout(() => {
        if (cancelled) return
        if (pollingInFlightRef.current) {
          void pollingInFlightRef.current.finally(() => {
            if (!cancelled) schedule(0)
          })
          return
        }
        const polling = refreshSessionIds(registeredIdList, { pollingGeneration })
          .then(() => undefined, () => undefined)
          .finally(() => {
            if (pollingInFlightRef.current === polling) pollingInFlightRef.current = null
            if (!cancelled) schedule(TASK_SESSION_ACTIVITY_POLL_MS)
          })
        pollingInFlightRef.current = polling
      }, delayMs)
    }
    schedule(TASK_SESSION_ACTIVITY_REGISTER_DEBOUNCE_MS)
    return () => {
      cancelled = true
      pollingGenerationRef.current += 1
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [enabled, refreshSessionIds, registeredIdKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const setOptimisticActivity = useCallback((sessionId: string, activity: TaskSessionActivity) => {
    setActivities((current) => ({ ...current, [sessionId]: activity }))
  }, [])

  const clearSessionActivity = useCallback((sessionId: string) => {
    const requestId = requestSeqRef.current + 1
    requestSeqRef.current = requestId
    latestRequestBySessionIdRef.current.set(sessionId, requestId)
    setActivities((current) => {
      if (!(sessionId in current)) return current
      const next = { ...current }
      delete next[sessionId]
      return next
    })
    setErrorsBySessionId((current) => {
      if (!(sessionId in current)) return current
      const next = { ...current }
      delete next[sessionId]
      return next
    })
  }, [])

  const isLoading = useCallback((sessionIds: readonly string[]) => {
    return uniqueSessionIds(sessionIds).some((sessionId) => loadingSessionIds.has(sessionId))
  }, [loadingSessionIds])

  const getError = useCallback((sessionIds: readonly string[]) => {
    for (const sessionId of uniqueSessionIds(sessionIds)) {
      const message = errorsBySessionId[sessionId]
      if (message) return message
    }
    return null
  }, [errorsBySessionId])

  return useMemo(() => ({
    activities,
    registerSessionIds,
    refreshSessionIds,
    setOptimisticActivity,
    clearSessionActivity,
    isLoading,
    getError,
  }), [activities, clearSessionActivity, getError, isLoading, refreshSessionIds, registerSessionIds, setOptimisticActivity])
}

export function TaskSessionActivityProvider({ children }: { children: ReactNode }) {
  const controller = useTaskSessionActivityController(true)
  return <TaskSessionActivityContext.Provider value={controller}>{children}</TaskSessionActivityContext.Provider>
}

export function useTaskSessionActivity(): TaskSessionActivityController {
  const context = useContext(TaskSessionActivityContext)
  const fallback = useTaskSessionActivityController(context === null)
  return context ?? fallback
}
