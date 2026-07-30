"use client"

import type { ReactNode } from "react"
import { Plus, Zap } from "lucide-react"
import { cn } from "../../lib/utils"
import { AppLeftPaneSplitAction } from "./AppLeftPaneSplitAction"

export interface AgentNewChatOption {
  agentTypeId: string
  label: string
}

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
  label = "New chat",
  meta,
  ariaLabel,
  splitAriaLabel = "New chat in split pane",
  quickChatAriaLabel = "Quick chat",
  onCreateSession,
  onCreateSplitSession,
  onCreatePopoverSession,
}: {
  icon: ReactNode
  label?: ReactNode
  meta?: ReactNode
  ariaLabel?: string
  splitAriaLabel?: string
  quickChatAriaLabel?: string
  onCreateSession: () => void
  onCreateSplitSession?: () => void
  onCreatePopoverSession?: () => void
}) {
  return (
    <div className="group flex h-11 w-full items-center rounded-md text-[13px] font-medium text-foreground transition-colors hover:bg-foreground/[0.045] focus-within:ring-2 focus-within:ring-ring/40 [@media(hover:hover)_and_(min-width:640px)]:h-8">
      <button
        type="button"
        aria-label={ariaLabel}
        title={ariaLabel}
        onClick={(event) => {
          onCreateSession()
          event.currentTarget.blur()
        }}
        className="flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-left focus-visible:outline-none"
      >
        <span className="grid size-5 shrink-0 place-items-center text-foreground/90" aria-hidden="true">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {meta ? <span className="shrink-0">{meta}</span> : null}
      </button>
      <span className="flex w-auto shrink-0 items-center gap-0.5 overflow-hidden opacity-100 transition-[width,opacity] [@media(hover:hover)_and_(min-width:640px)]:mr-1 [@media(hover:hover)_and_(min-width:640px)]:w-0 [@media(hover:hover)_and_(min-width:640px)]:opacity-0 [@media(hover:hover)_and_(min-width:640px)]:group-hover:w-auto [@media(hover:hover)_and_(min-width:640px)]:group-hover:opacity-100 [@media(hover:hover)_and_(min-width:640px)]:group-focus-within:w-auto [@media(hover:hover)_and_(min-width:640px)]:group-focus-within:opacity-100">
        {onCreateSplitSession ? (
          <AppLeftPaneSplitAction
            ariaLabel={splitAriaLabel}
            title={splitAriaLabel}
            touchResponsive
            transitionColors
            onClick={(event) => {
              event.stopPropagation()
              onCreateSplitSession()
              event.currentTarget.blur()
            }}
          />
        ) : null}
        {onCreatePopoverSession ? (
          <button
            type="button"
            aria-label={quickChatAriaLabel}
            title={quickChatAriaLabel}
            onClick={(event) => {
              event.stopPropagation()
              onCreatePopoverSession()
              event.currentTarget.blur()
            }}
            className="grid size-11 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 [@media(hover:hover)_and_(min-width:640px)]:size-6"
          >
            <Zap className="h-3.5 w-3.5" strokeWidth={1.85} aria-hidden="true" />
          </button>
        ) : null}
      </span>
    </div>
  )
}

export function AgentNewChatAction({
  label,
  ariaLabel,
  splitAriaLabel,
  quickChatAriaLabel,
  onCreateSession,
  onCreateSplitSession,
  onCreatePopoverSession,
}: {
  label: ReactNode
  ariaLabel: string
  splitAriaLabel: string
  quickChatAriaLabel: string
  onCreateSession: () => void
  onCreateSplitSession?: () => void
  onCreatePopoverSession?: () => void
}) {
  return (
    <div className="group flex min-h-8 w-full items-center gap-2 rounded-md border border-transparent px-2.5 py-1 text-left text-[13px] font-medium text-foreground/78 transition-colors hover:bg-foreground/[0.055] hover:text-foreground">
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          aria-label={ariaLabel}
          title={ariaLabel}
          onClick={(event) => {
            onCreateSession()
            event.currentTarget.blur()
          }}
          className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.85} aria-hidden="true" />
        </button>
        {onCreateSplitSession ? (
          <AppLeftPaneSplitAction
            ariaLabel={splitAriaLabel}
            title={splitAriaLabel}
            onClick={(event) => {
              onCreateSplitSession()
              event.currentTarget.blur()
            }}
          />
        ) : null}
        {onCreatePopoverSession ? (
          <button
            type="button"
            aria-label={quickChatAriaLabel}
            title={quickChatAriaLabel}
            onClick={(event) => {
              onCreatePopoverSession()
              event.currentTarget.blur()
            }}
            className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <Zap className="h-3.5 w-3.5" strokeWidth={1.85} aria-hidden="true" />
          </button>
        ) : null}
      </span>
    </div>
  )
}

export function SingleAgentNewChatAction({
  agent,
  label,
  onCreateSession,
  onCreateSplitSession,
  onCreatePopoverSession,
}: {
  agent: AgentNewChatOption
  label: ReactNode
  onCreateSession: (agentTypeId: string) => void
  onCreateSplitSession?: (agentTypeId: string) => void
  onCreatePopoverSession?: (agentTypeId: string) => void
}) {
  return (
    <AgentNewChatAction
      label={label}
      ariaLabel={`New chat with ${agent.label}`}
      splitAriaLabel={`New chat with ${agent.label} in split`}
      quickChatAriaLabel={`Quick chat with ${agent.label}`}
      onCreateSession={() => onCreateSession(agent.agentTypeId)}
      onCreateSplitSession={onCreateSplitSession
        ? () => onCreateSplitSession(agent.agentTypeId)
        : undefined}
      onCreatePopoverSession={onCreatePopoverSession
        ? () => onCreatePopoverSession(agent.agentTypeId)
        : undefined}
    />
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
