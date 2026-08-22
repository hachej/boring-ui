"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { workspaceSessionKey, workspaceSessionKeyFor } from "./sessionIdentity"

const CHAT_SESSION_STATUS_EVENT = "boring:chat-session-status"
const CHAT_SESSION_STATUS_REQUEST_EVENT = "boring:chat-session-status-request"

type SessionActivity = "idle" | "running" | "aborting" | "aborted" | "error"

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
  if (status !== "idle" && status !== "running" && status !== "aborting" && status !== "aborted" && status !== "error") return undefined
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

/**
 * Terminal states of the last run, shown once a session is no longer working.
 * `completed` means the run finished successfully; a cancelled (`aborted`) run
 * earns no chip at all.
 */
export type SessionTerminalState = "completed" | "failed"

/**
 * How long a just-finished run stays marked `completed` before the row falls
 * back to its timestamp. A permanent chip would mark every idle session and
 * carry no information; the useful signal is "the run you were watching ended".
 */
export const COMPLETED_VISIBLE_MS = 60_000

/**
 * Terminal states derived from activity the list already holds: `failed`
 * comes from the AgentHost `error`/`aborted-outcome` statuses projected onto
 * each row and streamed on the existing status event, and `completed` is the
 * working -> not-working transition of the set this component already
 * computes — but only when the row's settled status is not `aborted`, so a
 * cancelled run is never presented as done. Neither path reads a transcript
 * nor adds a per-row request, so session inventory cost is unchanged (gh-1338).
 *
 * `scopeKey` (the workspace id) scopes the terminal caches: switching to a
 * different workspace/source resets them, so state computed under one source
 * can never tint a colliding session id under another.
 */
export function useTerminalSessionStates(
  sessions: readonly SessionActivityItem[],
  working: ReadonlySet<string>,
  options: { completedVisibleMs?: number; scopeKey?: string } = {},
): ReadonlyMap<string, SessionTerminalState> {
  const completedVisibleMs = options.completedVisibleMs ?? COMPLETED_VISIBLE_MS
  const scopeKey = options.scopeKey
  const [failedKeys, setFailedKeys] = useState<ReadonlySet<string>>(() => new Set())
  const [completedKeys, setCompletedKeys] = useState<ReadonlySet<string>>(() => new Set())
  const previousWorkingRef = useRef<ReadonlySet<string> | undefined>(undefined)
  const previousScopeRef = useRef<string | undefined>(scopeKey)
  const expiryTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  // A workspace/source switch invalidates every cached outcome: chips earned
  // under the previous source must never survive onto a colliding id.
  useEffect(() => {
    if (previousScopeRef.current === scopeKey) return
    previousScopeRef.current = scopeKey
    previousWorkingRef.current = undefined
    setFailedKeys((current) => current.size === 0 ? current : new Set())
    setCompletedKeys((current) => {
      if (current.size > 0) {
        for (const key of current) {
          const timer = expiryTimersRef.current.get(key)
          if (timer) {
            clearTimeout(timer)
            expiryTimersRef.current.delete(key)
          }
        }
      }
      return current.size === 0 ? current : new Set()
    })
  }, [scopeKey])

  // Live failure news. The panel-only emitter carries no outcome field; it
  // reports streaming, never an outcome, so those events are left alone.
  // Events tagged with a foreign workspace are ignored so one workspace's
  // failure news cannot land on a colliding row in another.
  useEffect(() => {
    const onStatus = (event: Event) => {
      const detail = (event as CustomEvent).detail as { sessionId?: unknown; agentTypeId?: unknown; status?: unknown; workspaceId?: unknown } | undefined
      if (typeof detail?.sessionId !== "string" || typeof detail.status !== "string") return
      if (typeof detail.workspaceId === "string" && scopeKey !== undefined && detail.workspaceId !== scopeKey) return
      const key = workspaceSessionKey(detail.sessionId, typeof detail.agentTypeId === "string" ? detail.agentTypeId : undefined)
      const isFailed = detail.status === "error"
      setFailedKeys((current) => {
        if (current.has(key) === isFailed) return current
        const next = new Set(current)
        if (isFailed) next.add(key)
        else next.delete(key)
        return next
      })
    }
    window.addEventListener(CHAT_SESSION_STATUS_EVENT, onStatus)
    window.dispatchEvent(new Event(CHAT_SESSION_STATUS_REQUEST_EVENT))
    return () => window.removeEventListener(CHAT_SESSION_STATUS_EVENT, onStatus)
  }, [scopeKey])

  useEffect(() => () => {
    const timers = expiryTimersRef.current
    timers.forEach((timer) => clearTimeout(timer))
    timers.clear()
  }, [])

  useEffect(() => {
    const previous = previousWorkingRef.current
    previousWorkingRef.current = working
    if (!previous) return
    const finished = [...previous].filter((key) => !working.has(key))
    const restarted = [...working].filter((key) => !previous.has(key))
    if (finished.length === 0 && restarted.length === 0) return
    // A finish whose settled outcome is `aborted` is a cancellation, not a
    // completion. The list may not carry the terminal status yet (event/list
    // ordering), so this is a best-effort filter with a self-heal below.
    const statusByKey = new Map(sessions.map((session) => [workspaceSessionKeyFor(session), session.status]))
    setCompletedKeys((current) => {
      const next = new Set(current)
      finished.forEach((key) => {
        if (statusByKey.get(key) === "aborted") return
        next.add(key)
      })
      restarted.forEach((key) => next.delete(key))
      if (next.size === current.size && [...next].every((key) => current.has(key))) return current
      return next
    })
    const completedNow = finished.filter((key) => statusByKey.get(key) !== "aborted")
    for (const key of completedNow) {
      const timers = expiryTimersRef.current
      const running = timers.get(key)
      if (running) clearTimeout(running)
      timers.set(key, setTimeout(() => {
        timers.delete(key)
        setCompletedKeys((current) => {
          if (!current.has(key)) return current
          const next = new Set(current)
          next.delete(key)
          return next
        })
      }, completedVisibleMs))
    }
  }, [working, completedVisibleMs, sessions])

  return useMemo(() => {
    const states = new Map<string, SessionTerminalState>()
    for (const session of sessions) {
      const key = workspaceSessionKeyFor(session)
      // A session that is working again has no settled outcome to report.
      if (working.has(key)) continue
      // An aborted run is cancelled work, not done work: no chip, even if the
      // working-set transition already optimistically marked it completed.
      if (session.status === "aborted") continue
      if (session.status === "error" || failedKeys.has(key)) states.set(key, "failed")
      else if (completedKeys.has(key)) states.set(key, "completed")
    }
    return states
  }, [sessions, working, failedKeys, completedKeys])
}
