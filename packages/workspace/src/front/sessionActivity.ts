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

export interface AddressedSessionActivity {
  ref: { agentTypeId: string; sessionId: string }
  status: SessionActivity
}

function parseActivity(value: unknown): AddressedSessionActivity | undefined {
  if (!value || typeof value !== "object") return undefined
  const { ref, status } = value as { ref?: unknown; status?: unknown }
  if (!ref || typeof ref !== "object") return undefined
  const { agentTypeId, sessionId } = ref as { agentTypeId?: unknown; sessionId?: unknown }
  if (typeof agentTypeId !== "string" || typeof sessionId !== "string") return undefined
  if (status !== "idle" && status !== "running" && status !== "aborting" && status !== "error") return undefined
  return { ref: { agentTypeId, sessionId }, status }
}

/** Opens one Workspace-owned native SSE stream. EventSource reconnects automatically. */
export function startSessionActivityStream(options: {
  endpoint?: string
  workspaceId?: string
  onActivity: (activity: AddressedSessionActivity) => void
  eventSourceCtor?: typeof EventSource | null
}): () => void {
  const EventSourceCtor = options.eventSourceCtor === null
    ? null
    : options.eventSourceCtor ?? (typeof EventSource === "undefined" ? null : EventSource)
  if (!EventSourceCtor) return () => {}
  const endpoint = options.endpoint?.replace(/\/$/, "") ?? ""
  const query = options.workspaceId ? `?workspaceId=${encodeURIComponent(options.workspaceId)}` : ""
  const source = new EventSourceCtor(`${endpoint}/api/v1/agents/session-activity/events${query}`)
  let workingRefs = new Map<string, AddressedSessionActivity["ref"]>()
  const keyFor = ({ ref }: AddressedSessionActivity) => workspaceSessionKey(ref.sessionId, ref.agentTypeId)
  const publish = (activity: AddressedSessionActivity) => {
    const key = keyFor(activity)
    if (activity.status === "running" || activity.status === "aborting") workingRefs.set(key, activity.ref)
    else workingRefs.delete(key)
    options.onActivity(activity)
  }
  source.addEventListener("snapshot", (event) => {
    try {
      const parsed = JSON.parse((event as MessageEvent).data) as { sessions?: unknown }
      if (!Array.isArray(parsed.sessions)) return
      const activities = parsed.sessions.map(parseActivity).filter((item): item is AddressedSessionActivity => Boolean(item))
      const seen = new Set(activities.map(keyFor))
      const stale = [...workingRefs].filter(([key]) => !seen.has(key)).map(([, ref]) => ref)
      workingRefs = new Map()
      activities.forEach(publish)
      stale.forEach((ref) => options.onActivity({ ref, status: "idle" }))
    } catch { /* Ignore malformed server frames. */ }
  })
  source.addEventListener("activity", (event) => {
    try {
      const activity = parseActivity(JSON.parse((event as MessageEvent).data))
      if (activity) publish(activity)
    } catch { /* Ignore malformed server frames. */ }
  })
  return () => source.close()
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
