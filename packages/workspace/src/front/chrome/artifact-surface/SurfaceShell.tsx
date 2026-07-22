"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import type { DockviewApi } from "dockview-react"
import { ChevronRight, PanelLeftOpen } from "lucide-react"
import { ControlTooltip } from "../../components/ControlTooltip"
import { IconButton } from "@hachej/boring-ui-kit"
import { cn } from "../../lib/utils"
import { PaneCollapseButton } from "../../layout/paneCollapseButton"
import { ArtifactSurfacePane } from "./ArtifactSurfacePane"
import type { WorkspaceBridge, CommandResult, BridgeEventMap } from "../../bridge/types"
import type { WorkspaceState, PanelState } from "../../store/types"
import { WorkbenchLeftPane } from "../workbench-left/WorkbenchLeftPane"
import { useRegistry, useSurfaceResolverRegistry } from "../../registry"
import { normalizeUiFilesystem, type FilesystemId } from "../../../shared/types/filesystem"
import type { SurfaceOpenRequest } from "../../../shared/types/surface"
import { WORKSPACE_OPEN_PATH_SURFACE_KIND } from "../../../shared/types/surface"
import { isSharedDockviewPlacement, isWorkspacePagePlacement } from "../../../shared/types/panel"
import {
  findOpenFilePanel,
  normalizeSurfaceOpenRequest,
  normalizeWorkbenchPath,
  surfacePanelId,
} from "./surfaceShellHelpers"
export { normalizeSurfaceOpenRequest, resolvePanelForPath } from "./surfaceShellHelpers"

export interface SurfaceShellTab {
  id: string
  /** Registered panel component id for this tab. May differ from the tab instance id. */
  component?: string
  title: string
  params?: Record<string, unknown>
}

export interface SurfaceShellSnapshot {
  openTabs: SurfaceShellTab[]
  activeTab: string | null
}

export interface OpenPanelConfig {
  /** Panel instance id. If a panel with this id is already open, it's re-activated instead of duplicated. */
  id: string
  /** Registered component id (must match a `PanelConfig.id` in WorkspaceProvider's panel registry). */
  component: string
  /** Tab title. Defaults to `id`. */
  title?: string
  /** Arbitrary params passed to the pane component. */
  params?: Record<string, unknown>
}

export interface SurfaceShellOpenFileOptions {
  filesystem?: FilesystemId
  mode?: "view" | "edit" | "diff"
}

export class SurfaceUnavailableError extends Error {
  constructor(message = "Surface dockview is unavailable.") {
    super(message)
    this.name = "SurfaceUnavailableError"
  }
}

export interface SurfaceShellApi {
  /** Open a file in the workbench. Idempotent — re-activates an existing pane for the same filesystem/path. */
  openFile: (path: string, options?: SurfaceShellOpenFileOptions) => void
  /** Open a plugin-defined surface target through the registered surface resolvers. */
  openSurface: (request: SurfaceOpenRequest) => void
  /**
   * Open a non-file pane in the workbench. Idempotent on `id` —
   * re-activates an existing panel with the same id rather than duplicating.
   * Use this for app-specific panes (charts, dashboards, log viewers, …) that
   * aren't anchored to a filesystem path.
   */
  openPanel: (config: OpenPanelConfig) => void
  /** Hide the workbench's left sources/files pane while leaving the workbench open. */
  closeWorkbenchLeftPane: () => void
  /** Reveal/select a file-tree path without opening an editor pane. */
  expandToFile: (path: string) => void
  /** Current snapshot of open tabs + active tab. */
  getSnapshot: () => SurfaceShellSnapshot
}

export interface SurfaceShellProps {
  rootDir?: string
  sidebarDefaultWidth?: number
  sidebarMinWidth?: number
  sidebarMaxWidth?: number
  storageKey?: string
  /** Called whenever the surface dockview becomes ready, with an imperative handle. */
  onReady?: (api: SurfaceShellApi) => void
  /** Called before the current dockview instance is disposed or replaced. */
  onUnavailable?: () => void
  /** Called on every panel add/remove/active-change with the current snapshot. */
  onChange?: (snapshot: SurfaceShellSnapshot) => void
  /** Optional close action for hosts that model the workbench as collapsible. */
  onClose?: () => void
  /** Render the built-in top-right close affordance. Hosts can set false when they provide their own chrome. */
  showCloseAction?: boolean
  /**
   * Extra panel ids (registered via WorkspaceProvider's `panels` prop) that
   * this workbench is allowed to render. Defaults to the built-in
   * editor/viewer panels only. Pass app-specific pane ids here so calls
   * like `surface.openPanel({ component: "chart-canvas" })` actually
   * instantiate — without this, dockview's components map filters them
   * out and you get an empty tab. Two-layer defense: SurfaceShell.openPanel
   * validates against the registry (loud throw on unknown), AND the
   * dockview allowlist below filters which registered panels can mount
   * inside THIS surface (so a host can gate panels per shell instance).
   */
  extraPanels?: string[]
  defaultLeftTab?: string
  onReloadAgentPlugins?: () => void | Promise<unknown>
  initialPanels?: Array<{ id: string; component: string; title?: string; params?: Record<string, unknown> }>
  /** Increment to force a fresh Dockview instance after an imperative API failure. */
  dockviewGeneration?: number
  className?: string
}

