import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react"
import { cn } from "../lib/utils"
import type { LayoutConfig, GroupConfig } from "../dock"
import { useCommandRegistry, useRegistry } from "../registry"
import type { PaneProps } from "../registry/types"
import type { ChatLayoutProps } from "./types"

export function buildChatLayout(props: ChatLayoutProps = {}): LayoutConfig {
  const {
    nav = "session-list",
    navParams,
    center = "chat",
    centerParams,
    surface,
    surfaceParams,
    sidebar,
    sidebarParams,
  } = props
  const groups: GroupConfig[] = []

  if (nav) {
    groups.push({
      id: "nav",
      position: "left",
      panel: nav,
      params: navParams,
      locked: true,
      hideHeader: true,
      constraints: { minWidth: 60, maxWidth: 60 },
    })
  }

  groups.push({
    id: "center",
    position: "center",
    panel: center,
    params: centerParams,
    hideHeader: true,
  })

  if (sidebar) {
    groups.push({
      id: "sidebar",
      position: "left",
      panel: sidebar,
      params: sidebarParams,
      hideHeader: true,
      collapsible: true,
      collapsedWidth: 40,
      constraints: { minWidth: 200, maxWidthViewportRatio: 0.5 },
    })
  }

  if (surface) {
    groups.push({
      id: "surface",
      position: "right",
      panel: surface,
      params: surfaceParams,
      hideHeader: true,
      dynamic: true,
      placeholder: "empty",
    })
  }

  return { version: "2.0", groups }
}

export function ChatLayout(props: ChatLayoutProps) {
  const navOpen = Boolean(props.nav ?? "session-list")
  const surfaceConfigured = props.surface !== undefined && props.surface !== null
  const surfaceOpen = Boolean(props.surface)
  const navId = props.nav || "session-list"
  const surfaceId = props.surface || "artifact-surface"
  const viewport = useViewportWidth()
  const [navWidth, setNavWidth] = useState(260)
  const [surfaceWidth, setSurfaceWidth] = useState(680)
  const commandRegistry = useCommandRegistry()
  const effectiveNavWidth = clamp(navWidth, 200, 360)
  const surfaceMax = Math.max(480, Math.floor(viewport * 0.72))
  const effectiveSurfaceWidth = clamp(surfaceWidth, 480, surfaceMax)

  useEffect(() => {
    const pluginId = "workspace:chat-layout"
    commandRegistry.unregisterByPluginId(pluginId)
    commandRegistry.registerCommand({
      id: "workspace:open-session-history",
      title: "Open Session History",
      keywords: ["sessions", "history", "drawer"],
      shortcut: "⌘1",
      pluginId,
      when: () => !navOpen,
      run: () => props.onOpenNav?.(),
    })
    commandRegistry.registerCommand({
      id: "workspace:open-workbench",
      title: "Open Workbench",
      keywords: ["surface", "artifacts", "files"],
      shortcut: "⌘2",
      pluginId,
      when: () => surfaceConfigured && !surfaceOpen,
      run: () => props.onOpenSurface?.(),
    })
    return () => commandRegistry.unregisterByPluginId(pluginId)
  }, [commandRegistry, navOpen, surfaceConfigured, surfaceOpen, props.onOpenNav, props.onOpenSurface])

  return (
    <div className={cn("relative flex h-full min-h-0 w-full overflow-hidden bg-background", props.className)}>
      <aside
        aria-label="Session browser"
        aria-hidden={!navOpen}
        className={cn(
          "relative h-full min-h-0 shrink-0 overflow-hidden bg-background",
          "transition-[width,min-width,max-width] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
          navOpen && "border-r border-[color:oklch(from_var(--border)_l_c_h/0.6)]",
        )}
        style={{
          width: navOpen ? effectiveNavWidth : 0,
          minWidth: navOpen ? effectiveNavWidth : 0,
          maxWidth: navOpen ? effectiveNavWidth : 0,
          willChange: "width",
        }}
      >
        <div
          className={cn(
            "h-full min-h-0 overflow-hidden",
            "transition-opacity duration-[200ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
            navOpen ? "opacity-100" : "opacity-0",
          )}
        >
          <PanelSlot id={navId} params={props.navParams} />
        </div>
        {navOpen ? (
          <ResizeHandle
            side="drawer-right"
            ariaLabel="Resize sessions drawer"
            onResize={(delta) => setNavWidth((w) => clamp(w + delta, 200, 360))}
          />
        ) : null}
      </aside>

      <main className="relative h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
        <PanelSlot id={props.center ?? "chat"} params={props.centerParams} />
        {!navOpen && props.onOpenNav ? (
          <FloatingEdgeButton
            side="left"
            icon="sessions"
            onClick={props.onOpenNav}
            label="Sessions"
            hint="⌘1"
          />
        ) : null}
        {!surfaceOpen && props.onOpenSurface ? (
          <FloatingEdgeButton
            side="right"
            icon="workbench"
            onClick={props.onOpenSurface}
            label="Workbench"
            hint="⌘2"
          />
        ) : null}
      </main>

      {surfaceConfigured ? (
        <aside
          aria-label="Surface"
          aria-hidden={!surfaceOpen}
          className={cn(
            "relative h-full min-h-0 shrink-0 overflow-hidden bg-background",
            "transition-[width,min-width,max-width] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
            surfaceOpen && "border-l border-[color:oklch(from_var(--border)_l_c_h/0.6)]",
          )}
          style={{
            width: surfaceOpen ? effectiveSurfaceWidth : 0,
            minWidth: surfaceOpen ? effectiveSurfaceWidth : 0,
            maxWidth: surfaceOpen ? effectiveSurfaceWidth : 0,
            willChange: "width",
          }}
        >
          <div
            className={cn(
              "h-full min-h-0 overflow-hidden",
              "transition-opacity duration-[200ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
              surfaceOpen ? "opacity-100" : "opacity-0",
            )}
          >
            <PanelSlot id={surfaceId} params={props.surfaceParams} />
          </div>
          {surfaceOpen ? (
            <ResizeHandle
              side="surface-left"
              ariaLabel="Resize workbench"
              onResize={(delta) => setSurfaceWidth((w) => clamp(w - delta, 480, surfaceMax))}
            />
          ) : null}
        </aside>
      ) : null}
    </div>
  )
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function useViewportWidth(): number {
  const [w, setW] = useState<number>(() => (typeof window !== "undefined" ? window.innerWidth : 1200))
  useEffect(() => {
    const onResize = () => setW(window.innerWidth)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])
  return w
}

interface ResizeHandleProps {
  side: "drawer-right" | "surface-left"
  ariaLabel: string
  onResize: (delta: number) => void
}

function ResizeHandle({ side, ariaLabel, onResize }: ResizeHandleProps) {
  const startXRef = useRef<number | null>(null)

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    startXRef.current = e.clientX
    e.currentTarget.setPointerCapture(e.pointerId)
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
  }, [])

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (startXRef.current === null) return
    const delta = e.clientX - startXRef.current
    startXRef.current = e.clientX
    onResize(delta)
  }, [onResize])

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (startXRef.current === null) return
    startXRef.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
    document.body.style.cursor = ""
    document.body.style.userSelect = ""
  }, [])

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className={cn(
        "absolute top-0 bottom-0 z-20 w-1 cursor-col-resize bg-transparent",
        "transition-colors duration-200",
        "hover:bg-[var(--accent)] hover:[transition-delay:150ms]",
        "active:bg-[var(--accent)]",
        side === "drawer-right" ? "right-0" : "left-0",
      )}
      style={{ touchAction: "none" }}
    />
  )
}

