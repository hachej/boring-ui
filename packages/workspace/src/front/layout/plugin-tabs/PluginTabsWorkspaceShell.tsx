"use client"

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react"
import { PanelLeftClose, PanelLeftOpen } from "lucide-react"
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@hachej/boring-ui-kit"
import { cn } from "../../lib/utils"
import { PaneCollapseButton } from "../paneCollapseButton"
import { useViewportWidth } from "../useViewportWidth"
import { isCompactViewport } from "../breakpoints"

function AppLeftPaneResizeHandle({
  width,
  minWidth,
  maxWidth,
  onResize,
}: {
  width: number
  minWidth: number
  maxWidth: number
  onResize: (delta: number) => void
}) {
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
  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const smallStep = 16
    const largeStep = 48
    if (event.key === "ArrowLeft") {
      event.preventDefault()
      onResize(event.shiftKey ? -largeStep : -smallStep)
    } else if (event.key === "ArrowRight") {
      event.preventDefault()
      onResize(event.shiftKey ? largeStep : smallStep)
    } else if (event.key === "Home") {
      event.preventDefault()
      onResize(minWidth - width)
    } else if (event.key === "End") {
      event.preventDefault()
      onResize(maxWidth - width)
    }
  }, [maxWidth, minWidth, onResize, width])

  return (
    <div
      role="separator"
      aria-label="Resize app navigation"
      aria-orientation="vertical"
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      aria-valuenow={width}
      tabIndex={0}
      onKeyDown={handleKeyDown}
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
  collapsedRail: ReactNode
  children: ReactNode
  onExpand: () => void
  onCollapse: () => void
  onResizeLeftPane?: (delta: number) => void
  leftPaneWidth?: number
  minLeftPaneWidth?: number
  maxLeftPaneWidth?: number
  className?: string
  mobileShellEnabled?: boolean
}

export function PluginTabsWorkspaceShell({
  collapsed,
  leftPane,
  collapsedRail,
  children,
  onExpand,
  onCollapse,
  onResizeLeftPane,
  leftPaneWidth,
  minLeftPaneWidth = 220,
  maxLeftPaneWidth = 420,
  className,
  mobileShellEnabled,
}: PluginTabsWorkspaceShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const viewport = useViewportWidth()
  const mobileShell = mobileShellEnabled === true && isCompactViewport(viewport)
  const effectiveCollapsed = mobileShell ? !mobileOpen : collapsed
  useEffect(() => {
    if (!mobileShell) setMobileOpen(false)
  }, [mobileShell])
  return (
    <div
      data-boring-workspace-part="plugin-tabs-shell"
      data-boring-state={effectiveCollapsed ? "collapsed" : "expanded"}
      data-mobile-shell={mobileShell ? "true" : "false"}
      className={cn("relative flex h-full min-h-0 w-full overflow-hidden bg-background", className)}
    >
      {mobileShell ? null : collapsed ? collapsedRail : leftPane}
      {!mobileShell && !collapsed && onResizeLeftPane && leftPaneWidth != null ? (
        <AppLeftPaneResizeHandle
          width={leftPaneWidth}
          minWidth={minLeftPaneWidth}
          maxWidth={maxLeftPaneWidth}
          onResize={onResizeLeftPane}
        />
      ) : null}
      <div className="relative min-w-0 flex-1">
        {children}
      </div>

      {mobileShell ? (
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent
            side="left"
            showCloseButton={false}
            data-boring-workspace-part="app-left-mobile-overlay"
            data-boring-state="open"
            onClick={(event) => {
              const target = event.target as HTMLElement | null
              if (target?.closest('[data-boring-mobile-dismiss="true"]')) setMobileOpen(false)
            }}
            className="w-[min(86vw,360px)] max-w-[360px] gap-0 p-0 shadow-2xl [&>[data-boring-workspace-part=app-left-pane]]:!w-full [&>[data-boring-workspace-part=app-left-pane]]:!min-w-0 [&>[data-boring-workspace-part=app-left-pane]]:!max-w-none"
          >
            <SheetTitle className="sr-only">App navigation</SheetTitle>
            <SheetDescription className="sr-only">Workspace actions and chats</SheetDescription>
            <SheetClose asChild>
              <button
                type="button"
                aria-label="Close app navigation"
                className="absolute left-[calc(0.375rem+env(safe-area-inset-left))] top-[calc(0.375rem+env(safe-area-inset-top))] z-10 grid size-11 place-items-center rounded-lg text-muted-foreground transition-colors motion-reduce:transition-none hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <PanelLeftClose className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </SheetClose>
            {leftPane}
          </SheetContent>
        </Sheet>
      ) : null}

      {/* The same control owns both states. Expanded chrome reserves matching
          header space; collapsed chrome occupies the rail's fixed top slot. */}
      {!mobileShell || !mobileOpen ? (
      <div className="pointer-events-none absolute left-[calc(0.375rem+env(safe-area-inset-left))] top-[calc(0.5rem+env(safe-area-inset-top))] z-[70]">
        <PaneCollapseButton
          label={effectiveCollapsed ? "Open app navigation" : "Hide app navigation"}
          side="right"
          className="app-left-pane-toggle"
          onClick={mobileShell ? () => setMobileOpen((open) => !open) : collapsed ? onExpand : onCollapse}
        >
          {effectiveCollapsed ? (
            <PanelLeftOpen className="size-4" strokeWidth={1.75} />
          ) : (
            <PanelLeftClose className="size-4" strokeWidth={1.75} />
          )}
        </PaneCollapseButton>
      </div>
      ) : null}
    </div>
  )
}
