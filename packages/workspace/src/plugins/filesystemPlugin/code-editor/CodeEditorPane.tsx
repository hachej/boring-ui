"use client"

import { lazy, Suspense, useCallback, useRef, useState, useEffect } from "react"
import { useFileContent, useFileWrite } from "../../../front/data"
import { FileConflictError } from "../../../front/data/fetchClient"
import { useEditorLifecycle, type EditorLifecycleAdapter } from "../../../front/hooks"
import type { PaneProps } from "../../../front/registry/types"

const CodeEditor = lazy(() =>
  import("./CodeEditor").then((m) => ({ default: m.CodeEditor })),
)

function extToLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase()
  switch (ext) {
    case "js":
    case "jsx":
      return "javascript"
    case "ts":
    case "tsx":
      return "typescript"
    case "py":
      return "python"
    case "json":
      return "json"
    case "yaml":
    case "yml":
      return "yaml"
    case "md":
    case "markdown":
      return "markdown"
    case "sql":
      return "sql"
    default:
      return "typescript"
  }
}

export type CodeEditorPaneProps = PaneProps<{ path?: string }>

export function CodeEditorPane({ params, api, className }: CodeEditorPaneProps) {
  const path = typeof params?.path === "string" ? params.path : ""
  const { data: fileData, isLoading, error, dataUpdatedAt } = useFileContent(path)
  const { mutateAsync: writeFile } = useFileWrite()

  const [localContent, setLocalContent] = useState<string | null>(null)
  const contentRef = useRef<string>("")
  const dirtyRef = useRef(false)
  const loadedPathRef = useRef<string | null>(null)
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
      // Leave the conflict UI up so the user can retry.
    }
  }, [path, writeFile])

  useEffect(() => {
    if (lifecycle.shouldSync && fileData?.content != null) {
      setLocalContent(fileData.content)
      contentRef.current = fileData.content
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

  const language = extToLanguage(path)

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
          <CodeEditor
            content={localContent}
            onChange={handleChange}
            language={language}
            wordWrap
            className={className}
          />
        )}
      </Suspense>
    </div>
  )
}

function ConflictBanner({
  conflict,
  onReload,
  onOverwrite,
}: {
  conflict: FileConflictError
  onReload: () => void | Promise<void>
  onOverwrite: () => void | Promise<void>
}) {
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
      <span className="sr-only">{conflict.path}</span>
    </div>
  )
}
