"use client"

import type { ReactNode } from "react"
import { Columns2, Zap } from "lucide-react"
import { cn } from "../../lib/utils"

export function PrimaryAction({
  icon,
  label,
  onClick,
  emphasis = false,
  active = false,
  trailing,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
  emphasis?: boolean
  active?: boolean
  trailing?: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-active={active ? "true" : undefined}
      className={cn(
        "relative flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        active
          // When an overlay is open, it owns the selected nav state.
          ? "bg-[color:oklch(from_var(--accent)_l_c_h/0.14)] text-foreground hover:bg-[color:oklch(from_var(--accent)_l_c_h/0.18)]"
          : emphasis
            ? "text-foreground hover:bg-foreground/[0.045]"
            : "text-foreground/82 hover:bg-foreground/[0.055] hover:text-foreground",
      )}
    >
      <span className={cn("grid size-5 shrink-0 place-items-center", active ? "text-[color:var(--accent)]" : emphasis ? "text-foreground/90" : "text-muted-foreground")} aria-hidden="true">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {active ? <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-[color:var(--accent)]" /> : null}
      {trailing ? <span className="shrink-0">{trailing}</span> : null}
    </button>
  )
}

export function NewChatAction({
  icon,
  onCreateSession,
  onCreateSplitSession,
  onCreatePopoverSession,
}: {
  icon: ReactNode
  onCreateSession: () => void
  onCreateSplitSession?: () => void
  onCreatePopoverSession?: () => void
}) {
  return (
    <div className="group flex h-8 w-full items-center rounded-md text-[13px] font-medium text-foreground transition-colors hover:bg-foreground/[0.045] focus-within:ring-2 focus-within:ring-ring/40">
      <button
        type="button"
        onClick={(event) => {
          onCreateSession()
          event.currentTarget.blur()
        }}
        className="flex min-w-0 flex-1 items-center gap-2 px-2 text-left focus-visible:outline-none"
      >
        <span className="grid size-5 shrink-0 place-items-center text-foreground/90" aria-hidden="true">{icon}</span>
        <span className="min-w-0 flex-1 truncate">New chat</span>
      </button>
      <span className="mr-1 flex w-0 shrink-0 items-center gap-0.5 overflow-hidden opacity-0 transition-[width,opacity] group-hover:w-auto group-hover:opacity-100 group-focus-within:w-auto group-focus-within:opacity-100">
        {onCreateSplitSession ? (
          <button
            type="button"
            aria-label="New chat in split pane"
            title="New chat in split pane"
            onClick={(event) => {
              event.stopPropagation()
              onCreateSplitSession()
              event.currentTarget.blur()
            }}
            className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <Columns2 className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
          </button>
        ) : null}
        {onCreatePopoverSession ? (
          <button
            type="button"
            aria-label="New chat in popover"
            title="New chat in popover"
            onClick={(event) => {
              event.stopPropagation()
              onCreatePopoverSession()
              event.currentTarget.blur()
            }}
            className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <Zap className="h-3.5 w-3.5" strokeWidth={1.85} aria-hidden="true" />
          </button>
        ) : null}
      </span>
    </div>
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
