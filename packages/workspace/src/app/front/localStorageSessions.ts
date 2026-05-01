import { useSyncExternalStore } from "react"
import type { SessionItem } from "../../front/components/SessionList"

export interface WorkspaceLocalSessionsState {
  sessions: SessionItem[]
  activeId: string
}

export interface WorkspaceLocalSessionsStore {
  getState: () => WorkspaceLocalSessionsState
  subscribe: (fn: () => void) => () => void
  switchTo: (id: string) => void
  create: () => void
  remove: (id: string) => void
}

export interface CreateLocalStorageSessionsOptions {
  storageKey?: string
  initial?: () => WorkspaceLocalSessionsState
}

function defaultInitial(): WorkspaceLocalSessionsState {
  const id = `s${Date.now()}`
  return {
    sessions: [{ id, title: "New session", updatedAt: Date.now() }],
    activeId: id,
  }
}

function safeLoad(
  key: string,
  initial: () => WorkspaceLocalSessionsState,
): WorkspaceLocalSessionsState {
  if (typeof localStorage === "undefined") return initial()
  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<WorkspaceLocalSessionsState>
      const sessions = Array.isArray(parsed.sessions)
        ? parsed.sessions
        : Array.isArray((parsed as { items?: SessionItem[] }).items)
          ? ((parsed as { items?: SessionItem[] }).items as SessionItem[])
          : null
      if (sessions) {
        return { sessions, activeId: parsed.activeId ?? sessions[0]?.id ?? "" }
      }
    }
  } catch {
    // Corrupt or unavailable storage falls back to a fresh local session.
  }
  return initial()
}

function safePersist(key: string, state: WorkspaceLocalSessionsState): void {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(key, JSON.stringify(state))
  } catch {
    // Storage failure should not block the workspace shell.
  }
}

export function createLocalStorageSessions(
  opts: CreateLocalStorageSessionsOptions = {},
): WorkspaceLocalSessionsStore {
  const key = opts.storageKey ?? "workspace:sessions"
  const initial = opts.initial ?? defaultInitial

  let state = safeLoad(key, initial)
  const listeners = new Set<() => void>()

  const setState = (next: WorkspaceLocalSessionsState) => {
    state = next
    safePersist(key, state)
    listeners.forEach((fn) => fn())
  }

  return {
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    switchTo(id) {
      setState({ ...state, activeId: id })
    },
    create() {
      const id = `s${Date.now()}`
      const item: SessionItem = {
        id,
        title: "New session",
        updatedAt: Date.now(),
      }
      setState({ sessions: [item, ...state.sessions], activeId: id })
    },
    remove(id) {
      const next = state.sessions.filter((session) => session.id !== id)
      const activeId = state.activeId === id ? (next[0]?.id ?? "") : state.activeId
      setState({ sessions: next, activeId })
    },
  }
}

export function useLocalStorageSessions(
  store: WorkspaceLocalSessionsStore,
): WorkspaceLocalSessionsState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState)
}