const FILE_BACKED_PARAM = "__boringFileBacked"
const FILES_WORKSPACE_SOURCE_ID = "files"

type WorkbenchLeftState =
  | { mode: "hidden"; activeTab: string; restoreMode: "rail" | "source" }
  | { mode: "rail"; activeTab: string }
  | { mode: "source"; activeTab: string }

function validWorkbenchLeftState(value: unknown, fallbackTab: string): WorkbenchLeftState | null {
  if (!value || typeof value !== "object") return null
  const candidate = value as { mode?: unknown; activeTab?: unknown; restoreMode?: unknown }
  const activeTab = typeof candidate.activeTab === "string" ? candidate.activeTab : fallbackTab
  if (candidate.mode === "hidden") {
    return { mode: "hidden", activeTab, restoreMode: candidate.restoreMode === "source" ? "source" : "rail" }
  }
  if (candidate.mode === "source") return { mode: "source", activeTab }
  if (candidate.mode === "rail") return { mode: "rail", activeTab }
  return null
}

function initialWorkbenchLeftState(storageKey: string | undefined, defaultLeftTab: string | undefined): WorkbenchLeftState {
  const fallbackTab = defaultLeftTab ?? ""
  if (!storageKey) return { mode: "rail", activeTab: fallbackTab }
  try {
    const raw = localStorage.getItem(`${storageKey}:leftState`)
    if (raw) {
      const parsed = validWorkbenchLeftState(JSON.parse(raw), fallbackTab)
      if (parsed) return parsed
    }
    const legacyActiveTab = localStorage.getItem(`${storageKey}:activeLeftTab`) ?? fallbackTab
    const legacyHidden = localStorage.getItem(`${storageKey}:leftBlockCollapsed`) === "1"
    const legacySource = localStorage.getItem(`${storageKey}:sourcePaneOpen`) === "1"
    if (legacyHidden) return { mode: "hidden", activeTab: legacyActiveTab, restoreMode: legacySource ? "source" : "rail" }
    return { mode: legacySource ? "source" : "rail", activeTab: legacyActiveTab }
  } catch {
    return { mode: "rail", activeTab: fallbackTab }
  }
}

function hideWorkbenchLeft(state: WorkbenchLeftState): WorkbenchLeftState {
  if (state.mode === "hidden") return state
  return { mode: "hidden", activeTab: state.activeTab, restoreMode: state.mode === "source" ? "source" : "rail" }
}

function showWorkbenchLeft(state: WorkbenchLeftState): WorkbenchLeftState {
  if (state.mode !== "hidden") return state
  return { mode: state.restoreMode, activeTab: state.activeTab }
}

function openWorkbenchSource(state: WorkbenchLeftState, activeTab = state.activeTab): WorkbenchLeftState {
  return { mode: "source", activeTab }
}

function showWorkbenchRail(state: WorkbenchLeftState, activeTab = state.activeTab): WorkbenchLeftState {
  return { mode: "rail", activeTab }
}

function setWorkbenchActiveTab(state: WorkbenchLeftState, activeTab: string): WorkbenchLeftState {
  return state.mode === "hidden"
    ? { ...state, activeTab }
    : { mode: state.mode, activeTab }
}

function dockviewPanelComponent(panel: DockviewApi["panels"][number] | null | undefined): string | null {
  if (!panel) return null
  const contentComponent = (panel as { view?: { contentComponent?: unknown } }).view?.contentComponent
  if (typeof contentComponent === "string") return contentComponent
  const component = (panel as { component?: unknown }).component
  return typeof component === "string" ? component : null
}

function fileBackedPath(
  panel: PanelState | null | undefined,
  fileBackedPanelIds: ReadonlySet<string>,
): string | null {
  if (!panel) return null
  if (
    !panel.id.startsWith("file:") &&
    !panel.id.startsWith(`surface:${WORKSPACE_OPEN_PATH_SURFACE_KIND}:`) &&
    !fileBackedPanelIds.has(panel.id) &&
    panel.params?.[FILE_BACKED_PARAM] !== true
  ) return null
  const path = panel.params?.path
  return typeof path === "string" ? path : null
}

let seqCounter = 0
function fileBackedParams(
  params: Record<string, unknown> | undefined,
  path: string,
  options?: SurfaceShellOpenFileOptions,
): Record<string, unknown> {
  return {
    ...(params ?? {}),
    path: typeof params?.path === "string" ? params.path : path,
    ...(options?.mode ? { mode: options.mode } : {}),
    ...(options?.filesystem ? { filesystem: options.filesystem } : {}),
    [FILE_BACKED_PARAM]: true,
  }
}

