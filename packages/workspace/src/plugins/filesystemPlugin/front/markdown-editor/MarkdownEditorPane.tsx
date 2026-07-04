"use client"

import { lazy } from "react"
import type { PaneProps } from "../../../../front/registry/types"
import { useFilePane } from "../useFilePane"
import { FilePaneShell } from "../FilePaneShell"

const MarkdownEditor = lazy(() =>
  import("./MarkdownEditor").then((m) => ({ default: m.MarkdownEditor })),
)

// `path` is optional: dockview can restore a panel from serialized
// layout where params got lost. Read defensively, render a placeholder
// rather than crash when path isn't there.
export type MarkdownEditorPaneProps = PaneProps<{ path?: string; mode?: "view" | "edit" | "diff" }>

export function MarkdownEditorPane({ params, api, className }: MarkdownEditorPaneProps) {
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
<<<<<<< Updated upstream
    isReadonly,
  } = useFilePane({ filesystem, path, panelId: api?.id })
=======
  } = useFilePane({ path, panelId: api?.id })
>>>>>>> Stashed changes

  // Update panel title with dirty/readonly indicator
  if (api && tabTitle) {
    api.setTitle(isReadonly ? `${tabTitle} (readonly)` : tabTitle)
  }

  return (
    <FilePaneShell
      path={path}
      content={content}
      isLoading={isLoading}
      error={error}
      conflict={conflict}
      readOnly={readOnly || isReadonly}
      onChange={setContent}
      onReload={onReloadFromServer}
      onOverwrite={onOverwrite}
      editorComponent={MarkdownEditor}
      editorProps={{ className, documentPath: path, readOnly: readOnly || isReadonly, filesystem }}
    />
  )
}
