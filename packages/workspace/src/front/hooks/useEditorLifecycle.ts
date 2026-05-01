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
  flushSave: () => Promise<void>
  shouldSync: boolean
  ackSync: () => void
}

const AUTO_SAVE_DELAY = 1000
const STALE_SUPPRESSION_MS = 3000

export function useEditorLifecycle(
  path: string | null,
  opts: UseEditorLifecycleOptions,
): UseEditorLifecycleReturn {
  const { adapter, panelId, onDirtyChange, serverMtime } = opts

  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)
  const [shouldSync, setShouldSync] = useState(false)

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
      try {
        await a.save()
        lastSaveTimeRef.current = Date.now()
        setLastSavedAt(Date.now())
        setIsDirty(false)
        onDirtyChangeRef.current?.(path, false)
      } catch {
        // Save failed (e.g. OCC conflict). The adapter is responsible
        // for surfacing the failure to the user — we keep the dirty
        // flag set so a subsequent edit / explicit save retries.
        // Swallowing here prevents an unhandled-rejection from the
        // setTimeout-driven scheduleSave path.
      } finally {
        // Always signal save:end so consumers (e.g. tab spinner) clear
        // their pending UI even when save throws. Error semantics live
        // on the adapter's own UI surface.
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

  const flushSave = useCallback(async () => {
    clearTimeout(saveTimerRef.current)
    if (saveInFlightRef.current) return saveInFlightRef.current
    if (!adapterRef.current?.isDirty()) return
    return doSave()
  }, [doSave])

  const ackSync = useCallback(() => setShouldSync(false), [])

  useEffect(() => {
    if (serverMtime == null || !path) return

    if (lastKnownMtimeRef.current === null) {
      lastKnownMtimeRef.current = serverMtime
      return
    }

    if (serverMtime !== lastKnownMtimeRef.current) {
      const elapsed = Date.now() - lastSaveTimeRef.current
      if (elapsed < STALE_SUPPRESSION_MS) return
      lastKnownMtimeRef.current = serverMtime
      if (!isDirty) {
        setShouldSync(true)
      }
    }
  }, [serverMtime, path, isDirty])

  useEffect(() => {
    return () => clearTimeout(saveTimerRef.current)
  }, [])

  return { isDirty, isSaving, lastSavedAt, markDirty, flushSave, shouldSync, ackSync }
}
