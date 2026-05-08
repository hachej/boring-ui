"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { DockviewApi } from "dockview-react"
import { ChevronRight, FolderTree } from "lucide-react"
import { cn } from "../../lib/utils"
import { ArtifactSurfacePane } from "./ArtifactSurfacePane"
import type { WorkspaceBridge, CommandResult } from "../../bridge/types"
import type { WorkspaceState, PanelState } from "../../store/types"
import { WorkbenchLeftPane } from "../workbench-left/WorkbenchLeftPane"
import { WORKSPACE_UI_COMMAND_DOM_EVENT } from "../../bridge/uiCommandBus"
import { dispatchUiCommand } from "../../bridge/uiCommandDispatcher"
import { useRegistry, useSurfaceResolverRegistry } from "../../registry"
import type {
  SurfaceOpenRequest,
  SurfacePanelResolution,
  SurfaceResolverConfig,
} from "../../../shared/types/surface"
import { WORKSPACE_OPEN_PATH_SURFACE_KIND } from "../../../shared/types/surface"

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
  className?: string
}

const COLLAPSED_WIDTH = 40

export function resolvePanelForPath(
  path: string,
  registry: { resolve: SurfaceResolverConfig["resolve"] },
): SurfacePanelResolution | undefined {
  return registry.resolve({ kind: WORKSPACE_OPEN_PATH_SURFACE_KIND, target: path })
}

