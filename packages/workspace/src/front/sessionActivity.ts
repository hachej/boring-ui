"use client"

import { useEffect, useMemo, useState } from "react"
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

/** Terminal states of the last run, shown once a session is no longer working. */
export type SessionTerminalState = "completed" | "failed"

/** How long a just-finished run stays marked `completed` before returning to its timestamp. */
export const COMPLETED_VISIBLE_MS = 60_000

interface TerminalEntry {
  state: SessionTerminalState
  expiresAt?: number
}

interface ScopedSessionActivityModel {
  scopeKey: string
  inventorySnapshot: string
  inventoryFingerprints: ReadonlyMap<string, string>
  /** Inventory fingerprint seen when the latest live event for this key arrived. */
  liveInventoryFingerprints: ReadonlyMap<string, string | undefined>
  working: ReadonlySet<string>
  terminal: ReadonlyMap<string, TerminalEntry>
}

function inventoryFingerprint(session: SessionActivityItem): string {
  return JSON.stringify([session.status, session.updatedAt])
}

function inventorySnapshotFor(sessions: readonly SessionActivityItem[]): string {
  return JSON.stringify(sessions.map((session) => [
    session.agentTypeId,
    session.id,
    session.status,
    session.updatedAt,
  ]))
}

function applyActivity(
  model: ScopedSessionActivityModel,
  key: string,
  status: SessionActivity,
  completedVisibleMs: number,
): ScopedSessionActivityModel {
  const wasWorking = model.working.has(key)
  const isWorking = status === "running" || status === "aborting"
  const working = new Set(model.working)
  const terminal = new Map(model.terminal)

  if (isWorking) {
    working.add(key)
    terminal.delete(key)
  } else {
    working.delete(key)
    if (status === "error") terminal.set(key, { state: "failed" })
    else if (status === "idle") {
      if (wasWorking) {
        terminal.set(key, { state: "completed", expiresAt: Date.now() + completedVisibleMs })
      } else if (terminal.get(key)?.state !== "completed") {
        // Repeated live idle and confirming idle inventory are idempotent: an
        // existing completion keeps its original expiry instead of vanishing
        // early (or extending forever as duplicate frames arrive).
        terminal.delete(key)
      }
    } else {
      // `aborted` is an explicit cancellation, not a completion.
      terminal.delete(key)
    }
  }

  return { ...model, working, terminal }
}

function createScopedModel(
  scopeKey: string,
  sessions: readonly SessionActivityItem[],
  inventorySnapshot: string,
): ScopedSessionActivityModel {
  let model: ScopedSessionActivityModel = {
    scopeKey,
    inventorySnapshot,
    inventoryFingerprints: new Map(),
    liveInventoryFingerprints: new Map(),
    working: new Set(),
    terminal: new Map(),
  }
  const fingerprints = new Map<string, string>()
  for (const session of sessions) {
    const key = workspaceSessionKeyFor(session)
    fingerprints.set(key, inventoryFingerprint(session))
    if (session.status === "running" || session.status === "aborting" || session.status === "error") {
      model = applyActivity(model, key, session.status, COMPLETED_VISIBLE_MS)
    }
  }
  return { ...model, inventoryFingerprints: fingerprints }
}

function reconcileInventory(
  model: ScopedSessionActivityModel,
  sessions: readonly SessionActivityItem[],
  inventorySnapshot: string,
  completedVisibleMs: number,
): ScopedSessionActivityModel {
  let next = model
  const fingerprints = new Map<string, string>()
  const liveFingerprints = new Map(model.liveInventoryFingerprints)

  for (const session of sessions) {
    const key = workspaceSessionKeyFor(session)
    const fingerprint = inventoryFingerprint(session)
    fingerprints.set(key, fingerprint)
    // A live frame that arrived after this exact inventory row remains newer,
    // even when an unrelated row causes the inventory array to refresh.
    if (liveFingerprints.has(key) && liveFingerprints.get(key) === fingerprint) continue
    liveFingerprints.delete(key)
    if (session.status) next = applyActivity(next, key, session.status, completedVisibleMs)
  }

  return {
    ...next,
    inventorySnapshot,
    inventoryFingerprints: fingerprints,
    liveInventoryFingerprints: liveFingerprints,
  }
}

function modelForInputs(
  current: ScopedSessionActivityModel,
  scopeKey: string,
  sessions: readonly SessionActivityItem[],
  inventorySnapshot: string,
  completedVisibleMs: number,
): ScopedSessionActivityModel {
  if (current.scopeKey !== scopeKey) return createScopedModel(scopeKey, sessions, inventorySnapshot)
  if (current.inventorySnapshot !== inventorySnapshot) {
    return reconcileInventory(current, sessions, inventorySnapshot, completedVisibleMs)
  }
  return current
}

