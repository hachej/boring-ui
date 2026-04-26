import { useSyncExternalStore } from "react"
import type { SessionItem } from "@boring/workspace"

interface State {
  sessions: SessionItem[]
  activeId: string
}

let state: State = {
  sessions: [{ id: "s1", title: "New chat", updatedAt: Date.now() }],
  activeId: "s1",
}

const listeners = new Set<() => void>()

function setState(next: State) {
  state = next
  listeners.forEach((fn) => fn())
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

function getState() {
  return state
}

function switchTo(id: string) {
  setState({ ...state, activeId: id })
}

function create() {
  const id = `s${Date.now()}`
  const item: SessionItem = { id, title: "New chat", updatedAt: Date.now() }
  setState({ sessions: [item, ...state.sessions], activeId: id })
}

function remove(id: string) {
  const next = state.sessions.filter((s) => s.id !== id)
  const nextActive = state.activeId === id ? next[0]?.id ?? "" : state.activeId
  setState({ sessions: next, activeId: nextActive })
}

export function useSessions() {
  const { sessions, activeId } = useSyncExternalStore(subscribe, getState, getState)
  return { sessions, activeId, switchTo, create, remove }
}
