import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { SessionSummary } from '../../shared/session'

const API_BASE = '/api/v1/agent/sessions'
const STORAGE_KEY = 'boring-agent:activeSessionId'

export interface UseSessionsOptions {
  requestHeaders?: Record<string, string>
  storageKey?: string
  enabled?: boolean
  refreshKey?: unknown
  initialActiveSessionId?: string
}

export interface UseSessionsResult {
  sessions: SessionSummary[]
  activeSession: SessionSummary | undefined
  activeSessionId: string | undefined
  loading: boolean
  error: Error | undefined
  create: (init?: { title?: string }) => Promise<SessionSummary>
  switch: (id: string) => void
  delete: (id: string) => Promise<void>
}

function readPersistedId(storageKey: string): string | undefined {
  try {
    return localStorage.getItem(storageKey) ?? undefined
  } catch {
    return undefined
  }
}

function persistId(storageKey: string, id: string | undefined): void {
  try {
    if (id === undefined) localStorage.removeItem(storageKey)
    else localStorage.setItem(storageKey, id)
  } catch {}
}

function headersScopeKey(headers: Record<string, string> | undefined): string {
  return JSON.stringify(Object.entries(headers ?? {}).sort(([a], [b]) => a.localeCompare(b)))
}

function requestInit(
  headers: Record<string, string> | undefined,
): RequestInit | undefined {
  if (!headers || Object.keys(headers).length === 0) return undefined
  return { headers }
}

/**
 * Thrown when the sessions endpoint returns HTTP 503 ("Agent runtime is still
 * preparing"). This is a transient condition during cold-start warmup, so it is
 * marked retryable: the hook retries with backoff instead of surfacing an empty
 * chat. Only 503 is retryable — every other failure (network error, 4xx, 5xx)
 * is a terminal error so we never mask real/offline failures.
 */
class SessionsPreparingError extends Error {
  readonly retryable = true
  constructor() {
    super('Agent runtime is still preparing')
    this.name = 'SessionsPreparingError'
  }
}

