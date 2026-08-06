"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import type { DockviewApi } from "dockview-react"
import { PanelRightOpen } from "lucide-react"
import { IconButton } from "@hachej/boring-ui-kit"
import { cn } from "../../lib/utils"
import { ArtifactSurfacePane } from "./ArtifactSurfacePane"
import { WorkbenchHeaderActions } from "./WorkbenchHeaderActions"
import type { WorkspaceBridge, CommandResult, BridgeEventMap } from "../../bridge/types"
import type { WorkspaceState, PanelState } from "../../store/types"
import { WorkbenchLeftPane } from "../workbench-left/WorkbenchLeftPane"
import { useRegistry, useSurfaceResolverRegistry } from "../../registry"
import { normalizeUiFilesystem, type FilesystemId, type UiFileResource } from "../../../shared/types/filesystem"
import {
  closeWorkbenchPreview,
  isWorkbenchPreviewParams,
  pinnedWorkbenchParams,
  workbenchPreviewParams,
} from "../../dock/workbenchPreview"
import type { SurfaceOpenRequest } from "../../../shared/types/surface"
import type { FileTreeRevealRequest } from "../../../shared/plugins/types"
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

/** Result of openFileCore — the shared resolve/activate logic behind openFile
 * (sync + async) and openSurface's file-kind branch. Failure carries a stable
 * `code` so each caller can translate it into its own idiom (warn/err/throw). */
type OpenFileCoreResult =
  | { ok: true; path: string; filesystem: FilesystemId }
  | { ok: false; code: string; message: string; component?: string }

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
  /** Reveal/select a file-tree resource without opening an editor pane. */
  expandToFile: (path: string, options?: { filesystem?: FilesystemId }) => void
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
  /** Host-level collapsed mode: render only the persistent activity rail. */
  hostRailOnly?: boolean
  /** Mobile hosts already render their own level-one return bar. */
  hideLevelOneHeader?: boolean
  /** Expand the host-level workbench from its persistent activity rail. */
  onHostExpand?: () => void
  /** Whether the host has expanded the Workbench to fill the workspace. */
  hostFullscreen?: boolean
  /** Toggle between split-view and full-workspace Workbench layouts. */
  onHostToggleFullscreen?: () => void
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
  panel: Pick<PanelState, "id" | "params"> | null | undefined,
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

