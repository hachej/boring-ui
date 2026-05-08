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
        "relative flex items-center justify-between gap-2 px-3",
        "bg-background border-b border-[color:oklch(from_var(--border)_l_c_h/0.4)]",
        className,
      )}
      style={{ height: 40 }}
      aria-label="App top bar"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        {topBarLeft ?? (
          <>
            <img
              src="https://chatgpt.com/backend-api/estuary/content?id=file_000000006a4471f4b8411fcbfde271c6&ts=493962&p=fs&cid=1&sig=b406cfec61d387bdedd898858283b389f31ad2bd3eb7a358a6d1efa23e9afa83&v=0"
              alt={appTitle}
              className="h-6 w-6 shrink-0 rounded-md"
            />
            <span className="truncate text-[12px] font-medium tracking-tight text-foreground">{appTitle}</span>
            {sessionTitle && (
              <>
                <span aria-hidden="true" className="text-muted-foreground/30">/</span>
                <span className="truncate text-[12px] font-normal text-muted-foreground">{sessionTitle}</span>
              </>
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
        className="group h-6 gap-1 px-1.5 text-[12px] text-muted-foreground/60 hover:bg-transparent hover:text-foreground focus-visible:text-foreground"
        aria-label="Search catalogs and commands"
        title="Command palette (⌘K)"
      >
        <Search className="h-3 w-3 shrink-0 opacity-70" strokeWidth={1.75} />
        <span className="font-normal tracking-tight">Search</span>
        <Kbd className="ml-1 border-0 bg-transparent p-0 text-[10px] shadow-none group-hover:text-muted-foreground">⌘K</Kbd>
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
