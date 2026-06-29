"use client"

import type { PaneProps } from "../../../../front/registry/types"
import { useFilePane } from "../useFilePane"
import { FilePaneShell } from "../FilePaneShell"
import { CodeEditor } from "./CodeEditor"

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

export type CodeEditorPaneProps = PaneProps<{ path?: string; mode?: "view" | "edit" | "diff" }>

export function CodeEditorPane({ params, api, className }: CodeEditorPaneProps) {
  const path = typeof params?.path === "string" ? params.path : ""
  const readOnly = params?.mode === "view"

  const {
    content,
    isLoading,
    error,
    conflict,
    setContent,
    onReloadFromServer,
    onOverwrite,
    tabTitle,
  } = useFilePane({ path, panelId: api?.id })

  // Update panel title with dirty indicator
  if (api && tabTitle) {
    api.setTitle(tabTitle)
  }

  const language = extToLanguage(path)

  return (
    <FilePaneShell
      path={path}
      content={content}
      isLoading={isLoading}
      error={error}
      conflict={conflict}
      onChange={setContent}
      onReload={onReloadFromServer}
      onOverwrite={onOverwrite}
      editorComponent={CodeEditor}
      editorProps={{ language, wordWrap: true, className, readOnly }}
    />
  )
}
