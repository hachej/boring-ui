/**
 * useArtifactController — Surface artifact state management.
 *
 * Manages which artifacts are open, which is active, tab ordering,
 * and deduplication by canonicalKey. This is the UI-layer controller
 * for the Surface panel (right side of Stage+Wings layout).
 *
 * SurfaceArtifact shape (from Plan 1 Architecture C):
 *   {
 *     id, canonicalKey, kind, title, source, sourceSessionId,
 *     rendererKey, params, status, dirty, createdAt
 *   }
 *
 * Usage:
 *   import { useArtifactController } from '../shell/useArtifactController'
 *   const { surfaceOpen, activeArtifactId, artifacts, orderedIds, open, focus, close } = useArtifactController()
 */

import { useSyncExternalStore, useCallback } from 'react'

// ---------------------------------------------------------------------------
// Internal store (module-level singleton)
// ---------------------------------------------------------------------------

let state = createInitialState()

function createInitialState() {
  return {
    activeArtifactId: null,
    artifacts: new Map(),       // id → SurfaceArtifact
    orderedIds: [],             // insertion order (tab order)
    canonicalIndex: new Map(),  // canonicalKey → id (for dedup)
  }
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

function getSnapshot() {
  return state
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Open an artifact. If an artifact with the same canonicalKey already
 * exists, focus it instead of adding a duplicate.
 */
function open(artifact) {
  const existingId = state.canonicalIndex.get(artifact.canonicalKey)
  if (existingId) {
    // Dedup: focus existing artifact instead of adding duplicate
    focus(existingId)
    return
  }

  const nextArtifacts = new Map(state.artifacts)
  nextArtifacts.set(artifact.id, artifact)

  const nextCanonicalIndex = new Map(state.canonicalIndex)
  nextCanonicalIndex.set(artifact.canonicalKey, artifact.id)

  state = {
    ...state,
    activeArtifactId: artifact.id,
    artifacts: nextArtifacts,
    orderedIds: [...state.orderedIds, artifact.id],
    canonicalIndex: nextCanonicalIndex,
  }
  emitChange()
}

/**
 * Focus an artifact by id. Sets it as the active artifact without
 * changing tab order.
 */
function focus(id) {
  if (!state.artifacts.has(id)) return
  if (state.activeArtifactId === id) return

  state = { ...state, activeArtifactId: id }
  emitChange()
}

/**
 * Close an artifact by id. Removes it from all indices and activates
 * the most recently added sibling (last in orderedIds before the
 * closed one, or the new last element).
 */
function close(id) {
  if (!state.artifacts.has(id)) return

  const artifact = state.artifacts.get(id)

  const nextArtifacts = new Map(state.artifacts)
  nextArtifacts.delete(id)

  const nextCanonicalIndex = new Map(state.canonicalIndex)
  if (artifact) {
    nextCanonicalIndex.delete(artifact.canonicalKey)
  }

  const closedIndex = state.orderedIds.indexOf(id)
  const nextOrderedIds = state.orderedIds.filter((oid) => oid !== id)

  // Determine next active: prefer the item just before the closed one
  // in insertion order, falling back to the new last item, or null.
  let nextActiveId = null
  if (nextOrderedIds.length > 0) {
    if (state.activeArtifactId === id) {
      // Activate the sibling closest to the closed index
      const siblingIndex = Math.min(closedIndex, nextOrderedIds.length - 1)
      // Prefer the one before, then after
      nextActiveId =
        closedIndex > 0
          ? nextOrderedIds[closedIndex - 1]
          : nextOrderedIds[0]
    } else {
      nextActiveId = state.activeArtifactId
    }
  }

  state = {
    ...state,
    activeArtifactId: nextActiveId,
    artifacts: nextArtifacts,
    orderedIds: nextOrderedIds,
    canonicalIndex: nextCanonicalIndex,
  }
  emitChange()
}

/**
 * Explicitly set whether the Surface is open. Normally derived from
 * artifact count, but exposed for manual override if needed.
 */
function setSurfaceOpen(/* open */) {
  // surfaceOpen is derived from artifacts.size > 0
  // This is a no-op by design — callers should open/close artifacts
  // to control Surface visibility.
}

/**
 * Reset the store to initial state.
 * Exported for test isolation — not intended for production use.
 */
export function resetArtifactStore() {
  state = createInitialState()
  emitChange()
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useArtifactController() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot)

  const surfaceOpen = snapshot.artifacts.size > 0

  return {
    surfaceOpen,
    activeArtifactId: snapshot.activeArtifactId,
    artifacts: snapshot.artifacts,
    orderedIds: snapshot.orderedIds,

    open: useCallback((artifact) => open(artifact), []),
    focus: useCallback((id) => focus(id), []),
    close: useCallback((id) => close(id), []),
    setSurfaceOpen: useCallback((val) => setSurfaceOpen(val), []),
  }
}
