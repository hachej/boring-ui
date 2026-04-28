"use client"

import { useCallback, useMemo } from "react"
import type { DockviewApi } from "dockview-react"
import { DockviewShell } from "../dock"
import type { LayoutConfig, SerializedLayout } from "../dock"
import { cn } from "../lib/utils"

const SURFACE_STORAGE_KEY = "boring-ui-v2:surface"

// Bumped when the SerializedLayout shape (or our envelope contract) changes
// incompatibly. Stored payloads with a different version are dropped rather
// than risking a fromJSON throw on a stale shape.
const STORAGE_VERSION = 1

const ALLOWED_PANELS = [
  "code-editor",
  "markdown-editor",
  "csv-viewer",
  "empty",
]

const SURFACE_LAYOUT: LayoutConfig = {
  version: "2.0",
  groups: [{ id: "artifacts", position: "center", dynamic: true }],
}

interface StoredEnvelope {
  v: number
  layout: SerializedLayout
}

// Read + validate a persisted layout. Returns undefined on any failure
// (missing, parse error, version mismatch, panel referencing an unknown
// component) so the caller falls back to a fresh layout. Filtering out
// individual unknown panels would orphan the grid tree, so we drop the
// whole layout if any one is invalid.
function readStoredLayout(
  key: string,
  allowed: ReadonlySet<string>,
): SerializedLayout | undefined {
  if (typeof window === "undefined") return undefined
  let raw: string | null
  try {
    raw = window.localStorage.getItem(key)
  } catch {
    return undefined
  }
  if (!raw) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== "object") return undefined
  const envelope = parsed as Partial<StoredEnvelope>
  if (envelope.v !== STORAGE_VERSION) return undefined
  const layout = envelope.layout
  if (!layout || typeof layout !== "object") return undefined
  const panels = (layout as { panels?: unknown }).panels
  if (!panels || typeof panels !== "object") return undefined
  for (const entry of Object.values(panels as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") return undefined
    const comp = (entry as { contentComponent?: unknown }).contentComponent
    if (typeof comp !== "string" || !allowed.has(comp)) return undefined
  }
  return layout as SerializedLayout
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
  const callerControlled = Boolean(onLayoutChange || persistedLayout)

  // Re-derived on storageKey/allowedPanels change so a runtime swap
  // re-hydrates from the new bucket. Combined with the `key=` on
  // DockviewShell below, this remounts dockview and runs fromJSON on the
  // new payload — without that, dockview consumes persistedLayout once on
  // its initial onReady and ignores subsequent changes.
  const internalPersisted = useMemo(() => {
    if (callerControlled) return undefined
    return readStoredLayout(storageKey, new Set(allowedPanels))
  }, [callerControlled, storageKey, allowedPanels])

  const handleLayoutChange = useCallback(
    (layout: SerializedLayout) => {
      if (onLayoutChange) {
        onLayoutChange(layout)
        return
      }
      const envelope: StoredEnvelope = { v: STORAGE_VERSION, layout }
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(envelope))
      } catch {
        /* localStorage full / disabled — accept loss rather than block UI. */
      }
    },
    [onLayoutChange, storageKey],
  )

  if (!visible) return null

  return (
    <div
      className={cn("h-full w-full", className)}
      data-testid="artifact-surface"
    >
      <DockviewShell
        // Force a fresh dockview when the persistence target changes —
        // dockview only consumes persistedLayout on initial onReady, and
        // writes after a key swap would otherwise land under the new key
        // with the old layout.
        key={`${storageKey}:${callerControlled ? "ext" : "auto"}`}
        layout={SURFACE_LAYOUT}
        persistedLayout={persistedLayout ?? internalPersisted}
        onLayoutChange={handleLayoutChange}
        onReady={onReady}
        allowedPanels={allowedPanels}
        prefixHeaderActions={prefixHeaderActions}
        rightHeaderActions={rightHeaderActions}
        watermarkComponent={watermarkComponent}
      />
    </div>
  )
}

ArtifactSurfacePane.defaultAllowedPanels = ALLOWED_PANELS
