"use client"

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react"
import { PanelLeftClose, PanelLeftOpen } from "lucide-react"
import { cn } from "../../lib/utils"
import { PaneCollapseButton } from "../paneCollapseButton"

function AppLeftPaneResizeHandle({ onResize }: { onResize: (delta: number) => void }) {
  const lastXRef = useRef<number | null>(null)
  const handlePointerMove = useCallback((event: PointerEvent) => {
    if (lastXRef.current == null) return
    const delta = event.clientX - lastXRef.current
    lastXRef.current = event.clientX
    if (delta !== 0) onResize(delta)
  }, [onResize])
  const stopResize = useCallback(() => {
    lastXRef.current = null
    document.body.style.cursor = ""
    document.body.style.userSelect = ""
    window.removeEventListener("pointermove", handlePointerMove)
    window.removeEventListener("pointerup", stopResize)
  }, [handlePointerMove])
  const startResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    lastXRef.current = event.clientX
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", stopResize)
  }, [handlePointerMove, stopResize])

  return (
    <div
      role="separator"
      aria-label="Resize app navigation"
      aria-orientation="vertical"
      onPointerDown={startResize}
      className="group relative z-20 -ml-px w-1 shrink-0 cursor-col-resize touch-none bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-foreground/30 group-active:bg-foreground/45" />
    </div>
  )
}

export interface PluginTabsWorkspaceShellProps {
  collapsed: boolean
  leftPane: ReactNode
  children: ReactNode
  onExpand: () => void
  onCollapse: () => void
  onResizeLeftPane?: (delta: number) => void
  className?: string
}

export function PluginTabsWorkspaceShell({
  collapsed,
  leftPane,
  children,
  onExpand,
  onCollapse,
  onResizeLeftPane,
  className,
}: PluginTabsWorkspaceShellProps) {
  // Ephemeral peek: when the pane is collapsed, hovering the left edge slides
  // the pane in as an overlay (it does not push the content or pin open). It
  // retracts when the pointer leaves the overlay.
  const [peek, setPeek] = useState(false)
  return (
    <div
      data-boring-workspace-part="plugin-tabs-shell"
      data-boring-state={collapsed ? "collapsed" : "expanded"}
      className={cn("relative flex h-full min-h-0 w-full overflow-hidden bg-background", className)}
    >
      {collapsed ? null : leftPane}
      {!collapsed && onResizeLeftPane ? <AppLeftPaneResizeHandle onResize={onResizeLeftPane} /> : null}
      <div className="relative min-w-0 flex-1">
        {children}
      </div>

      {/* Ephemeral peek (collapsed only): hover the left edge to reveal the
          pane as an overlay. The overlay is mounted ONLY while peeking, so the
          collapsed state is genuinely empty otherwise (an always-mounted,
          transform-hidden overlay left the pane visible). */}
      {collapsed ? (
        <>
          <div
            data-boring-workspace-part="app-left-peek-trigger"
            className="absolute inset-y-0 left-0 z-[60] w-3"
            onMouseEnter={() => setPeek(true)}
            aria-hidden="true"
          />
          {peek ? (
            <div
              data-boring-workspace-part="app-left-peek"
              data-boring-state="open"
              onMouseLeave={() => setPeek(false)}
              className="absolute inset-y-0 left-0 z-[65] flex shadow-2xl"
            >
              {leftPane}
            </div>
          ) : null}
        </>
      ) : null}

      {/* One collapse rule: same place and style in both states; only the
          quiet panel glyph changes to show open vs close mode. The app pane
          reserves matching header padding while expanded, and the collapsed
          chat tab strip keeps 48px leading clearance via dockview-overrides.css. */}
      <div className="pointer-events-none absolute left-1.5 top-2 z-[70]">
        <PaneCollapseButton
          label={collapsed ? "Open app navigation" : "Hide app navigation"}
          side="right"
          onClick={collapsed ? onExpand : onCollapse}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" strokeWidth={1.75} />
          ) : (
            <PanelLeftClose className="h-4 w-4" strokeWidth={1.75} />
          )}
        </PaneCollapseButton>
      </div>
    </div>
  )
}
