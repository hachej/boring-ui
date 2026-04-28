"use client"

import { lazy, Suspense, useCallback, useRef, useState, useEffect } from "react"
import { useFileContent, useFileWrite } from "../data"
import { useEditorLifecycle, type EditorLifecycleAdapter } from "../hooks"
import type { PaneProps } from "../registry/types"

const MarkdownEditor = lazy(() =>
  import("../components/MarkdownEditor").then((m) => ({ default: m.MarkdownEditor })),
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
