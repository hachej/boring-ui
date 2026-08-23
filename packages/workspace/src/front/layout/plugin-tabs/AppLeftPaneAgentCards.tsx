"use client"

import type { ReactNode } from "react"
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

/** One pass over the pane's chats, not three scalars scanned three times. */
export interface AppLeftPaneAgentStats {
  sessions: number
  /** Chats currently working (streaming/executing) for this Agent. */
  working: number
  /** Chats waiting on the user (question/review/approval badges). */
  attention: number
}

export interface AppLeftPaneAgentCardProps {
  agentTypeId: string
  label: string
  description?: string
  leadingIcon?: ReactNode
  stats: AppLeftPaneAgentStats
  /**
   * A raw chat count is inventory, not a call to action, and it competes for
   * the eye with the amber "needs you" rollup right beside it. Surfaces that
   * want the header to carry ONLY actionable signal turn it off.
   */
  showSessionCount?: boolean
  sessionsStatus?: "loading" | "loaded" | "error"
  /** The Chats lens is an optional filter (multi-project tree only). */
  filtered: boolean
  /** Quiet ancestry state for the Agent that owns the active chat. */
  active?: boolean
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
  showCreate?: boolean
  createControl?: ReactNode
  onCreateSplitSession?: () => void
  onCreatePopoverSession?: () => void
  onOpenSettings?: () => void
}

// Coarse pointers get the 44px touch target from main; desktop keeps the
// compact 24px action of the nested design.
// No Tailwind size utility: `.app-left-secondary-action` (globals.css) owns
// the size, keyed to the pointer, so it cannot disagree with the pointer-keyed
// 44px touch rule the way a width-keyed `size-11 sm:size-6` pair did.
const cardActionClassName = "app-left-secondary-action grid shrink-0 place-items-center rounded-md text-muted-foreground transition-colors motion-reduce:transition-none hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

export function AppLeftPaneAgentCard({
  agentTypeId,
  label,
  description,
  leadingIcon,
  stats,
  showSessionCount = true,
  sessionsStatus,
  filtered,
  active = false,
  expandable = false,
  expanded = false,
  onToggle,
  onToggleFilter,
  onCreateSession,
  showCreate = true,
  createControl,
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
    : showSessionCount
      ? `${stats.sessions} ${stats.sessions === 1 ? "chat" : "chats"}`
      : undefined
  // The working/attention pills carry `sr-only` text, but they sit INSIDE a
  // button with an explicit aria-label, which replaces its content for
  // assistive tech — so screen-reader users heard the chat count and nothing
  // about liveliness. The accessible name states all three.
  const livelinessLabel = [
    stats.working > 0 ? `${stats.working} working` : undefined,
    stats.attention > 0 ? `${stats.attention} ${stats.attention === 1 ? "needs" : "need"} you` : undefined,
  ].filter(Boolean).join("; ")

  return (
    <div
      data-boring-workspace-part="app-left-agent-card"
      data-boring-agent-type-id={agentTypeId}
      data-filtered={filtered ? "true" : "false"}
      data-active={active ? "true" : "false"}
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
        aria-label={[
          `${expandable ? `${expanded ? "Collapse" : "Expand"} ` : ""}${label}`,
          countLabel,
          livelinessLabel || undefined,
        ].filter(Boolean).join("; ")}
        title={subtitle ? `${label} — ${subtitle}` : label}
        onClick={onToggle}
        disabled={!onToggle}
        className="flex min-w-0 flex-1 self-stretch items-center gap-1 rounded-md px-0.5 text-left focus-visible:outline-none disabled:cursor-default"
      >
        {expandable ? (
          <ChevronRight
            className={cn("size-3 shrink-0 text-muted-foreground/70 transition-transform motion-reduce:transition-none", expanded && "rotate-90")}
            strokeWidth={1.75}
            aria-hidden="true"
          />
        ) : null}
        {leadingIcon ? <span className="grid size-4 shrink-0 place-items-center text-muted-foreground/70" aria-hidden="true">{leadingIcon}</span> : null}
        <span className={cn("min-w-0 truncate text-[13px] leading-4", (active || (expandable && expanded)) ? "font-semibold text-foreground" : "font-medium text-foreground/80")}>
          {short}
        </span>
        <span
          data-boring-agent-session-count="true"
          className="min-w-0 flex-1 shrink-0 pl-0.5 text-[11px] font-normal leading-4 tabular-nums text-muted-foreground/80"
        >
          {sessionsStatus === "error" ? "!" : !showSessionCount || (expandable && expanded) ? null : stats.sessions}
        </span>
        {/* Aggregate liveliness: quiet dot+count pairs so a collapsed Agent
            still tells you something is running or waiting on you. */}
        {stats.working > 0 ? (
          <span
            data-boring-workspace-part="agent-card-working-count"
            title={`${stats.working} ${stats.working === 1 ? "chat is" : "chats are"} working`}
            className="flex shrink-0 items-center gap-0.5 pl-1 text-[10px] tabular-nums leading-4 text-[color:var(--accent)]"
          >
            <span className="size-1.5 animate-pulse rounded-full bg-[color:var(--accent)] motion-reduce:animate-none" aria-hidden="true" />
            {stats.working}
            <span className="sr-only">working</span>
          </span>
        ) : null}
        {stats.attention > 0 ? (
          <span
            data-boring-workspace-part="agent-card-attention-count"
            title={`${stats.attention} ${stats.attention === 1 ? "chat needs" : "chats need"} your input`}
            className="flex shrink-0 items-center gap-0.5 pl-1 text-[10px] tabular-nums leading-4 text-[color:var(--attention)]"
          >
            <span className="size-1.5 rounded-full bg-[color:var(--attention)]" aria-hidden="true" />
            {stats.attention}
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
          // for the placement variants in the normal current-app Agent row.
          <DropdownMenu modal={false}>
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
            <DropdownMenuContent data-boring-workspace-part="app-left-menu" align="end" className="min-w-44">
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
      {/* The "+" is the card's primary affordance when its context is complete. */}
      {createControl ?? (showCreate ? (
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
      ) : null)}
    </div>
  )
}
