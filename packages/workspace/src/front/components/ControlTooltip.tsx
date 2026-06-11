"use client"

import type { ReactElement, ReactNode } from "react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@hachej/boring-ui-kit"

/**
 * Instant tooltip for icon-only chrome controls — no OS hover delay, with
 * an optional keyboard hint rendered after the label. Wrap the control and
 * drop its native `title` (the two together double up).
 */
export function ControlTooltip({
  label,
  hint,
  side = "top",
  children,
}: {
  label: ReactNode
  hint?: string
  side?: "top" | "bottom" | "left" | "right"
  children: ReactElement
}) {
  return (
    <TooltipProvider delayDuration={0} skipDelayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side}>
          {label}
          {hint ? <span className="ml-1.5 opacity-60">{hint}</span> : null}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