function normalizeWorkbenchPath(path: string): string {
  const trimmed = path.trim().replace(/\\/g, "/")
  const noLeadingDot = trimmed.replace(/^\.\//, "")
  const normalized = noLeadingDot.replace(/\/+/g, "/")
  // Security: reject path traversal attempts
  if (normalized.includes("..")) {
    throw new Error(`Invalid path: path traversal not allowed`)
  }
  return normalized
}

function findOpenFilePanel(api: DockviewApi, path: string) {
  const panelId = `file:${path}`
  return api.getPanel(panelId)
    ?? api.panels.find((panel) =>
      (panel.params as Record<string, unknown> | undefined)?.path === path
    )
}

export function normalizeSurfaceOpenRequest(
  request: SurfaceOpenRequest,
): SurfaceOpenRequest {
  if (request.kind !== WORKSPACE_OPEN_PATH_SURFACE_KIND) return request
  return {
    ...request,
    target: normalizeWorkbenchPath(request.target),
  }
}

function surfacePanelId(
  request: SurfaceOpenRequest,
  resolved: SurfacePanelResolution,
): string {
  return resolved.id ?? `surface:${request.kind}:${request.target}`
}

let seqCounter = 0
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
  extraPanels,
  defaultLeftTab,
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
  const apiRef = useRef<DockviewApi | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const [api, setApi] = useState<DockviewApi | null>(null)
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const bridgeSelectorsRef = useRef(new Set<(state: WorkspaceState) => void>())

  // Read of the panel registry — used to validate `openPanel({component})`
  // against what's actually registered. Without this check, dockview's
  // addPanel silently creates an empty tab when given an unknown component
  // name (real bug we hit when the agent dispatched openPanel for a panel
  // the host hadn't registered).
  const panelRegistry = useRegistry()
  const surfaceResolverRegistry = useSurfaceResolverRegistry()
  const panelRegistryRef = useRef(panelRegistry)
  panelRegistryRef.current = panelRegistry
  const surfaceResolverRegistryRef = useRef(surfaceResolverRegistry)
  surfaceResolverRegistryRef.current = surfaceResolverRegistry
  const allowedPanels = useMemo(() => {
    const ids = new Set<string>()
    for (const panel of panelRegistry.list()) {
      if (panel.placement === "center") ids.add(panel.id)
    }
    for (const id of extraPanels ?? []) {
      ids.add(id)
    }
    return [...ids]
  }, [extraPanels, panelRegistry])

  const openFileSync = useCallback((path: string) => {
    const api = apiRef.current
    if (!api) return
    const normalizedPath = normalizeWorkbenchPath(path)
    const existing = findOpenFilePanel(api, normalizedPath)
    if (existing) {
      existing.api.setActive()
      return
    }
    const request: SurfaceOpenRequest = {
      kind: WORKSPACE_OPEN_PATH_SURFACE_KIND,
      target: normalizedPath,
    }
    const resolved = surfaceResolverRegistryRef.current.resolve(request)
    if (!resolved) return
    if (!panelRegistryRef.current.has(resolved.component)) return
    const panelId = surfacePanelId(request, resolved)
    const existingByResolvedId = api.getPanel(panelId)
    if (existingByResolvedId) {
      if (resolved.params) existingByResolvedId.api.updateParameters(resolved.params)
      existingByResolvedId.api.setActive()
      return
    }
    api.addPanel({
      id: panelId,
      component: resolved.component,
      title: resolved.title ?? normalizedPath.split("/").pop() ?? normalizedPath,
      params: resolved.params ?? { path: normalizedPath },
    })
  }, [])

  const openSurfaceSync = useCallback((request: SurfaceOpenRequest) => {
    const api = apiRef.current
    if (!api) return
    const normalizedRequest = normalizeSurfaceOpenRequest(request)
    const resolved = surfaceResolverRegistryRef.current.resolve(normalizedRequest)
    if (!resolved) return
    const panelId = surfacePanelId(normalizedRequest, resolved)
    const existing =
      normalizedRequest.kind === WORKSPACE_OPEN_PATH_SURFACE_KIND
        ? findOpenFilePanel(api, normalizedRequest.target) ?? api.getPanel(panelId)
        : api.getPanel(panelId)
    if (existing) {
      if (resolved.params) existing.api.updateParameters(resolved.params)
      existing.api.setActive()
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
    api.addPanel({
      id: panelId,
      component: resolved.component,
      title: resolved.title ?? normalizedRequest.target,
      params: resolved.params,
    })
  }, [])

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
    // Validate the component is actually registered. Without this check,
    // dockview happily creates an empty tab when handed an unknown
    // component name (it falls back to a no-op renderer). That's how the
    // agent's "openPanel({component:'chart'})" produced a blank workbench
    // with no error signal in either direction. Refuse loudly here so the
    // failure is visible at the call site and (when called via exec_ui)
    // surfaces back to the LLM through bridge.postCommand error.
    const registry = panelRegistryRef.current
    if (!registry.has(config.component)) {
      const known = registry.list().map((p) => p.id).join(", ")
      throw new Error(
        `openPanel: unknown component "${config.component}". Registered panels: [${known}]. ` +
          `Add the component to WorkspaceProvider's "panels" prop, or pick one of the registered ids.`,
      )
    }
    api.addPanel({
      id: config.id,
      component: config.component,
      title: config.title ?? config.id,
      params: config.params,
    })
  }, [])

  const getSnapshot = useCallback((): SurfaceShellSnapshot => {
    const api = apiRef.current
    if (!api) return { openTabs: [], activeTab: null }
    const openTabs: SurfaceShellTab[] = api.panels.map((p) => ({
      id: p.id,
      title: (p.title ?? p.id) as string,
      params: (p.params as Record<string, unknown> | undefined) ?? undefined,
    }))
    return { openTabs, activeTab: api.activePanel?.id ?? null }
  }, [])

  const localSurfaceApi = useMemo<SurfaceShellApi>(() => ({
    openFile: openFileSync,
    openSurface: openSurfaceSync,
    openPanel: openPanelSync,
    closeWorkbenchLeftPane: () => setCollapsed(true),
    getSnapshot,
  }), [getSnapshot, openFileSync, openPanelSync, openSurfaceSync])

  useEffect(() => {
    const ctx = {
      surface: () => (apiRef.current ? localSurfaceApi : null),
      isWorkbenchOpen: () => true,
      openWorkbench: () => undefined,
    }
    const dispatch = (command: Parameters<typeof dispatchUiCommand>[0]) => {
      dispatchUiCommand(command, ctx)
    }
    const onDomCommand = (event: Event) => {
      const detail = (event as CustomEvent<{ command?: unknown }>).detail
      if (detail?.command && typeof detail.command === "object") {
        dispatch(detail.command as Parameters<typeof dispatchUiCommand>[0])
      }
    }
    window.addEventListener(WORKSPACE_UI_COMMAND_DOM_EVENT, onDomCommand)
    return () => {
      window.removeEventListener(WORKSPACE_UI_COMMAND_DOM_EVENT, onDomCommand)
    }
  }, [localSurfaceApi])

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
    const activeParams = (api?.activePanel?.params as Record<string, unknown> | undefined) ?? undefined
    const activeFile = typeof activeParams?.path === "string" ? activeParams.path : null
    return {
      hydrationComplete: true,
      layout: null,
      sidebar: { collapsed: false, width: sidebarDefaultWidth },
      panelSizes: {},
      preferences: { theme: "dark" },
      panels,
      activePanel,
      activeFile,
      visibleFiles: panels
        .map((p) => p.params?.path)
        .filter((p): p is string => typeof p === "string"),
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

  const handleReady = useCallback((ready: DockviewApi) => {
    apiRef.current = ready
    setApi(ready)
    onReadyRef.current?.(localSurfaceApi)
    // Subscribe to dockview events so the parent gets a snapshot push on
    // every panel mutation. Disposers are intentionally not stored — the
    // dockview instance lives for the SurfaceShell's entire lifetime, and
    // SurfaceShell unmounts disposes the dockview itself.
    const emit = () => {
      onChangeRef.current?.(getSnapshot())
      emitBridgeState()
    }
    ready.onDidAddPanel(emit)
    ready.onDidRemovePanel(emit)
    ready.onDidActivePanelChange(emit)
    // Initial snapshot once everyone's wired up.
    emit()
  }, [localSurfaceApi, getSnapshot, emitBridgeState])


  const openFile = useCallback(
    async (path: string): Promise<CommandResult> => {
      try {
        const api = apiRef.current
        if (!api) return err("not-ready", "surface not ready")
        const normalizedPath = normalizeWorkbenchPath(path)
        const existing = findOpenFilePanel(api, normalizedPath)
        if (existing) {
          existing.api.setActive()
          return ok()
        }
        const request: SurfaceOpenRequest = {
          kind: WORKSPACE_OPEN_PATH_SURFACE_KIND,
          target: normalizedPath,
        }
        const resolved = surfaceResolverRegistryRef.current.resolve(request)
        if (!resolved) return err("NO_SURFACE_RESOLVER", `no registered surface resolver handles ${normalizedPath}`)
        if (!panelRegistryRef.current.has(resolved.component)) {
          return err(
            "NO_SURFACE_PANEL",
            `surface resolver "${request.kind}" returned unknown panel "${resolved.component}"`,
          )
        }
        const panelId = surfacePanelId(request, resolved)
        const existingByResolvedId = api.getPanel(panelId)
        if (existingByResolvedId) {
          if (resolved.params) existingByResolvedId.api.updateParameters(resolved.params)
          existingByResolvedId.api.setActive()
          return ok()
        }
        api.addPanel({
          id: panelId,
          component: resolved.component,
          title: resolved.title ?? normalizedPath.split("/").pop() ?? normalizedPath,
          params: resolved.params ?? { path: normalizedPath },
        })
        return ok()
      } catch (error) {
        return err(
          "INVALID_SURFACE_PATH",
          error instanceof Error ? error.message : "failed to open file",
        )
      }
    },
    [],
  )

  const bridge = useMemo<WorkspaceBridge>(() => {
    return {
      getOpenPanels: () => getBridgeState().panels,
      getActiveFile: () => getBridgeState().activeFile,
      getDirtyFiles: () => [],
      getVisibleFiles: () => getBridgeState().visibleFiles,
      openFile,
      openPanel: async () => ok(),
      closePanel: async () => ok(),
      closeWorkbenchLeftPane: async () => {
        setCollapsed(true)
        return ok()
      },
      showNotification: async () => ok(),
      navigateToLine: async () => ok(),
      expandToFile: async () => ok(),
      markDirty: () => {},
      markClean: () => {},
      subscribe: () => () => {},
      select: (selector, handler) => {
        const wrapped = (state: WorkspaceState) => handler(selector(state))
        bridgeSelectorsRef.current.add(wrapped)
        wrapped(getBridgeState())
        return () => {
          bridgeSelectorsRef.current.delete(wrapped)
        }
      },
    }
  }, [openFile, getBridgeState])

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
      if (collapsed) return
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
    [collapsed, sidebarMinWidth, sidebarMaxWidth],
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
      localStorage.setItem(`${storageKey}:sidebarCollapsed`, collapsed ? "1" : "0")
    } catch {}
  }, [storageKey, collapsed])

  return (
    <div
      ref={containerRef}
      className={cn("flex h-full min-h-0 w-full bg-background", className)}
      data-testid="surface-shell"
    >
      {!collapsed ? (
        <>
          <aside
            className="flex h-full min-h-0 flex-col"
            style={{ width: sidebarWidth, minWidth: sidebarWidth, maxWidth: sidebarWidth }}
            aria-label="Workbench left pane"
          >
            <WorkbenchLeftPane
              rootDir={rootDir}
              bridge={bridge}
              defaultTab={defaultLeftTab}
              onCollapse={() => setCollapsed(true)}
            />
          </aside>

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
        </>
      ) : null}

      <div className="relative min-w-0 flex-1">
        <div
          className="workbench-dockview h-full"
          data-collapsed-sources={collapsed ? "true" : undefined}
        >
          <ArtifactSurfacePane
            storageKey={storageKey}
            onReady={handleReady}
            allowedPanels={allowedPanels}
            rightHeaderActions={onClose ? () => <WorkbenchCloseAction onClose={onClose} /> : undefined}
          />
        </div>
        {/* Show-sources button — overlaid into the tab strip so it is always reachable,
            even for existing groups created before collapse (dockview only wires
            prefixHeaderActions on group creation). */}
        {collapsed && (
          <div className="pointer-events-none absolute left-0 top-0 z-20 flex items-center" style={{ height: 44 }}>
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              className={cn(
                "pointer-events-auto ml-2 flex h-7 w-7 items-center justify-center rounded-md",
                "text-muted-foreground transition-colors",
                "hover:bg-foreground/5 hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              )}
              aria-label="Show sources"
              title="Show sources"
            >
              <FolderTree className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>
        )}
        <EmptyWorkbenchOverlay
          api={api}
          collapsed={collapsed}
          onExpandFiles={() => setCollapsed(false)}
          onClose={onClose}
        />
      </div>
    </div>
  )
}

function WorkbenchCloseAction({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      className={cn(
        "mx-1 flex h-7 w-7 items-center justify-center rounded-md",
        "text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
      )}
      aria-label="Close workbench"
      title="Close workbench (⌘2)"
    >
      <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
    </button>
  )
}

function EmptyWorkbenchOverlay({
  api,
  collapsed,
  onExpandFiles,
  onClose,
}: {
  api: DockviewApi | null
  collapsed: boolean
  onExpandFiles: () => void
  onClose?: () => void
}) {
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
        {collapsed && (
          <button
            type="button"
            onClick={onExpandFiles}
            className={cn(
              "pointer-events-auto mx-1 flex h-7 w-7 items-center justify-center rounded-md",
              "text-muted-foreground transition-colors",
              "hover:bg-foreground/5 hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            )}
            aria-label="Show sources"
            title="Show sources"
          >
            <FolderTree className="h-4 w-4" strokeWidth={1.75} />
          </button>
        )}
        <div className="flex-1" />
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className={cn(
              "pointer-events-auto mx-1 flex h-7 w-7 items-center justify-center rounded-md",
              "text-muted-foreground transition-colors",
              "hover:bg-foreground/5 hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            )}
            aria-label="Close workbench"
            title="Close workbench (⌘2)"
          >
            <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
          </button>
        )}
      </div>

      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 pt-12 pb-10 text-center">
        <div className="flex items-center gap-2 text-[10.5px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          <span className="inline-block h-px w-4 bg-[color:var(--accent)]" aria-hidden="true" />
          Workbench
        </div>
        <div className="text-[15px] font-medium tracking-tight text-foreground">Nothing open yet</div>
        <p className="max-w-[280px] text-[12.5px] leading-relaxed text-muted-foreground">
          Open a source item, or let the agent produce an artifact here.
        </p>
        {collapsed && (
          <button
            type="button"
            onClick={onExpandFiles}
            className={cn(
              "pointer-events-auto mt-2 inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-[12px] font-medium text-foreground",
              "shadow-[0_1px_0_oklch(0_0_0/0.02),0_2px_6px_-2px_oklch(0_0_0/0.06)]",
              "transition-colors hover:border-[color:var(--accent)]/40 hover:text-[color:var(--accent)]",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            )}
          >
            <FolderTree className="h-3.5 w-3.5" strokeWidth={1.75} />
            Show sources
          </button>
        )}
      </div>
    </>
  )
}
