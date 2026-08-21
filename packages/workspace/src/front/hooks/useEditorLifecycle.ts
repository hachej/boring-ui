"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { events, workspaceEvents } from "../events"

export interface EditorLifecycleAdapter {
  isDirty: () => boolean
  save: () => Promise<void>
}

export interface UseEditorLifecycleOptions {
  adapter: EditorLifecycleAdapter | null
  panelId: string
  onDirtyChange?: (path: string, dirty: boolean) => void
}

export interface UseEditorLifecycleReturn {
  isDirty: boolean
  isSaving: boolean
  lastSavedAt: number | null
  markDirty: () => void
  markClean: () => void
  flushSave: () => Promise<void>
}

// Short enough that an agent edit rarely lands while the buffer is still dirty
// (which is what triggers the external-modification conflict banner). Long
// enough to batch a burst of keystrokes into a single save.
const AUTO_SAVE_DELAY = 250
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
  const { adapter, panelId, onDirtyChange } = opts

  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const saveInFlightRef = useRef<Promise<void> | null>(null)
  const scheduleSaveRef = useRef<() => void>(() => {})
  const lifecycleGenRef = useRef(0)
  const previousPathRef = useRef<string | null | undefined>(undefined)
  const onDirtyChangeRef = useRef(onDirtyChange)
  onDirtyChangeRef.current = onDirtyChange
  const adapterRef = useRef(adapter)
  adapterRef.current = adapter

  const doSave = useCallback(async () => {
    const a = adapterRef.current
    if (!a || !path || !a.isDirty()) return
    if (saveInFlightRef.current) return saveInFlightRef.current

    const saveGen = lifecycleGenRef.current
    let p: Promise<void> | null = null

    p = (async () => {
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
        if (lifecycleGenRef.current !== saveGen) return
        if (winner === "saved") {
          setLastSavedAt(Date.now())
          if (a.isDirty()) {
            // More edits arrived while the request was in flight. Keep the
            // lifecycle dirty and schedule the next serialized save after the
            // current promise leaves `saveInFlightRef`.
            setIsDirty(true)
            onDirtyChangeRef.current?.(path, true)
            scheduleSaveRef.current()
          } else {
            setIsDirty(false)
            onDirtyChangeRef.current?.(path, false)
          }
        }
        // winner === "timeout": leave dirty=true so the next keystroke or
        // flushSave retries. The original save promise may still resolve
        // later in the background; that's fine — its result is silently
        // discarded.
      } catch {
        if (lifecycleGenRef.current !== saveGen) return
        // Save failed (e.g. OCC conflict). The adapter is responsible
        // for surfacing the failure to the user — we keep the dirty
        // flag set so a subsequent edit / explicit save retries.
        // Swallowing here prevents an unhandled-rejection from the
        // setTimeout-driven scheduleSave path.
      } finally {
        if (watchdog) clearTimeout(watchdog)
        if (saveInFlightRef.current === p) {
          saveInFlightRef.current = null
        }
        if (lifecycleGenRef.current !== saveGen) return
        // Always signal save:end so consumers (e.g. tab spinner) clear
        // their pending UI even when save throws or hits the watchdog.
        events.emit(workspaceEvents.editorSaveEnd, { panelId })
        setIsSaving(false)
      }
    })()
    saveInFlightRef.current = p
    return p
  }, [path, panelId])

  const scheduleSave = useCallback(() => {
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(doSave, AUTO_SAVE_DELAY)
  }, [doSave])
  scheduleSaveRef.current = scheduleSave

  const markDirty = useCallback(() => {
    if (!path) return
    setIsDirty(true)
    onDirtyChangeRef.current?.(path, true)
    scheduleSave()
  }, [path, scheduleSave])

  const markClean = useCallback(() => {
    clearTimeout(saveTimerRef.current)
    setIsDirty(false)
    if (path) {
      onDirtyChangeRef.current?.(path, false)
    }
  }, [path])

  const flushSave = useCallback(async () => {
    clearTimeout(saveTimerRef.current)
    if (saveInFlightRef.current) return saveInFlightRef.current
    if (!adapterRef.current?.isDirty()) return
    return doSave()
  }, [doSave])

  useEffect(() => {
    if (previousPathRef.current === undefined) {
      previousPathRef.current = path
      return
    }
    if (previousPathRef.current === path) return

    previousPathRef.current = path
    lifecycleGenRef.current += 1
    clearTimeout(saveTimerRef.current)
    if (saveInFlightRef.current) {
      events.emit(workspaceEvents.editorSaveEnd, { panelId })
    }
    saveInFlightRef.current = null
    setIsDirty(false)
    setIsSaving(false)
  }, [path])

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
  }
}
