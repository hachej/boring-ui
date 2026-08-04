"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { workspaceSessionKey, workspaceSessionKeyFor } from "./sessionIdentity"

const CHAT_SESSION_STATUS_EVENT = "boring:chat-session-status"
const CHAT_SESSION_STATUS_REQUEST_EVENT = "boring:chat-session-status-request"

type SessionActivity = "idle" | "running" | "aborting" | "error"

export interface SessionActivityItem {
  id: string
  agentTypeId?: string
  updatedAt?: string | number
  status?: SessionActivity
}

/** Optimistic panel events reconciled by changed AgentHost activity snapshots. */
export function useWorkingSessionIds(sessions: readonly SessionActivityItem[]): ReadonlySet<string> {
  const [working, setWorking] = useState<ReadonlySet<string>>(() => new Set())
  const activitySnapshot = useMemo(() => JSON.stringify(sessions.map((session) => [
    session.agentTypeId,
    session.id,
    session.status,
    session.updatedAt,
  ])), [sessions])
  const previousActivitySnapshotRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    const onStatus = (event: Event) => {
      const detail = (event as CustomEvent).detail as { sessionId?: unknown; agentTypeId?: unknown; working?: unknown } | undefined
      if (typeof detail?.sessionId !== "string") return
      const key = workspaceSessionKey(detail.sessionId, typeof detail.agentTypeId === "string" ? detail.agentTypeId : undefined)
      const isWorking = detail.working === true
      setWorking((current) => {
        if (current.has(key) === isWorking) return current
        const next = new Set(current)
        if (isWorking) next.add(key)
        else next.delete(key)
        return next
      })
    }
    window.addEventListener(CHAT_SESSION_STATUS_EVENT, onStatus)
    window.dispatchEvent(new Event(CHAT_SESSION_STATUS_REQUEST_EVENT))
    return () => window.removeEventListener(CHAT_SESSION_STATUS_EVENT, onStatus)
  }, [])

  useEffect(() => {
    const previousSnapshot = previousActivitySnapshotRef.current
    if (previousSnapshot === activitySnapshot) return
    previousActivitySnapshotRef.current = activitySnapshot
    setWorking((current) => {
      const next = new Set(current)
      for (const session of sessions) {
        if (!session.status) continue
        const key = workspaceSessionKeyFor(session)
        if (session.status === "running" || session.status === "aborting") next.add(key)
        else if (previousSnapshot !== undefined) next.delete(key)
      }
      if (next.size === current.size && [...next].every((key) => current.has(key))) return current
      return next
    })
  }, [activitySnapshot, sessions])

  return working
}