function parseLiveStatus(detail: { status?: unknown; working?: unknown }): SessionActivity | undefined {
  if (detail.status === "idle" || detail.status === "running" || detail.status === "aborting"
    || detail.status === "aborted" || detail.status === "error") return detail.status
  if (detail.working === true) return "running"
  return undefined
}

function eventBelongsToScope(workspaceId: unknown, scopeKey: string): boolean {
  if (scopeKey) return workspaceId === scopeKey
  return typeof workspaceId !== "string"
}

/**
 * One scoped model for optimistic panel state, authoritative live outcomes,
 * and inventory reconciliation. Live frames are applied atomically so an
 * explicit aborted outcome can never pass through `completed`; scope-tagged
 * state also makes the first render after a workspace switch start clean.
 */
export function useSessionActivityStates(
  sessions: readonly SessionActivityItem[],
  options: { scopeKey: string; completedVisibleMs?: number },
): {
  workingSessionIds: ReadonlySet<string>
  terminalSessionStates: ReadonlyMap<string, SessionTerminalState>
} {
  const scopeKey = options.scopeKey
  const completedVisibleMs = options.completedVisibleMs ?? COMPLETED_VISIBLE_MS
  const inventorySnapshot = useMemo(() => inventorySnapshotFor(sessions), [sessions])
  const [model, setModel] = useState<ScopedSessionActivityModel>(() => (
    createScopedModel(scopeKey, sessions, inventorySnapshot)
  ))
  // Derive against the current scope and inventory during render. Waiting for
  // an effect would expose one committed frame of the previous workspace (or
  // superseded inventory) before the scoped model catches up.
  const visibleModel = modelForInputs(model, scopeKey, sessions, inventorySnapshot, completedVisibleMs)

  useEffect(() => {
    setModel((current) => modelForInputs(
      current,
      scopeKey,
      sessions,
      inventorySnapshot,
      completedVisibleMs,
    ))
  }, [completedVisibleMs, inventorySnapshot, scopeKey, sessions])

  useEffect(() => {
    const onStatus = (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        sessionId?: unknown
        agentTypeId?: unknown
        workspaceId?: unknown
        working?: unknown
        status?: unknown
      } | undefined
      if (typeof detail?.sessionId !== "string" || !eventBelongsToScope(detail.workspaceId, scopeKey)) return
      const status = parseLiveStatus(detail)
      const key = workspaceSessionKey(
        detail.sessionId,
        typeof detail.agentTypeId === "string" ? detail.agentTypeId : undefined,
      )
      setModel((current) => {
        const scoped = modelForInputs(
          current,
          scopeKey,
          sessions,
          inventorySnapshot,
          completedVisibleMs,
        )
        const liveFingerprints = new Map(scoped.liveInventoryFingerprints)
        liveFingerprints.set(key, scoped.inventoryFingerprints.get(key))
        if (status) {
          return {
            ...applyActivity(scoped, key, status, completedVisibleMs),
            liveInventoryFingerprints: liveFingerprints,
          }
        }
        if (detail.working !== false || !scoped.working.has(key)) return scoped
        // A panel can report that streaming stopped but cannot identify the
        // outcome. Clear working atomically, but wait for an explicit live or
        // inventory outcome before showing any terminal badge.
        const working = new Set(scoped.working)
        working.delete(key)
        return { ...scoped, working, liveInventoryFingerprints: liveFingerprints }
      })
    }
    window.addEventListener(CHAT_SESSION_STATUS_EVENT, onStatus)
    window.dispatchEvent(new Event(CHAT_SESSION_STATUS_REQUEST_EVENT))
    return () => window.removeEventListener(CHAT_SESSION_STATUS_EVENT, onStatus)
  }, [completedVisibleMs, inventorySnapshot, scopeKey, sessions])

  useEffect(() => {
    const expiries = [...visibleModel.terminal.values()]
      .map((entry) => entry.expiresAt)
      .filter((expiresAt): expiresAt is number => expiresAt !== undefined)
    if (expiries.length === 0) return
    const timer = setTimeout(() => {
      const now = Date.now()
      setModel((current) => {
        if (current.scopeKey !== scopeKey) return current
        const terminal = new Map(current.terminal)
        let changed = false
        for (const [key, entry] of terminal) {
          if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
            terminal.delete(key)
            changed = true
          }
        }
        return changed ? { ...current, terminal } : current
      })
    }, Math.max(0, Math.min(...expiries) - Date.now()))
    return () => clearTimeout(timer)
  }, [scopeKey, visibleModel])

  const terminalSessionStates = useMemo(() => {
    const states = new Map<string, SessionTerminalState>()
    for (const session of sessions) {
      const key = workspaceSessionKeyFor(session)
      if (visibleModel.working.has(key)) continue
      const terminal = visibleModel.terminal.get(key)
      if (terminal) states.set(key, terminal.state)
    }
    return states
  }, [sessions, visibleModel])

  return {
    workingSessionIds: visibleModel.working,
    terminalSessionStates,
  }
}
