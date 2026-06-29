"use client"

import type { ReactNode } from "react"
import { ControlTooltip } from "../components/ControlTooltip"
import { cn } from "../lib/utils"

export interface PaneCollapseButtonProps {
  label: string
  onClick: () => void
  children: ReactNode
  side?: "top" | "right" | "bottom" | "left"
  className?: string
}

/**
 * Canonical chrome for left-pane collapse/expand controls.
 *
 * Rule: collapsed and expanded states keep the same button position, size,
 * style, and icon family. The action changes; the chrome does not jump.
 */
export function PaneCollapseButton({
  label,
  onClick,
  children,
  side = "right",
  className,
}: PaneCollapseButtonProps) {
  return (
    <ControlTooltip label={label} side={side}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className={cn(
          "pointer-events-auto flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors",
          "hover:bg-background/70 hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
          className,
        )}
      >
        {children}
      </button>
    </ControlTooltip>
  )
}
