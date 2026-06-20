"use client"

import type { ReactNode } from "react"
import { PanelLeft } from "lucide-react"
import { cn } from "../../lib/utils"
import { CornerChromeButton } from "../cornerChrome"

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
      <div className="min-w-0 flex-1">{children}</div>
:      <div className="pointer-events-none absolute left-3 top-2.5 z-[70]">
        <CornerChromeButton
          label={collapsed ? "Open app navigation" : "Collapse app navigation"}
          side="right"
          onClick={collapsed ? onExpand : onCollapse}
          pressed={!collapsed}
        >
          <PanelLeft className="size-3" strokeWidth={1.75} />
        </CornerChromeButton>
      </div>
    </div>
  )
}
