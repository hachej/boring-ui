"use client"

import type { PaneProps } from "../../../../shared/types/panel"
import { MediaViewer } from "./MediaViewer"

export type MediaViewerPaneProps = PaneProps<{ path?: string; kind?: "image" | "pdf" }>

function inferKind(path: string, explicit?: "image" | "pdf"): "image" | "pdf" {
  if (explicit) return explicit
  return path.toLowerCase().endsWith(".pdf") ? "pdf" : "image"
}

export function MediaViewerPane({ params, className }: MediaViewerPaneProps) {
  const path = params?.path ?? ""
  return <MediaViewer path={path} kind={inferKind(path, params?.kind)} className={className} />
}
