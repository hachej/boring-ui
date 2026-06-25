"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentType } from "react"
import type { DockviewPanelApi } from "dockview-react"
import { ChevronRight, FolderTree, Maximize2, MoreHorizontal, Plus } from "lucide-react"
import { ControlTooltip } from "../../components/ControlTooltip"
import { IconButton } from "@hachej/boring-ui-kit"
import { cn } from "../../lib/utils"
import type { WorkspaceBridge, CommandResult, BridgeEventMap } from "../../bridge/types"
import type { WorkspaceState, PanelState } from "../../store/types"
import { WorkbenchLeftPane } from "../workbench-left/WorkbenchLeftPane"
import { useRegistry, useSurfaceResolverRegistry } from "../../registry"
import type { SurfaceOpenRequest } from "../../../shared/types/surface"
import type { PaneProps } from "../../../shared/types/panel"
import { WORKSPACE_OPEN_PATH_SURFACE_KIND } from "../../../shared/types/surface"
import {
  findOpenFilePanel,
  normalizeSurfaceOpenRequest,
  normalizeWorkbenchPath,
  surfacePanelId,
} from "./surfaceShellHelpers"
export { normalizeSurfaceOpenRequest, resolvePanelForPath } from "./surfaceShellHelpers"

export interface SurfaceShellTab {
  id: string
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

interface WorkspacePaneTab extends OpenPanelConfig {
  kind: "files" | "plugin"
  filetreeOpen?: boolean
}

export interface SurfaceShellApi {
  /** Open a file in the workbench. Idempotent — re-activates an existing pane for the same path. */
  openFile: (path: string) => void
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
  /** Called once when the surface dockview becomes ready, with an imperative handle. */
  onReady?: (api: SurfaceShellApi) => void
  /** Called on every panel add/remove/active-change with the current snapshot. */
  onChange?: (snapshot: SurfaceShellSnapshot) => void
  /** Optional close action for hosts that model the workbench as collapsible. */
  onClose?: () => void
  fullscreen?: boolean
  onToggleFullscreen?: () => void
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
  className?: string
}

const COLLAPSED_WIDTH = 40
const FILE_BACKED_PARAM = "__boringFileBacked"
const WORKSPACE_TABS_STORAGE_VERSION = 1

interface StoredWorkspaceTabsEnvelope {
  v: number
  tabs: WorkspacePaneTab[]
  activeTab: string | null
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
): Record<string, unknown> {
  return {
    ...(params ?? {}),
    path: typeof params?.path === "string" ? params.path : path,
    [FILE_BACKED_PARAM]: true,
  }
}

function ok(): CommandResult {
  return { seq: ++seqCounter, status: "ok" }
}
function err(code: string, message: string): CommandResult {
  return { seq: ++seqCounter, status: "error", error: { code, message } }
}

function workspaceTabsStorageKey(storageKey: string): string {
  return `${storageKey}:workspaceTabs`
}

function defaultWorkspaceTabs(): WorkspacePaneTab[] {
  return [{
    id: "files",
    component: "__files-home",
    title: "Files",
    kind: "files" as const,
    filetreeOpen: true,
  }]
}

function tabsFromInitialPanels(initialPanels: SurfaceShellProps["initialPanels"]): WorkspacePaneTab[] {
  const tabs = (initialPanels ?? []).map((panel) => ({
    id: panel.id,
    component: panel.component,
    title: panel.title ?? panel.id,
    params: panel.params,
    kind: "plugin" as const,
    filetreeOpen: false,
  }))
  return tabs.length > 0 ? tabs : defaultWorkspaceTabs()
}

function readStoredWorkspaceTabs(storageKey: string | undefined): StoredWorkspaceTabsEnvelope | null {
  if (!storageKey) return null
  try {
    const raw = localStorage.getItem(workspaceTabsStorageKey(storageKey))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredWorkspaceTabsEnvelope>
    if (parsed.v !== WORKSPACE_TABS_STORAGE_VERSION || !Array.isArray(parsed.tabs)) return null
    const tabs = parsed.tabs.filter((tab): tab is WorkspacePaneTab => (
      typeof tab === "object" && tab !== null &&
      typeof tab.id === "string" && tab.id.length > 0 &&
      typeof tab.component === "string" && tab.component.length > 0 &&
      (tab.kind === "files" || tab.kind === "plugin")
    ))
    if (tabs.length === 0) return null
    const activeTab = typeof parsed.activeTab === "string" && tabs.some((tab) => tab.id === parsed.activeTab)
      ? parsed.activeTab
      : tabs[0]?.id ?? null
    return { v: WORKSPACE_TABS_STORAGE_VERSION, tabs, activeTab }
  } catch {
    return null
  }
}

function writeStoredWorkspaceTabs(storageKey: string | undefined, tabs: WorkspacePaneTab[], activeTab: string | null): void {
  if (!storageKey) return
  try {
    if (tabs.length === 0) {
      localStorage.removeItem(workspaceTabsStorageKey(storageKey))
      return
    }
    const safeActive = activeTab && tabs.some((tab) => tab.id === activeTab) ? activeTab : tabs[0]?.id ?? null
    localStorage.setItem(
      workspaceTabsStorageKey(storageKey),
      JSON.stringify({ v: WORKSPACE_TABS_STORAGE_VERSION, tabs, activeTab: safeActive }),
    )
  } catch {}
}

const noop = () => {}
const noopEvent = () => ({ dispose: noop })

function createWorkspaceTabContainerApi(
  openPanel: (config: OpenPanelConfig) => void,
  closePanel: (id: string) => void,
): PaneProps["containerApi"] {
  return {
    width: typeof window === "undefined" ? 0 : window.innerWidth,
    height: typeof window === "undefined" ? 0 : window.innerHeight,
    minimumHeight: 0,
    maximumHeight: Infinity,
    minimumWidth: 0,
    maximumWidth: Infinity,
    activePanel: undefined,
    panels: [],
    groups: [],
    activeGroup: undefined,
    addPanel: openPanel,
    addGroup: noop,
    removePanel: (panel: { id?: string }) => {
      if (panel?.id) closePanel(panel.id)
    },
    removeGroup: noop,
    getPanel: () => undefined,
    getGroup: () => undefined,
    moveGroupOrPanel: noop,
    fromJSON: noop,
    toJSON: () => ({}),
    clear: noop,
    focus: noop,
    layout: noop,
    onDidLayoutChange: noopEvent,
    onDidLayoutFromJSON: noopEvent,
    onDidAddPanel: noopEvent,
    onDidRemovePanel: noopEvent,
    onDidActivePanelChange: noopEvent,
    onDidAddGroup: noopEvent,
    onDidRemoveGroup: noopEvent,
    onDidActiveGroupChange: noopEvent,
    onUnhandledDragOverEvent: noopEvent,
    onDidDrop: noopEvent,
    onWillDrop: noopEvent,
    onWillDragGroup: noopEvent,
    onWillDragPanel: noopEvent,
    onDidActivePanelChange_: noopEvent,
  } as unknown as PaneProps["containerApi"]
}

export function SurfaceShell({
  rootDir = "",
  sidebarDefaultWidth = 240,
  sidebarMinWidth = 180,
  sidebarMaxWidth = 480,
  storageKey,
  onReady,
  onChange,
  onClose,
  fullscreen = false,
  onToggleFullscreen,
  extraPanels,
  defaultLeftTab,
  onReloadAgentPlugins,
  initialPanels,
  className,
}: SurfaceShellProps) {
  // Lazy initializers read persisted state SYNCHRONOUSLY on first mount so
  // the write effect (which depends on `sidebarWidth` / `collapsed`) doesn't
  // fire on the next render with the unhydrated default and overwrite the
  // saved value. Without this, `localStorage.setItem` runs once with the
  // default, then the read effect's setState triggers a re-render, then the
  // write effect runs again with the right value — but the brief default
  // write leaks if any code reads localStorage in between.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (!storageKey) return false
    try {
      return localStorage.getItem(`${storageKey}:sidebarCollapsed`) === "1"
    } catch {
      return false
    }
  })
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
  const containerRef = useRef<HTMLDivElement | null>(null)
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const [fileTreeRevealRequest, setFileTreeRevealRequest] = useState<{ path: string; seq: number } | null>(null)
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady
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
  const collapsedRef = useRef(collapsed)
  collapsedRef.current = collapsed
  const autoCollapsedByRef = useRef<string | null>(null)
  const allowedPanels = useMemo(() => {
    const ids = new Set<string>()
    for (const panel of panelRegistrySnapshot) {
      if (panel.placement === "center") ids.add(panel.id)
    }
    for (const id of extraPanels ?? []) {
      ids.add(id)
    }
    return [...ids]
  }, [extraPanels, panelRegistrySnapshot])
  const [workspaceTabs, setWorkspaceTabs] = useState<WorkspacePaneTab[]>(() => (
    readStoredWorkspaceTabs(storageKey)?.tabs ?? tabsFromInitialPanels(initialPanels)
  ))
  const [activeWorkspaceTabId, setActiveWorkspaceTabId] = useState<string | null>(() => {
    const stored = readStoredWorkspaceTabs(storageKey)
    return stored?.activeTab ?? tabsFromInitialPanels(initialPanels)[0]?.id ?? null
  })
  const [pluginMenuOpen, setPluginMenuOpen] = useState(false)
  const workspaceTabsRef = useRef<WorkspacePaneTab[]>([])
  const activeWorkspaceTabIdRef = useRef<string | null>(null)
  workspaceTabsRef.current = workspaceTabs
  activeWorkspaceTabIdRef.current = activeWorkspaceTabId
  const pluginMenuEntries = useMemo(() => {
    const entries: Array<{ id: string; title: string; component?: string; kind: "files" | "panel"; multiple?: boolean }> = [
      { id: "files", title: "File", kind: "files", multiple: true },
    ]
    for (const panel of panelRegistrySnapshot) {
      if (panel.placement === "center") {
        entries.push({ id: panel.id, title: panel.title, component: panel.id, kind: "panel", multiple: false })
      }
    }
    return entries
  }, [panelRegistrySnapshot])
  const activeWorkspaceTab = useMemo(
    () => workspaceTabs.find((tab) => tab.id === activeWorkspaceTabId) ?? workspaceTabs[0] ?? null,
    [activeWorkspaceTabId, workspaceTabs],
  )
  const openWorkspaceTab = useCallback((tab: WorkspacePaneTab) => {
    setWorkspaceTabs((current) => {
      const existing = current.findIndex((candidate) => candidate.id === tab.id)
      if (existing >= 0) {
        const next = [...current]
        next[existing] = { ...next[existing]!, ...tab }
        return next
      }
      return [...current, tab]
    })
    setActiveWorkspaceTabId(tab.id)
    setPluginMenuOpen(false)
  }, [])

  const openFileSync = useCallback((path: string) => {
    const normalizedPath = normalizeWorkbenchPath(path)
    const request: SurfaceOpenRequest = {
      kind: WORKSPACE_OPEN_PATH_SURFACE_KIND,
      target: normalizedPath,
    }
    const resolved = surfaceResolverRegistryRef.current.resolve(request)
    if (!resolved) {
      console.warn(`[SurfaceShell] openFile: no surface resolver matched "${normalizedPath}"`)
      return false
    }
    if (!panelRegistryRef.current.has(resolved.component)) {
      console.warn(`[SurfaceShell] openFile: resolver returned unknown panel "${resolved.component}" for "${normalizedPath}"`)
      return false
    }
    const panelId = surfacePanelId(request, resolved)
    fileBackedPanelIdsRef.current.add(panelId)
    const params = fileBackedParams(resolved.params, normalizedPath)
    openWorkspaceTab({
      id: panelId,
      component: resolved.component,
      title: resolved.title ?? normalizedPath.split("/").pop() ?? normalizedPath,
      params,
      kind: "files",
      filetreeOpen: false,
    })
    return true
  }, [openWorkspaceTab])

  const openSurfaceSync = useCallback((request: SurfaceOpenRequest) => {
    const normalizedRequest = normalizeSurfaceOpenRequest(request)
    const resolved = surfaceResolverRegistryRef.current.resolve(normalizedRequest)
    if (!resolved) {
      console.warn(`[SurfaceShell] openSurface: no resolver matched kind="${normalizedRequest.kind}" target="${normalizedRequest.target}"`)
      return false
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
    const baseParams = normalizedRequest.kind === WORKSPACE_OPEN_PATH_SURFACE_KIND
      ? fileBackedParams(resolved.params, normalizedRequest.target)
      : resolved.params
    const resolvedParams = closeWorkbenchOnDone && onCloseRef.current
      ? { ...(baseParams ?? {}), __closeWorkbenchOnDone: onCloseRef.current }
      : baseParams
    openWorkspaceTab({
      id: panelId,
      component: resolved.component,
      title: resolved.title ?? normalizedRequest.target,
      params: resolvedParams,
      kind: normalizedRequest.kind === WORKSPACE_OPEN_PATH_SURFACE_KIND ? "files" : "plugin",
      filetreeOpen: false,
    })
    return true
  }, [openWorkspaceTab])

  const openPanelSync = useCallback((config: OpenPanelConfig) => {
    const registry = panelRegistryRef.current
    if (!registry.has(config.component)) {
      const known = registry.list().map((p) => p.id).join(", ")
      throw new Error(
        `openPanel: unknown component "${config.component}". Registered panels: [${known}]. ` +
          `Add the component to WorkspaceProvider's "panels" prop, or pick one of the registered ids.`,
      )
    }
    const registeredPanel = registry.get(config.component)
    openWorkspaceTab({
      id: config.id,
      component: config.component,
      title: config.title ?? registeredPanel?.title ?? config.id,
      params: config.params,
      kind: "plugin",
      filetreeOpen: false,
    })
  }, [openWorkspaceTab])

  const getSnapshot = useCallback((): SurfaceShellSnapshot => {
    const tabs = workspaceTabsRef.current
    return {
      openTabs: tabs.map((tab) => ({ id: tab.id, title: tab.title ?? tab.id, params: tab.params })),
      activeTab: activeWorkspaceTabIdRef.current,
    }
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
    setCollapsed(false)
    if (emitBridgeEvent("tree:expand", { path: normalizedPath })) {
      pendingTreeExpandRef.current = null
    }
  }, [emitBridgeEvent])

  const localSurfaceApi = useMemo<SurfaceShellApi>(() => ({
    openFile: openFileSync,
    openSurface: openSurfaceSync,
    openPanel: openPanelSync,
    closeWorkbenchLeftPane: () => {
      autoCollapsedByRef.current = null
      setCollapsed(true)
      const activeId = activeWorkspaceTabIdRef.current
      if (activeId) {
        setWorkspaceTabs((prev) => prev.map((tab) => (
          tab.id === activeId && tab.kind === "files"
            ? { ...tab, filetreeOpen: false }
            : tab
        )))
      }
    },
    expandToFile: expandToFileSync,
    getSnapshot,
  }), [expandToFileSync, getSnapshot, openFileSync, openPanelSync, openSurfaceSync])

  const getBridgeState = useCallback((): WorkspaceState => {
    const tabs = workspaceTabsRef.current
    const activePanel = activeWorkspaceTabIdRef.current
    const panels: PanelState[] = tabs.map((tab) => ({
      id: tab.id,
      component: tab.component,
      params: tab.params,
    }))
    const activePanelState = tabs.find((tab) => tab.id === activePanel)
    const activeFile = activePanelState?.kind === "files" && typeof activePanelState.params?.path === "string"
      ? activePanelState.params.path
      : null
    return {
      hydrationComplete: true,
      layout: null,
      sidebar: { collapsed: false, width: sidebarDefaultWidth },
      panelSizes: {},
      preferences: { theme: "dark" },
      panels,
      activePanel,
      activeFile,
      visibleFiles: tabs
        .filter((tab) => tab.kind === "files" && typeof tab.params?.path === "string")
        .map((tab) => tab.params!.path as string),
      dirtyFiles: {},
      notifications: [],
    }
  }, [sidebarDefaultWidth])

  const emitBridgeState = useCallback(() => {
    const state = getBridgeState()
    for (const handler of bridgeSelectorsRef.current) {
      handler(state)
    }
  }, [getBridgeState])

  useEffect(() => {
    onReadyRef.current?.(localSurfaceApi)
  }, [localSurfaceApi])

  useEffect(() => {
    const snapshot = getSnapshot()
    onChangeRef.current?.(snapshot)
    emitBridgeState()
  }, [activeWorkspaceTabId, emitBridgeState, getSnapshot, workspaceTabs])

  const openFile = useCallback(
    async (path: string): Promise<CommandResult> => {
      try {
        if (!openFileSync(path)) {
          return err("OPEN_FILE", `No surface resolver could open "${path}"`)
        }
        return ok()
      } catch (error) {
        return err(
          "INVALID_SURFACE_PATH",
          error instanceof Error ? error.message : "failed to open file",
        )
      }
    },
    [openFileSync],
  )

  const bridge = useMemo<WorkspaceBridge>(() => {
    return {
      getOpenPanels: () => getBridgeState().panels,
      getActiveFile: () => getBridgeState().activeFile,
      getDirtyFiles: () => [],
      getVisibleFiles: () => getBridgeState().visibleFiles,
      openFile,
      openPanel: async (config) => {
        try {
          openPanelSync(config)
          return ok()
        } catch (error) {
          return err("OPEN_PANEL", error instanceof Error ? error.message : "failed to open panel")
        }
      },
      closePanel: async (id) => {
        setWorkspaceTabs((current) => current.filter((tab) => tab.id !== id))
        if (activeWorkspaceTabIdRef.current === id) {
          const next = workspaceTabsRef.current.find((tab) => tab.id !== id) ?? null
          setActiveWorkspaceTabId(next?.id ?? null)
        }
        return ok()
      },
      closeWorkbenchLeftPane: async () => {
        autoCollapsedByRef.current = null
        setCollapsed(true)
        const activeId = activeWorkspaceTabIdRef.current
        if (activeId) {
          setWorkspaceTabs((prev) => prev.map((tab) => (
            tab.id === activeId && tab.kind === "files"
              ? { ...tab, filetreeOpen: false }
              : tab
          )))
        }
        return ok()
      },
      showNotification: async () => ok(),
      navigateToLine: async () => ok(),
      expandToFile: async (path) => {
        expandToFileSync(path)
        return ok()
      },
      markDirty: () => {},
      markClean: () => {},
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
  }, [expandToFileSync, openFile, getBridgeState])

  const startDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (collapsed) return
      e.preventDefault()
      const target = e.currentTarget
      target.setPointerCapture(e.pointerId)
      dragStateRef.current = { startX: e.clientX, startWidth: sidebarWidth }
    },
    [collapsed, sidebarWidth],
  )

  const onDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const state = dragStateRef.current
      if (!state) return
      const delta = e.clientX - state.startX
      const next = Math.max(sidebarMinWidth, Math.min(sidebarMaxWidth, state.startWidth - delta))
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
      if (collapsed) return
      const step = e.shiftKey ? 32 : 16
      if (e.key === "ArrowLeft") {
        e.preventDefault()
        setSidebarWidth((w) => Math.min(sidebarMaxWidth, w + step))
      } else if (e.key === "ArrowRight") {
        e.preventDefault()
        setSidebarWidth((w) => Math.max(sidebarMinWidth, w - step))
      } else if (e.key === "Home") {
        e.preventDefault()
        setSidebarWidth(sidebarMinWidth)
      } else if (e.key === "End") {
        e.preventDefault()
        setSidebarWidth(sidebarMaxWidth)
      }
    },
    [collapsed, sidebarMinWidth, sidebarMaxWidth],
  )

  useEffect(() => {
    const stored = readStoredWorkspaceTabs(storageKey)
    const tabs = stored?.tabs ?? tabsFromInitialPanels(initialPanels)
    setWorkspaceTabs(tabs)
    setActiveWorkspaceTabId(stored?.activeTab ?? tabs[0]?.id ?? null)
  }, [storageKey])

  useEffect(() => {
    writeStoredWorkspaceTabs(storageKey, workspaceTabs, activeWorkspaceTabId)
  }, [activeWorkspaceTabId, storageKey, workspaceTabs])

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
      localStorage.setItem(`${storageKey}:sidebarCollapsed`, collapsed ? "1" : "0")
    } catch {}
  }, [storageKey, collapsed])

  const panelComponents = useMemo(() => panelRegistry.getComponents(), [panelRegistry, panelRegistrySnapshot])
  const activeComponent = activeWorkspaceTab ? panelComponents[activeWorkspaceTab.component] ?? null : null
  const activeFilePath = activeWorkspaceTab?.kind === "files" && typeof activeWorkspaceTab.params?.path === "string"
    ? activeWorkspaceTab.params.path
    : null
  const updateWorkspaceTab = useCallback((id: string, patch: Partial<WorkspacePaneTab>) => {
    setWorkspaceTabs((current) => current.map((tab) => tab.id === id ? { ...tab, ...patch } : tab))
  }, [])
  const closeWorkspaceTab = useCallback((id: string) => {
    setWorkspaceTabs((current) => {
      const next = current.filter((tab) => tab.id !== id)
      if (activeWorkspaceTabIdRef.current === id) {
        setActiveWorkspaceTabId(next[0]?.id ?? null)
      }
      return next
    })
  }, [])
  const openPluginEntry = useCallback((entry: { id: string; title: string; component?: string; kind: "files" | "panel"; multiple?: boolean }) => {
    setPluginMenuOpen(false)
    if (entry.kind === "files") {
      openWorkspaceTab({
        id: `files:${Date.now()}`,
        component: "__files-home",
        title: "Files",
        params: {},
        kind: "files",
        filetreeOpen: true,
      })
      return
    }
    if (!entry.component) return
    if (entry.multiple === false) {
      const existing = workspaceTabsRef.current.find((tab) => tab.component === entry.component)
      if (existing) {
        setActiveWorkspaceTabId(existing.id)
        return
      }
    }
    openWorkspaceTab({
      id: entry.multiple === false ? entry.component : `${entry.component}:${Date.now()}`,
      component: entry.component,
      title: entry.title,
      params: {},
      kind: "plugin",
      filetreeOpen: false,
    })
  }, [openWorkspaceTab])
  const workspaceTabContainerApi = useMemo(
    () => createWorkspaceTabContainerApi(openPanelSync, closeWorkspaceTab),
    [closeWorkspaceTab, openPanelSync],
  )

  return (
    <div
      ref={containerRef}
      data-boring-workspace-part="surface"
      data-boring-surface-mode="workspace-tabs"
      className={cn("flex h-full min-h-0 w-full flex-col bg-background", className)}
      data-testid="surface-shell"
    >
      <WorkspaceSurfaceTopBar
        tabs={workspaceTabs}
        activeTabId={activeWorkspaceTab?.id ?? null}
        activePath={activeFilePath}
        filetreeOpen={Boolean(activeWorkspaceTab?.kind === "files" && activeWorkspaceTab.filetreeOpen)}
        pluginMenuOpen={pluginMenuOpen}
        pluginEntries={pluginMenuEntries}
        onActivateTab={setActiveWorkspaceTabId}
        onCloseTab={closeWorkspaceTab}
        onTogglePluginMenu={() => setPluginMenuOpen((open) => !open)}
        onOpenPlugin={openPluginEntry}
        onToggleFiletree={() => {
          if (!activeWorkspaceTab || activeWorkspaceTab.kind !== "files") return
          updateWorkspaceTab(activeWorkspaceTab.id, { filetreeOpen: !activeWorkspaceTab.filetreeOpen })
        }}
        fullscreen={fullscreen}
        onToggleFullscreen={onToggleFullscreen}
        onClose={onClose}
      />

      <div className="min-h-0 flex-1">
        {!activeWorkspaceTab ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Open a workspace tab with +
          </div>
        ) : (
          <div className="flex h-full min-h-0 w-full">
            <div className="min-w-0 flex-1">
              {activeComponent ? (
                <WorkspacePaneHost
                  tab={activeWorkspaceTab}
                  component={activeComponent}
                  containerApi={workspaceTabContainerApi}
                  onParamsChange={(params) => updateWorkspaceTab(activeWorkspaceTab.id, { params })}
                  onTitleChange={(title) => updateWorkspaceTab(activeWorkspaceTab.id, { title })}
                  onClose={() => closeWorkspaceTab(activeWorkspaceTab.id)}
                />
              ) : activeWorkspaceTab.component === "__files-home" ? (
                <FilesHomePane />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Missing plugin panel</div>
              )}
            </div>
            {activeWorkspaceTab.kind === "files" && activeWorkspaceTab.filetreeOpen ? (
              <aside
                data-boring-workspace-part="surface-sidebar"
                data-boring-state="expanded"
                className="flex h-full min-h-0 flex-col border-l border-border"
                style={{ width: sidebarWidth, minWidth: sidebarWidth, maxWidth: sidebarWidth }}
                aria-label="Files"
              >
                <WorkbenchLeftPane
                  rootDir={rootDir}
                  bridge={bridge}
                  defaultTab={defaultLeftTab}
                  revealFileTreeRequest={fileTreeRevealRequest}
                  onOpenPanel={openPanelSync}
                  onReloadAgentPlugins={onReloadAgentPlugins}
                />
              </aside>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}

function WorkspaceSurfaceTopBar({
  tabs,
  activeTabId,
  activePath,
  filetreeOpen,
  pluginMenuOpen,
  pluginEntries,
  onActivateTab,
  onCloseTab,
  onTogglePluginMenu,
  onOpenPlugin,
  onToggleFiletree,
  fullscreen,
  onToggleFullscreen,
  onClose,
}: {
  tabs: WorkspacePaneTab[]
  activeTabId: string | null
  activePath: string | null
  filetreeOpen: boolean
  pluginMenuOpen: boolean
  pluginEntries: Array<{ id: string; title: string; component?: string; kind: "files" | "panel"; multiple?: boolean }>
  onActivateTab: (id: string) => void
  onCloseTab: (id: string) => void
  onTogglePluginMenu: () => void
  onOpenPlugin: (entry: { id: string; title: string; component?: string; kind: "files" | "panel"; multiple?: boolean }) => void
  onToggleFiletree: () => void
  fullscreen: boolean
  onToggleFullscreen?: () => void
  onClose?: () => void
}) {
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null
  const pathParts = activePath?.split("/").filter(Boolean) ?? []
  const breadcrumbs = pathParts.length > 0 ? pathParts : [activeTab?.title ?? "Workspace"]
  return (
    <div data-boring-workspace-part="surface-topbar" className="shrink-0 border-b border-border bg-background">
      <div className="relative flex h-11 items-center gap-1 px-3">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
          {tabs.map((tab) => {
            const active = tab.id === activeTabId
            return (
              <button
                key={tab.id}
                type="button"
                aria-label={`Activate ${tab.title ?? tab.id}`}
                aria-pressed={active}
                onClick={() => onActivateTab(tab.id)}
                className={`group flex h-8 max-w-[220px] items-center gap-2 rounded-xl px-3 text-sm transition-colors ${active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"}`}
              >
                <span className="truncate">{tab.title ?? tab.id}</span>
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={`Close ${tab.title ?? tab.id}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    onCloseTab(tab.id)
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return
                    event.preventDefault()
                    event.stopPropagation()
                    onCloseTab(tab.id)
                  }}
                  className="grid size-4 place-items-center rounded-full text-muted-foreground opacity-80 hover:bg-background hover:text-foreground"
                >
                  ×
                </span>
              </button>
            )
          })}
          <div className="relative shrink-0">
            <button
              type="button"
              aria-label="Add workspace tab"
              title="Add workspace tab"
              onClick={onTogglePluginMenu}
              className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Plus className="h-4 w-4" strokeWidth={1.75} />
            </button>
            {pluginMenuOpen ? (
              <div
                data-boring-workspace-part="plugin-tab-menu"
                className="absolute left-0 top-9 z-[2500] w-64 overflow-hidden rounded-xl border border-border bg-popover p-1.5 text-sm shadow-xl"
              >
                <div className="px-2 pb-1 pt-1 text-xs font-medium text-muted-foreground">New workspace tab</div>
                {pluginEntries.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    aria-label={`Create ${entry.title} tab`}
                    onClick={() => onOpenPlugin(entry)}
                    className="flex h-10 w-full items-center gap-2 rounded-lg px-2 text-left text-popover-foreground hover:bg-muted"
                  >
                    <span className="grid size-6 place-items-center rounded-md bg-muted text-muted-foreground">
                      {entry.kind === "files" ? <FolderTree className="h-4 w-4" strokeWidth={1.75} /> : <Plus className="h-4 w-4" strokeWidth={1.75} />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <button type="button" aria-label="Workspace options" className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
          <MoreHorizontal className="h-4 w-4" strokeWidth={1.75} />
        </button>
        {onToggleFullscreen ? (
          <IconButton
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onToggleFullscreen}
            className="pointer-events-auto mx-1"
            aria-label={fullscreen ? "Exit workspace fullscreen" : "Enter workspace fullscreen"}
            title={fullscreen ? "Exit workspace fullscreen" : "Enter workspace fullscreen"}
          >
            <Maximize2 className="h-4 w-4" strokeWidth={1.75} />
          </IconButton>
        ) : null}
        {onClose ? <WorkbenchCloseAction onClose={onClose} /> : null}
      </div>
      <div className="flex h-10 items-center gap-2 border-t border-border/60 px-3 text-sm">
        <div className="flex min-w-0 flex-1 items-center gap-1 text-muted-foreground">
          {breadcrumbs.map((part, index) => (
            <span key={`${part}-${index}`} className="contents">
              {index > 0 ? <span className="text-muted-foreground/60">›</span> : null}
              <span className={index === breadcrumbs.length - 1 ? "truncate font-medium text-foreground" : "truncate"}>{part}</span>
            </span>
          ))}
        </div>
        <button type="button" aria-label="Open externally" className="rounded-lg border border-border px-3 py-1 text-foreground hover:bg-muted">
          Open
        </button>
        {activeTab?.kind === "files" ? (
          <button
            type="button"
            aria-label={filetreeOpen ? "Hide file tree" : "Show file tree"}
            aria-pressed={filetreeOpen}
            onClick={onToggleFiletree}
            className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground aria-pressed:bg-muted aria-pressed:text-foreground"
          >
            <FolderTree className="h-4 w-4" strokeWidth={1.75} />
          </button>
        ) : null}
      </div>
    </div>
  )
}

function FilesHomePane() {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
      <div>
        <div className="text-base font-medium text-foreground">Files</div>
        <div className="mt-1">Pick a file from the file tree to open it in its own Files tab.</div>
      </div>
    </div>
  )
}

function WorkspacePaneHost({
  tab,
  component: Component,
  containerApi,
  onParamsChange,
  onTitleChange,
  onClose,
}: {
  tab: WorkspacePaneTab
  component: ComponentType<PaneProps<Record<string, unknown>>>
  containerApi: PaneProps<Record<string, unknown>>["containerApi"]
  onParamsChange: (params: Record<string, unknown>) => void
  onTitleChange: (title: string) => void
  onClose: () => void
}) {
  const [params, setParams] = useState<Record<string, unknown>>(tab.params ?? {})
  const paramsRef = useRef<Record<string, unknown>>(tab.params ?? {})
  const listenersRef = useRef(new Set<(event: { params: Record<string, unknown> }) => void>())
  const onParamsChangeRef = useRef(onParamsChange)
  const onTitleChangeRef = useRef(onTitleChange)
  const onCloseRef = useRef(onClose)
  onParamsChangeRef.current = onParamsChange
  onTitleChangeRef.current = onTitleChange
  onCloseRef.current = onClose

  const publishParams = useCallback((next: Record<string, unknown>) => {
    paramsRef.current = next
    setParams(next)
    onParamsChangeRef.current(next)
    for (const listener of [...listenersRef.current]) listener({ params: next })
  }, [])

  useEffect(() => {
    publishParams(tab.params ?? {})
  }, [publishParams, tab.id, tab.params])

  const panelApi = useMemo(() => ({
    id: tab.id,
    updateParameters(next: Record<string, unknown>) {
      publishParams({ ...paramsRef.current, ...next })
    },
    onDidParametersChange(listener: (event: { params: Record<string, unknown> }) => void) {
      listenersRef.current.add(listener)
      return { dispose: () => listenersRef.current.delete(listener) }
    },
    setActive() {},
    setTitle(title: string) {
      if (title === tab.title) return
      window.queueMicrotask(() => onTitleChangeRef.current(title))
    },
    close() {
      onCloseRef.current()
    },
  }) as unknown as DockviewPanelApi, [publishParams, tab.id, tab.title])

  return (
    <Component
      params={params}
      api={panelApi}
      containerApi={containerApi}
      className="h-full"
    />
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
