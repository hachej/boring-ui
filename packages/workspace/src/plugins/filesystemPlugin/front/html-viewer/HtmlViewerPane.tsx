"use client"

import type { PaneProps } from "../../../../shared/types/panel"
import { HtmlViewer } from "./HtmlViewer"

export type HtmlViewerPaneProps = PaneProps<{ path?: string }>

export function HtmlViewerPane({ params, className }: HtmlViewerPaneProps) {
  return <HtmlViewer path={params?.path ?? ""} className={className} />
}
