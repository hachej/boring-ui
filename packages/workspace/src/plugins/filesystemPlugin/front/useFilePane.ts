"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { normalizeUiFilesystem, uiFileResourceKey, type FilesystemId } from "../../../shared/types/filesystem"
import { events } from "../../../front/events"
import { filesystemEvents } from "../shared/events"
import { useFileContent, useFileEventStatus, useFileWrite } from "./data"
import { FileConflictError } from "./data/fetchClient"
import { useEditorLifecycle, type EditorLifecycleAdapter } from "../../../front/hooks"

let nextFallbackPanelId = 0

const DOCUMENT_STATUS_CLEAR_MS = 4_000
const AGENT_ATTRIBUTION_TTL_MS = 5_000

export interface UseFilePaneOptions {
  /** The file path to load/edit. If empty/undefined, pane shows "no file selected". */
  path: string
  /** Filesystem identity for cache/dirty/stale separation. Defaults to user. */
  filesystem?: FilesystemId
  /** Unique panel ID for lifecycle tracking. Omit to use a stable per-pane fallback ID. */
  panelId?: string
  /** Initial content (optional, for draft/unsaved files). */
  initialContent?: string
  /** When supplied, auto-create the file with this content if it does not exist. */
  createIfMissing?: string
}

export type FilePaneDocumentStatus =
  | { kind: "fallback" }
  | { kind: "checking" }
  | { kind: "updated"; source: "agent" | "disk" }
  | { kind: "conflict"; source: "agent" | "disk" }
  | { kind: "resolved"; action: "reloaded" | "overwritten" }

export interface UseFilePaneReturn {
  // Loading/error state
  isLoading: boolean
  error: Error | null

  // Content state
  content: string | null
  isDirty: boolean
  isReadonly: boolean

  // Conflict handling
  conflict: FileConflictError | null
  documentStatus: FilePaneDocumentStatus | null
  onReloadFromServer: () => Promise<void>
  onOverwrite: () => Promise<void>

  // Actions
  setContent: (content: string) => void
  save: () => Promise<void>
  flushSave: () => Promise<void>

  // Metadata
  fileName: string
  tabTitle: string
}

/**
 * Shared hook for file-based panes (code editor, markdown editor, etc.).
 *
 * Handles:
 * - File loading via React Query
 * - Local content state with dirty tracking
 * - Optimistic concurrency control (OCC) via mtime
 * - External file change detection
 * - Conflict resolution (reload vs overwrite)
 * - Panel title updates with dirty indicator
 *
 * @example
 * ```typescript
 * function MyEditorPane({ params, api }) {
 *   const { content, setContent, isLoading, error, conflict, ... } = useFilePane({
 *     path: params.path,
 *     panelId: api.id,
 *   })
 *
 *   if (!params.path) return <NoFileSelected />
 *   if (error) return <ErrorBanner error={error} />
 *
 *   return (
 *     <>
 *       {conflict && <ConflictBanner onReload={onReloadFromServer} onOverwrite={onOverwrite} />}
 *       <MyEditor content={content} onChange={setContent} />
 *     </>
 *   )
 * }
 * ```
 */
