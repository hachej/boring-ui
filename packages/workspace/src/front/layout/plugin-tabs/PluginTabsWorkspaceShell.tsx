"use client"

import type { ReactNode } from "react"
import { PanelLeft } from "lucide-react"
import { IconButton } from "@hachej/boring-ui-kit"
import { ControlTooltip } from "../../components/ControlTooltip"
import { cn } from "../../lib/utils"

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
      <div className="pointer-events-none absolute left-3 top-3 z-[70]">
        <ControlTooltip label={collapsed ? "Open app navigation" : "Collapse app navigation"} side="right">
          <IconButton
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={collapsed ? onExpand : onCollapse}
            aria-label={collapsed ? "Open app navigation" : "Collapse app navigation"}
            title={collapsed ? "Open app navigation" : "Collapse app navigation"}
            aria-pressed={!collapsed}
            className={cn(
              "pointer-events-auto h-9 w-9 rounded-xl bg-background/90 text-muted-foreground shadow-[0_1px_2px_-1px_oklch(0_0_0/0.08),0_2px_10px_-5px_oklch(0_0_0/0.18),inset_0_0_0_1px_oklch(from_var(--border)_l_c_h/0.75)] backdrop-blur transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-ring/40",
              !collapsed && "bg-foreground/[0.09] text-foreground shadow-[0_1px_2px_-1px_oklch(0_0_0/0.10),0_4px_14px_-6px_oklch(0_0_0/0.22),inset_0_0_0_1px_oklch(from_var(--border)_l_c_h/0.9)]",
            )}
          >
            <PanelLeft className="h-4 w-4" strokeWidth={1.75} />
          </IconButton>
        </ControlTooltip>
      </div>
    </div>
  )
}
