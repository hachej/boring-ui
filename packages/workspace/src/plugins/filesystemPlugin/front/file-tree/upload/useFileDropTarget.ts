import { useCallback, useEffect, useMemo, useRef, useState } from "react"

/** `DataTransfer.types` marker every browser sets for an OS file drag. */
const OS_FILE_DRAG_TYPE = "Files"

export function isOsFileDrag(transfer: DataTransfer | null | undefined): boolean {
  if (!transfer) return false
  return Array.from(transfer.types ?? []).includes(OS_FILE_DRAG_TYPE)
}

export interface DroppedEntries {
  files: File[]
  /** Names of dropped directories. The upload queue writes flat files only. */
  directories: string[]
}

/**
 * Split an OS drop into plain files and directories. `webkitGetAsEntry` is the
 * only reliable way to tell a folder from a zero-byte file; when it is missing
 * (older engines, synthetic events) we fall back to `DataTransfer.files`, which
 * never reports directories.
 */
export function partitionDroppedEntries(transfer: DataTransfer | null | undefined): DroppedEntries {
  if (!transfer) return { files: [], directories: [] }
  const items = Array.from(transfer.items ?? [])
  if (items.some((item) => typeof item.webkitGetAsEntry === "function")) {
    const files: File[] = []
    const directories: string[] = []
    for (const item of items) {
      if (item.kind !== "file") continue
      const entry = typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null
      if (entry?.isDirectory) {
        directories.push(entry.name)
        continue
      }
      const file = item.getAsFile()
      if (file) files.push(file)
    }
    return { files, directories }
  }
  return { files: Array.from(transfer.files ?? []), directories: [] }
}

export interface FileDropTargetOptions {
  enabled: boolean
  onDropEntries(entries: DroppedEntries): void
}

export interface FileDropTarget {
  /** True while an OS file drag hovers the target and uploads are allowed. */
  active: boolean
  handlers: {
    onDragEnter(event: React.DragEvent): void
    onDragOver(event: React.DragEvent): void
    onDragLeave(event: React.DragEvent): void
    onDrop(event: React.DragEvent): void
  }
}

export function useFileDropTarget({ enabled, onDropEntries }: FileDropTargetOptions): FileDropTarget {
  const [active, setActive] = useState(false)
  const depth = useRef(0)

  // A file dropped anywhere the page does not claim makes the browser navigate
  // away from the workspace and lose unsaved state. Swallow those defaults for
  // the whole window; drop targets that do want the file (chat attachments, the
  // tree below) still see the event first because this listener never stops
  // propagation.
  useEffect(() => {
    if (typeof window === "undefined") return
    const swallow = (event: DragEvent) => {
      if (isOsFileDrag(event.dataTransfer)) event.preventDefault()
    }
    window.addEventListener("dragover", swallow)
    window.addEventListener("drop", swallow)
    return () => {
      window.removeEventListener("dragover", swallow)
      window.removeEventListener("drop", swallow)
    }
  }, [])

  useEffect(() => {
    if (enabled) return
    depth.current = 0
    setActive(false)
  }, [enabled])

  const onDragEnter = useCallback((event: React.DragEvent) => {
    if (!enabled || !isOsFileDrag(event.dataTransfer)) return
    event.preventDefault()
    depth.current += 1
    setActive(true)
  }, [enabled])

  const onDragOver = useCallback((event: React.DragEvent) => {
    if (!isOsFileDrag(event.dataTransfer)) return
    // Always preventDefault: without it the browser navigates to the file even
    // when this root cannot accept uploads.
    event.preventDefault()
    event.dataTransfer.dropEffect = enabled ? "copy" : "none"
    if (enabled && !active) {
      depth.current = Math.max(depth.current, 1)
      setActive(true)
    }
  }, [active, enabled])

  const onDragLeave = useCallback((event: React.DragEvent) => {
    if (!isOsFileDrag(event.dataTransfer)) return
    depth.current -= 1
    if (depth.current <= 0) {
      depth.current = 0
      setActive(false)
    }
  }, [])

  const onDrop = useCallback((event: React.DragEvent) => {
    if (!isOsFileDrag(event.dataTransfer)) return
    event.preventDefault()
    depth.current = 0
    setActive(false)
    if (!enabled) return
    onDropEntries(partitionDroppedEntries(event.dataTransfer))
  }, [enabled, onDropEntries])

  const handlers = useMemo(
    () => ({ onDragEnter, onDragOver, onDragLeave, onDrop }),
    [onDragEnter, onDragOver, onDragLeave, onDrop],
  )
  return { active: enabled && active, handlers }
}
