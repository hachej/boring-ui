"use client"

import { useCallback, useMemo } from "react"
import type { DockviewApi } from "dockview-react"
import { DockviewShell } from "../../dock"
import type { LayoutConfig, SerializedLayout } from "../../dock"
import { cn } from "../../lib/utils"

const SURFACE_STORAGE_KEY = "boring-ui-v2:surface"

// Bumped when the SerializedLayout shape (or our envelope contract) changes
// incompatibly. Stored payloads with a different version are dropped rather
// than risking a fromJSON throw on a stale shape.
const STORAGE_VERSION = 1

const SURFACE_LAYOUT: LayoutConfig = {
  version: "2.0",
  groups: [{ id: "artifacts", position: "center", dynamic: true }],
}

interface StoredEnvelope {
  v: number
  layout: SerializedLayout
}

type StoredLayoutState =
  | { status: "ready"; layout: SerializedLayout }
  | { status: "blocked-by-allowed-panels" }
  | { status: "empty" | "invalid" }

// Read + validate a persisted layout. Malformed/stale payloads are invalid and
// ignored. Layouts whose panel components are merely not registered/allowed yet
// are treated as temporarily blocked so an early empty Dockview mount cannot
// overwrite them before plugin registrations arrive.
function readStoredLayoutState(
  key: string,
  allowed?: ReadonlySet<string>,
): StoredLayoutState {
  if (typeof window === "undefined") return { status: "empty" }
  let raw: string | null
  try {
    raw = window.localStorage.getItem(key)
  } catch {
    return { status: "empty" }
  }
  if (!raw) return { status: "empty" }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { status: "invalid" }
  }
  if (!parsed || typeof parsed !== "object") return { status: "invalid" }
  const envelope = parsed as Partial<StoredEnvelope>
  if (envelope.v !== STORAGE_VERSION) return { status: "invalid" }
  const layout = envelope.layout
  if (!layout || typeof layout !== "object") return { status: "invalid" }
  const panels = (layout as { panels?: unknown }).panels
  if (!panels || typeof panels !== "object") return { status: "invalid" }
  for (const entry of Object.values(panels as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") return { status: "invalid" }
    const comp = (entry as { contentComponent?: unknown }).contentComponent
    if (typeof comp !== "string") return { status: "invalid" }
    if (allowed && !allowed.has(comp)) return { status: "blocked-by-allowed-panels" }
  }
  return { status: "ready", layout: layout as SerializedLayout }
}

function layoutHasPanels(layout: SerializedLayout): boolean {
  const panels = (layout as { panels?: unknown }).panels
  return Boolean(panels && typeof panels === "object" && Object.keys(panels as Record<string, unknown>).length > 0)
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
  allowedPanels,
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
  const allowedPanelsKey = allowedPanels?.slice().sort().join("\u0000") ?? "*"
  const allowedPanelSet = useMemo(
    () => allowedPanels ? new Set(allowedPanels) : undefined,
    [allowedPanels],
  )
  const internalLayoutState = useMemo(() => {
    if (callerControlled) return { status: "empty" } as StoredLayoutState
    return readStoredLayoutState(storageKey, allowedPanelSet)
  }, [allowedPanelSet, callerControlled, storageKey])
  const internalPersisted = internalLayoutState.status === "ready" ? internalLayoutState.layout : undefined

  const handleLayoutChange = useCallback(
    (layout: SerializedLayout) => {
      if (onLayoutChange) {
        onLayoutChange(layout)
        return
      }
      if (
        internalLayoutState.status === "blocked-by-allowed-panels" &&
        !layoutHasPanels(layout)
      ) {
        return
      }
      const envelope: StoredEnvelope = { v: STORAGE_VERSION, layout }
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(envelope))
      } catch {
        /* localStorage full / disabled — accept loss rather than block UI. */
      }
    },
    [internalLayoutState.status, onLayoutChange, storageKey],
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
        key={`${storageKey}:${callerControlled ? "ext" : "auto"}:${allowedPanelsKey}`}
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

ArtifactSurfacePane.defaultAllowedPanels = [] as string[]