export function useFilePane(options: UseFilePaneOptions): UseFilePaneReturn {
  const { path, panelId, initialContent = null, createIfMissing } = options
  const filesystem = normalizeUiFilesystem(options.filesystem)
  const activePath = /\S/.test(path) ? path : null
  const activeResourceKey = activePath ? uiFileResourceKey({ filesystem, path: activePath }) : null
  const fallbackPanelIdRef = useRef(panelId ?? `file-pane:${nextFallbackPanelId++}`)
  const lifecyclePanelId = panelId ?? fallbackPanelIdRef.current

  // Readonly/readwrite is a trusted server binding property returned by the file
  // route. Do not infer access from filesystem ids; arbitrary named filesystems
  // may be readonly or readwrite.
  const fileContentOptions = createIfMissing === undefined ? { filesystem } : { filesystem, createIfMissing }
  const {
    data: fileData,
    isLoading,
    isFetching,
    error,
    refetch: refetchFileData,
  } = useFileContent(activePath, fileContentOptions)
  const fileEventStatus = useFileEventStatus()
  const isReadonly = fileData?.access === "readonly"
  const { mutateAsync: writeFile } = useFileWrite()

  // Local content state
  const [content, setContentState] = useState<string | null>(initialContent)
  const contentRef = useRef<string>("")
  const dirtyRef = useRef(false)
  const loadedPathRef = useRef<string | null>(null)
  const loadedResourceKeyRef = useRef<string | null>(null)
  const baselineMtimeRef = useRef<number | null>(null)
  // Content, not mtime, is the document identity. Some providers omit mtimes
  // or expose only second precision, so changed bytes can share one mtime.
  const diskContentRef = useRef<string | null>(null)
  const markLifecycleDirtyRef = useRef<(() => void) | null>(null)
  // Monotonic save token. Each adapter.save() call bumps this and captures
  // its own gen; before mutating shared refs (baseline, dirty, conflict) it
  // re-checks the current value. If a watchdog in useEditorLifecycle has
  // abandoned the call and a newer save has already started, the late
  // resolver finds saveGenRef has moved on and skips its mutations —
  // otherwise it would clobber baselineMtimeRef with a stale mtime and
  // mark a still-dirty buffer as clean.
  const saveGenRef = useRef(0)

  // Conflict + external-update state. Refs make autosave gating synchronous:
  // once a conflict is observed, continued typing cannot race a render and
  // schedule an implicit overwrite.
  const [conflict, setConflict] = useState<FileConflictError | null>(null)
  const [conflictSource, setConflictSource] = useState<"agent" | "disk">("disk")
  const conflictRef = useRef<FileConflictError | null>(null)
  const [transientDocumentStatus, setTransientDocumentStatus] = useState<FilePaneDocumentStatus | null>(null)
  const statusClearTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pendingExternalSourceRef = useRef<{ source: "agent" | "disk"; expiresAt: number } | null>(null)

  const showTransientDocumentStatus = useCallback((status: FilePaneDocumentStatus) => {
    clearTimeout(statusClearTimerRef.current)
    setTransientDocumentStatus(status)
    statusClearTimerRef.current = setTimeout(() => setTransientDocumentStatus(null), DOCUMENT_STATUS_CLEAR_MS)
  }, [])

  const consumeExternalSource = useCallback((): "agent" | "disk" => {
    const pending = pendingExternalSourceRef.current
    pendingExternalSourceRef.current = null
    return pending && pending.expiresAt >= Date.now() ? pending.source : "disk"
  }, [])

  // TypeScript workaround: track content state for the return type
  // so we can reference it in the function body

  // Reset state when path changes
  useEffect(() => {
    if (loadedPathRef.current !== path || loadedResourceKeyRef.current !== activeResourceKey) {
      setContentState(initialContent)
      contentRef.current = initialContent ?? ""
      dirtyRef.current = false
      baselineMtimeRef.current = null
      diskContentRef.current = null
      saveGenRef.current += 1
      conflictRef.current = null
      pendingExternalSourceRef.current = null
      setConflict(null)
      setConflictSource("disk")
      setTransientDocumentStatus(null)
      loadedPathRef.current = path
      loadedResourceKeyRef.current = activeResourceKey
    }
  }, [path, activeResourceKey, initialContent])

  // Load file content on mount or when file data changes
  useEffect(() => {
    if (fileData?.content != null && content === null) {
      setContentState(fileData.content)
      contentRef.current = fileData.content
      diskContentRef.current = fileData.content
      baselineMtimeRef.current = fileData.mtimeMs ?? null
    }
  }, [fileData, content])

  // Editor lifecycle adapter
  const adapter: EditorLifecycleAdapter | null =
    activePath && content != null && !isReadonly
      ? {
          isDirty: () => dirtyRef.current && conflictRef.current === null,
          save: async () => {
            // Capture our generation so a watchdog-abandoned-then-resumed
            // sequence doesn't let the late writeFile mutate state that a
            // newer save has already updated.
            const myGen = ++saveGenRef.current
            const contentToSave = contentRef.current
            try {
              const result = await writeFile({
                filesystem,
                path: activePath,
                content: contentToSave,
                expectedMtimeMs: baselineMtimeRef.current ?? undefined,
              })
              // Stale resolver: a newer save started after a watchdog timeout
              // gave up on us. Don't touch shared state — the newer save is
              // the source of truth.
              if (saveGenRef.current !== myGen) return
              if (typeof result.mtimeMs === "number") {
                baselineMtimeRef.current = result.mtimeMs
              }
              diskContentRef.current = contentToSave
              // Do not mark keystrokes typed during the request as persisted.
              // Schedule a follow-up save after the current in-flight promise
              // clears; throwing keeps useEditorLifecycle's dirty state true.
              dirtyRef.current = contentRef.current !== contentToSave
              conflictRef.current = null
              setConflict(null)
              if (dirtyRef.current) {
                markLifecycleDirtyRef.current?.()
                throw new Error("new editor changes remain after save")
              }
            } catch (err) {
              // Late-resolved errors get the same guard — a stale FileConflictError
              // (about a baseline two saves ago) should not raise the banner.
              if (saveGenRef.current !== myGen) throw err
              if (err instanceof FileConflictError) {
                // Freeze autosave until the user explicitly chooses Reload or
                // Overwrite. Advancing the baseline here used to make the next
                // keystroke silently overwrite the external version.
                const source = consumeExternalSource()
                conflictRef.current = err
                setConflict(err)
                setConflictSource(source)
                throw err
              }
              throw err
            }
          },
          getContent: () => contentRef.current,
        }
      : null

  const lifecycle = useEditorLifecycle(activeResourceKey, {
    adapter,
    panelId: lifecyclePanelId,
  })
  markLifecycleDirtyRef.current = lifecycle.markDirty

  // Preserve high-confidence Agent attribution just long enough to correlate
  // the bus invalidation with the resulting file query. A later chokidar echo
  // is remote and must not downgrade a still-live Agent marker.
  useEffect(() => {
    if (!activePath) return
    return events.on(filesystemEvents.changed, (event) => {
      if (event.path !== activePath) return
      if (normalizeUiFilesystem(event.filesystem) !== filesystem) return
      const current = pendingExternalSourceRef.current
      if (event.cause === "agent") {
        pendingExternalSourceRef.current = {
          source: "agent",
          expiresAt: Date.now() + AGENT_ATTRIBUTION_TTL_MS,
        }
      } else if (
        event.cause === "remote" &&
        (!current || current.source !== "agent" || current.expiresAt < Date.now())
      ) {
        pendingExternalSourceRef.current = {
          source: "disk",
          expiresAt: Date.now() + AGENT_ATTRIBUTION_TTL_MS,
        }
      }
    })
  }, [activePath, filesystem])

  // Reconcile by confirmed disk content, not mtime. This handles providers
  // with missing or second-resolution mtimes and removes the old 3-second
  // window that could suppress a genuine Agent write as an editor-save echo.
  useEffect(() => {
    if (fileData?.content == null || content === null) return
    if (diskContentRef.current === null) {
      diskContentRef.current = fileData.content
      baselineMtimeRef.current = fileData.mtimeMs ?? null
      return
    }
    if (fileData.content === diskContentRef.current) return

    const source = consumeExternalSource()
    diskContentRef.current = fileData.content
    if (dirtyRef.current && !isReadonly) {
      const nextConflict = new FileConflictError(
        activePath ?? path,
        fileData.mtimeMs ?? null,
        baselineMtimeRef.current,
      )
      conflictRef.current = nextConflict
      setConflict(nextConflict)
      setConflictSource(source)
      return
    }

    setContentState(fileData.content)
    contentRef.current = fileData.content
    baselineMtimeRef.current = fileData.mtimeMs ?? null
    dirtyRef.current = false
    conflictRef.current = null
    setConflict(null)
    showTransientDocumentStatus({ kind: "updated", source })
  }, [activePath, consumeExternalSource, content, fileData, isReadonly, path, showTransientDocumentStatus])

  // Tab title with dirty indicator
  const fileName = activePath ? (activePath.split("/").pop() ?? activePath) : ""
  const [tabTitle, setTabTitle] = useState("")

  useEffect(() => {
    const title = fileName ? (!isReadonly && lifecycle.isDirty ? `${fileName} ●` : fileName) : ""
    setTabTitle(title)
  }, [fileName, isReadonly, lifecycle.isDirty])

  // Actions
  const setContent = useCallback((newContent: string) => {
    if (isReadonly) return
    setContentState(newContent)
    contentRef.current = newContent
    dirtyRef.current = true
    lifecycle.markDirty()
  }, [isReadonly, setContentState, lifecycle])

  const onReloadFromServer = useCallback(async () => {
    if (!activePath) return

    const refreshed = await refetchFileData()
    if (refreshed.status !== "success" || refreshed.data == null) return

    const next = refreshed.data
    setContentState(next.content)
    contentRef.current = next.content
    diskContentRef.current = next.content
    baselineMtimeRef.current = next.mtimeMs ?? null
    dirtyRef.current = false
    conflictRef.current = null
    pendingExternalSourceRef.current = null
    lifecycle.markClean()
    setConflict(null)
    showTransientDocumentStatus({ kind: "resolved", action: "reloaded" })
  }, [activePath, lifecycle, refetchFileData, setContentState, showTransientDocumentStatus])

  const onOverwrite = useCallback(async () => {
    if (isReadonly) return
    // Bump the save generation so any pending autosave (e.g., one that the
    // watchdog already abandoned) cannot later resolve and undo our state
    // mutations below.
    const myGen = ++saveGenRef.current
    try {
      // Use contentRef.current — it is updated SYNCHRONOUSLY by setContent
      // (see line above) so it always carries the latest keystrokes the
      // user typed, including any keystrokes between conflict detection
      // and clicking Overwrite. The React `content` state is one render
      // behind during fast typing, so reading it first would save stale
      // content. (Earlier comment claimed the opposite — it was wrong.)
      if (!activePath) return
      const contentToSave = contentRef.current
      const result = await writeFile({ filesystem, path: activePath, content: contentToSave })
      if (saveGenRef.current !== myGen) return
      if (typeof result.mtimeMs === "number") {
        baselineMtimeRef.current = result.mtimeMs
      }
      diskContentRef.current = contentToSave
      dirtyRef.current = false
      conflictRef.current = null
      pendingExternalSourceRef.current = null
      lifecycle.markClean()
      setConflict(null)
      showTransientDocumentStatus({ kind: "resolved", action: "overwritten" })
    } catch {
      // Leave conflict UI up so user can retry
    }
  }, [activePath, filesystem, isReadonly, lifecycle, showTransientDocumentStatus, writeFile])

  const save = useCallback(async () => {
    if (isReadonly || !adapter || !dirtyRef.current) return
    await adapter.save()
  }, [adapter, isReadonly])

  const flushSave = useCallback(async () => {
    if (isReadonly) return
    await lifecycle.flushSave()
  }, [isReadonly, lifecycle])

  useEffect(() => () => clearTimeout(statusClearTimerRef.current), [])

  const documentStatus = useMemo<FilePaneDocumentStatus | null>(() => {
    if (!isReadonly && conflict) return { kind: "conflict", source: conflictSource }
    if (content !== null && isFetching) return { kind: "checking" }
    if (transientDocumentStatus) return transientDocumentStatus
    if (fileEventStatus === "unsupported") return { kind: "fallback" }
    return null
  }, [conflict, conflictSource, content, fileEventStatus, isFetching, isReadonly, transientDocumentStatus])

  return {
    isLoading,
    error: error as Error | null,
    content,
    isDirty: isReadonly ? false : lifecycle.isDirty,
    isReadonly,
    conflict: isReadonly ? null : conflict,
    documentStatus,
    onReloadFromServer,
    onOverwrite,
    setContent,
    save,
    flushSave,
    fileName,
    tabTitle,
  }
}
