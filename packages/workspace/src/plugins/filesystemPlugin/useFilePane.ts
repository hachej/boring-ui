"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useFileContent, useFileWrite } from "../../front/data"
import { FileConflictError } from "../../front/data/fetchClient"
import { useEditorLifecycle, type EditorLifecycleAdapter } from "../../front/hooks"

export interface UseFilePaneOptions {
  /** The file path to load/edit. If empty/undefined, pane shows "no file selected". */
  path: string
  /** Unique panel ID for lifecycle tracking (defaults to path). */
  panelId?: string
  /** Initial content (optional, for draft/unsaved files). */
  initialContent?: string
}

export interface UseFilePaneReturn {
  // Loading/error state
  isLoading: boolean
  error: Error | null

  // Content state
  content: string | null
  isDirty: boolean

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
  const { path, panelId = path, initialContent = null } = options

  const { data: fileData, isLoading, error, dataUpdatedAt } = useFileContent(path)
  const { mutateAsync: writeFile } = useFileWrite()

  // Local content state
  const [content, setContentState] = useState<string | null>(initialContent)
  const contentRef = useRef<string>("")
  const dirtyRef = useRef(false)
  const loadedPathRef = useRef<string | null>(null)
  const baselineMtimeRef = useRef<number | null>(null)

  // Conflict state
  const [conflict, setConflict] = useState<FileConflictError | null>(null)

  // TypeScript workaround: track content state for the return type
  // so we can reference it in the function body

  // Reset state when path changes
  useEffect(() => {
    if (loadedPathRef.current !== path) {
      setContentState(initialContent)
      contentRef.current = initialContent ?? ""
      dirtyRef.current = false
      baselineMtimeRef.current = null
      setConflict(null)
      loadedPathRef.current = path
    }
  }, [path, initialContent])

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
    path && content != null
      ? {
          isDirty: () => dirtyRef.current,
          save: async () => {
            try {
              const result = await writeFile({
                path,
                content: contentRef.current,
                expectedMtimeMs: baselineMtimeRef.current ?? undefined,
              })
              if (typeof result.mtimeMs === "number") {
                baselineMtimeRef.current = result.mtimeMs
              }
              dirtyRef.current = false
              setConflict(null)
            } catch (err) {
              if (err instanceof FileConflictError) {
                setConflict(err)
                throw err
              }
              throw err
            }
          },
          getContent: () => contentRef.current,
        }
      : null

  const lifecycle = useEditorLifecycle(path, {
    adapter,
    panelId,
    serverMtime: dataUpdatedAt || null,
  })

  // Handle external file changes (auto-sync when not dirty)
  useEffect(() => {
    if (lifecycle.shouldSync && fileData?.content != null) {
      setContentState(fileData.content)
      contentRef.current = fileData.content
      baselineMtimeRef.current = fileData.mtimeMs ?? null
      dirtyRef.current = false
      lifecycle.ackSync()
    }
  }, [lifecycle.shouldSync, fileData, setContentState, lifecycle])

  // Tab title with dirty indicator
  const fileName = path ? (path.split("/").pop() ?? path) : ""
  const [tabTitle, setTabTitle] = useState("")

  useEffect(() => {
    const title = fileName ? (lifecycle.isDirty ? `${fileName} ●` : fileName) : ""
    setTabTitle(title)
    if (title && panelId) {
      // We can't call api.setTitle here because we don't have access to it
      // The caller should handle this separately if needed
    }
  }, [fileName, lifecycle.isDirty, panelId])

  // Actions
  const setContent = useCallback((newContent: string) => {
    setContentState(newContent)
    contentRef.current = newContent
    dirtyRef.current = true
    lifecycle.markDirty()
  }, [setContentState, lifecycle])

  const onReloadFromServer = useCallback(async () => {
    if (!fileData) return
    setContentState(fileData.content)
    contentRef.current = fileData.content
    baselineMtimeRef.current = fileData.mtimeMs ?? null
    dirtyRef.current = false
    setConflict(null)
  }, [fileData, setContentState])

  const onOverwrite = useCallback(async () => {
    try {
      // Use content state (not ref) to ensure we have the latest content
      // in case the user typed after the conflict was detected
      const contentToSave = content ?? contentRef.current
      const result = await writeFile({ path, content: contentToSave })
      if (typeof result.mtimeMs === "number") {
        baselineMtimeRef.current = result.mtimeMs
      }
      dirtyRef.current = false
      setConflict(null)
    } catch {
      // Leave conflict UI up so user can retry
    }
  }, [path, writeFile, content])

  const save = useCallback(async () => {
    if (!adapter || !dirtyRef.current) return
    await adapter.save()
  }, [adapter])

  const flushSave = useCallback(async () => {
    await lifecycle.flushSave()
  }, [lifecycle])

  return {
    isLoading,
    error: error as Error | null,
    content,
    isDirty: lifecycle.isDirty,
    conflict,
    onReloadFromServer,
    onOverwrite,
    setContent,
    save,
    flushSave,
    fileName,
    tabTitle,
  }
}