function ok(): CommandResult {
  return { seq: ++seqCounter, status: "ok" }
}
function err(code: string, message: string): CommandResult {
  return { seq: ++seqCounter, status: "error", error: { code, message } }
}

export function SurfaceShell({
  rootDir = "",
  sidebarDefaultWidth = 240,
  sidebarMinWidth = 180,
  sidebarMaxWidth = 480,
  storageKey,
  onReady,
  onUnavailable,
  onChange,
  onClose,
  showCloseAction = true,
  extraPanels,
  defaultLeftTab,
  onReloadAgentPlugins,
  initialPanels,
  dockviewGeneration = 0,
  className,
}: SurfaceShellProps) {
  // Persist and transition the left block as one state object. This avoids
  // illegal combinations like "hidden but source-open" and lets full-block
  // collapse restore the same active source (Files, Macro, …) on uncollapse.
  const [leftState, setLeftState] = useState<WorkbenchLeftState>(() => initialWorkbenchLeftState(storageKey, defaultLeftTab))
  const leftBlockCollapsed = leftState.mode === "hidden"
  const sourcePaneOpen = leftState.mode === "source"
  const activeLeftTab = leftState.activeTab
  const setActiveLeftTab = useCallback((tab: string) => {
    setLeftState((state) => setWorkbenchActiveTab(state, tab))
  }, [])
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    if (!storageKey) return sidebarDefaultWidth
    try {
      const raw = localStorage.getItem(`${storageKey}:sidebarWidth`)
      if (!raw) return sidebarDefaultWidth
      const n = Number(raw)
      if (!Number.isFinite(n)) return sidebarDefaultWidth
      return Math.max(sidebarMinWidth, Math.min(sidebarMaxWidth, n))
    } catch {
      return sidebarDefaultWidth
    }
  })
  const apiRef = useRef<DockviewApi | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const [api, setApi] = useState<DockviewApi | null>(null)
  // Active dockview panel id, tracked reactively so the workbench rail can accent
  // a workspace-page icon only while its page is the focused surface tab (the rail's
  // own activeTab is set on icon-click and goes stale when you switch surface tabs).
  const [activeSurfacePanelId, setActiveSurfacePanelId] = useState<string | null>(null)
  const [fileTreeRevealRequest, setFileTreeRevealRequest] = useState<{ path: string; seq: number } | null>(null)
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady
  const onUnavailableRef = useRef(onUnavailable)
  onUnavailableRef.current = onUnavailable
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const bridgeSelectorsRef = useRef(new Set<(state: WorkspaceState) => void>())
  const fileBackedPanelIdsRef = useRef(new Set<string>())
  const pendingTreeExpandRef = useRef<string | null>(null)
  const bridgeEventHandlersRef = useRef(
    new Map<keyof BridgeEventMap, Set<(data: BridgeEventMap[keyof BridgeEventMap]) => void>>(),
  )

  // Read of the panel registry — used to validate `openPanel({component})`
  // against what's actually registered. Without this check, dockview's
  // addPanel silently creates an empty tab when given an unknown component
  // name (real bug we hit when the agent dispatched openPanel for a panel
  // the host hadn't registered).
  const panelRegistry = useRegistry()
  const panelRegistrySnapshot = useSyncExternalStore(
    panelRegistry.subscribe,
    panelRegistry.getSnapshot,
    panelRegistry.getSnapshot,
  )
  const surfaceResolverRegistry = useSurfaceResolverRegistry()
  const panelRegistryRef = useRef(panelRegistry)
  panelRegistryRef.current = panelRegistry
  const surfaceResolverRegistryRef = useRef(surfaceResolverRegistry)
  surfaceResolverRegistryRef.current = surfaceResolverRegistry
  const allowedPanels = useMemo(() => {
    const ids = new Set<string>()
    for (const panel of panelRegistrySnapshot) {
      if (isSharedDockviewPlacement(panel.placement)) ids.add(panel.id)
    }
    for (const id of extraPanels ?? []) {
      ids.add(id)
    }
    return [...ids]
  }, [extraPanels, panelRegistrySnapshot])

  const collapseLeftBlock = useCallback((): void => {
    setLeftState(hideWorkbenchLeft)
  }, [])

  const expandLeftBlock = useCallback((): void => {
    setLeftState(showWorkbenchLeft)
  }, [])

  const openSourcePane = useCallback((tab?: string): void => {
    setLeftState((state) => openWorkbenchSource(state, tab))
  }, [])

  const closeSourcePane = useCallback((): void => {
    setLeftState(showWorkbenchRail)
  }, [])

  const applyPanelPlacementTransition = useCallback((component: string): void => {
    const panel = panelRegistryRef.current.get(component)
    if (isWorkspacePagePlacement(panel?.placement)) {
      // Workspace pages are main-area tabs. They do not own the source pane.
      // Keep the rail visible, but close filetree/catalog content.
      closeSourcePane()
    }
  }, [closeSourcePane])

  const activateDockviewPanel = useCallback((config: OpenPanelConfig & { title: string }): boolean => {
    const api = apiRef.current
    if (!api) return false
    const existing = api.getPanel(config.id)
    if (existing) {
      try {
        if (config.params) existing.api.updateParameters(config.params)
        existing.api.setActive()
        applyPanelPlacementTransition(config.component)
        return true
      } catch {
        return false
      }
    }
    applyPanelPlacementTransition(config.component)
    try {
      api.addPanel({
        id: config.id,
        component: config.component,
        title: config.title,
        params: config.params,
      })
      return Boolean(api.getPanel(config.id))
    } catch {
      return false
    }
  }, [applyPanelPlacementTransition])

  const collapseForActiveWorkspacePage = useCallback((dockview: DockviewApi): void => {
    const component = dockviewPanelComponent(dockview.activePanel)
    if (component) applyPanelPlacementTransition(component)
  }, [applyPanelPlacementTransition])

  const activateExistingFilePanel = useCallback((
    api: DockviewApi,
    path: string,
    filesystem: FilesystemId,
    component: string,
    params: Record<string, unknown>,
  ): boolean => {
    const existing = findOpenFilePanel(api, path, filesystem)
    if (!existing) return false
    // Only reuse legacy/path-matched panels when they still resolve to the same
    // component. If a newer resolver takes over the path (for example CSV),
    // opening should create the newer panel instead of reactivating stale UI.
    if (dockviewPanelComponent(existing) !== component) return false
    try {
      existing.api.updateParameters(params)
      existing.api.setActive()
      applyPanelPlacementTransition(component)
      return true
    } catch {
      return false
    }
  }, [applyPanelPlacementTransition])

  const openFileSync = useCallback((path: string, options?: SurfaceShellOpenFileOptions) => {
    const api = apiRef.current
    if (!api) throw new SurfaceUnavailableError()
    const normalizedPath = normalizeWorkbenchPath(path)
    const request: SurfaceOpenRequest = {
      kind: WORKSPACE_OPEN_PATH_SURFACE_KIND,
      target: normalizedPath,
      filesystem: normalizeUiFilesystem(options?.filesystem),
    }
    const resolved = surfaceResolverRegistryRef.current.resolve(request)
    if (resolved) {
      if (!panelRegistryRef.current.has(resolved.component)) {
        console.warn(`[SurfaceShell] openFile: resolver returned unknown panel "${resolved.component}" for "${normalizedPath}"`)
        return
      }
      const panelId = surfacePanelId(request, resolved)
      const params = fileBackedParams(resolved.params, normalizedPath, { filesystem: request.filesystem, mode: options?.mode })
      fileBackedPanelIdsRef.current.add(panelId)
      if (activateExistingFilePanel(api, normalizedPath, normalizeUiFilesystem(request.filesystem), resolved.component, params)) return
      if (!activateDockviewPanel({
        id: panelId,
        component: resolved.component,
        title: resolved.title ?? normalizedPath.split("/").pop() ?? normalizedPath,
        params,
      })) throw new SurfaceUnavailableError("Surface failed to activate the requested file panel.")
      return
    }

    const existing = findOpenFilePanel(api, normalizedPath, request.filesystem)
    if (existing) {
      existing.api.setActive()
      return
    }
    console.warn(`[SurfaceShell] openFile: no surface resolver matched "${normalizedPath}"`)
  }, [activateDockviewPanel, activateExistingFilePanel])

  const openSurfaceSync = useCallback((request: SurfaceOpenRequest) => {
    const normalizedRequest = normalizeSurfaceOpenRequest(request)
    const resolved = surfaceResolverRegistryRef.current.resolve(normalizedRequest)
    if (!resolved) {
      console.warn(`[SurfaceShell] openSurface: no resolver matched kind="${normalizedRequest.kind}" target="${normalizedRequest.target}"`)
      return
    }
    const registry = panelRegistryRef.current
    if (!registry.has(resolved.component)) {
      const known = registry.list().map((p) => p.id).join(", ")
      throw new Error(
        `openSurface: unknown component "${resolved.component}". Registered panels: [${known}]. ` +
          `Register the component through a panel output before resolving to it.`,
      )
    }
    const panelId = surfacePanelId(normalizedRequest, resolved)
    if (normalizedRequest.kind === WORKSPACE_OPEN_PATH_SURFACE_KIND) {
      fileBackedPanelIdsRef.current.add(panelId)
    }
    const closeWorkbenchOnDone = normalizedRequest.meta?.closeWorkbenchOnDone === true
    const surfaceMode = normalizedRequest.meta?.mode
    const baseParams = normalizedRequest.kind === WORKSPACE_OPEN_PATH_SURFACE_KIND
      ? fileBackedParams(
          resolved.params,
          normalizedRequest.target,
          {
            filesystem: normalizedRequest.filesystem,
            ...(surfaceMode === "view" || surfaceMode === "edit" || surfaceMode === "diff" ? { mode: surfaceMode } : {}),
          },
        )
      : resolved.params
    const resolvedParams = closeWorkbenchOnDone && onCloseRef.current
      ? { ...(baseParams ?? {}), __closeWorkbenchOnDone: onCloseRef.current }
      : baseParams
    if (
      normalizedRequest.kind === WORKSPACE_OPEN_PATH_SURFACE_KIND &&
      apiRef.current &&
      activateExistingFilePanel(apiRef.current, normalizedRequest.target, normalizeUiFilesystem(normalizedRequest.filesystem), resolved.component, resolvedParams ?? {})
    ) return
    if (!activateDockviewPanel({
      id: panelId,
      component: resolved.component,
      title: resolved.title ?? normalizedRequest.target,
      params: resolvedParams,
    })) throw new SurfaceUnavailableError("Surface failed to activate the requested panel.")
  }, [activateDockviewPanel, activateExistingFilePanel])

  const openPanelSync = useCallback((config: OpenPanelConfig) => {
    const api = apiRef.current
    if (!api) throw new SurfaceUnavailableError()
    const existing = api.getPanel(config.id)
    if (existing) {
      // Re-activate, and update params if they changed (so callers can drive
      // pane state by re-issuing openPanel with new params — same panel, new
      // input).
      try {
        if (config.params) existing.api.updateParameters(config.params)
        existing.api.setActive()
        return
      } catch {
        throw new SurfaceUnavailableError("Surface failed to reactivate the requested panel.")
      }
    }
    // Validate the component is actually registered. Without this check,
    // dockview happily creates an empty tab when handed an unknown
    // component name (it falls back to a no-op renderer). That's how the
    // agent's "openPanel({component:'chart'})" produced a blank workbench
    // with no error signal in either direction. Refuse loudly here so the
    // failure is visible at the call site and (when called via exec_ui)
    // surfaces back to the LLM through the UI bridge error path.
    const registry = panelRegistryRef.current
    if (!registry.has(config.component)) {
      const known = registry.list().map((p) => p.id).join(", ")
      throw new Error(
        `openPanel: unknown component "${config.component}". Registered panels: [${known}]. ` +
          `Add the component to WorkspaceProvider's "panels" prop, or pick one of the registered ids.`,
      )
    }
    if (!activateDockviewPanel({
      id: config.id,
      component: config.component,
      title: config.title ?? config.id,
      params: config.params,
    })) throw new SurfaceUnavailableError("Surface failed to activate the requested panel.")
  }, [activateDockviewPanel])

  const getSnapshot = useCallback((): SurfaceShellSnapshot => {
    const api = apiRef.current
    if (!api) return { openTabs: [], activeTab: null }
    const openTabs: SurfaceShellTab[] = api.panels.map((p) => {
      const component = dockviewPanelComponent(p)
      return {
        id: p.id,
        ...(component ? { component } : {}),
        title: (p.title ?? p.id) as string,
        params: (p.params as Record<string, unknown> | undefined) ?? undefined,
      }
    })
    return { openTabs, activeTab: api.activePanel?.id ?? null }
  }, [])

  const emitBridgeEvent = useCallback(<K extends keyof BridgeEventMap>(
    event: K,
    data: BridgeEventMap[K],
  ): boolean => {
    const handlers = bridgeEventHandlersRef.current.get(event)
    if (!handlers || handlers.size === 0) return false
    for (const handler of [...handlers]) {
      handler(data)
    }
    return true
  }, [])

  const expandToFileSync = useCallback((path: string) => {
    const normalizedPath = normalizeWorkbenchPath(path)
    pendingTreeExpandRef.current = normalizedPath
    setFileTreeRevealRequest((prev) => ({ path: normalizedPath, seq: (prev?.seq ?? 0) + 1 }))
    openSourcePane(FILES_WORKSPACE_SOURCE_ID)
    if (emitBridgeEvent("tree:expand", { path: normalizedPath })) {
      pendingTreeExpandRef.current = null
    }
  }, [emitBridgeEvent, openSourcePane])

  const localSurfaceApi = useMemo<SurfaceShellApi>(() => ({
    openFile: openFileSync,
    openSurface: openSurfaceSync,
    openPanel: openPanelSync,
    closeWorkbenchLeftPane: collapseLeftBlock,
    expandToFile: expandToFileSync,
    getSnapshot,
  }), [collapseLeftBlock, expandToFileSync, getSnapshot, openFileSync, openPanelSync, openSurfaceSync])

  const getBridgeState = useCallback((): WorkspaceState => {
    const api = apiRef.current
    const panels: PanelState[] = api
      ? api.panels.map((p) => ({
          id: p.id,
          component: String((p as { component?: string }).component ?? ""),
          params: (p.params as Record<string, unknown> | undefined) ?? undefined,
        }))
      : []
    const activePanel = api?.activePanel?.id ?? null
    const fileBackedPanelIds = fileBackedPanelIdsRef.current
    const activePanelState = panels.find((panel) => panel.id === activePanel)
    const activeFile = fileBackedPath(activePanelState, fileBackedPanelIds)
    return {
      hydrationComplete: true,
      layout: null,
      sidebar: { collapsed: leftBlockCollapsed, width: sidebarWidth },
      panelSizes: {},
      preferences: { theme: "dark" },
      panels,
      activePanel,
      activeFile,
      visibleFiles: panels
        .map((panel) => fileBackedPath(panel, fileBackedPanelIds))
        .filter((p): p is string => p !== null),
      dirtyFiles: {},
      notifications: [],
    }
  }, [leftBlockCollapsed, sidebarWidth])

  const emitBridgeState = useCallback(() => {
    const state = getBridgeState()
    for (const handler of bridgeSelectorsRef.current) {
      handler(state)
    }
  }, [getBridgeState])

  const initializedPanelsRef = useRef(false)
  const handleUnavailable = useCallback((unavailable: DockviewApi) => {
    if (apiRef.current !== unavailable) return
    apiRef.current = null
    initializedPanelsRef.current = false
    setApi(null)
    setActiveSurfacePanelId(null)
    onUnavailableRef.current?.()
  }, [])

  const handleReady = useCallback((ready: DockviewApi) => {
    apiRef.current = ready
    setApi(ready)
    if (!initializedPanelsRef.current) {
      initializedPanelsRef.current = true
      for (const panel of initialPanels ?? []) {
        if (!ready.getPanel(panel.id)) {
          ready.addPanel({ id: panel.id, component: panel.component, title: panel.title, params: panel.params })
        }
      }
    }
    onReadyRef.current?.(localSurfaceApi)
    // Subscribe to dockview events so the parent gets a snapshot push on
    // every panel mutation. Disposers are intentionally not stored — the
    // dockview instance lives for the SurfaceShell's entire lifetime, and
    // SurfaceShell unmounts disposes the dockview itself.
    const emit = () => {
      setActiveSurfacePanelId(ready.activePanel?.id ?? null)
      onChangeRef.current?.(getSnapshot())
      emitBridgeState()
    }
    ready.onDidAddPanel(emit)
    ready.onDidRemovePanel(emit)
    ready.onDidActivePanelChange(() => {
      collapseForActiveWorkspacePage(ready)
      emit()
    })
    // Initial snapshot once everyone's wired up.
    collapseForActiveWorkspacePage(ready)
    emit()
  }, [collapseForActiveWorkspacePage, localSurfaceApi, getSnapshot, emitBridgeState])


  const openFile = useCallback(
    async (path: string, options?: SurfaceShellOpenFileOptions): Promise<CommandResult> => {
      try {
        const api = apiRef.current
        if (!api) return err("not-ready", "surface not ready")
        const normalizedPath = normalizeWorkbenchPath(path)
        const request: SurfaceOpenRequest = {
          kind: WORKSPACE_OPEN_PATH_SURFACE_KIND,
          target: normalizedPath,
          filesystem: normalizeUiFilesystem(options?.filesystem),
        }
        const resolved = surfaceResolverRegistryRef.current.resolve(request)
        if (resolved) {
          if (!panelRegistryRef.current.has(resolved.component)) {
            return err(
              "NO_SURFACE_PANEL",
              `surface resolver "${request.kind}" returned unknown panel "${resolved.component}"`,
            )
          }
          const panelId = surfacePanelId(request, resolved)
          const params = fileBackedParams(resolved.params, normalizedPath, { filesystem: request.filesystem, mode: options?.mode })
          fileBackedPanelIdsRef.current.add(panelId)
          if (activateExistingFilePanel(api, normalizedPath, normalizeUiFilesystem(request.filesystem), resolved.component, params)) return ok()
          if (!activateDockviewPanel({
            id: panelId,
            component: resolved.component,
            title: resolved.title ?? normalizedPath.split("/").pop() ?? normalizedPath,
            params,
          })) return err("SURFACE_UNAVAILABLE", "surface failed to activate the requested file panel")
          return ok()
        }

        const existing = findOpenFilePanel(api, normalizedPath, request.filesystem)
        if (existing) {
          try {
            existing.api.setActive()
            return ok()
          } catch {
            return err("SURFACE_UNAVAILABLE", "surface failed to reactivate the requested file panel")
          }
        }
        return err("NO_SURFACE_RESOLVER", `no registered surface resolver handles ${normalizedPath}`)
      } catch (error) {
        return error instanceof SurfaceUnavailableError
          ? err("SURFACE_UNAVAILABLE", error.message)
          : err(
              "INVALID_SURFACE_PATH",
              error instanceof Error ? error.message : "failed to open file",
            )
      }
    },
    [activateDockviewPanel, activateExistingFilePanel],
  )

  const bridge = useMemo<WorkspaceBridge>(() => {
    return {
      getOpenPanels: () => getBridgeState().panels,
      getActiveFile: () => getBridgeState().activeFile,
      getDirtyFiles: () => [],
      getVisibleFiles: () => getBridgeState().visibleFiles,
      openFile,
      openPanel: async (config) => {
        if (!apiRef.current) return err("not-ready", "surface not ready")
        try {
          openPanelSync(config)
          return ok()
        } catch (error) {
          return error instanceof SurfaceUnavailableError
            ? err("SURFACE_UNAVAILABLE", error.message)
            : err("INVALID_PANEL", error instanceof Error ? error.message : "failed to open panel")
        }
      },
      closePanel: async (id) => {
        const api = apiRef.current
        if (!api) return err("not-ready", "surface not ready")
        const panel = api.getPanel(id)
        if (!panel) return err("PANEL_NOT_FOUND", `panel "${id}" is not open`)
        panel.api.close()
        return ok()
      },
      closeWorkbenchLeftPane: async () => {
        collapseLeftBlock()
        return ok()
      },
      showNotification: async (msg, level = "info") => {
        emitBridgeEvent("notification:shown", { message: msg, level })
        return ok()
      },
      navigateToLine: async () => err("UNSUPPORTED_BRIDGE_OPERATION", "navigateToLine is not supported by the surface-backed file tree bridge"),
      expandToFile: async (path) => {
        expandToFileSync(path)
        return ok()
      },
      markDirty: () => { throw new Error("markDirty is not supported by the surface-backed file tree bridge") },
      markClean: () => { throw new Error("markClean is not supported by the surface-backed file tree bridge") },
      subscribe: <K extends keyof BridgeEventMap>(event: K, handler: (data: BridgeEventMap[K]) => void) => {
        let handlers = bridgeEventHandlersRef.current.get(event)
        if (!handlers) {
          handlers = new Set()
          bridgeEventHandlersRef.current.set(event, handlers)
        }
        handlers.add(handler as (data: BridgeEventMap[keyof BridgeEventMap]) => void)
        if (event === "tree:expand" && pendingTreeExpandRef.current) {
          handler({ path: pendingTreeExpandRef.current } as BridgeEventMap[K])
          pendingTreeExpandRef.current = null
        }
        return () => {
          handlers?.delete(handler as (data: BridgeEventMap[keyof BridgeEventMap]) => void)
        }
      },
      select: (selector, handler) => {
        const wrapped = (state: WorkspaceState) => handler(selector(state))
        bridgeSelectorsRef.current.add(wrapped)
        wrapped(getBridgeState())
        return () => {
          bridgeSelectorsRef.current.delete(wrapped)
        }
      },
    }
  }, [collapseLeftBlock, emitBridgeEvent, expandToFileSync, getBridgeState, openFile, openPanelSync])

  const startDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (leftBlockCollapsed || !sourcePaneOpen) return
      e.preventDefault()
      const target = e.currentTarget
      target.setPointerCapture(e.pointerId)
      dragStateRef.current = { startX: e.clientX, startWidth: sidebarWidth }
    },
    [leftBlockCollapsed, sourcePaneOpen, sidebarWidth],
  )

  const onDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const state = dragStateRef.current
      if (!state) return
      const delta = e.clientX - state.startX
      const next = Math.max(sidebarMinWidth, Math.min(sidebarMaxWidth, state.startWidth + delta))
      setSidebarWidth(next)
    },
    [sidebarMinWidth, sidebarMaxWidth],
  )

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStateRef.current) return
    dragStateRef.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
  }, [])

  const onHandleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (leftBlockCollapsed || !sourcePaneOpen) return
      const step = e.shiftKey ? 32 : 16
      if (e.key === "ArrowLeft") {
        e.preventDefault()
        setSidebarWidth((w) => Math.max(sidebarMinWidth, w - step))
      } else if (e.key === "ArrowRight") {
        e.preventDefault()
        setSidebarWidth((w) => Math.min(sidebarMaxWidth, w + step))
      } else if (e.key === "Home") {
        e.preventDefault()
        setSidebarWidth(sidebarMinWidth)
      } else if (e.key === "End") {
        e.preventDefault()
        setSidebarWidth(sidebarMaxWidth)
      }
    },
    [leftBlockCollapsed, sourcePaneOpen, sidebarMinWidth, sidebarMaxWidth],
  )

  // Persist sidebar width. (The on-mount READ moved into the useState lazy
  // initializer so the first render is already hydrated — without that, the
  // write effect fires once with the default and clobbers the persisted
  // value before the read effect's setState rolls through.)
  useEffect(() => {
    if (!storageKey) return
    try {
      localStorage.setItem(`${storageKey}:sidebarWidth`, String(sidebarWidth))
    } catch {}
  }, [storageKey, sidebarWidth])

  useEffect(() => {
    if (!storageKey) return
    try {
      localStorage.setItem(`${storageKey}:leftState`, JSON.stringify(leftState))
    } catch {}
  }, [leftState, storageKey])

  const workbenchRailWidth = 44
  const workbenchSidebarWidth = leftBlockCollapsed ? 0 : sourcePaneOpen ? sidebarWidth : workbenchRailWidth

  return (
    <div
      ref={containerRef}
      data-boring-workspace-part="surface"
      className={cn("flex h-full min-h-0 w-full bg-background", className)}
      data-testid="surface-shell"
    >
      <aside
        data-boring-workspace-part="surface-sidebar"
        data-boring-state={leftBlockCollapsed ? "collapsed" : sourcePaneOpen ? "expanded" : "rail"}
        className="relative z-10 flex h-full min-h-0 flex-col overflow-hidden"
        style={{ width: workbenchSidebarWidth, minWidth: workbenchSidebarWidth, maxWidth: workbenchSidebarWidth }}
        aria-label="Workbench left pane"
      >
        {!leftBlockCollapsed && (
          <WorkbenchLeftPane
            rootDir={rootDir}
            bridge={bridge}
            defaultTab={defaultLeftTab}
            activeTab={activeLeftTab}
            activePanelId={activeSurfacePanelId}
            onActiveTabChange={setActiveLeftTab}
            revealFileTreeRequest={fileTreeRevealRequest}
            onOpenPanel={openPanelSync}
            onReloadAgentPlugins={onReloadAgentPlugins}
            onCollapse={collapseLeftBlock}
            onExpand={openSourcePane}
            onCloseSourcePane={closeSourcePane}
            railOnly={!sourcePaneOpen}
          />
        )}
      </aside>

      {!leftBlockCollapsed && sourcePaneOpen && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          tabIndex={0}
          onPointerDown={startDrag}
          onPointerMove={onDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onHandleKeyDown}
          className={cn(
            "relative w-px shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-primary/40",
            "focus-visible:outline-none focus-visible:bg-primary/50",
          )}
        >
          <span aria-hidden="true" className="absolute inset-y-0 -left-1.5 -right-1.5" />
        </div>
      )}

      <div className="relative min-w-0 flex-1">
        <div
          data-boring-workspace-part="surface-tabs"
          data-boring-state={leftBlockCollapsed ? "collapsed" : sourcePaneOpen ? "expanded" : "rail"}
          className="workbench-dockview h-full"
          data-collapsed-sources={!sourcePaneOpen ? "true" : undefined}
          data-left-block-collapsed={leftBlockCollapsed ? "true" : undefined}
        >
          <ArtifactSurfacePane
            storageKey={storageKey}
            instanceKey={dockviewGeneration}
            onReady={handleReady}
            onUnavailable={handleUnavailable}
            allowedPanels={allowedPanels}
          />
        </div>
        {/* Header overlays — always reachable, including existing/single-tab
            dockview groups where header action slots can be squeezed/hidden.
            zIndex must beat dockview's "open tabs" overflow popover (built by
            PopupService at --dv-overlay-z-index 999, sometimes doubled to ~1998)
            so the close-workspace control on the right edge is never covered by
            an open dropdown menu. */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between"
          style={{ height: 44, zIndex: 2000 }}
        >
          <div className="self-start pl-1.5 pt-2">
            {leftBlockCollapsed && (
              <PaneCollapseButton label="Show workspace menu" side="right" onClick={expandLeftBlock}>
                <PanelLeftOpen className="h-4 w-4" strokeWidth={1.75} />
              </PaneCollapseButton>
            )}
          </div>
          {showCloseAction && onClose && <WorkbenchCloseAction onClose={onClose} />}
        </div>
        <EmptyWorkbenchOverlay api={api} />
      </div>
    </div>
  )
}

