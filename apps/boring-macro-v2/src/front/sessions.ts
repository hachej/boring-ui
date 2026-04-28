import { useSyncExternalStore } from "react"
import type { SessionItem } from "@boring/workspace"

interface State {
  items: SessionItem[]
  activeId: string
}

const KEY = "boring-macro-v2:sessions"

function load(): State {
  if (typeof localStorage === "undefined") {
    return { items: [], activeId: "" }
  }
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as State
      if (Array.isArray(parsed.items)) return parsed
    }
  } catch {
    // ignore
  }
  const id = `s${Date.now()}`
  return {
    items: [{ id, title: "New session", updatedAt: Date.now() }],
    activeId: id,
  }
}

let state: State = load()
const listeners = new Set<() => void>()

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // ignore
  }
}

function setState(next: State) {
  state = next
  persist()
  listeners.forEach((fn) => fn())
}

export const sessions = {
  getState: () => state,
  subscribe: (fn: () => void) => {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  },
  switchTo(id: string) {
    if (state.activeId === id) return
    setState({ ...state, activeId: id })
  },
  create() {
    const id = `s${Date.now()}`
    const item: SessionItem = {
      id,
      title: "New session",
      updatedAt: Date.now(),
    }
    setState({ items: [item, ...state.items], activeId: id })
  },
  remove(id: string) {
    const next = state.items.filter((s) => s.id !== id)
    const nextActive =
      state.activeId === id ? next[0]?.id ?? "" : state.activeId
    setState({ items: next, activeId: nextActive })
  },
}

export function useSessions(): State {
  return useSyncExternalStore(sessions.subscribe, sessions.getState, sessions.getState)
}
