"use client"

import { useId, type ReactNode } from "react"
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
  const titleId = useId()
  const descriptionId = useId()

  return (
    <section
      data-boring-workspace-part={part}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className="flex h-full min-h-0 flex-col bg-background"
    >
      <header className={cn(
        "flex h-12 shrink-0 items-center justify-between border-b border-border/60",
        headerInsetStart ? "pl-12" : "pl-4",
        headerInsetEnd ? "pr-16" : "pr-4",
      )}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="shrink-0">{icon}</div>
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-sm font-semibold tracking-tight text-foreground" title={title}>{title}</h2>
            <p id={descriptionId} className="truncate text-xs text-muted-foreground" title={description}>{description}</p>
          </div>
        </div>
        {actions ? <div role="group" aria-label={`${title} actions`} className="flex shrink-0 items-center gap-0.5">{actions}</div> : null}
      </header>
      {children}
    </section>
  )
}
