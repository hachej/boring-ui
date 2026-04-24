"use client"

import { useCallback, useRef } from "react"
import type { DockviewApi } from "dockview-react"
import { DockviewShell } from "../dock"
import type { LayoutConfig, SerializedLayout } from "../dock"
import { cn } from "../lib/utils"

const SURFACE_STORAGE_KEY = "boring-ui-v2:surface"

const ALLOWED_PANELS = [
  "code-editor",
  "markdown-editor",
  "csv-viewer",
  "empty",
]

const SURFACE_LAYOUT: LayoutConfig = {
  version: "2.0",
  groups: [
    {
      id: "artifacts",
      position: "center",
      dynamic: true,
    },
  ],
}

export interface ArtifactSurfacePaneProps {
  visible?: boolean
  storageKey?: string
  allowedPanels?: string[]
  persistedLayout?: SerializedLayout
  onLayoutChange?: (layout: SerializedLayout) => void
  onReady?: (api: DockviewApi) => void
  prefixHeaderActions?: React.FunctionComponent<unknown>
  rightHeaderActions?: React.FunctionComponent<unknown>
  watermarkComponent?: React.FunctionComponent<unknown>
  className?: string
}

export function ArtifactSurfacePane({
  visible = true,
  storageKey = SURFACE_STORAGE_KEY,
  allowedPanels = ALLOWED_PANELS,
  persistedLayout,
  onLayoutChange,
  onReady,
  prefixHeaderActions,
  rightHeaderActions,
  watermarkComponent,
  className,
}: ArtifactSurfacePaneProps) {
  const suppressRef = useRef(false)

  const handleLayoutChange = useCallback(
    (layout: SerializedLayout) => {
      if (suppressRef.current) return
      onLayoutChange?.(layout)
    },
    [onLayoutChange],
  )

  if (!visible) return null

  return (
    <div
      className={cn("h-full w-full", className)}
      data-testid="artifact-surface"
    >
      <DockviewShell
        layout={SURFACE_LAYOUT}
        persistedLayout={persistedLayout}
        onLayoutChange={handleLayoutChange}
        onReady={onReady}
        allowedPanels={allowedPanels}
        storageKey={storageKey}
        prefixHeaderActions={prefixHeaderActions}
        rightHeaderActions={rightHeaderActions}
        watermarkComponent={watermarkComponent}
      />
    </div>
  )
}

ArtifactSurfacePane.defaultAllowedPanels = ALLOWED_PANELS
ArtifactSurfacePane.storageKey = SURFACE_STORAGE_KEY
