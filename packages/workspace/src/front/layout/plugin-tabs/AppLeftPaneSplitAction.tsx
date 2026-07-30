"use client"

import type { MouseEventHandler } from "react"
import { Columns2 } from "lucide-react"
import { cn } from "../../lib/utils"

export function AppLeftPaneSplitAction({
  ariaLabel,
  title,
  onClick,
  touchResponsive = false,
  transitionColors = false,
}: {
  ariaLabel: string
  title: string
  onClick: MouseEventHandler<HTMLButtonElement>
  touchResponsive?: boolean
  transitionColors?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={title}
      onClick={onClick}
      className={cn(
        "grid shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        transitionColors && "transition-colors",
        touchResponsive
          ? "size-11 [@media(hover:hover)_and_(min-width:640px)]:size-6"
          : "size-6",
      )}
    >
      <Columns2 className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
    </button>
  )
}
