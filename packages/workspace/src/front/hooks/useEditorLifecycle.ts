"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { events, workspaceEvents } from "../events"

export interface EditorLifecycleAdapter {
  isDirty: () => boolean
  save: () => Promise<void>
  getContent: () => string
}

export interface UseEditorLifecycleOptions {
  adapter: EditorLifecycleAdapter | null
  panelId: string
  onDirtyChange?: (path: string, dirty: boolean) => void
  serverMtime?: number | null
}

export interface UseEditorLifecycleReturn {
  isDirty: boolean
  isSaving: boolean
  lastSavedAt: number | null
  markDirty: () => void
  markClean: () => void
  flushSave: () => Promise<void>
  shouldSync: boolean
  ackSync: () => void
  /** True when the file was modified externally while the editor has unsaved changes. */
  externalChangeWhileDirty: boolean
  ackExternalChange: () => void
  /** Call after a successful save with the mtime the server returned. */
  notifySaved: (mtime: number) => void
}

// Short enough that an agent edit rarely lands while the buffer is still dirty
// (which is what triggers the external-modification conflict banner). Long
// enough to batch a burst of keystrokes into a single save.
const AUTO_SAVE_DELAY = 250
const STALE_SUPPRESSION_MS = 3000
// Watchdog for hung saves. If `adapter.save()` never resolves (network hang,
// stuck mutation, server timeout), the finally block below would never run,
// `saveEnd` would never emit, and the tab spinner + dirty marker stay stuck
// forever. After this many ms we abandon waiting, emit saveEnd so the UI
// clears, and leave dirty=true so the next keystroke retries.
const SAVE_WATCHDOG_MS = 30_000

export function useEditorLifecycle(
  path: string | null,
  opts: UseEditorLifecycleOptions,
): UseEditorLifecycleReturn {
  const { adapter, panelId, onDirtyChange, serverMtime } = opts

  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)
  const [shouldSync, setShouldSync] = useState(false)
  const [externalChangeWhileDirty, setExternalChangeWhileDirty] = useState(false)

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const saveInFlightRef = useRef<Promise<void> | null>(null)
  const lastSaveTimeRef = useRef(0)
  const lastKnownMtimeRef = useRef<number | null>(null)
  const onDirtyChangeRef = useRef(onDirtyChange)
  onDirtyChangeRef.current = onDirtyChange
  const adapterRef = useRef(adapter)
  adapterRef.current = adapter

  const doSave = useCallback(async () => {
    const a = adapterRef.current
    if (!a || !path || !a.isDirty()) return
    if (saveInFlightRef.current) return saveInFlightRef.current

    const p = (async () => {
      setIsSaving(true)
      events.emit(workspaceEvents.editorSaveStart, { panelId })

      // Watchdog: if a.save() hangs (network drop, server stuck), we MUST
      // still emit saveEnd or the tab spinner + dirty marker get stuck.
      // Race the save against a timeout; whichever wins, we clean up.
      let watchdog: ReturnType<typeof setTimeout> | undefined
      const watchdogTrip: Promise<"timeout"> = new Promise((resolve) => {
        watchdog = setTimeout(() => resolve("timeout"), SAVE_WATCHDOG_MS)
      })

      try {
        const winner = await Promise.race([
          a.save().then(() => "saved" as const),
          watchdogTrip,
        ])
        if (winner === "saved") {
          lastSaveTimeRef.current = Date.now()
          setLastSavedAt(Date.now())
          setIsDirty(false)
          onDirtyChangeRef.current?.(path, false)
        }
        // winner === "timeout": leave dirty=true so the next keystroke or
        // flushSave retries. The original save promise may still resolve
        // later in the background; that's fine — its result is silently
        // discarded.
      } catch {
        // Save failed (e.g. OCC conflict). The adapter is responsible
        // for surfacing the failure to the user — we keep the dirty
        // flag set so a subsequent edit / explicit save retries.
        // Swallowing here prevents an unhandled-rejection from the
        // setTimeout-driven scheduleSave path.
      } finally {
        if (watchdog) clearTimeout(watchdog)
        // Always signal save:end so consumers (e.g. tab spinner) clear
        // their pending UI even when save throws or hits the watchdog.
        events.emit(workspaceEvents.editorSaveEnd, { panelId })
        setIsSaving(false)
        saveInFlightRef.current = null
      }
    })()
    saveInFlightRef.current = p
    return p
  }, [path, panelId])

  const scheduleSave = useCallback(() => {
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(doSave, AUTO_SAVE_DELAY)
  }, [doSave])

  const markDirty = useCallback(() => {
    if (!path) return
    setIsDirty(true)
    onDirtyChangeRef.current?.(path, true)
    scheduleSave()
  }, [path, scheduleSave])

  const markClean = useCallback(() => {
    if (!path) return
    clearTimeout(saveTimerRef.current)
    setIsDirty(false)
    setExternalChangeWhileDirty(false)
    onDirtyChangeRef.current?.(path, false)
  }, [path])

  const flushSave = useCallback(async () => {
    clearTimeout(saveTimerRef.current)
    if (saveInFlightRef.current) return saveInFlightRef.current
    if (!adapterRef.current?.isDirty()) return
    return doSave()
  }, [doSave])

  const ackSync = useCallback(() => setShouldSync(false), [])
  const ackExternalChange = useCallback(() => setExternalChangeWhileDirty(false), [])

  const notifySaved = useCallback((mtime: number) => {
    // Immediately record the server mtime so the post-save SSE echo is never
    // mistaken for an external modification. Without this, lastKnownMtimeRef
    // stays at the pre-save value and any refetch during the suppression window
    // leaves a stale baseline that mis-fires after the window expires.
    lastKnownMtimeRef.current = mtime
    setExternalChangeWhileDirty(false)
  }, [])

  useEffect(() => {
    if (serverMtime == null || !path) return

    if (lastKnownMtimeRef.current === null) {
      lastKnownMtimeRef.current = serverMtime
      return
    }

    if (serverMtime !== lastKnownMtimeRef.current) {
      const elapsed = Date.now() - lastSaveTimeRef.current
      if (elapsed < STALE_SUPPRESSION_MS) {
        // Absorb the echo of our own save so post-suppression comparisons
        // are anchored to the correct mtime, not the pre-save one.
        lastKnownMtimeRef.current = serverMtime
        return
      }
      lastKnownMtimeRef.current = serverMtime
      if (!isDirty) {
        setShouldSync(true)
      } else {
        // File changed externally while we have unsaved edits — surface this
        // immediately so the user isn't surprised by a 409 on next save.
        setExternalChangeWhileDirty(true)
      }
    }
  }, [serverMtime, path, isDirty])

  useEffect(() => {
    return () => clearTimeout(saveTimerRef.current)
  }, [])

  return {
    isDirty,
    isSaving,
    lastSavedAt,
    markDirty,
    markClean,
    flushSave,
    shouldSync,
    ackSync,
    externalChangeWhileDirty,
    ackExternalChange,
    notifySaved,
  }
}
