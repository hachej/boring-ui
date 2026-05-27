"use client"

import type { ReactNode } from "react"
import { Plus, Search } from "lucide-react"
import { Button, IconButton, Kbd } from "@hachej/boring-ui-kit"
import { cn } from "../lib/utils"

export interface TopBarProps {
  appTitle?: string
  sessionTitle?: string
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
  onCommandPalette,
  onNewChat,
  topBarLeft,
  topBarRight,
  className,
}: TopBarProps) {
  const right = topBarRight ?? null

  return (
    <header
      data-boring-workspace-part="topbar"
      className={cn(
        "relative flex h-11 items-center justify-between gap-2 px-3",
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
              {(appTitle?.[0] ?? "B").toUpperCase()}
            </span>
            {sessionTitle ? (
              <>
                <span className="shrink-0 text-[13px] font-medium leading-none tracking-tight text-foreground/65">{appTitle}</span>
                <span aria-hidden="true" className="text-[13px] leading-none text-muted-foreground/45">·</span>
                <span className="truncate text-[13px] font-medium leading-none tracking-tight text-foreground">{sessionTitle}</span>
              </>
            ) : (
              <span className="truncate text-[13px] font-medium leading-none tracking-tight text-foreground">{appTitle}</span>
            )}
          </>
        )}
      </div>

      {/* Command palette trigger — minimalist, no background */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onCommandPalette}
        className="group h-7 gap-1.5 px-2 text-[13px] leading-none text-muted-foreground/75 hover:bg-muted/70 hover:text-foreground focus-visible:text-foreground"
        aria-label="Search catalogs and commands"
        title="Command palette (⌘K)"
      >
        <Search className="h-3.5 w-3.5 shrink-0 opacity-80" strokeWidth={1.75} />
        <span className="font-normal tracking-tight">Search</span>
        <Kbd className="ml-0.5 bg-muted/40 leading-none shadow-none">⌘K</Kbd>
      </Button>

      <div className="flex flex-1 shrink-0 items-center justify-end gap-1">
        {onNewChat && (
          <IconButton
            type="button"
            variant="ghost"
            size="icon-sm"
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
