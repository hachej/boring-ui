"use client"

import type { ReactNode } from "react"
import { PanelLeftClose, PanelLeftOpen } from "lucide-react"
import { cn } from "../../lib/utils"
import { PaneCollapseButton } from "../paneCollapseButton"

export interface PluginTabsWorkspaceShellProps {
  collapsed: boolean
  leftPane: ReactNode
  children: ReactNode
  onExpand: () => void
  onCollapse: () => void
  className?: string
}

export function PluginTabsWorkspaceShell({
  collapsed,
  leftPane,
  children,
  onExpand,
  onCollapse,
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
      </div>

      {/* One collapse rule: same place, same button style in both states;
          only the icon changes. The app pane reserves matching header padding
          while expanded, and the collapsed chat tab strip keeps 48px leading
          clearance via dockview-overrides.css. */}
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
