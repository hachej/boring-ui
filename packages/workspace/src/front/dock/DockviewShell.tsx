/// <reference types="vite/client" />
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
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
import { events, workspaceEvents, type WorkspacePanelMatch } from "../events"
import type {
  DockviewShellApi,
  DockviewShellProps,
  GroupConfig,
  SerializedLayout,
} from "./types"
import { LoadingState } from "@hachej/boring-ui-kit"
import { ShadcnTab } from "./ShadcnTab"

const PERSIST_DEBOUNCE_MS = 300

const DockviewApiContext = createContext<DockviewShellApi | null>(null)

function matchesPanel(
  panel: DockviewApi["panels"][number],
  match: WorkspacePanelMatch,
): boolean {
  if ("id" in match) return panel.id === match.id
  const params = panel.params as Record<string, unknown> | undefined
  if ("paramPrefix" in match) {
    const value = params?.[match.paramPrefix]
    const prefixMatches = typeof value === "string" && value.startsWith(match.value)
    const paramsMatch = match.params
      ? Object.entries(match.params).every(([key, expected]) => params?.[key] === expected)
      : true
    return prefixMatches && paramsMatch
  }
  if ("params" in match) {
    return Object.entries(match.params).every(([key, value]) => params?.[key] === value)
  }
  return params?.[match.param] === match.value
}

function findMatchingPanels(
  api: DockviewApi,
  match: WorkspacePanelMatch | WorkspacePanelMatch[],
): DockviewApi["panels"] {
  const matches = Array.isArray(match) ? match : [match]
  const seen = new Set<string>()
  const panels: DockviewApi["panels"] = []
  for (const panel of api.panels) {
    if (!matches.some((candidate) => matchesPanel(panel, candidate))) continue
    if (seen.has(panel.id)) continue
    seen.add(panel.id)
    panels.push(panel)
  }
  return panels
}

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

    updatePanelParams(panelId, params) {
      const panel = getApi().getPanel(panelId)
      if (!panel) return
      panel.api.updateParameters({
        ...((panel.params as Record<string, unknown> | undefined) ?? {}),
        ...params,
      })
    },

    setPanelTitle(panelId, title) {
      const panel = getApi().getPanel(panelId)
      if (panel) panel.api.setTitle(title)
    },

    findPanelsByParam(key, value) {
      return getApi().panels
        .filter((panel) => (panel.params as Record<string, unknown> | undefined)?.[key] === value)
        .map((panel) => panel.id)
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

  let shouldAddDefaultPanels = true
  if (persistedLayout) {
    try {
      api.fromJSON(persistedLayout)
      shouldAddDefaultPanels = false
    } catch (error) {
      console.warn("[DockviewShell] Ignoring invalid persisted layout", error)
    }
  }

  if (shouldAddDefaultPanels) {
    let firstPanelAdded = false
    for (const group of layout.groups) {
      if (!group.panel) continue
      if (!registry.has(group.panel)) {
        console.error(
          `[DockviewShell] Panel "${group.panel}" not found in registry. Available: ${registry.list().map((p) => p.id).join(", ")}`,
        )
        if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
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
  onUnavailable,
  onLayoutChange,
  allowedPanels,
  className,
  prefixHeaderActions,
  rightHeaderActions,
  watermarkComponent,
}: DockviewShellProps) {
  const registry = useRegistry()
  const registrySnapshot = useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot)
  const hydrationComplete = useHydrationComplete()
  const apiRef = useRef<DockviewApi | null>(null)
  const pendingOnReady = useRef<DockviewReadyEvent | null>(null)
  const disposeRef = useRef<(() => void) | undefined>(undefined)
  const onUnavailableRef = useRef(onUnavailable)
  onUnavailableRef.current = onUnavailable
  const componentsCacheRef = useRef<Record<string, React.FunctionComponent<IDockviewPanelProps>> | null>(null)

  const components = useMemo(() => {
    const all = registry.getComponents()
    const next = (allowedPanels
      ? Object.fromEntries(Object.entries(all).filter(([id]) => allowedPanels.includes(id)))
      : all) as Record<string, React.FunctionComponent<IDockviewPanelProps>>
    const previous = componentsCacheRef.current
    if (previous) {
      const previousKeys = Object.keys(previous)
      const nextKeys = Object.keys(next)
      if (
        previousKeys.length === nextKeys.length &&
        nextKeys.every((key) => previous[key] === next[key])
      ) {
        return previous
      }
    }
    componentsCacheRef.current = next
    return next
  }, [registry, registrySnapshot, allowedPanels])

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
    return () => {
      const current = apiRef.current
      apiRef.current = null
      pendingOnReady.current = null
      if (current) onUnavailableRef.current?.(current)
      disposeRef.current?.()
      disposeRef.current = undefined
    }
  }, [])

  useEffect(() => {
    const offUpdate = events.on(workspaceEvents.panelUpdate, ({ match, params, title }) => {
      const api = apiRef.current
      if (!api) return
      for (const panel of findMatchingPanels(api, match)) {
        if (params) {
          panel.api.updateParameters({
            ...((panel.params as Record<string, unknown> | undefined) ?? {}),
            ...params,
          })
        }
        if (title) panel.api.setTitle(title)
      }
    })
    const offClose = events.on(workspaceEvents.panelClose, ({ match }) => {
      const api = apiRef.current
      if (!api) return
      for (const panel of findMatchingPanels(api, match)) {
        api.removePanel(panel)
      }
    })
    return () => {
      offUpdate()
      offClose()
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
    <LoadingState centered className="bg-background" label="Loading workspace..." />
  )
}

export { DockviewApiContext }
