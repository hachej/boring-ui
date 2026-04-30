"use client"

import { useCallback } from "react"
import type { UseArtifactPanelsReturn } from "./useArtifactPanels"

const DEFAULT_TOOL_PANEL_MAP: Record<string, string> = {
  write: "code-editor",
  edit: "code-editor",
  read: "code-editor",
  create_file: "code-editor",
  markdown: "markdown-editor",
  csv: "csv-viewer",
  data: "csv-viewer",
}

export interface UseArtifactRoutingOptions {
  toolPanelMap?: Record<string, string>
}

export interface UseArtifactRoutingReturn {
  openForTool: (
    toolName: string,
    params: { path: string; [key: string]: unknown },
  ) => void
  resolvePanel: (toolName: string) => string | undefined
}

export function useArtifactRouting(
  artifactPanels: UseArtifactPanelsReturn,
  opts: UseArtifactRoutingOptions = {},
): UseArtifactRoutingReturn {
  const map = { ...DEFAULT_TOOL_PANEL_MAP, ...opts.toolPanelMap }

  const resolvePanel = useCallback(
    (toolName: string): string | undefined => {
      return map[toolName]
    },
    [map],
  )

  const openForTool = useCallback(
    (
      toolName: string,
      params: { path: string; [key: string]: unknown },
    ) => {
      const component = map[toolName]
      if (!component) return
      const panelId = `artifact-${params.path}`
      if (artifactPanels.isOpen(panelId)) {
        artifactPanels.activate(panelId)
      } else {
        artifactPanels.open({ id: panelId, component, params })
      }
    },
    [map, artifactPanels],
  )

  return { openForTool, resolvePanel }
}
