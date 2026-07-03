"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { normalizeUiFilesystem, uiFileResourceKey, type FilesystemId } from "../../../shared/types/filesystem"
import { useFileContent, useFileWrite } from "./data"
import { FileConflictError } from "./data/fetchClient"
import { useEditorLifecycle, type EditorLifecycleAdapter } from "../../../front/hooks"

let nextFallbackPanelId = 0

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
  const { data: fileData, isLoading, error, refetch: refetchFileData } = useFileContent(activePath, fileContentOptions)
  const isReadonly = fileData?.access === "readonly"
  const { mutateAsync: writeFile } = useFileWrite()

  // Local content state
  const [content, setContentState] = useState<string | null>(initialContent)
  const contentRef = useRef<string>("")
  const dirtyRef = useRef(false)
  const loadedPathRef = useRef<string | null>(null)
  const loadedResourceKeyRef = useRef<string | null>(null)
  const baselineMtimeRef = useRef<number | null>(null)
  // Ref so the save callback (defined before lifecycle) can call lifecycle.notifySaved.
  const notifySavedRef = useRef<((mtime: number) => void) | null>(null)
  // Monotonic save token. Each adapter.save() call bumps this and captures
  // its own gen; before mutating shared refs (baseline, dirty, conflict) it
  // re-checks the current value. If a watchdog in useEditorLifecycle has
  // abandoned the call and a newer save has already started, the late
  // resolver finds saveGenRef has moved on and skips its mutations —
  // otherwise it would clobber baselineMtimeRef with a stale mtime and
  // mark a still-dirty buffer as clean.
  const saveGenRef = useRef(0)

  // Conflict state
  const [conflict, setConflict] = useState<FileConflictError | null>(null)

  // TypeScript workaround: track content state for the return type
  // so we can reference it in the function body

  // Reset state when path changes
  useEffect(() => {
    if (loadedPathRef.current !== path || loadedResourceKeyRef.current !== activeResourceKey) {
      setContentState(initialContent)
      contentRef.current = initialContent ?? ""
      dirtyRef.current = false
      baselineMtimeRef.current = null
      saveGenRef.current += 1
      setConflict(null)
      loadedPathRef.current = path
      loadedResourceKeyRef.current = activeResourceKey
    }
  }, [path, activeResourceKey, initialContent])

  // Load file content on mount or when file data changes
  useEffect(() => {
    if (fileData?.content != null && content === null) {
      setContentState(fileData.content)
      contentRef.current = fileData.content
      baselineMtimeRef.current = fileData.mtimeMs ?? null
    }
  }, [fileData, content])

  // Editor lifecycle adapter
  const adapter: EditorLifecycleAdapter | null =
    activePath && content != null && !isReadonly
      ? {
          isDirty: () => dirtyRef.current,
          save: async () => {
            // Capture our generation so a watchdog-abandoned-then-resumed
            // sequence doesn't let the late writeFile mutate state that a
            // newer save has already updated.
            const myGen = ++saveGenRef.current
            try {
              const result = await writeFile({
                filesystem,
                path: activePath,
                content: contentRef.current,
                expectedMtimeMs: baselineMtimeRef.current ?? undefined,
              })
              // Stale resolver: a newer save started after a watchdog timeout
              // gave up on us. Don't touch shared state — the newer save is
              // the source of truth.
              if (saveGenRef.current !== myGen) return
              if (typeof result.mtimeMs === "number") {
                baselineMtimeRef.current = result.mtimeMs
                notifySavedRef.current?.(result.mtimeMs)
              }
              dirtyRef.current = false
              setConflict(null)
            } catch (err) {
              // Late-resolved errors get the same guard — a stale FileConflictError
              // (about a baseline two saves ago) should not raise the banner.
              if (saveGenRef.current !== myGen) throw err
              if (err instanceof FileConflictError) {
                // Show the banner so the user knows the file changed
                // externally, but also bump the baseline to the server's
                // current mtime. Without this, every subsequent autosave
                // fails OCC against the same stale baseline and the
                // user's continued typing never persists until they
                // explicitly Overwrite. With the bump, the next autosave
                // (triggered by the next keystroke) force-overwrites the
                // external change — treating continued typing as
                // implicit consent that "my edits win".
                if (typeof err.currentMtimeMs === "number") {
                  baselineMtimeRef.current = err.currentMtimeMs
                }
                setConflict(err)
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
    serverMtime: fileData?.mtimeMs ?? null,
  })
  // Keep the ref in sync so the save callback can call notifySaved without
  // creating a circular dependency at definition time.
  notifySavedRef.current = lifecycle.notifySaved

  // Auto-sync when an external change is detected and the editor is clean.
  // Guard with dirtyRef (synchronous) rather than lifecycle.isDirty (React
  // state) to avoid overwriting keystrokes that arrived since detection.
  useEffect(() => {
    if (!lifecycle.shouldSync || fileData?.content == null) return
    if (dirtyRef.current) {
      // User became dirty between detection and this render; don't clobber
      // their edits — the next save will hit 409 and handle it properly.
      lifecycle.ackSync()
      return
    }
    setContentState(fileData.content)
    contentRef.current = fileData.content
    baselineMtimeRef.current = fileData.mtimeMs ?? null
    dirtyRef.current = false
    lifecycle.ackSync()
  }, [lifecycle.shouldSync, lifecycle, fileData, setContentState])

  // Show the conflict banner immediately when the file is modified externally
  // while the editor has unsaved changes, instead of waiting for the next
  // save to fail with a 409. Bump the baseline at the same time so the
  // next autosave force-overwrites the external change — matching the
  // 409-recovery path in adapter.save above (continued typing wins).
  useEffect(() => {
    if (isReadonly || !lifecycle.externalChangeWhileDirty || fileData?.mtimeMs == null) return
    setConflict(new FileConflictError(activePath ?? path, fileData.mtimeMs, baselineMtimeRef.current))
    baselineMtimeRef.current = fileData.mtimeMs
    lifecycle.ackExternalChange()
  }, [activePath, isReadonly, lifecycle.externalChangeWhileDirty, lifecycle, fileData, path])

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
    baselineMtimeRef.current = next.mtimeMs ?? null
    dirtyRef.current = false
    lifecycle.markClean()
    // Sync the lifecycle's lastKnownMtimeRef + clear externalChangeWhileDirty
    // so a follow-up SSE for the same mtime doesn't re-raise the conflict.
    if (typeof next.mtimeMs === "number") {
      notifySavedRef.current?.(next.mtimeMs)
    }
    setConflict(null)
  }, [activePath, lifecycle, refetchFileData, setContentState])

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
        // notifySaved updates the lifecycle's lastKnownMtimeRef AND clears
        // externalChangeWhileDirty. Without it, the SSE echo of our own
        // overwrite (carrying the new mtime) reads as another external
        // change against the still-stale lastKnownMtimeRef, and the
        // banner immediately reappears.
        notifySavedRef.current?.(result.mtimeMs)
      }
      dirtyRef.current = false
      setConflict(null)
    } catch {
      // Leave conflict UI up so user can retry
    }
  }, [activePath, filesystem, isReadonly, writeFile])

  const save = useCallback(async () => {
    if (isReadonly || !adapter || !dirtyRef.current) return
    await adapter.save()
  }, [adapter, isReadonly])

  const flushSave = useCallback(async () => {
    if (isReadonly) return
    await lifecycle.flushSave()
  }, [isReadonly, lifecycle])

  return {
    isLoading,
    error: error as Error | null,
    content,
    isDirty: isReadonly ? false : lifecycle.isDirty,
    isReadonly,
    conflict: isReadonly ? null : conflict,
    onReloadFromServer,
    onOverwrite,
    setContent,
    save,
    flushSave,
    fileName,
    tabTitle,
  }
}
