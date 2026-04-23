import { useState, useEffect, useCallback, useRef } from 'react'
import type { SessionSummary } from '../../shared/session'

const API_BASE = '/api/v1/agent/sessions'
const STORAGE_KEY = 'boring-agent:activeSessionId'

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

function readPersistedId(): string | undefined {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? undefined
  } catch {
    return undefined
  }
}

function persistId(id: string | undefined): void {
  try {
    if (id === undefined) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, id)
  } catch {}
}

async function fetchSessions(): Promise<SessionSummary[]> {
  const res = await fetch(API_BASE)
  if (!res.ok) throw new Error(`Failed to load sessions: ${res.status}`)
  return res.json()
}

export function useSessions(): UseSessionsResult {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>(
    readPersistedId,
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | undefined>()
  const versionRef = useRef(0)

  const refresh = useCallback(async () => {
    const v = ++versionRef.current
    try {
      const data = await fetchSessions()
      if (v === versionRef.current) {
        setSessions(data)
        setLoading(false)
      }
    } catch (err) {
      if (v === versionRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)))
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const create = useCallback(
    async (init?: { title?: string }): Promise<SessionSummary> => {
      const res = await fetch(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      persistId(session.id)
      void refresh()
      return session
    },
    [refresh],
  )

  const switchSession = useCallback((id: string) => {
    setActiveSessionId(id)
    persistId(id)
  }, [])

  const deleteSession = useCallback(
    async (id: string): Promise<void> => {
      setSessions((prev) => prev.filter((s) => s.id !== id))
      setActiveSessionId((prev) => {
        if (prev === id) {
          persistId(undefined)
          return undefined
        }
        return prev
      })
      try {
        const res = await fetch(`${API_BASE}/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        })
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
    [refresh],
  )

  return {
    sessions,
    activeSession: sessions.find((s) => s.id === activeSessionId),
    activeSessionId,
    loading,
    error,
    create,
    switch: switchSession,
    delete: deleteSession,
  }
}
