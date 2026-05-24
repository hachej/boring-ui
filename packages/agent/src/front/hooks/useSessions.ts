import { useState, useEffect, useCallback, useRef } from 'react'
import type { SessionSummary } from '../../shared/session'

const API_BASE = '/api/v1/agent/sessions'
const STORAGE_KEY = 'boring-agent:activeSessionId'

export interface UseSessionsOptions {
  requestHeaders?: Record<string, string>
  storageKey?: string
  enabled?: boolean
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

function requestInit(
  headers: Record<string, string> | undefined,
): RequestInit | undefined {
  if (!headers || Object.keys(headers).length === 0) return undefined
  return { headers }
}

async function fetchSessions(
  headers: Record<string, string> | undefined,
): Promise<SessionSummary[]> {
  const init = requestInit(headers)
  const res = init ? await fetch(API_BASE, init) : await fetch(API_BASE)
  if (!res.ok) throw new Error(`Failed to load sessions: ${res.status}`)
  return res.json()
}

export function useSessions(opts: UseSessionsOptions = {}): UseSessionsResult {
  const storageKey = opts.storageKey ?? STORAGE_KEY
  const requestHeaders = opts.requestHeaders
  const enabled = opts.enabled ?? true
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>(
    () => readPersistedId(storageKey),
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | undefined>()
  const [loaded, setLoaded] = useState(false)
  const versionRef = useRef(0)

  const refresh = useCallback(async () => {
    const v = ++versionRef.current
    if (!enabled) {
      setError(undefined)
      setLoaded(false)
      setLoading(false)
      return
    }
    setLoaded(false)
    setLoading(true)
    try {
      const data = await fetchSessions(requestHeaders)
      if (v === versionRef.current) {
        setError(undefined)
        setLoaded(true)
        setSessions(data)
        setActiveSessionId((prev) => {
          if (prev && data.some((session) => session.id === prev)) return prev
          const next = data[0]?.id
          persistId(storageKey, next)
          return next
        })
        setLoading(false)
      }
    } catch (err) {
      if (v === versionRef.current) {
        setLoaded(true)
        setError(err instanceof Error ? err : new Error(String(err)))
        setLoading(false)
      }
    }
  }, [enabled, requestHeaders, storageKey])

  useEffect(() => {
    if (!enabled) {
      setError(undefined)
      setLoaded(false)
      setLoading(false)
      return
    }
    void refresh()
  }, [enabled, refresh])

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

  return {
    sessions,
    activeSession: sessions.find((s) => s.id === activeSessionId),
    activeSessionId,
    loading: enabled ? loading || !loaded : false,
    error,
    create,
    switch: switchSession,
    delete: deleteSession,
  }
}
