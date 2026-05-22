/**
 * localStorage-backed sessions store. Same shape as createMockSessions
 * (vanilla store + useSyncExternalStore hook) but persists state across
 * reloads and across tabs in the same origin.
 *
 * Use this when an app wants a real "session list survives F5" experience
 * without wiring a chat backend yet — e.g. boring.macro pre-Phase 4. The
 * mock variant in `createMockSessions.ts` stays for demos that should
 * always boot from a known seed.
 */
import { useSyncExternalStore } from "react"
import type { SessionItem } from "../components/SessionList"
import type {
  MockSessionsState as State,
  MockSessionsStore as Store,
} from "./createMockSessions"

export interface CreateLocalStorageSessionsOptions {
  /** localStorage key prefix. Defaults to `"workspace:sessions"`. */
  storageKey?: string
  /**
   * Seed used the first time we run (no value at `storageKey` yet).
   * Defaults to a single "New session" row with `id = "s${Date.now()}"`.
   */
  initial?: () => State
}

function defaultInitial(): State {
  const id = `s${Date.now()}`
  return {
    sessions: [{ id, title: "New session", updatedAt: Date.now() }],
    activeId: id,
  }
}

function safeLoad(key: string, initial: () => State): State {
  if (typeof localStorage === "undefined") return initial()
  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<State>
      const sessions = Array.isArray(parsed.sessions)
        ? parsed.sessions
        : null
      if (sessions) {
        return { sessions, activeId: parsed.activeId ?? sessions[0]?.id ?? "" }
      }
    }
  } catch {
    // corrupt or storage-disabled — fall through to seed
  }
  return initial()
}

function safePersist(key: string, state: State): void {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(key, JSON.stringify(state))
  } catch {
    // quota exceeded / storage disabled — non-fatal
  }
}

export function createLocalStorageSessions(
  opts: CreateLocalStorageSessionsOptions = {},
): Store {
  const key = opts.storageKey ?? "workspace:sessions"
  const initial = opts.initial ?? defaultInitial

  let state: State = safeLoad(key, initial)
  const listeners = new Set<() => void>()

  const setState = (next: State) => {
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
      const next = state.sessions.filter((s) => s.id !== id)
      const nextActive =
        state.activeId === id ? (next[0]?.id ?? "") : state.activeId
      setState({ sessions: next, activeId: nextActive })
    },
  }
}

/**
 * React hook bound to a specific store instance. Identical signature to
 * `useMockSessions` — both stores share the `MockSessionsStore` type.
 */
export function useLocalStorageSessions(store: Store): State {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState)
}
