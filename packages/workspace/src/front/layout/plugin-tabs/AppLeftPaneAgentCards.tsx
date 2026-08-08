"use client"

import { ChevronRight, Columns2, ListFilter, MoreHorizontal, Plus, Settings, Zap } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@hachej/boring-ui-kit"
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
  /** Chats currently working (streaming/executing) for this Agent. */
  workingCount?: number
  /** Chats waiting on the user (question/review/approval badges). */
  attentionCount?: number
  sessionsStatus?: "loading" | "loaded" | "error"
  /** The Chats lens is an optional filter (multi-project tree only). */
  filtered: boolean
  /**
   * When the pane nests each Agent's chats under its card, the card is a
   * disclosure row: default click means exactly one thing — toggle its nested
   * chat list. New-chat targeting lives on the New chat picker and the "+".
   */
  expandable?: boolean
  expanded?: boolean
  onToggle?: () => void
  /** Omitted in nested mode: the disclosure replaces the per-Agent lens. */
  onToggleFilter?: () => void
  onCreateSession: () => void
  onCreateSplitSession?: () => void
  onCreatePopoverSession?: () => void
  onOpenSettings?: () => void
}

// Coarse pointers get the 44px touch target from main; desktop keeps the
// compact 24px action of the nested design.
const cardActionClassName = "app-left-secondary-action grid size-11 shrink-0 place-items-center sm:size-6 rounded-md text-muted-foreground transition-colors motion-reduce:transition-none hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

export function AppLeftPaneAgentCard({
  agentTypeId,
  label,
  description,
  sessionCount,
  workingCount = 0,
  attentionCount = 0,
  sessionsStatus,
  filtered,
  expandable = false,
  expanded = false,
  onToggle,
  onToggleFilter,
  onCreateSession,
  onCreateSplitSession,
  onCreatePopoverSession,
  onOpenSettings,
}: AppLeftPaneAgentCardProps) {
  const short = shortAgentLabel(label)
  // The description no longer earns a second line: compact rows show it only
  // as the row tooltip so Agent rows match session-row density.
  const subtitle = description?.trim() || undefined
  const countLabel = sessionsStatus === "error"
    ? "chats unavailable"
    : `${sessionCount} ${sessionCount === 1 ? "chat" : "chats"}`

  return (
    <div
      data-boring-workspace-part="app-left-agent-card"
      data-boring-agent-type-id={agentTypeId}
      data-filtered={filtered ? "true" : "false"}
      data-expanded={expandable ? (expanded ? "true" : "false") : undefined}
      className={cn(
        // Owner-ratified look: flat compact rows (no card borders/boxes),
        // session-row density; hover reveals the secondary actions.
        "app-left-agent-card app-left-agent-row group relative flex min-h-7 w-full items-center gap-0.5 rounded-md px-1 py-0.5 transition-colors motion-reduce:transition-none",
        // Tint on hover only — a mouse click must not leave a lingering ring
        // that reads as "selected"; keyboard focus still gets its ring.
        "hover:bg-foreground/[0.05] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/40",
      )}
    >
      <button
        type="button"
        aria-expanded={expandable ? expanded : undefined}
        aria-label={`${expandable ? `${expanded ? "Collapse" : "Expand"} ` : ""}${label}; ${countLabel}`}
        title={subtitle ? `${label} — ${subtitle}` : label}
        onClick={onToggle}
        disabled={!onToggle}
        className="flex min-h-11 sm:min-h-0 sm:h-6 min-w-0 flex-1 items-center gap-1 rounded-md px-0.5 text-left focus-visible:outline-none disabled:cursor-default"
      >
        {expandable ? (
          <ChevronRight
            className={cn("size-3 shrink-0 text-muted-foreground/70 transition-transform motion-reduce:transition-none", expanded && "rotate-90")}
            strokeWidth={1.75}
            aria-hidden="true"
          />
        ) : null}
        <span className={cn("min-w-0 truncate text-[13px] leading-4", expandable && expanded ? "font-semibold text-foreground" : "font-medium text-foreground/80")}>
          {short}
        </span>
        <span
          data-boring-agent-session-count="true"
          className="min-w-0 flex-1 shrink-0 pl-0.5 text-[11px] font-normal leading-4 tabular-nums text-muted-foreground/80"
        >
          {sessionsStatus === "error" ? "!" : sessionCount}
        </span>
        {/* Aggregate liveliness: quiet dot+count pairs so a collapsed Agent
            still tells you something is running or waiting on you. */}
        {workingCount > 0 ? (
          <span
            data-boring-workspace-part="agent-card-working-count"
            title={`${workingCount} ${workingCount === 1 ? "chat is" : "chats are"} working`}
            className="flex shrink-0 items-center gap-0.5 pl-1 text-[10px] tabular-nums leading-4 text-[color:var(--accent)]"
          >
            <span className="size-1.5 animate-pulse rounded-full bg-[color:var(--accent)] motion-reduce:animate-none" aria-hidden="true" />
            {workingCount}
            <span className="sr-only">working</span>
          </span>
        ) : null}
        {attentionCount > 0 ? (
          <span
            data-boring-workspace-part="agent-card-attention-count"
            title={`${attentionCount} ${attentionCount === 1 ? "chat needs" : "chats need"} your input`}
            className="flex shrink-0 items-center gap-0.5 pl-1 text-[10px] tabular-nums leading-4 text-amber-700 dark:text-amber-300"
          >
            <span className="size-1.5 rounded-full bg-amber-500" aria-hidden="true" />
            {attentionCount}
            <span className="sr-only">waiting for you</span>
          </span>
        ) : null}
      </button>
      {/*
        Secondary actions collapse to zero width off-hover so the Agent label
        gets the whole card, matching the session-row / new-chat idiom.
      */}
      {/* Reveal on hover or keyboard focus; a mouse click on the row must not
          leave the icons pinned open (plain focus-within would). */}
      <span className="app-left-agent-card-actions flex w-0 shrink-0 items-center gap-0.5 overflow-hidden opacity-0 transition-[width,opacity] motion-reduce:transition-none group-hover:w-auto group-hover:opacity-100 group-has-[:focus-visible]:w-auto group-has-[:focus-visible]:opacity-100 data-[filtered=true]:w-auto data-[filtered=true]:opacity-100" data-filtered={filtered ? "true" : "false"}>
        {onToggleFilter ? (
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
        {onCreateSplitSession || onCreatePopoverSession ? (
          // One "+" creates the default chat; this caret is the single place
          // for the placement variants (owner: three placement icons were too
          // many — compact into one affordance, keep the options).
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`New chat options for ${label}`}
                title="More ways to start a chat"
                className={cardActionClassName}
              >
                <MoreHorizontal className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              <DropdownMenuItem onSelect={() => onCreateSession()}>
                <Plus className="h-3.5 w-3.5" /> New chat
              </DropdownMenuItem>
              {onCreateSplitSession ? (
                <DropdownMenuItem onSelect={() => onCreateSplitSession()}>
                  <Columns2 className="h-3.5 w-3.5" /> New chat in split pane
                </DropdownMenuItem>
              ) : null}
              {onCreatePopoverSession ? (
                <DropdownMenuItem onSelect={() => onCreatePopoverSession()}>
                  <Zap className="h-3.5 w-3.5" /> Quick chat
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </span>
      {/* The "+" is the card's primary affordance, so it never hides. */}
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
