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
import { useHydrationComplete } from "../../store/selectors"
import { events } from "../events"
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
        title: config.title,
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
      const params = panel.params as Record<string, unknown> | undefined
      const title = panel.title

      api.removePanel(panel)

      const base = { id: panelId, component, params, title }

      if ("groupId" in target) {
        const group = api.groups.find((g) => g.id === target.groupId)
        api.addPanel({
          ...base,
          position: group ? { referenceGroup: group } : undefined,
        })
      } else {
        const ref = api.getPanel(target.referencePanelId)
        api.addPanel({
          ...base,
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

function resolveGroupConstraints(group: GroupConfig): {
  minimumWidth?: number
  maximumWidth?: number
  minimumHeight?: number
  maximumHeight?: number
} | null {
  if (!group.constraints) return null

  let maximumWidth = group.constraints.maxWidth
  const ratio = group.constraints.maxWidthViewportRatio

  if (typeof ratio === "number" && ratio > 0 && typeof window !== "undefined") {
    const ratioWidth = Math.floor(window.innerWidth * ratio)
    maximumWidth = typeof maximumWidth === "number"
      ? Math.min(maximumWidth, ratioWidth)
      : ratioWidth
  }

  return {
    minimumWidth: group.constraints.minWidth,
    maximumWidth,
    minimumHeight: group.constraints.minHeight,
    maximumHeight: group.constraints.maxHeight,
  }
}

function applyGroupConstraints(api: DockviewApi, group: GroupConfig): void {
  const panel = api.getPanel(group.panel ?? group.id)
  if (!panel?.group) return
  const constraints = resolveGroupConstraints(group)
  if (!constraints) return
  panel.group.api.setConstraints(constraints)
}

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
        params: group.params,
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
    applyGroupConstraints(api, group)
  }

  const responsiveConstraintGroups = layout.groups.filter(
    (group) => typeof group.constraints?.maxWidthViewportRatio === "number",
  )
  let removeResizeListener: (() => void) | undefined
  if (responsiveConstraintGroups.length > 0) {
    const onResize = () => {
      for (const group of responsiveConstraintGroups) {
        applyGroupConstraints(api, group)
      }
    }
    window.addEventListener("resize", onResize)
    removeResizeListener = () => window.removeEventListener("resize", onResize)
  }

  let dispose: (() => void) | undefined
  if (onLayoutChange) {
    let timer: ReturnType<typeof setTimeout> | null = null
    const debouncedPersist = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        onLayoutChange(api.toJSON() as SerializedLayout)
      }, PERSIST_DEBOUNCE_MS)
    }
    const layoutDisposable = api.onDidLayoutChange(debouncedPersist)
    const flushOnUnload = () => {
      if (timer) {
        clearTimeout(timer)
        onLayoutChange(api.toJSON() as SerializedLayout)
      }
    }
    window.addEventListener("beforeunload", flushOnUnload)
    dispose = () => {
      flushOnUnload()
      layoutDisposable.dispose()
      window.removeEventListener("beforeunload", flushOnUnload)
      removeResizeListener?.()
    }
  } else {
    dispose = () => {
      removeResizeListener?.()
    }
  }
  return dispose
}

export function DockviewShell({
  layout,
  persistedLayout,
  onReady,
  onLayoutChange,
  allowedPanels,
  className,
  prefixHeaderActions,
  rightHeaderActions,
  watermarkComponent,
}: DockviewShellProps) {
  const registry = useRegistry()
  const hydrationComplete = useHydrationComplete()
  const apiRef = useRef<DockviewApi | null>(null)
  const pendingOnReady = useRef<DockviewReadyEvent | null>(null)
  const disposeRef = useRef<(() => void) | undefined>(undefined)

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
      disposeRef.current?.()
      disposeRef.current = initializeDockview(
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

  useEffect(() => {
    return () => disposeRef.current?.()
  }, [])

  // Propagate filesystem mutations into open panels: a moved/renamed
  // file updates the matching tab's params.path + title in place; a
  // deleted file closes its tab. Matches panels by id (`file:${path}`
  // convention) AND by `params.path` so it survives id changes from
  // earlier moves. Iterates with filter+forEach so duplicate panels
  // pointing at the same path all get reconciled, not just the first.
  useEffect(() => {
    const offMoved = events.on("file:moved", ({ from, to }) => {
      const api = apiRef.current
      if (!api) return
      const newTitle = to.split("/").pop() ?? to
      api.panels
        .filter(
          (p) =>
            p.id === `file:${from}` ||
            (p.params as { path?: string } | undefined)?.path === from,
        )
        .forEach((target) => {
          target.api.updateParameters({
            ...((target.params as Record<string, unknown> | undefined) ?? {}),
            path: to,
          })
          target.api.setTitle(newTitle)
        })
    })

    const offDeleted = events.on("file:deleted", ({ path }) => {
      const api = apiRef.current
      if (!api) return
      api.panels
        .filter(
          (p) =>
            p.id === `file:${path}` ||
            (p.params as { path?: string } | undefined)?.path === path,
        )
        .forEach((target) => api.removePanel(target))
    })

    return () => {
      offMoved()
      offDeleted()
    }
  }, [])

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
        prefixHeaderActionsComponent={prefixHeaderActions as never}
        rightHeaderActionsComponent={rightHeaderActions as never}
        watermarkComponent={watermarkComponent as never}
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
