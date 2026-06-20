"use client"

import type { ReactNode } from "react"
import { PanelLeftClose, PanelLeftOpen } from "lucide-react"
import { cn } from "../../lib/utils"
import { CornerChromeButton } from "../cornerChrome"

export interface PluginTabsWorkspaceShellProps {
  collapsed: boolean
  leftPane: ReactNode
  children: ReactNode
  onExpand: () => void
  onCollapse: () => void
  /** Optional content hosted as a chat left overlay (e.g. Skills / Plugins).
   *  When set, rendered as an absolute panel over the chat region's left
   *  edge — not as a workbench/workspace panel. */
  leftOverlay?: ReactNode | null
  className?: string
}

export function PluginTabsWorkspaceShell({
  collapsed,
  leftPane,
  children,
  onExpand,
  onCollapse,
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
            className="absolute inset-y-0 left-0 z-40 flex w-[400px] max-w-[85%] flex-col border-r border-border bg-background"
          >
            {leftOverlay}
          </div>
        ) : null}
      </div>
      {leftOverlay && collapsed ? null : (
        <div className="pointer-events-none absolute left-3 top-2.5 z-[70]">
          <CornerChromeButton
            label={collapsed ? "Open app navigation" : "Collapse app navigation"}
            side="right"
            onClick={collapsed ? onExpand : onCollapse}
            pressed={!collapsed}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-3" strokeWidth={1.75} />
            ) : (
              <PanelLeftClose className="size-3" strokeWidth={1.75} />
            )}
          </CornerChromeButton>
        </div>
      )}
    </div>
  )
}
