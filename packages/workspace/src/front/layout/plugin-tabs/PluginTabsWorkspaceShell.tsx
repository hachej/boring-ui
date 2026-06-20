"use client"

import type { ReactNode } from "react"
import { PanelLeftOpen } from "lucide-react"
import { cn } from "../../lib/utils"
import { CornerChromeButton } from "../cornerChrome"

export interface PluginTabsWorkspaceShellProps {
  collapsed: boolean
  leftPane: ReactNode
  children: ReactNode
  onExpand: () => void
  /** Optional content hosted as a chat overlay (e.g. Skills / Plugins).
   *  When set, rendered over the entire chat region — not as a workbench/
   *  workspace panel — so it covers all open chat panes (including split
   *  panes), not just the left edge. */
  leftOverlay?: ReactNode | null
  className?: string
}

export function PluginTabsWorkspaceShell({
  collapsed,
  leftPane,
  children,
  onExpand,
  leftOverlay,
  className,
}: PluginTabsWorkspaceShellProps) {
  return (
    <div
      data-boring-workspace-part="plugin-tabs-shell"
      data-boring-state={collapsed ? "collapsed" : "expanded"}
      className={cn("relative flex h-full min-h-0 w-full overflow-hidden bg-background", className)}
    >
      {collapsed ? null : leftPane}
      <div className="relative min-w-0 flex-1">
        {children}
        {leftOverlay ? (
          <div
            data-boring-workspace-part="chat-left-overlay"
            className="absolute inset-0 z-40 flex bg-background"
          >
            <div className="mx-auto flex w-full max-w-2xl flex-col border-x border-border bg-background">
              {leftOverlay}
            </div>
          </div>
        ) : null}
      </div>
      {/* Collapsed-only restore control. When the pane is expanded, the
          collapse control lives inside AppLeftPane (matching the
          workbench-left "Hide workspace menu" rail button). When collapsed,
          render a floating restore control whose icon size (16px) matches the
          workbench "Show workspace menu" overlay so the two left-pane collapse
          controls read as the same family. Hidden while a chat overlay is open
          over the collapsed pane. */}
      {collapsed && !leftOverlay ? (
        <div className="pointer-events-none absolute left-3 top-2.5 z-[70]">
          <CornerChromeButton
            label="Open app navigation"
            side="right"
            onClick={onExpand}
            pressed={false}
          >
            <PanelLeftOpen className="h-4 w-4" strokeWidth={1.75} />
          </CornerChromeButton>
        </div>
      ) : null}
    </div>
  )
}