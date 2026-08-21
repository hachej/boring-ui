"use client"

import { lazy } from "react"
import { normalizeUiFilesystem, type FilesystemId, type UiFileOpenMode } from "../../../../shared/types/filesystem"
import type { PaneProps } from "../../../../front/registry/types"
import { useFilePane } from "../useFilePane"
import { FilePaneShell } from "../FilePaneShell"

const MarkdownEditor = lazy(() =>
  import("./MarkdownEditor").then((m) => ({ default: m.MarkdownEditor })),
)

// `path` is optional: dockview can restore a panel from serialized
// layout where params got lost. Read defensively, render a placeholder
// rather than crash when path isn't there.
export type MarkdownEditorPaneProps = PaneProps<{ path?: string; filesystem?: FilesystemId; mode?: UiFileOpenMode }>

export function MarkdownEditorPane({ params, api, className }: MarkdownEditorPaneProps) {
  const path = typeof params?.path === "string" ? params.path : ""
  const filesystem = normalizeUiFilesystem(params?.filesystem)
  const readOnly = params?.mode === "view"

  const {
    content,
    isLoading,
    error,
    conflict,
    documentStatus,
    setContent,
    onReloadFromServer,
    onOverwrite,
    tabTitle,
    isReadonly,
  } = useFilePane({ filesystem, path, panelId: api?.id })

  // Update panel title with dirty/readonly indicator
  if (api && tabTitle) {
    api.setTitle(isReadonly ? `${tabTitle} (readonly)` : tabTitle)
  }

  return (
    <FilePaneShell
      path={path}
      filesystem={filesystem}
      content={content}
      isLoading={isLoading}
      error={error}
      conflict={conflict}
      readOnly={readOnly || isReadonly}
      onChange={setContent}
      onReload={onReloadFromServer}
      onOverwrite={onOverwrite}
      editorComponent={MarkdownEditor}
      editorProps={{ className, documentPath: path, readOnly: readOnly || isReadonly, filesystem, documentStatus }}
    />
  )
}
