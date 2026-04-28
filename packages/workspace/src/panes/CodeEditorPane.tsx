"use client"

import { lazy, Suspense, useCallback, useRef, useState, useEffect } from "react"
import { useFileContent, useFileWrite } from "../data"
import { useEditorLifecycle, type EditorLifecycleAdapter } from "../hooks"
import type { PaneProps } from "../registry/types"

const CodeEditor = lazy(() =>
  import("../components/CodeEditor").then((m) => ({ default: m.CodeEditor })),
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

// `path` is optional at the type level because dockview can restore a
// panel from a serialized layout where params got lost (or never set —
// e.g. a stale layout from a previous version). Read defensively and
// render a placeholder rather than crashing.
export type CodeEditorPaneProps = PaneProps<{ path?: string }>

export function CodeEditorPane({ params, api, className }: CodeEditorPaneProps) {
  const path = typeof params?.path === "string" ? params.path : ""
  const { data: fileData, isLoading, error, dataUpdatedAt } = useFileContent(path)
  const { mutateAsync: writeFile } = useFileWrite()

  const [localContent, setLocalContent] = useState<string | null>(null)
  const contentRef = useRef<string>("")
  const dirtyRef = useRef(false)
  const loadedPathRef = useRef<string | null>(null)

  useEffect(() => {
    if (loadedPathRef.current !== path) {
      setLocalContent(null)
      contentRef.current = ""
      dirtyRef.current = false
      loadedPathRef.current = path
    }
  }, [path])

  useEffect(() => {
    if (fileData?.content != null && localContent === null) {
      setLocalContent(fileData.content)
      contentRef.current = fileData.content
    }
  }, [fileData, localContent])

  const adapter: EditorLifecycleAdapter | null =
    path && localContent != null
      ? {
          isDirty: () => dirtyRef.current,
          save: async () => {
            await writeFile({ path, content: contentRef.current })
            dirtyRef.current = false
          },
          getContent: () => contentRef.current,
        }
      : null
  const lifecycle = useEditorLifecycle(path, {
    adapter,
    panelId: api?.id ?? path,
    serverMtime: dataUpdatedAt || null,
  })

  useEffect(() => {
    if (lifecycle.shouldSync && fileData?.content != null) {
      setLocalContent(fileData.content)
      contentRef.current = fileData.content
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

  // Reflect dirty state into the dockview tab title so users see "●"
  // on the tab they're editing without us drawing our own header bar.
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
