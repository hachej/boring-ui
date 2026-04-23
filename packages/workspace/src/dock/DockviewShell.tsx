/// <reference types="vite/client" />
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react"
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
} from "dockview-react"
import "dockview-react/dist/styles/dockview.css"
import "./dockview-overrides.css"
import { useRegistry } from "../registry"
import { useHydrationComplete } from "../store/selectors"
import type {
  DockviewShellApi,
  DockviewShellProps,
  GroupConfig,
  SerializedLayout,
} from "./types"
import { ShadcnTab } from "./ShadcnTab"

const PERSIST_DEBOUNCE_MS = 300

const DockviewApiContext = createContext<DockviewShellApi | null>(null)

export function useDockviewApi(): DockviewShellApi {
  const api = useContext(DockviewApiContext)
  if (!api) {
    throw new Error(
      "useDockviewApi must be used within a DockviewShell",
    )
  }
  return api
}

function positionToDirection(
  position: GroupConfig["position"],
): "left" | "right" | "above" | "below" | "within" {
  switch (position) {
    case "left":
      return "left"
    case "right":
      return "right"
    case "bottom":
      return "below"
    case "center":
    default:
      return "within"
  }
}

function createShellApi(
  apiRef: React.RefObject<DockviewApi | null>,
): DockviewShellApi {
  function getApi(): DockviewApi {
    if (!apiRef.current)
      throw new Error("DockviewShell not initialized")
    return apiRef.current
  }

  return {
    addPanel(groupId, config) {
      const api = getApi()
      const group = api.groups.find((g) => g.id === groupId)
      api.addPanel({
        id: config.id,
        component: config.component,
        params: config.params,
        position: group ? { referenceGroup: group } : undefined,
      })
    },

    removePanel(panelId) {
      const api = getApi()
      const panel = api.getPanel(panelId)
      if (panel) api.removePanel(panel)
    },

    activatePanel(panelId) {
      const api = getApi()
      const panel = api.getPanel(panelId)
      if (panel) panel.api.setActive()
    },

    movePanel(panelId, target) {
      const api = getApi()
      const panel = api.getPanel(panelId)
      if (!panel) return
      const component = panel.view.contentComponent

      api.removePanel(panel)

      if ("groupId" in target) {
        const group = api.groups.find((g) => g.id === target.groupId)
        api.addPanel({
          id: panelId,
          component,
          position: group ? { referenceGroup: group } : undefined,
        })
      } else {
        const ref = api.getPanel(target.referencePanelId)
        api.addPanel({
          id: panelId,
          component,
          position: ref
            ? { referencePanel: ref, direction: target.direction }
            : undefined,
        })
      }
    },

    getActivePanel() {
      const api = getApi()
      return api.activePanel?.id ?? null
    },

    toJSON() {
      return getApi().toJSON() as SerializedLayout
    },
  }
}

const MAX_PANEL_STATE_BYTES = 4096

function initializeDockview(
  event: DockviewReadyEvent,
  layout: DockviewShellProps["layout"],
  persistedLayout: DockviewShellProps["persistedLayout"],
  registry: { has(id: string): boolean; list(): Array<{ id: string }> },
  onLayoutChange: DockviewShellProps["onLayoutChange"],
  apiRef: React.MutableRefObject<DockviewApi | null>,
) {
  const api = event.api
  apiRef.current = api

  if (persistedLayout) {
    api.fromJSON(persistedLayout)
  } else {
    let firstPanelAdded = false
    for (const group of layout.groups) {
      if (!group.panel) continue
      if (!registry.has(group.panel)) {
        console.error(
          `[DockviewShell] Panel "${group.panel}" not found in registry. Available: ${registry.list().map((p) => p.id).join(", ")}`,
        )
        if (import.meta.env.DEV) {
          throw new Error(`Unknown panel ID: ${group.panel}`)
        }
        continue
      }
      api.addPanel({
        id: group.panel,
        component: group.panel,
        position: firstPanelAdded
          ? { direction: positionToDirection(group.position) }
          : undefined,
      })
      firstPanelAdded = true
    }
  }

  for (const group of layout.groups) {
    const panel = api.getPanel(group.panel ?? group.id)
    if (!panel?.group) continue
    if (group.locked) panel.group.locked = "no-drop-target" as const
    if (group.hideHeader) panel.group.header.hidden = true
    if (group.constraints) {
      panel.group.api.setConstraints({
        minimumWidth: group.constraints.minWidth,
        maximumWidth: group.constraints.maxWidth,
        minimumHeight: group.constraints.minHeight,
        maximumHeight: group.constraints.maxHeight,
      })
    }
  }

  if (onLayoutChange) {
    let timer: ReturnType<typeof setTimeout> | null = null
    const debouncedPersist = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        onLayoutChange(api.toJSON() as SerializedLayout)
      }, PERSIST_DEBOUNCE_MS)
    }
    api.onDidLayoutChange(debouncedPersist)
    const flushOnUnload = () => {
      if (timer) {
        clearTimeout(timer)
        onLayoutChange(api.toJSON() as SerializedLayout)
      }
    }
    window.addEventListener("beforeunload", flushOnUnload)
  }
}

export function DockviewShell({
  layout,
  persistedLayout,
  onReady,
  onLayoutChange,
  allowedPanels,
  className,
}: DockviewShellProps) {
  const registry = useRegistry()
  const hydrationComplete = useHydrationComplete()
  const apiRef = useRef<DockviewApi | null>(null)
  const pendingOnReady = useRef<DockviewReadyEvent | null>(null)

  const components = useMemo(() => {
    const all = registry.getComponents()
    if (!allowedPanels) return all
    return Object.fromEntries(
      Object.entries(all).filter(([id]) => allowedPanels.includes(id)),
    )
  }, [registry, allowedPanels])

  const shellApi = useMemo(() => createShellApi(apiRef), [])

  const doInit = useCallback(
    (event: DockviewReadyEvent) => {
      initializeDockview(
        event,
        layout,
        persistedLayout,
        registry,
        onLayoutChange,
        apiRef,
      )
      onReady?.(event.api)
    },
    [layout, persistedLayout, registry, onLayoutChange, onReady],
  )

  const handleReady = useCallback(
    (event: DockviewReadyEvent) => {
      if (!hydrationComplete) {
        pendingOnReady.current = event
        return
      }
      doInit(event)
    },
    [hydrationComplete, doInit],
  )

  useEffect(() => {
    if (hydrationComplete && pendingOnReady.current) {
      doInit(pendingOnReady.current)
      pendingOnReady.current = null
    }
  }, [hydrationComplete, doInit])

  if (!hydrationComplete) {
    return <LoadingSkeleton />
  }

  return (
    <DockviewApiContext.Provider value={shellApi}>
      <DockviewReact
        className={`dv-shell ${className ?? ""}`}
        components={
          components as Record<
            string,
            React.FunctionComponent<IDockviewPanelProps>
          >
        }
        defaultTabComponent={
          ShadcnTab as React.FunctionComponent<IDockviewPanelHeaderProps>
        }
        onReady={handleReady}
      />
    </DockviewApiContext.Provider>
  )
}

function LoadingSkeleton() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-background text-muted-foreground">
      <span className="animate-pulse">Loading workspace...</span>
    </div>
  )
}

export { DockviewApiContext }
