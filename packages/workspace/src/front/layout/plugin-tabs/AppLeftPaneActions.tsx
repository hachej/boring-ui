"use client"

import type { ReactNode } from "react"
import { cn } from "../../lib/utils"

export function PrimaryAction({
  icon,
  label,
  onClick,
  emphasis = false,
  trailing,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
  emphasis?: boolean
  trailing?: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        emphasis
          // Primary CTA: a solid (borderless) filled surface so it reads as a
          // button, not an input field.
          ? "bg-foreground/[0.06] text-foreground hover:bg-foreground/[0.1]"
          : "text-foreground/82 hover:bg-foreground/[0.055] hover:text-foreground",
      )}
    >
      <span className={cn("grid size-5 shrink-0 place-items-center", emphasis ? "text-foreground/90" : "text-muted-foreground")} aria-hidden="true">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing ? <span className="shrink-0">{trailing}</span> : null}
    </button>
  )
}

/** Small keyboard-shortcut hint badge (e.g. ⌘K), Linear/Stripe-style. */
export function KbdHint({ keys }: { keys: string }) {
  return (
    <kbd aria-hidden="true" className="rounded border border-border/60 bg-foreground/[0.08] px-1.5 py-px text-[10px] font-medium leading-[1.4] tracking-wide text-muted-foreground">
      {keys}
    </kbd>
  )
}
