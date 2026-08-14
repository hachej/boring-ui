"use client"

import type { ReactNode } from "react"
import { Check, ChevronDown, Columns2, MoreHorizontal, Plus, Zap } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@hachej/boring-ui-kit"
import { cn } from "../../lib/utils"
import { ControlTooltip } from "../../components/ControlTooltip"

export function PrimaryAction({
  entryKey,
  icon,
  label,
  onClick,
  emphasis = false,
  active = false,
  trailing,
}: {
  entryKey?: string
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
      data-boring-app-left-nav-key={entryKey}
      data-boring-mobile-dismiss="true"
      data-active={active ? "true" : undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        "app-left-primary-action relative flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-left text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          // When an overlay is open, it owns the selected nav state.
          ? "bg-[color:oklch(from_var(--accent)_l_c_h/0.14)] font-semibold text-foreground hover:bg-[color:oklch(from_var(--accent)_l_c_h/0.18)]"
          : emphasis
            ? "text-foreground hover:bg-foreground/[0.045]"
            : "text-foreground/82 hover:bg-foreground/[0.055] hover:text-foreground",
      )}
    >
      <span className={cn("grid size-4 shrink-0 place-items-center", active ? "text-[color:var(--accent)]" : emphasis ? "text-foreground/90" : "text-muted-foreground")} aria-hidden="true">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing ? <span className="shrink-0">{trailing}</span> : null}
    </button>
  )
}

export function RailAction({
  entryKey,
  icon,
  label,
  onClick,
  active = false,
  trailing,
}: {
  entryKey?: string
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
        data-boring-app-left-nav-key={entryKey}
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
            className="app-left-secondary-action grid place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
            className="app-left-secondary-action grid place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Zap className="h-3.5 w-3.5" strokeWidth={1.85} aria-hidden="true" />
          </button>
        ) : null}
      </span>
    </div>
  )
}

export function FleetNewChatAction({
  agents,
  selectedAgentTypeId,
  onSelectAgent,
  onCreateSession,
  onCreateSplitSession,
  onCreatePopoverSession,
}: {
  agents: readonly { agentTypeId: string; label: string }[]
  selectedAgentTypeId?: string
  /** Retargets new chats without creating one; creation stays explicit. */
  onSelectAgent?: (agentTypeId: string) => void
  onCreateSession: (agentTypeId: string) => void
  onCreateSplitSession?: (agentTypeId: string) => void
  onCreatePopoverSession?: (agentTypeId: string) => void
}) {
  const selected = agents.find((agent) => agent.agentTypeId === selectedAgentTypeId) ?? agents[0]
  if (!selected) return null
  const shortLabel = selected.label.replace(/^Boring\s+/i, "") || selected.label

  return (
    <div data-boring-workspace-part="app-left-fleet-new-chat" className="app-left-new-chat-action group/fleet-create flex h-[30px] w-full items-center rounded-md text-[13px] font-medium text-foreground hover:bg-foreground/[0.045] focus-within:ring-2 focus-within:ring-ring/40">
      <button
        type="button"
        onClick={() => onCreateSession(selected.agentTypeId)}
        aria-label={`Start new chat with ${selected.label}`}
        className="flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-left focus-visible:outline-none"
      >
        <Plus className="size-4 shrink-0 text-foreground/90" strokeWidth={2} aria-hidden="true" />
        <span className="shrink-0">New chat</span>
        <span className="min-w-0 flex-1 truncate text-right text-[11px] font-normal text-muted-foreground">{shortLabel}</span>
      </button>
      <span className="app-left-new-chat-secondary pointer-events-none flex w-0 shrink-0 items-center overflow-hidden opacity-0 transition-[width,opacity] group-hover/fleet-create:pointer-events-auto group-hover/fleet-create:w-auto group-hover/fleet-create:opacity-100 group-focus-within/fleet-create:pointer-events-auto group-focus-within/fleet-create:w-auto group-focus-within/fleet-create:opacity-100 motion-reduce:transition-none">
        {onCreateSplitSession ? (
          <button
            type="button"
            aria-label={`Start split chat with ${selected.label}`}
            title="New chat in split pane"
            onClick={() => onCreateSplitSession(selected.agentTypeId)}
            className="app-left-secondary-action grid shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Columns2 className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
          </button>
        ) : null}
        {onCreatePopoverSession ? (
          <button
            type="button"
            aria-label={`Start quick chat with ${selected.label}`}
            title="Quick chat"
            onClick={() => onCreatePopoverSession(selected.agentTypeId)}
            className="app-left-secondary-action grid shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Zap className="size-3.5" strokeWidth={1.85} aria-hidden="true" />
          </button>
        ) : null}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="Choose Agent for new chat" title="Choose Agent" className="app-left-secondary-action grid shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ChevronDown className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent data-boring-workspace-part="app-left-menu" align="end" sideOffset={6} className="w-52 border-border/60">
          {/* Tiebroken with the row index: the fleet arrives from the host and
              nothing guarantees agentTypeId is unique, so two entries sharing a
              key would put the checkmark on the wrong Agent. */}
          {agents.map((agent, index) => (
            <DropdownMenuItem key={`${agent.agentTypeId}\u0000${index}`} onSelect={() => onSelectAgent?.(agent.agentTypeId)} className="gap-2 text-[13px]">
              <span className="grid size-4 place-items-center" aria-hidden="true">
                {agent.agentTypeId === selected.agentTypeId ? <Check className="size-3.5" strokeWidth={2} /> : null}
              </span>
              <span className="truncate">{agent.label.replace(/^Boring\s+/i, "") || agent.label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
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
