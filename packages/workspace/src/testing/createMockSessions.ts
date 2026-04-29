/**
 * In-memory session store for demos / playgrounds / tests that need a
 * working `sessions` + `activeSessionId` + handlers but don't have (or
 * don't want) a real chat backend.
 *
 * Returns a vanilla store + a React hook backed by useSyncExternalStore,
 * so consumers can drive it from event handlers AND read it from
 * components without prop-drilling.
 */
import { useSyncExternalStore } from "react"
import type { SessionItem } from "../front/components/SessionList"

export interface MockSessionsState {
  sessions: SessionItem[]
  activeId: string
}

export interface MockSessionsStore {
  getState: () => MockSessionsState
  subscribe: (fn: () => void) => () => void
  switchTo: (id: string) => void
  create: () => void
  remove: (id: string) => void
}

export interface CreateMockSessionsOptions {
  /** Initial sessions. Defaults to a 5-row demo set with descending updatedAt. */
  initial?: SessionItem[]
  /** Initial active session id. Defaults to the first session's id. */
  activeId?: string
}

const defaultSeed = (): SessionItem[] => {
  const now = Date.now()
  return [
    { id: "s1", title: "Workspace demo", updatedAt: now - 5 * 60_000 },
    { id: "s2", title: "Plan review", updatedAt: now - 3 * 60 * 60_000 },
    { id: "s3", title: "Yesterday's refactor", updatedAt: now - 26 * 60 * 60_000 },
    { id: "s4", title: "Weekly cleanup", updatedAt: now - 5 * 24 * 60 * 60_000 },
    { id: "s5", title: "Old exploration", updatedAt: now - 40 * 24 * 60 * 60_000 },
  ]
}

export function createMockSessions(opts: CreateMockSessionsOptions = {}): MockSessionsStore {
  const initial = opts.initial ?? defaultSeed()
  let state: MockSessionsState = {
    sessions: initial,
    activeId: opts.activeId ?? initial[0]?.id ?? "",
  }
  const listeners = new Set<() => void>()

  const setState = (next: MockSessionsState) => {
    state = next
    listeners.forEach((fn) => fn())
  }

  return {
    getState: () => state,
    subscribe: (fn) => {
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
      const item: SessionItem = { id, title: "New session", updatedAt: Date.now() }
      setState({ sessions: [item, ...state.sessions], activeId: id })
    },
    remove(id) {
      const next = state.sessions.filter((s) => s.id !== id)
      const nextActive = state.activeId === id ? next[0]?.id ?? "" : state.activeId
      setState({ sessions: next, activeId: nextActive })
    },
  }
}

/**
 * Convenience hook bound to a specific store instance. Subscribes via
 * useSyncExternalStore so React only re-renders on actual state changes.
 */
export function useMockSessions(store: MockSessionsStore): MockSessionsState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState)
}
