"use client"

import type { ReactNode } from "react"
import { Plus, Search } from "lucide-react"
import { Button, IconButton, Kbd } from "@hachej/boring-ui-kit"
import { cn } from "../lib/utils"

export interface TopBarProps {
  appTitle?: string
  sessionTitle?: string
  /**
   * Human label of the Agent that owns the chat named by `sessionTitle`, e.g.
   * "Coder". The host resolves it and omits it when the workspace has fewer
   * than two Agents — with one Agent there is nothing to disambiguate, so the
   * bar degrades to exactly its previous title-only form. Presentational: this
   * component never reads fleet state itself.
   */
  sessionAgentLabel?: string
  onCommandPalette?: () => void
  onNewChat?: () => void
  /** Override the brand/title block on the left. Hosts pass workspace
   *  switchers, breadcrumbs, etc. here. When set, the default
   *  `[B] appTitle / sessionTitle` block is replaced entirely. */
  topBarLeft?: ReactNode
  /** Override the avatar on the right. The new-chat (+) button stays —
   *  it's session-mechanic, not host chrome. Hosts pass theme toggles,
   *  user menus, etc. here. */
  topBarRight?: ReactNode
  className?: string
}

export function TopBar({
  appTitle = "Boring",
  sessionTitle,
  sessionAgentLabel,
  onCommandPalette,
  onNewChat,
  topBarLeft,
  topBarRight,
  className,
}: TopBarProps) {
  const right = topBarRight ?? null
  const primaryTitle = sessionTitle || appTitle
  // Only a CHAT gets Agent provenance. When there is no session title the bar
  // is showing the app name, and naming an Agent beside that would attribute
  // the workspace itself to one persona.
  const agentLabel = sessionTitle ? sessionAgentLabel : undefined

  return (
    <header
      data-boring-workspace-part="topbar"
      className={cn(
        "relative flex min-h-11 items-center justify-between gap-2",
        "pl-[calc(0.75rem+env(safe-area-inset-left))] pr-[calc(0.75rem+env(safe-area-inset-right))] pt-[env(safe-area-inset-top)]",
        "bg-background border-b border-border",
        className,
      )}
      aria-label="App top bar"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5 leading-none">
        {topBarLeft ?? (
          <>
            <span
              aria-hidden="true"
              className="grid size-[22px] shrink-0 place-items-center rounded-sm bg-foreground text-[11px] font-semibold leading-none tracking-tight text-background"
            >
              {(primaryTitle?.[0] ?? "B").toUpperCase()}
            </span>
            <span
              className="min-w-0 shrink-[2] truncate text-[13px] font-medium leading-none tracking-tight text-foreground"
              title={agentLabel ? `${primaryTitle} — ${agentLabel}` : primaryTitle}
            >
              {primaryTitle}
            </span>
            {agentLabel ? (
              // Secondary, never competing with the title: the same quiet 11px
              // provenance idiom the pinned-chat rows and the docked pane header
              // use. It shrinks and truncates ahead of nothing and behind the
              // title, so it can never push the search or avatar controls out.
              <span
                data-boring-workspace-part="topbar-agent"
                className="min-w-0 shrink truncate text-[11px] font-medium leading-none text-muted-foreground"
              >
                {agentLabel}
              </span>
            ) : null}
          </>
        )}
      </div>

      {/* Command palette trigger — minimalist, no background */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onCommandPalette}
        className="topbar-search-action group h-7 gap-1.5 px-2 text-[13px] leading-none text-muted-foreground/75 hover:bg-muted/70 hover:text-foreground focus-visible:text-foreground"
        aria-label="Search catalogs and commands"
        title="Command palette (⌘K)"
      >
        <Search className="h-3.5 w-3.5 shrink-0 opacity-80" strokeWidth={1.75} />
        <span className="font-normal tracking-tight">Search</span>
        <Kbd className="topbar-desktop-hint ml-0.5 bg-muted/40 leading-none shadow-none">⌘K</Kbd>
      </Button>

      <div className="flex flex-1 shrink-0 items-center justify-end gap-1">
        {onNewChat && (
          <IconButton
            type="button"
            variant="ghost"
            size="icon-sm"
            className="topbar-icon-action"
            onClick={onNewChat}
            aria-label="New chat"
            title="New chat"
          >
            <Plus className="h-4 w-4" />
          </IconButton>
        )}
        {right}
      </div>
    </header>
  )
}