function PanelSlot({ id, params }: { id: string; params?: Record<string, unknown> }) {
  const registry = useRegistry()
  const components = useMemo(() => registry.getComponents(), [registry])
  const Component = components[id] as ComponentType<PaneProps<Record<string, unknown> | undefined>> | undefined
  const api = useMemo(() => createPanelApi(id), [id])
  if (!Component) return null
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading…</div>}>
      <Component
        params={params}
        api={api as PaneProps["api"]}
        containerApi={{} as PaneProps["containerApi"]}
      />
    </Suspense>
  )
}

function createPanelApi(id: string): Partial<PaneProps["api"]> {
  return {
    id,
    title: id,
    setTitle: () => {},
    setActive: () => {},
    close: () => {},
    updateParameters: () => {},
    onDidParametersChange: () => ({ dispose() {} }),
    onDidActiveChange: () => ({ dispose() {} }),
    onDidDimensionsChange: () => ({ dispose() {} }),
    onDidLocationChange: () => ({ dispose() {} }),
    onDidTitleChange: () => ({ dispose() {} }),
    onWillFocus: () => ({ dispose() {} }),
    onDidFocus: () => ({ dispose() {} }),
    onDidBlur: () => ({ dispose() {} }),
    onWillVisibilityChange: () => ({ dispose() {} }),
    onDidVisibilityChange: () => ({ dispose() {} }),
    onDidConstraintsChange: () => ({ dispose() {} }),
  } as Partial<PaneProps["api"]>
}

function FloatingEdgeButton({
  side,
  icon,
  onClick,
  label,
  hint,
}: {
  side: "left" | "right"
  icon: "sessions" | "workbench"
  onClick: () => void
  label: string
  hint?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={hint ? `${label} (${hint})` : label}
      className={cn(
        "absolute top-1/2 z-30 -translate-y-1/2",
        side === "left" ? "left-2" : "right-2",
        "flex h-9 w-9 flex-col items-center justify-center gap-0.5 rounded-lg",
        "bg-background text-muted-foreground",
        "shadow-[0_1px_2px_-1px_oklch(0_0_0/0.08),0_2px_8px_-4px_oklch(0_0_0/0.10),inset_0_0_0_1px_oklch(from_var(--border)_l_c_h/0.7)]",
        "transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
        "hover:text-[color:var(--accent)] hover:shadow-[0_2px_4px_-1px_oklch(0_0_0/0.08),0_4px_12px_-4px_oklch(0.62_0.14_65/0.25),inset_0_0_0_1px_oklch(0.62_0.14_65/0.35)]",
        "hover:-translate-y-[calc(50%+1px)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]/40",
      )}
    >
      {icon === "sessions" ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
          <path d="M12 7v5l3.2 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M3 7.5 A1.5 1.5 0 0 1 4.5 6 h4 l2 2 h9 A1.5 1.5 0 0 1 21 9.5 V17.5 A1.5 1.5 0 0 1 19.5 19 H4.5 A1.5 1.5 0 0 1 3 17.5 Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  )
}
