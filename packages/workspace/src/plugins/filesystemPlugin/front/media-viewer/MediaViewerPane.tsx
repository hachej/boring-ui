"use client"

import { normalizeUiFilesystem, type FilesystemId } from "../../../../shared/types/filesystem"
import type { PaneProps } from "../../../../shared/types/panel"
import { MediaViewer } from "./MediaViewer"
import { useMediaViewerReload } from "./useMediaViewerReload"

export type MediaViewerPaneProps = PaneProps<{ path?: string; kind?: "image" | "pdf"; filesystem?: FilesystemId }>

function inferKind(path: string, explicit?: "image" | "pdf"): "image" | "pdf" {
  if (explicit) return explicit
  return path.toLowerCase().endsWith(".pdf") ? "pdf" : "image"
}

export function MediaViewerPane({ params, className }: MediaViewerPaneProps) {
  const path = params?.path ?? ""
  const filesystem = normalizeUiFilesystem(params?.filesystem)
  const { reloadKey, reload } = useMediaViewerReload({ path })

  return (
    <MediaViewer
      path={path}
      kind={inferKind(path, params?.kind)}
      filesystem={filesystem}
      reloadKey={reloadKey}
      onReload={reload}
      className={className}
    />
  )
}
