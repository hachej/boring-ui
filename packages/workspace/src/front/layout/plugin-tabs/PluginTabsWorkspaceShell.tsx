"use client"

import type { ReactNode } from "react"
import { PanelLeftOpen } from "lucide-react"
import { IconButton } from "@hachej/boring-ui-kit"
import { ControlTooltip } from "../../components/ControlTooltip"
import { cn } from "../../lib/utils"

export interface PluginTabsWorkspaceShellProps {
  collapsed: boolean
  leftPane: ReactNode
  children: ReactNode
  onExpand: () => void
  className?: string
}

export function PluginTabsWorkspaceShell({
  collapsed,
  leftPane,
  children,
  onExpand,
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
      {collapsed ? (
        <div className="pointer-events-none absolute left-2 top-[52px] z-40">
          <ControlTooltip label="Open app navigation" side="right">
            <IconButton
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onExpand}
              aria-label="Open app navigation"
              title="Open app navigation"
              className="pointer-events-auto h-9 w-9 rounded-lg bg-background/90 text-muted-foreground shadow-[0_1px_2px_-1px_oklch(0_0_0/0.08),0_2px_8px_-4px_oklch(0_0_0/0.10),inset_0_0_0_1px_oklch(from_var(--border)_l_c_h/0.75)] backdrop-blur hover:bg-muted hover:text-foreground"
            >
              <PanelLeftOpen className="h-4 w-4" strokeWidth={1.75} />
            </IconButton>
          </ControlTooltip>
        </div>
      ) : null}
    </div>
  )
}
