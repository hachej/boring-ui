"use client"

import { lazy, Suspense, useCallback, useRef, useState, useEffect } from "react"
import { useFileContent, useFileWrite } from "../../front/data"
import { FileConflictError } from "../../front/data/fetchClient"
import { useEditorLifecycle, type EditorLifecycleAdapter } from "../../front/hooks"
import type { PaneProps } from "../../front/registry/types"

const MarkdownEditor = lazy(() =>
  import("./MarkdownEditor").then((m) => ({ default: m.MarkdownEditor })),
)

// `path` is optional: dockview can restore a panel from serialized
// layout where params got lost. Read defensively, render a placeholder
// rather than crash when path isn't there.
export type MarkdownEditorPaneProps = PaneProps<{ path?: string }>

export function MarkdownEditorPane({ params, api, className }: MarkdownEditorPaneProps) {
  const path = typeof params?.path === "string" ? params.path : ""
  const { data: fileData, isLoading, error, dataUpdatedAt } = useFileContent(path)
  const { mutateAsync: writeFile } = useFileWrite()

  const [localContent, setLocalContent] = useState<string | null>(null)
  const contentRef = useRef<string>("")
  const dirtyRef = useRef(false)
  const loadedPathRef = useRef<string | null>(null)
  // OCC baseline. Server returns mtimeMs on read; we send it back on
  // each write so a concurrent change → 409 instead of silent
  // last-write-wins. Updated to the post-write mtime on success.
  const baselineMtimeRef = useRef<number | null>(null)
  const [conflict, setConflict] = useState<FileConflictError | null>(null)

  useEffect(() => {
    if (loadedPathRef.current !== path) {
      setLocalContent(null)
      contentRef.current = ""
      dirtyRef.current = false
      baselineMtimeRef.current = null
      setConflict(null)
      loadedPathRef.current = path
    }
  }, [path])

  useEffect(() => {
    if (fileData?.content != null && localContent === null) {
      setLocalContent(fileData.content)
      contentRef.current = fileData.content
      baselineMtimeRef.current = fileData.mtimeMs ?? null
    }
  }, [fileData, localContent])

  const adapter: EditorLifecycleAdapter | null =
    path && localContent != null
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
                // Don't clear dirty: the user's edits are still
                // unsaved, the conflict banner offers Reload /
                // Overwrite.
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
    panelId: api?.id ?? path,
    serverMtime: dataUpdatedAt || null,
  })

  const handleReloadFromServer = useCallback(async () => {
    if (!fileData) return
    setLocalContent(fileData.content)
    contentRef.current = fileData.content
    baselineMtimeRef.current = fileData.mtimeMs ?? null
    dirtyRef.current = false
    setConflict(null)
  }, [fileData])

  const handleForceOverwrite = useCallback(async () => {
    try {
      const result = await writeFile({ path, content: contentRef.current })
      if (typeof result.mtimeMs === "number") {
        baselineMtimeRef.current = result.mtimeMs
      }
      dirtyRef.current = false
      setConflict(null)
    } catch {
      // If even the unconditional write fails, leave the conflict UI
      // up so the user can retry — no recovery flow needed beyond
      // letting them try again.
    }
  }, [path, writeFile])

  useEffect(() => {
    if (lifecycle.shouldSync && fileData?.content != null) {
      setLocalContent(fileData.content)
      contentRef.current = fileData.content
      // OCC baseline must follow the synced content — without this,
      // the next save would 409 against ITS OWN refetch.
      baselineMtimeRef.current = fileData.mtimeMs ?? null
      dirtyRef.current = false
      lifecycle.ackSync()
    }
  }, [lifecycle.shouldSync, fileData, lifecycle])

  const handleChange = useCallback(
    (newContent: string) => {
      setLocalContent(newContent)
      contentRef.current = newContent
      dirtyRef.current = true
      lifecycle.markDirty()
    },
    [lifecycle],
  )

  const fileName = path ? (path.split("/").pop() ?? path) : ""
  const tabTitle = fileName ? (lifecycle.isDirty ? `${fileName} ●` : fileName) : ""
  useEffect(() => {
    if (tabTitle) api?.setTitle?.(tabTitle)
  }, [api, tabTitle])

  if (!path) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        No file selected
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-destructive text-sm">
        Failed to load file: {error.message}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {conflict && (
        <ConflictBanner
          conflict={conflict}
          onReload={handleReloadFromServer}
          onOverwrite={handleForceOverwrite}
        />
      )}
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <span className="animate-pulse">Loading editor...</span>
          </div>
        }
      >
        {isLoading || localContent === null ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <span className="animate-pulse">Loading file...</span>
          </div>
        ) : (
          <MarkdownEditor
            content={localContent}
            onChange={handleChange}
            className={className}
          />
        )}
      </Suspense>
    </div>
  )
}

interface ConflictBannerProps {
  conflict: FileConflictError
  onReload: () => void | Promise<void>
  onOverwrite: () => void | Promise<void>
}

function ConflictBanner({ conflict, onReload, onOverwrite }: ConflictBannerProps) {
  return (
    <div
      role="alert"
      className="flex items-center gap-3 border-b border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-200"
    >
      <span className="flex-1">
        This file has been modified outside the editor. Your unsaved changes
        will be lost if you reload, or will overwrite the latest version on
        disk if you save.
      </span>
      <button
        type="button"
        onClick={() => void onReload()}
        className="rounded-sm border border-amber-500/50 bg-amber-500/20 px-2 py-0.5 text-xs hover:bg-amber-500/30"
      >
        Reload
      </button>
      <button
        type="button"
        onClick={() => void onOverwrite()}
        className="rounded-sm border border-destructive/50 bg-destructive/15 px-2 py-0.5 text-xs text-destructive hover:bg-destructive/25"
      >
        Overwrite
      </button>
      {/* The path is in the error for logging — show it on hover so the
          banner stays compact in narrow panes. */}
      <span className="sr-only">{conflict.path}</span>
    </div>
  )
}
