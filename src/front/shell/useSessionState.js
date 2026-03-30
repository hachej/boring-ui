/**
 * useSessionState — UI-layer session pointer management.
 *
 * This hook manages which session is active, the session list, and
 * session lifecycle (create, switch, add). It does NOT manage storage
 * (IndexedDB / JSONL) — that is handled by the transport layer or
 * pi-agent-core runtime.
 *
 * Session metadata shape:
 *   { id: string, title: string, lastModified: number, status: string }
 *
 * Usage:
 *   import { useSessionState } from '../shell/useSessionState'
 *   const { activeSessionId, sessions, switchSession, createNewSession, addSession } = useSessionState()
 */

import { useSyncExternalStore, useCallback } from 'react'

// ---------------------------------------------------------------------------
// Internal store (module-level singleton, survives re-renders)
// ---------------------------------------------------------------------------

let state = {
  activeSessionId: null,
  sessionsById: new Map(), // id → session metadata
}

const listeners = new Set()

function emitChange() {
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Returns sessions sorted by lastModified descending (most recent first).
 */
function getSortedSessions() {
  return Array.from(state.sessionsById.values()).sort(
    (a, b) => b.lastModified - a.lastModified
  )
}

function getSnapshot() {
  return state
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function switchSession(id) {
  if (state.activeSessionId === id) return
  state = { ...state, activeSessionId: id }
  emitChange()
}

function createNewSession() {
  const id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const now = Date.now()
  const session = { id, title: 'New Session', lastModified: now, status: 'active' }

  const nextMap = new Map(state.sessionsById)
  nextMap.set(id, session)

  state = {
    ...state,
    activeSessionId: id,
    sessionsById: nextMap,
  }
  emitChange()
}

function addSession(metadata) {
  const nextMap = new Map(state.sessionsById)
  nextMap.set(metadata.id, metadata)

  state = {
    ...state,
    sessionsById: nextMap,
  }
  emitChange()
}

/**
 * Reset the store to initial state.
 * Exported for test isolation — not intended for production use.
 */
export function resetSessionStore() {
  state = {
    activeSessionId: null,
    sessionsById: new Map(),
  }
  emitChange()
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSessionState() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot)

  const sessions = getSortedSessions()

  return {
    activeSessionId: snapshot.activeSessionId,
    sessions,
    switchSession: useCallback((id) => switchSession(id), []),
    createNewSession: useCallback(() => createNewSession(), []),
    addSession: useCallback((metadata) => addSession(metadata), []),
  }
}
