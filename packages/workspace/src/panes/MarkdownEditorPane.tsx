"use client"

import { lazy, Suspense, useCallback, useRef, useState, useEffect } from "react"
import { PanelChrome } from "../dock"
import { useFileContent, useFileWrite } from "../data"
import { useEditorLifecycle, type EditorLifecycleAdapter } from "../hooks"
import type { DockviewPanelApi } from "dockview-react"

const MarkdownEditor = lazy(() =>
  import("../components/MarkdownEditor").then((m) => ({ default: m.MarkdownEditor })),
)

export interface MarkdownEditorPaneProps {
  path: string
  panelApi?: DockviewPanelApi
  className?: string
}

export function MarkdownEditorPane({ path, panelApi, className }: MarkdownEditorPaneProps) {
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
    panelId: panelApi?.id ?? path,
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

  const fileName = path.split("/").pop() ?? path
  const title = lifecycle.isDirty ? `${fileName} ●` : fileName

  if (error) {
    return (
      <PanelChrome title={fileName} panelApi={panelApi}>
        <div className="flex h-full items-center justify-center text-destructive text-sm">
          Failed to load file: {error.message}
        </div>
      </PanelChrome>
    )
  }

  return (
    <PanelChrome title={title} panelApi={panelApi}>
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
    </PanelChrome>
  )
}
