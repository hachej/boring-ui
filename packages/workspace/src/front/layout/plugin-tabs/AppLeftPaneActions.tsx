"use client"

import { useState, type ReactNode } from "react"
import { ChevronRight, Columns2, Zap } from "lucide-react"
import { cn } from "../../lib/utils"

interface AgentNewChatOption {
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
  ariaLabel,
  splitAriaLabel = "New chat in split pane",
  onCreateSession,
  onCreateSplitSession,
  onCreatePopoverSession,
}: {
  icon: ReactNode
  label?: string
  ariaLabel?: string
  splitAriaLabel?: string
  onCreateSession: () => void
  onCreateSplitSession?: () => void
  onCreatePopoverSession?: () => void
}) {
  return (
    <div className="group flex h-8 w-full items-center rounded-md text-[13px] font-medium text-foreground transition-colors hover:bg-foreground/[0.045] focus-within:ring-2 focus-within:ring-ring/40">
      <button
        type="button"
        aria-label={ariaLabel}
        title={ariaLabel}
        onClick={(event) => {
          onCreateSession()
          event.currentTarget.blur()
        }}
        className="flex min-w-0 flex-1 items-center gap-2 px-2 text-left focus-visible:outline-none"
      >
        <span className="grid size-5 shrink-0 place-items-center text-foreground/90" aria-hidden="true">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </button>
      <span className="mr-1 flex w-0 shrink-0 items-center gap-0.5 overflow-hidden opacity-0 transition-[width,opacity] group-hover:w-auto group-hover:opacity-100 group-focus-within:w-auto group-focus-within:opacity-100">
        {onCreateSplitSession ? (
          <button
            type="button"
            aria-label={splitAriaLabel}
            title={splitAriaLabel}
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
            aria-label="Quick chat"
            title="Quick chat"
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

export function AgentNewChatActions({
  agents,
  onCreateSession,
  onCreateSplitSession,
}: {
  agents: readonly AgentNewChatOption[]
  onCreateSession: (agentTypeId: string) => void
  onCreateSplitSession?: (agentTypeId: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const renderAgentAction = (agent: AgentNewChatOption) => (
    <NewChatAction
      icon={<Zap className="h-3.5 w-3.5" strokeWidth={1.85} />}
      label={agent.label}
      ariaLabel={`New chat with ${agent.label}`}
      splitAriaLabel={`New chat with ${agent.label} in split`}
      onCreateSession={() => onCreateSession(agent.agentTypeId)}
      onCreateSplitSession={onCreateSplitSession
        ? () => onCreateSplitSession(agent.agentTypeId)
        : undefined}
    />
  )

  if (agents.length === 1) return renderAgentAction(agents[0]!)

  return (
    <section data-boring-workspace-part="app-left-agent-actions">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] font-medium text-foreground transition-colors hover:bg-foreground/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <ChevronRight
          className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150", expanded && "rotate-90")}
          strokeWidth={2}
          aria-hidden="true"
        />
        <span>Agents</span>
      </button>
      {expanded ? (
        <ul aria-label="Agents available for new chat" className="mt-0.5 space-y-0.5 pl-3">
          {agents.map((agent) => (
            <li key={agent.agentTypeId} aria-label={agent.label}>
              {renderAgentAction(agent)}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
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
