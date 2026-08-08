"use client"

import { Columns2, ListFilter, Plus, Settings, Zap } from "lucide-react"
import { cn } from "../../lib/utils"

/** Agent labels are workspace-branded upstream; the pane shows the short form. */
export function shortAgentLabel(label: string): string {
  return label.replace(/^Boring\s+/i, "") || label
}

export interface AppLeftPaneAgentCardProps {
  agentTypeId: string
  label: string
  description?: string
  sessionCount: number
  sessionsStatus?: "loading" | "loaded" | "error"
  selected: boolean
  /** The Chats lens is an optional filter, independent from the selected Agent. */
  filtered: boolean
  onSelect?: () => void
  onToggleFilter: () => void
  onCreateSession: () => void
  onCreateSplitSession?: () => void
  onCreatePopoverSession?: () => void
  onOpenSettings?: () => void
}

const cardActionClassName = "app-left-secondary-action grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors motion-reduce:transition-none hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

export function AppLeftPaneAgentCard({
  agentTypeId,
  label,
  description,
  sessionCount,
  sessionsStatus,
  selected,
  filtered,
  onSelect,
  onToggleFilter,
  onCreateSession,
  onCreateSplitSession,
  onCreatePopoverSession,
  onOpenSettings,
}: AppLeftPaneAgentCardProps) {
  const short = shortAgentLabel(label)
  // Only fleets that publish a description get a second line; repeating the
  // Agent type id under its own label would be noise, not identity.
  const subtitle = description?.trim() || undefined
  const countLabel = sessionsStatus === "error"
    ? "chats unavailable"
    : `${sessionCount} ${sessionCount === 1 ? "chat" : "chats"}`

  return (
    <div
      data-boring-workspace-part="app-left-agent-card"
      data-boring-agent-type-id={agentTypeId}
      data-selected={selected ? "true" : "false"}
      data-filtered={filtered ? "true" : "false"}
      className={cn(
        "app-left-agent-card group relative flex w-full items-center gap-1 rounded-lg border px-1.5 py-1.5 transition-colors motion-reduce:transition-none",
        "focus-within:ring-2 focus-within:ring-ring/40",
        selected
          ? "border-[color:oklch(from_var(--accent)_l_c_h/0.35)] bg-[color:oklch(from_var(--accent)_l_c_h/0.09)]"
          : "border-border/45 bg-foreground/[0.015] hover:border-border/70 hover:bg-foreground/[0.045]",
      )}
    >
      <button
        type="button"
        data-boring-mobile-dismiss="true"
        aria-pressed={selected}
        aria-label={`Use ${label} for new chats; ${countLabel}`}
        title={subtitle}
        onClick={onSelect}
        disabled={!onSelect}
        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-md px-1 py-0.5 text-left focus-visible:outline-none disabled:cursor-default"
      >
        <span className="flex w-full min-w-0 items-center gap-1.5">
          <span className={cn("min-w-0 flex-1 truncate text-[13px] leading-4", selected ? "font-semibold text-foreground" : "font-medium text-foreground/85")}>
            {short}
          </span>
          <span
            data-boring-agent-session-count="true"
            className="shrink-0 rounded-full bg-foreground/[0.07] px-1.5 text-[10px] font-medium leading-4 tabular-nums text-muted-foreground"
          >
            {sessionsStatus === "error" ? "!" : sessionCount}
          </span>
        </span>
        {subtitle ? (
          <span className="w-full min-w-0 truncate text-[11px] leading-4 text-muted-foreground/85">{subtitle}</span>
        ) : null}
      </button>
      {/*
        Secondary actions collapse to zero width off-hover so the Agent label
        gets the whole card, matching the session-row / new-chat idiom.
      */}
      <span className="app-left-agent-card-actions flex w-0 shrink-0 items-center gap-0.5 overflow-hidden opacity-0 transition-[width,opacity] motion-reduce:transition-none group-hover:w-auto group-hover:opacity-100 group-focus-within:w-auto group-focus-within:opacity-100 data-[filtered=true]:w-auto data-[filtered=true]:opacity-100" data-filtered={filtered ? "true" : "false"}>
        <button
          type="button"
          aria-label={`${filtered ? "Clear" : "Show only"} ${label} chats`}
          title={filtered ? "Clear chat filter" : "Filter chats by this Agent"}
          aria-pressed={filtered}
          onClick={onToggleFilter}
          className={cn(
            cardActionClassName,
            filtered && "bg-[color:oklch(from_var(--accent)_l_c_h/0.16)] text-[color:var(--accent)]",
          )}
        >
          <ListFilter className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
        </button>
        {onCreateSplitSession ? (
          <button
            type="button"
            aria-label={`New chat with ${label} in split pane`}
            title="New chat in split pane"
            data-boring-mobile-dismiss="true"
            onClick={onCreateSplitSession}
            className={cardActionClassName}
          >
            <Columns2 className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
          </button>
        ) : null}
        {onCreatePopoverSession ? (
          <button
            type="button"
            aria-label={`Quick chat with ${label}`}
            title="Quick chat"
            data-boring-mobile-dismiss="true"
            onClick={onCreatePopoverSession}
            className={cardActionClassName}
          >
            <Zap className="size-3.5" strokeWidth={1.85} aria-hidden="true" />
          </button>
        ) : null}
        {onOpenSettings ? (
          <button
            type="button"
            aria-label={`Settings for ${label}`}
            title="Agent settings"
            data-boring-mobile-dismiss="true"
            onClick={onOpenSettings}
            className={cardActionClassName}
          >
            <Settings className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
          </button>
        ) : null}
      </span>
      {/* Item 3: the "+" is the card's primary affordance, so it never hides. */}
      <button
        type="button"
        aria-label={`New chat with ${label}`}
        title={`New chat with ${short}`}
        data-boring-mobile-dismiss="true"
        onClick={onCreateSession}
        className={cn(cardActionClassName, "app-left-agent-card-create text-foreground/80 hover:bg-[color:oklch(from_var(--accent)_l_c_h/0.16)] hover:text-[color:var(--accent)]")}
      >
        <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  )
}
