"use client"

import { normalizeUiFilesystem, type FilesystemId } from "../../../../shared/types/filesystem"
import type { PaneProps } from "../../../../shared/types/panel"
import { HtmlViewer } from "./HtmlViewer"

export type HtmlViewerPaneProps = PaneProps<{ path?: string; filesystem?: FilesystemId }>

export function HtmlViewerPane({ params, className }: HtmlViewerPaneProps) {
  return <HtmlViewer path={params?.path ?? ""} filesystem={normalizeUiFilesystem(params?.filesystem)} className={className} />
}
