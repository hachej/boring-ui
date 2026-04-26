import { useSyncExternalStore } from "react"
import type { SessionItem } from "@boring/workspace"

interface State {
  sessions: SessionItem[]
  activeId: string
}

const seed = (): SessionItem[] => {
  const now = Date.now()
  return [
    { id: "s1", title: "Workspace demo", updatedAt: now - 5 * 60_000 },
    { id: "s2", title: "Plan review", updatedAt: now - 3 * 60 * 60_000 },
    { id: "s3", title: "Yesterday's refactor", updatedAt: now - 26 * 60 * 60_000 },
    { id: "s4", title: "Weekly cleanup", updatedAt: now - 5 * 24 * 60 * 60_000 },
    { id: "s5", title: "Old exploration", updatedAt: now - 40 * 24 * 60 * 60_000 },
  ]
}

let state: State = { sessions: seed(), activeId: "s1" }
const listeners = new Set<() => void>()

function setState(next: State) {
  state = next
  listeners.forEach((fn) => fn())
}

export const mockSessions = {
  getState: () => state,
  subscribe: (fn: () => void) => {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  },
  switchTo(id: string) {
    setState({ ...state, activeId: id })
  },
  create() {
    const id = `s${Date.now()}`
    const item: SessionItem = { id, title: "New session", updatedAt: Date.now() }
    setState({ sessions: [item, ...state.sessions], activeId: id })
  },
  remove(id: string) {
    const next = state.sessions.filter((s) => s.id !== id)
    const nextActive = state.activeId === id ? next[0]?.id ?? "" : state.activeId
    setState({ sessions: next, activeId: nextActive })
  },
}

export function useMockSessions(): State {
  return useSyncExternalStore(mockSessions.subscribe, mockSessions.getState, mockSessions.getState)
}
