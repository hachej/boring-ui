"use client"

import type { ReactNode } from "react"
import { Columns2, MoreHorizontal, Plus, Settings, Zap } from "lucide-react"
import { cn } from "../../lib/utils"
import { ControlTooltip } from "../../components/ControlTooltip"

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
      data-boring-mobile-dismiss="true"
      data-active={active ? "true" : undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        "app-left-primary-action relative flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          // When an overlay is open, it owns the selected nav state.
          ? "bg-[color:oklch(from_var(--accent)_l_c_h/0.14)] font-semibold text-foreground hover:bg-[color:oklch(from_var(--accent)_l_c_h/0.18)]"
          : emphasis
            ? "text-foreground hover:bg-foreground/[0.045]"
            : "text-foreground/82 hover:bg-foreground/[0.055] hover:text-foreground",
      )}
    >
      <span className={cn("grid size-5 shrink-0 place-items-center", active ? "text-[color:var(--accent)]" : emphasis ? "text-foreground/90" : "text-muted-foreground")} aria-hidden="true">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing ? <span className="shrink-0">{trailing}</span> : null}
    </button>
  )
}

export function RailAction({
  icon,
  label,
  onClick,
  active = false,
  trailing,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
  active?: boolean
  trailing?: ReactNode
}) {
  return (
    <ControlTooltip label={label} side="right">
      <button
        type="button"
        aria-label={label}
        data-active={active ? "true" : undefined}
        aria-current={active ? "page" : undefined}
        onClick={onClick}
        className={cn(
          "app-left-rail-action relative grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors motion-reduce:transition-none",
          "hover:bg-foreground/[0.055] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          active && "bg-[color:oklch(from_var(--accent)_l_c_h/0.14)] text-[color:var(--accent)]",
        )}
      >
        <span className="grid size-5 place-items-center" aria-hidden="true">
          {icon ?? <MoreHorizontal className="h-4 w-4" strokeWidth={1.75} />}
        </span>
        {trailing ? (
          <span className="pointer-events-none absolute right-0 top-0 max-w-5 truncate rounded-full bg-background px-1 text-[9px] font-semibold leading-4 text-foreground shadow-sm" aria-hidden="true">
            {trailing}
          </span>
        ) : null}
      </button>
    </ControlTooltip>
  )
}

export function NewChatAction({
  icon,
  agentLabel,
  onCreateSession,
  onCreateSplitSession,
  onCreatePopoverSession,
}: {
  icon: ReactNode
  agentLabel?: string
  onCreateSession: () => void
  onCreateSplitSession?: () => void
  onCreatePopoverSession?: () => void
}) {
  return (
    <div className="app-left-new-chat-action group flex h-8 w-full items-center rounded-md text-[13px] font-medium text-foreground transition-colors motion-reduce:transition-none hover:bg-foreground/[0.045] focus-within:ring-2 focus-within:ring-ring">
      <button
        type="button"
        aria-label={agentLabel ? `New chat with ${agentLabel}` : undefined}
        data-boring-mobile-dismiss="true"
        onClick={(event) => {
          onCreateSession()
          event.currentTarget.blur()
        }}
        className="flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-left focus-visible:outline-none"
      >
        <span className="grid size-5 shrink-0 place-items-center text-foreground/90" aria-hidden="true">{icon}</span>
        <span className="min-w-0 flex-1 truncate">New chat</span>
      </button>
      <span className="app-left-new-chat-secondary mr-1 flex w-0 shrink-0 items-center gap-0.5 overflow-hidden opacity-0 transition-opacity motion-reduce:transition-none group-hover:w-auto group-hover:opacity-100 group-focus-within:w-auto group-focus-within:opacity-100">
        {onCreateSplitSession ? (
          <button
            type="button"
            aria-label={agentLabel ? `New chat with ${agentLabel} in split pane` : "New chat in split pane"}
            title={agentLabel ? `New chat with ${agentLabel} in split pane` : "New chat in split pane"}
            data-boring-mobile-dismiss="true"
            onClick={(event) => {
              event.stopPropagation()
              onCreateSplitSession()
              event.currentTarget.blur()
            }}
            className="app-left-secondary-action grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Columns2 className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
          </button>
        ) : null}
        {onCreatePopoverSession ? (
          <button
            type="button"
            aria-label={agentLabel ? `Quick chat with ${agentLabel}` : "Quick chat"}
            title={agentLabel ? `Quick chat with ${agentLabel}` : "Quick chat"}
            data-boring-mobile-dismiss="true"
            onClick={(event) => {
              event.stopPropagation()
              onCreatePopoverSession()
              event.currentTarget.blur()
            }}
            className="app-left-secondary-action grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Zap className="h-3.5 w-3.5" strokeWidth={1.85} aria-hidden="true" />
          </button>
        ) : null}
      </span>
    </div>
  )
}

export function AgentChatActions({
  agentLabel,
  onCreateSession,
  onCreateSplitSession,
  onCreatePopoverSession,
  onOpenSettings,
}: {
  agentLabel: string
  onCreateSession: () => void
  onCreateSplitSession?: () => void
  onCreatePopoverSession?: () => void
  onOpenSettings?: () => void
}) {
  const actions = [
    onCreateSplitSession ? { label: `New chat with ${agentLabel} in split pane`, title: "New chat in split pane", icon: <Columns2 className="size-3.5" strokeWidth={1.75} />, onClick: onCreateSplitSession } : null,
    onCreatePopoverSession ? { label: `Quick chat with ${agentLabel}`, title: "Quick chat", icon: <Zap className="size-3.5" strokeWidth={1.85} />, onClick: onCreatePopoverSession } : null,
    { label: `New chat with ${agentLabel}`, title: "New chat", icon: <Plus className="size-4" strokeWidth={2} />, onClick: onCreateSession },
    onOpenSettings ? { label: `Settings for ${agentLabel}`, title: "Agent settings", icon: <Settings className="size-3.5" strokeWidth={1.75} />, onClick: onOpenSettings } : null,
  ].filter((action): action is NonNullable<typeof action> => Boolean(action))

  return (
    <span className="app-left-agent-actions pointer-events-none flex shrink-0 items-center opacity-0">
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          aria-label={action.label}
          title={action.title}
          data-boring-mobile-dismiss="true"
          onClick={() => action.onClick()}
          className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span aria-hidden="true">{action.icon}</span>
        </button>
      ))}
    </span>
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
