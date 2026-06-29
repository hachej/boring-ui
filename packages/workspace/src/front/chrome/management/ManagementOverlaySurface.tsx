"use client"

import type { ReactNode } from "react"
import { cn } from "../../lib/utils"

export interface ManagementOverlaySurfaceProps {
  part: string
  icon: ReactNode
  title: string
  description: string
  actions?: ReactNode
  headerInsetStart?: boolean
  headerInsetEnd?: boolean
  children: ReactNode
}

/**
 * Shared shell for app-left management overlays (Skills, Plugins, and host/
 * plugin-provided tools) so they use one header/content surface contract.
 */
export function ManagementOverlaySurface({
  part,
  icon,
  title,
  description,
  actions,
  headerInsetStart = false,
  headerInsetEnd = false,
  children,
}: ManagementOverlaySurfaceProps) {
  return (
    <div data-boring-workspace-part={part} className="flex h-full min-h-0 flex-col bg-background">
      <header className={cn(
        "flex h-12 shrink-0 items-center justify-between border-b border-border/60",
        headerInsetStart ? "pl-12" : "pl-4",
        headerInsetEnd ? "pr-16" : "pr-4",
      )}>
        <div className="flex min-w-0 items-center gap-2">
          {icon}
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold tracking-tight text-foreground">{title}</h2>
            <p className="truncate text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-0.5">{actions}</div> : null}
      </header>
      {children}
    </div>
  )
}
