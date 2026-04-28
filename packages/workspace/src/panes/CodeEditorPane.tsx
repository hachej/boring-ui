"use client"

import { lazy, Suspense, useCallback, useRef, useState, useEffect } from "react"
import { PanelChrome } from "../dock"
import { useFileContent, useFileWrite } from "../data"
import { useEditorLifecycle, type EditorLifecycleAdapter } from "../hooks"
import type { DockviewPanelApi } from "dockview-react"

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

export interface CodeEditorPaneProps {
  path: string
  panelApi?: DockviewPanelApi
  chromeless?: boolean
  className?: string
}

export function CodeEditorPane({ path, panelApi, chromeless, className }: CodeEditorPaneProps) {
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
  const language = extToLanguage(path)
  const title = lifecycle.isDirty ? `${fileName} ●` : fileName

  if (error) {
    const body = (
      <div className="flex h-full items-center justify-center text-destructive text-sm">
        Failed to load file: {error.message}
      </div>
    )
    return chromeless ? body : <PanelChrome title={fileName} panelApi={panelApi}>{body}</PanelChrome>
  }

  const editor = (
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
  )

  if (chromeless) return <div className="flex h-full min-h-0 flex-col">{editor}</div>

  return (
    <PanelChrome title={title} panelApi={panelApi}>
      {editor}
    </PanelChrome>
  )
}
