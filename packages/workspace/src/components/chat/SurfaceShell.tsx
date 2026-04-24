"use client"

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import type { DockviewApi } from "dockview-react"
import { FileText, Layers3, PanelLeftOpen } from "lucide-react"
import { cn } from "../../lib/utils"
import { ArtifactSurfacePane } from "../../panes/ArtifactSurfacePane"
import type { WorkspaceBridge, CommandResult } from "../../bridge/types"
import { WorkbenchLeftPane } from "./WorkbenchLeftPane"
import { ChatShellContext } from "./context"
import type { DataSource } from "../DataCatalog"

export interface SurfaceShellProps {
  rootDir?: string
  sidebarDefaultWidth?: number
  sidebarMinWidth?: number
  sidebarMaxWidth?: number
  storageKey?: string
  dataSources?: DataSource[]
  className?: string
}

const COLLAPSED_WIDTH = 40

function componentForPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase()
  if (ext === "md" || ext === "markdown") return "markdown-editor"
  if (ext === "csv" || ext === "tsv") return "csv-viewer"
  return "code-editor"
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
  dataSources = [],
  className,
}: SurfaceShellProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(sidebarDefaultWidth)
  const apiRef = useRef<DockviewApi | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const [api, setApi] = useState<DockviewApi | null>(null)

  const handleReady = useCallback((ready: DockviewApi) => {
    apiRef.current = ready
    setApi(ready)
  }, [])

  const openFile = useCallback(
    async (path: string): Promise<CommandResult> => {
      const api = apiRef.current
      if (!api) return err("not-ready", "surface not ready")
      const panelId = `file:${path}`
      const existing = api.getPanel(panelId)
      if (existing) {
        existing.api.setActive()
        return ok()
      }
      api.addPanel({
        id: panelId,
        component: componentForPath(path),
        title: path.split("/").pop() ?? path,
        params: { path },
      })
      return ok()
    },
    [],
  )

  const bridge = useMemo<WorkspaceBridge>(() => {
    return {
      getOpenPanels: () => [],
      getActiveFile: () => null,
      getDirtyFiles: () => [],
      getVisibleFiles: () => [],
      openFile,
      openPanel: async () => ok(),
      closePanel: async () => ok(),
      showNotification: async () => ok(),
      navigateToLine: async () => ok(),
      expandToFile: async () => ok(),
      markDirty: () => {},
      markClean: () => {},
      subscribe: () => () => {},
      select: () => () => {},
    }
  }, [openFile])

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

  // Persist sidebar width
  useEffect(() => {
    if (!storageKey) return
    try {
      const raw = localStorage.getItem(`${storageKey}:sidebarWidth`)
      if (raw) {
        const n = Number(raw)
        if (Number.isFinite(n)) setSidebarWidth(Math.max(sidebarMinWidth, Math.min(sidebarMaxWidth, n)))
      }
      const c = localStorage.getItem(`${storageKey}:sidebarCollapsed`)
      if (c === "1") setCollapsed(true)
    } catch {}
    // only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
              dataSources={dataSources}
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
        <div className="workbench-dockview h-full">
          <ArtifactSurfacePane
            onReady={handleReady}
            prefixHeaderActions={
              collapsed
                ? () => <FilesToggleAction collapsed={collapsed} onToggle={() => setCollapsed(false)} />
                : undefined
            }
            /* When open, the close button lives inside WorkbenchLeftPane header — no prefix needed */
            rightHeaderActions={() => <WorkbenchCloseAction />}
          />
        </div>
        <EmptyWorkbenchOverlay api={api} collapsed={collapsed} onExpandFiles={() => setCollapsed(false)} />
      </div>
    </div>
  )
}

function FilesToggleAction({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "mx-1 flex h-7 w-7 items-center justify-center rounded",
        "text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
      aria-label={collapsed ? "Show files" : "Hide files"}
      aria-pressed={!collapsed}
      title={collapsed ? "Show files" : "Hide files"}
    >
      <PanelLeftOpen className={cn("h-4 w-4 transition-transform", !collapsed && "rotate-180")} />
    </button>
  )
}

function WorkbenchCloseAction() {
  const shell = useContext(ChatShellContext)
  if (!shell) return null
  return (
    <button
      type="button"
      onClick={() => shell.setSurfaceOpen(false)}
      className={cn(
        "mx-1 flex h-7 w-7 items-center justify-center rounded",
        "text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
      aria-label="Close workbench"
      title="Close workbench (⌘2)"
    >
      <Layers3 className="h-4 w-4" />
    </button>
  )
}

function EmptyWorkbenchOverlay({
  api,
  collapsed,
  onExpandFiles,
}: {
  api: DockviewApi | null
  collapsed: boolean
  onExpandFiles: () => void
}) {
  const [empty, setEmpty] = useState(true)
  const shell = useContext(ChatShellContext)
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
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-0.5 border-b border-border/60 bg-background px-1" style={{ height: 52 }}>
        {collapsed && (
          <button
            type="button"
            onClick={onExpandFiles}
            className={cn(
              "pointer-events-auto mx-1 flex h-7 w-7 items-center justify-center rounded",
              "text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
            aria-label="Show files"
            title="Show files"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        )}
        <div className="flex-1" />
        {shell && (
          <button
            type="button"
            onClick={() => shell.setSurfaceOpen(false)}
            className={cn(
              "pointer-events-auto mx-1 flex h-7 w-7 items-center justify-center rounded",
              "text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
            aria-label="Close workbench"
            title="Close workbench (⌘2)"
          >
            <Layers3 className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 pt-12 text-center text-muted-foreground">
        <div
          aria-hidden="true"
          className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted/60 text-muted-foreground"
        >
          <FileText className="h-4 w-4" strokeWidth={1.75} />
        </div>
        <div className="text-[13px] font-medium text-foreground">No file open</div>
        <p className="max-w-[260px] text-[12px] leading-relaxed text-muted-foreground">
          Open a file from the files pane, or wait for the agent to produce an artifact.
        </p>
        {collapsed && (
          <button
            type="button"
            onClick={onExpandFiles}
            className={cn(
              "pointer-events-auto mt-1 flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-[12px] font-medium text-background shadow-sm",
              "transition-opacity hover:opacity-90",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <PanelLeftOpen className="h-3.5 w-3.5" />
            Show files
          </button>
        )}
      </div>
    </>
  )
}