function fileBackedResource(
  panel: Pick<PanelState, "id" | "params"> | null | undefined,
  fileBackedPanelIds: ReadonlySet<string>,
): UiFileResource | null {
  const path = fileBackedPath(panel, fileBackedPanelIds)
  if (!path) return null
  const rawFilesystem = panel?.params?.filesystem
  return {
    path,
    filesystem: normalizeUiFilesystem(typeof rawFilesystem === "string" ? rawFilesystem : undefined),
  }
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

function prepareFilePreview(
  api: DockviewApi,
  path: string,
  filesystem: FilesystemId,
  fileBackedPanelIds: ReadonlySet<string>,
): void {
  const preview = api.panels.find((panel) => isWorkbenchPreviewParams(panel.params))
  if (!preview) return
  const resource = fileBackedResource(
    { id: preview.id, params: preview.params as Record<string, unknown> | undefined },
    fileBackedPanelIds,
  )
  const sameLogicalPath = resource?.path.replace(/^\/+/, "") === path.replace(/^\/+/, "")
  if (sameLogicalPath && resource?.filesystem !== filesystem) {
    preview.api.updateParameters(pinnedWorkbenchParams(preview.params as Record<string, unknown> | undefined))
    return
  }
  preview.api.close()
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
  onChange,
  onClose,
  hostRailOnly = false,
  hideLevelOneHeader = false,
  onHostExpand,
  hostFullscreen = false,
  onHostToggleFullscreen,
  showCloseAction = true,
  extraPanels,
  defaultLeftTab,
  onReloadAgentPlugins,
  initialPanels,
  className,
}: SurfaceShellProps) {
  // Persist and transition the left block as one state object. This avoids
  // illegal combinations like "hidden but source-open" and lets full-block
  // collapse restore the same active source (Files, Macro, …) on uncollapse.
  const [leftState, setLeftState] = useState<WorkbenchLeftState>(() => initialWorkbenchLeftState(storageKey, defaultLeftTab))
  // The far-right activity rail is structural and never disappears on desktop.
  // Legacy "hidden" state now means rail-only; hostRailOnly additionally hides
  // the editor and source content while preserving that same rail.
  const leftBlockCollapsed = false
  const sourcePaneOpen = !hostRailOnly && leftState.mode === "source"
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
  const [openSurfacePanels, setOpenSurfacePanels] = useState<Array<{ id: string; title: string }>>([])
  const [fileTreeRevealRequest, setFileTreeRevealRequest] = useState<FileTreeRevealRequest | null>(null)
  const fileTreeRevealSeqRef = useRef(0)
  useEffect(() => {
    if (!fileTreeRevealRequest) return
    setFileTreeRevealRequest((current) => current?.seq === fileTreeRevealRequest.seq ? null : current)
  }, [fileTreeRevealRequest])
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const bridgeSelectorsRef = useRef(new Set<(state: WorkspaceState) => void>())
  const fileBackedPanelIdsRef = useRef(new Set<string>())
  const pendingTreeExpandRef = useRef<{ path: string; filesystem?: FilesystemId } | null>(null)
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

  const openSourcePane = useCallback((tab?: string): void => {
    setLeftState((state) => openWorkbenchSource(state, tab))
    onHostExpand?.()
  }, [onHostExpand])

  const closeSourcePane = useCallback((): void => {
    setLeftState(showWorkbenchRail)
  }, [])

  const toggleHostWorkbench = useCallback((): void => {
    if (hostRailOnly) {
      onHostExpand?.()
      return
    }
    onCloseRef.current?.()
  }, [hostRailOnly, onHostExpand])

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
      if (config.params) existing.api.updateParameters(config.params)
      existing.api.setActive()
      applyPanelPlacementTransition(config.component)
      return true
    }
    applyPanelPlacementTransition(config.component)
    api.addPanel({
      id: config.id,
      component: config.component,
      title: config.title,
      params: config.params,
    })
    return true
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
    existing.api.updateParameters(params)
    existing.api.setActive()
    applyPanelPlacementTransition(component)
    return true
  }, [applyPanelPlacementTransition])

  const emitFileOpened = useCallback((path: string, options?: SurfaceShellOpenFileOptions) => {
    const handlers = bridgeEventHandlersRef.current.get("file:opened")
    if (!handlers || handlers.size === 0) return
    const payload: BridgeEventMap["file:opened"] = {
      path,
      mode: options?.mode ?? "edit",
      filesystem: normalizeUiFilesystem(options?.filesystem),
    }
    for (const handler of [...handlers]) handler(payload)
  }, [])

  const emitActiveFileOpened = useCallback((dockview: DockviewApi) => {
    const panel = dockview.activePanel
    const resource = fileBackedResource(
      panel ? { id: panel.id, params: panel.params as Record<string, unknown> | undefined } : null,
      fileBackedPanelIdsRef.current,
    )
    if (!resource) return
    const mode = panel?.params?.mode
    emitFileOpened(resource.path, {
      filesystem: resource.filesystem,
      ...(mode === "view" || mode === "edit" || mode === "diff" ? { mode } : {}),
    })
  }, [emitFileOpened])

  // Shared core for every "open a file-backed surface" path (sync openFile,
  // openSurface's file-kind branch, and the async openFile command). Resolves
  // the request, reuses/activates the matching panel, and is the single call
  // site for emitFileOpened — callers only decide how to surface a failure
  // (warn, return an err(), or throw).
  const openFileCore = useCallback((
    api: DockviewApi,
    path: string,
    options?: SurfaceShellOpenFileOptions & { extraParams?: Record<string, unknown> },
  ): OpenFileCoreResult => {
    const normalizedPath = normalizeWorkbenchPath(path)
    const filesystem = normalizeUiFilesystem(options?.filesystem)
    const request: SurfaceOpenRequest = {
      kind: WORKSPACE_OPEN_PATH_SURFACE_KIND,
      target: normalizedPath,
      filesystem,
    }
    const resolved = surfaceResolverRegistryRef.current.resolve(request)

    const finish = (): OpenFileCoreResult => {
      emitFileOpened(normalizedPath, { ...options, filesystem })
      return { ok: true, path: normalizedPath, filesystem }
    }

    if (resolved) {
      if (!panelRegistryRef.current.has(resolved.component)) {
        return {
          ok: false,
          code: "NO_SURFACE_PANEL",
          message: `surface resolver "${request.kind}" returned unknown panel "${resolved.component}" for "${normalizedPath}"`,
          component: resolved.component,
        }
      }
      const panelId = surfacePanelId(request, resolved)
      const params = {
        ...fileBackedParams(resolved.params, normalizedPath, { filesystem, mode: options?.mode }),
        ...options?.extraParams,
      }
      fileBackedPanelIdsRef.current.add(panelId)
      if (activateExistingFilePanel(api, normalizedPath, filesystem, resolved.component, params)) {
        return finish()
      }
      prepareFilePreview(api, normalizedPath, filesystem, fileBackedPanelIdsRef.current)
      if (!activateDockviewPanel({
        id: panelId,
        component: resolved.component,
        title: resolved.title ?? normalizedPath.split("/").pop() ?? normalizedPath,
        params: workbenchPreviewParams(params),
      })) {
        return { ok: false, code: "not-ready", message: "surface not ready" }
      }
      return finish()
    }

    const existing = findOpenFilePanel(api, normalizedPath, filesystem)
    if (existing) {
      existing.api.setActive()
      return finish()
    }
    return {
      ok: false,
      code: "NO_SURFACE_RESOLVER",
      message: `no registered surface resolver handles ${normalizedPath}`,
    }
  }, [activateDockviewPanel, activateExistingFilePanel, emitFileOpened])

  const openFileSync = useCallback((path: string, options?: SurfaceShellOpenFileOptions) => {
    const api = apiRef.current
    if (!api) {
      console.warn("[SurfaceShell] openFile: surface not ready (dockview not initialized)")
      return
    }
    const result = openFileCore(api, path, options)
    if (!result.ok) {
      console.warn(`[SurfaceShell] openFile: ${result.message}`)
    }
  }, [openFileCore])

  const openSurfaceSync = useCallback((request: SurfaceOpenRequest) => {
    const normalizedRequest = normalizeSurfaceOpenRequest(request)

    if (normalizedRequest.kind === WORKSPACE_OPEN_PATH_SURFACE_KIND) {
      const api = apiRef.current
      if (!api) {
        console.warn("[SurfaceShell] openSurface: surface not ready (dockview not initialized)")
        return
      }
      const surfaceMode = normalizedRequest.meta?.mode
      const closeWorkbenchOnDone = normalizedRequest.meta?.closeWorkbenchOnDone === true
      const result = openFileCore(api, normalizedRequest.target, {
        filesystem: normalizedRequest.filesystem,
        ...(surfaceMode === "view" || surfaceMode === "edit" || surfaceMode === "diff" ? { mode: surfaceMode } : {}),
        ...(closeWorkbenchOnDone && onCloseRef.current
          ? { extraParams: { __closeWorkbenchOnDone: onCloseRef.current } }
          : {}),
      })
      if (result.ok) return
      if (result.code === "NO_SURFACE_PANEL") {
        const known = panelRegistryRef.current.list().map((p) => p.id).join(", ")
        throw new Error(
          `openSurface: unknown component "${result.component}". Registered panels: [${known}]. ` +
            `Register the component through a panel output before resolving to it.`,
        )
      }
      console.warn(`[SurfaceShell] openSurface: ${result.message}`)
      return
    }

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
    const closeWorkbenchOnDone = normalizedRequest.meta?.closeWorkbenchOnDone === true
    const params = closeWorkbenchOnDone && onCloseRef.current
      ? { ...(resolved.params ?? {}), __closeWorkbenchOnDone: onCloseRef.current }
      : resolved.params
    if (!activateDockviewPanel({
      id: panelId,
      component: resolved.component,
      title: resolved.title ?? normalizedRequest.target,
      params,
    })) {
      console.warn("[SurfaceShell] openSurface: surface not ready (dockview not initialized)")
    }
  }, [activateDockviewPanel, openFileCore])

  const openPanelSync = useCallback((config: OpenPanelConfig) => {
    const api = apiRef.current
    if (!api) return
    const existing = api.getPanel(config.id)
    if (existing) {
      // Re-activate, and update params if they changed (so callers can drive
      // pane state by re-issuing openPanel with new params — same panel, new
      // input).
      if (config.params) {
        existing.api.updateParameters(config.params)
      }
      existing.api.setActive()
      return
    }
    // File-tree/plugin launches share one reusable preview tab. Pinned tabs
    // clear this marker from their tab chrome and are never replaced.
    closeWorkbenchPreview(api)

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
    activateDockviewPanel({
      id: config.id,
      component: config.component,
      title: config.title ?? config.id,
      params: workbenchPreviewParams(config.params),
    })
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

  const expandToFileSync = useCallback((path: string, options?: { filesystem?: FilesystemId }) => {
    const normalizedPath = normalizeWorkbenchPath(path)
    const filesystem = options?.filesystem
    const request = { path: normalizedPath, ...(filesystem ? { filesystem } : {}) }
    pendingTreeExpandRef.current = request
    setFileTreeRevealRequest({ ...request, seq: ++fileTreeRevealSeqRef.current })
    openSourcePane(FILES_WORKSPACE_SOURCE_ID)
    if (emitBridgeEvent("tree:expand", request)) {
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
      setOpenSurfacePanels(ready.panels.map((panel) => ({ id: panel.id, title: panel.title ?? panel.id })))
      onChangeRef.current?.(getSnapshot())
      emitBridgeState()
    }
    ready.onDidAddPanel(emit)
    ready.onDidRemovePanel(emit)
    ready.onDidActivePanelChange(() => {
      collapseForActiveWorkspacePage(ready)
      emitActiveFileOpened(ready)
      emit()
    })
    // Initial snapshot once everyone's wired up.
    collapseForActiveWorkspacePage(ready)
    emit()
  }, [collapseForActiveWorkspacePage, emitActiveFileOpened, localSurfaceApi, getSnapshot, emitBridgeState])


  const openFile = useCallback(
    async (path: string, options?: SurfaceShellOpenFileOptions): Promise<CommandResult> => {
      try {
        const api = apiRef.current
        if (!api) return err("not-ready", "surface not ready")
        const result = openFileCore(api, path, options)
        return result.ok ? ok() : err(result.code, result.message)
      } catch (error) {
        return err(
          "INVALID_SURFACE_PATH",
          error instanceof Error ? error.message : "failed to open file",
        )
      }
    },
    [openFileCore],
  )

  const bridge = useMemo<WorkspaceBridge>(() => {
    return {
      getOpenPanels: () => getBridgeState().panels,
      getActiveFile: () => getBridgeState().activeFile,
      getActiveFileResource: () => {
        const api = apiRef.current
        const panel = api?.activePanel
        return fileBackedResource(
          panel ? { id: panel.id, params: panel.params as Record<string, unknown> | undefined } : null,
          fileBackedPanelIdsRef.current,
        )
      },
      getDirtyFiles: () => [],
      getVisibleFiles: () => getBridgeState().visibleFiles,
      openFile,
      openPanel: async (config) => {
        if (!apiRef.current) return err("not-ready", "surface not ready")
        try {
          openPanelSync(config)
          return ok()
        } catch (error) {
          return err("INVALID_PANEL", error instanceof Error ? error.message : "failed to open panel")
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
      expandToFile: async (path, options) => {
        expandToFileSync(path, options)
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
          handler(pendingTreeExpandRef.current as BridgeEventMap[K])
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
      // The source pane is docked on the right, so dragging its left edge
      // leftward increases width and dragging rightward decreases it.
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
      if (leftBlockCollapsed || !sourcePaneOpen) return
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
  const workbenchHeaderHeight = 44
  const workbenchSidebarWidth = sourcePaneOpen ? sidebarWidth : workbenchRailWidth

  return (
    <div
      ref={containerRef}
      data-boring-workspace-part="surface"
      data-boring-state={hostRailOnly ? "rail" : "expanded"}
      className={cn("flex h-full min-h-0 w-full flex-col bg-background", className)}
      data-testid="surface-shell"
    >
      {!hideLevelOneHeader ? <header
        data-boring-workspace-part="workbench-level-one-header"
        data-boring-state={hostRailOnly ? "collapsed" : "expanded"}
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center",
          hostRailOnly ? "justify-center border-b border-border/60 bg-background" : "justify-end px-3",
        )}
        style={{ height: workbenchHeaderHeight }}
      >
        {hostRailOnly ? (
          <IconButton
            type="button"
            variant="ghost"
            size="icon-xs"
            className="workbench-open-button pointer-events-auto"
            onClick={toggleHostWorkbench}
            aria-label="Open workbench"
            title="Open workbench (⌘2)"
          >
            <PanelRightOpen className="h-4 w-4" strokeWidth={1.75} />
          </IconButton>
        ) : (
          <WorkbenchHeaderActions
            panels={openSurfacePanels}
            activePanelId={activeSurfacePanelId}
            onActivatePanel={(panelId) => apiRef.current?.getPanel(panelId)?.api.setActive()}
            fullscreen={hostFullscreen}
            onToggleFullscreen={onHostToggleFullscreen}
            onClose={showCloseAction ? onClose : undefined}
          />
        )}
      </header> : null}

      <div
        data-boring-workspace-part="workbench-body"
        className="flex h-full min-h-0 w-full"
        style={{ height: "100%" }}
      >
        <div
          data-boring-workspace-part="workbench-content"
          aria-hidden={hostRailOnly}
          inert={hostRailOnly ? true : undefined}
          className={cn("relative min-w-0 flex-1 overflow-hidden", hostRailOnly && "w-0 flex-none")}
        >
          <div
            data-boring-workspace-part="surface-tabs"
            data-boring-state={sourcePaneOpen ? "expanded" : "rail"}
            className="workbench-dockview h-full"
            data-collapsed-sources={!sourcePaneOpen ? "true" : undefined}
          >
            <ArtifactSurfacePane
              storageKey={storageKey}
              onReady={handleReady}
              allowedPanels={allowedPanels}
            />
          </div>
          <EmptyWorkbenchOverlay api={api} />
        </div>

        {sourcePaneOpen ? (
          <div
            data-boring-workspace-part="workbench-source-resize"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize workspace sources"
            tabIndex={0}
            onPointerDown={startDrag}
            onPointerMove={onDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={onHandleKeyDown}
            className={cn(
              "relative w-px shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-primary/40",
              !hideLevelOneHeader && "mt-11",
              "focus-visible:outline-none focus-visible:bg-primary/50",
            )}
            style={{ height: hideLevelOneHeader ? "100%" : `calc(100% - ${workbenchHeaderHeight}px)` }}
          >
            <span aria-hidden="true" className="absolute inset-y-0 -left-1.5 -right-1.5" />
          </div>
        ) : null}

        <aside
          data-boring-workspace-part="surface-sidebar"
          data-boring-state={hostRailOnly ? "host-collapsed" : sourcePaneOpen ? "expanded" : "rail"}
          className={cn(
            "relative z-10 flex min-h-0 shrink-0 flex-col overflow-hidden border-l border-border/60",
            !hideLevelOneHeader && "mt-11",
          )}
          style={{
            width: workbenchSidebarWidth,
            minWidth: workbenchSidebarWidth,
            maxWidth: workbenchSidebarWidth,
            height: hideLevelOneHeader ? "100%" : `calc(100% - ${workbenchHeaderHeight}px)`,
          }}
          aria-label={hostRailOnly ? "Workbench activity rail" : "Workbench sources and activity rail"}
        >
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
            onExpand={openSourcePane}
            onCloseSourcePane={closeSourcePane}
            railOnly={!sourcePaneOpen}
            railSide="right"
          />
        </aside>
      </div>
    </div>
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