function WorkbenchCloseAction({ onClose }: { onClose: () => void }) {
  return (
    <IconButton
      type="button"
      variant="ghost"
      size="icon-xs"
      onClick={onClose}
      className="pointer-events-auto mx-1"
      aria-label="Close workbench"
      title="Close workbench (⌘2)"
    >
      <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
    </IconButton>
  )
}

function EmptyWorkbenchOverlay({ api }: { api: DockviewApi | null }) {
  const [empty, setEmpty] = useState(true)
  useEffect(() => {
    if (!api) return
    const sync = () => setEmpty(api.panels.length === 0)
    sync()
    const d1 = api.onDidAddPanel(sync)
    const d2 = api.onDidRemovePanel(sync)
    return () => {
      d1.dispose()
      d2.dispose()
    }
  }, [api])
  if (!empty) return null
  return (
    <>
      {/* Fallback top bar so icons are always visible even with no tabs */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-0.5 border-b border-[color:oklch(from_var(--border)_l_c_h/0.4)] bg-background px-1" style={{ height: 44 }}>
        <div className="flex-1" />
      </div>

      <div className="pointer-events-none absolute inset-0 flex flex-col items-start justify-center gap-2 px-6 pt-12 pb-10">
        <div className="flex items-center gap-2 text-[11px] font-medium tracking-tight text-muted-foreground/75">
          <span className="inline-block h-px w-3 bg-[color:var(--accent)]" aria-hidden="true" />
          Workbench
        </div>
        <div className="text-[15px] font-medium tracking-tight text-foreground">Nothing open yet</div>
        <p className="max-w-[280px] text-[12.5px] leading-relaxed text-muted-foreground/85">
          Open a source item, or let the agent produce an artifact here.
        </p>

      </div>
    </>
  )
}