// Bounded retry policy for transient 503s during runtime warmup.
const MAX_SESSIONS_RETRIES = 8
function retryDelayMs(attempt: number): number {
  return Math.min(250 * 2 ** attempt, 2000)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchSessions(
  headers: Record<string, string> | undefined,
): Promise<SessionSummary[]> {
  const init = requestInit(headers)
  const res = init ? await fetch(API_BASE, init) : await fetch(API_BASE)
  if (res.status === 503) throw new SessionsPreparingError()
  if (!res.ok) throw new Error(`Failed to load sessions: ${res.status}`)
  return res.json()
}

export function useSessions(opts: UseSessionsOptions = {}): UseSessionsResult {
  const storageKey = opts.storageKey ?? STORAGE_KEY
  const requestHeaders = opts.requestHeaders
  const enabled = opts.enabled ?? true
  const refreshKey = opts.refreshKey
  const initialActiveSessionId = opts.initialActiveSessionId
  const scopeKey = useMemo(
    () => `${storageKey}\n${headersScopeKey(requestHeaders)}`,
    [requestHeaders, storageKey],
  )
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>(
    () => initialActiveSessionId ?? readPersistedId(storageKey),
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | undefined>()
  const [loaded, setLoaded] = useState(false)
  const versionRef = useRef(0)
  const loadedScopeRef = useRef(scopeKey)
  // Unmount guard: set false in the consuming effect's cleanup (below) so
  // in-flight retries never setState after unmount. Kept as a plain ref (no
  // dedicated effect) to avoid perturbing hook order.
  const mountedRef = useRef(true)

  const refresh = useCallback(async () => {
    const v = ++versionRef.current
    // A state update is only valid while this refresh is the latest one
    // (no newer scope change / refresh) and the component is still mounted.
    const isCurrent = () => v === versionRef.current && mountedRef.current
    if (!enabled) {
      setSessions([])
      setActiveSessionId(undefined)
      setError(undefined)
      setLoaded(false)
      setLoading(false)
      return
    }
    setLoaded(false)
    setLoading(true)
    try {
      let data: SessionSummary[] | undefined
      // Bounded retry loop: a transient 503 ("runtime still preparing") keeps
      // us in loading state and retries with backoff rather than latching an
      // error and showing an empty chat. Non-retryable errors fall straight
      // through to the catch block below (original behavior).
      for (let attempt = 0; ; attempt++) {
        try {
          data = await fetchSessions(requestHeaders)
          break
        } catch (err) {
          const retryable =
            err instanceof SessionsPreparingError && attempt < MAX_SESSIONS_RETRIES
          if (!retryable) throw err
          // Cancel in-flight retries if a newer refresh/scope change happened
          // or we unmounted; do not touch state in that case.
          if (!isCurrent()) return
          await delay(retryDelayMs(attempt))
          if (!isCurrent()) return
        }
      }
      if (isCurrent() && data) {
        const replacingLoadedScope = loadedScopeRef.current !== scopeKey
        loadedScopeRef.current = scopeKey
        const persisted = initialActiveSessionId ?? readPersistedId(storageKey)
        setError(undefined)
        setLoaded(true)
        setSessions(data)
        setActiveSessionId((prev) => {
          const preferred = replacingLoadedScope ? persisted : (prev ?? persisted)
          if (preferred && data.some((session) => session.id === preferred)) return preferred
          const next = data[0]?.id
          persistId(storageKey, next)
          return next
        })
        setLoading(false)
      }
    } catch (err) {
      if (isCurrent()) {
        const replacingLoadedScope = loadedScopeRef.current !== scopeKey
        loadedScopeRef.current = scopeKey
        if (replacingLoadedScope) {
          setSessions([])
          setActiveSessionId(undefined)
        }
        setLoaded(true)
        setError(err instanceof Error ? err : new Error(String(err)))
        setLoading(false)
      }
    }
  }, [enabled, initialActiveSessionId, requestHeaders, scopeKey, storageKey])

  useEffect(() => {
    mountedRef.current = true
    if (!enabled) {
      setSessions([])
      setActiveSessionId(undefined)
      setError(undefined)
      setLoaded(false)
      setLoading(false)
      return
    }
    void refresh()
    return () => {
      mountedRef.current = false
    }
  }, [enabled, refresh, refreshKey, scopeKey])

  const create = useCallback(
    async (init?: { title?: string }): Promise<SessionSummary> => {
      if (!enabled) throw new Error('Sessions are disabled')
      const res = await fetch(API_BASE, {
        method: 'POST',
        headers: { ...requestHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(init ?? {}),
      })
      if (!res.ok) {
        const err = new Error(`Failed to create session: ${res.status}`)
        setError(err)
        throw err
      }
      const session: SessionSummary = await res.json()
      setSessions((prev) => [session, ...prev])
      setActiveSessionId(session.id)
      persistId(storageKey, session.id)
      void refresh()
      return session
    },
    [enabled, refresh, requestHeaders, storageKey],
  )

  const switchSession = useCallback((id: string) => {
    setActiveSessionId(id)
    persistId(storageKey, id)
  }, [storageKey])

  const deleteSession = useCallback(
    async (id: string): Promise<void> => {
      if (!enabled) throw new Error('Sessions are disabled')
      setSessions((prev) => prev.filter((s) => s.id !== id))
      setActiveSessionId((prev) => {
        if (prev === id) {
          persistId(storageKey, undefined)
          return undefined
        }
        return prev
      })
      try {
        const res = await fetch(
          `${API_BASE}/${encodeURIComponent(id)}`,
          requestHeaders
            ? { method: 'DELETE', headers: requestHeaders }
            : { method: 'DELETE' },
        )
        if (!res.ok && res.status !== 404) {
          throw new Error(`Failed to delete session: ${res.status}`)
        }
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)))
        void refresh()
        throw err
      }
      void refresh()
    },
    [enabled, refresh, requestHeaders, storageKey],
  )

  const scopeMatches = loadedScopeRef.current === scopeKey
  const visibleSessions = enabled && scopeMatches ? sessions : []
  const visibleActiveSessionId = enabled && scopeMatches ? activeSessionId : undefined

  return {
    sessions: visibleSessions,
    activeSession: visibleSessions.find((s) => s.id === visibleActiveSessionId),
    activeSessionId: visibleActiveSessionId,
    loading: enabled ? !scopeMatches || loading || !loaded : false,
    error,
    create,
    switch: switchSession,
    delete: deleteSession,
  }
}
