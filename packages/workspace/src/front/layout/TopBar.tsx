"use client"

import type { ReactNode } from "react"
import { useTopBarSlot } from "@boring/core/front/top-bar-slot"
import { Plus, Search } from "lucide-react"
import { cn } from "../../lib/utils"

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
  const slot = useTopBarSlot()
  const right = topBarRight ?? slot ?? null

  return (
    <header
      className={cn(
        "relative flex items-center justify-between gap-3 px-4",
        "bg-background border-b border-[color:oklch(from_var(--border)_l_c_h/0.4)]",
        className,
      )}
      style={{ height: 52 }}
      aria-label="App top bar"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        {topBarLeft ?? (
          <>
            <div
              aria-hidden="true"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-foreground text-[12px] font-semibold text-background"
            >
              {appTitle.charAt(0).toUpperCase()}
            </div>
            <span className="truncate text-[13px] font-medium tracking-tight text-foreground">{appTitle}</span>
            {sessionTitle && (
              <>
                <span aria-hidden="true" className="text-muted-foreground/30">/</span>
                <span className="truncate text-[13px] font-normal text-muted-foreground">{sessionTitle}</span>
              </>
            )}
          </>
        )}
      </div>

      {/* Command palette trigger — minimalist, no background */}
      <button
        type="button"
        onClick={onCommandPalette}
        className={cn(
          "group flex h-7 items-center gap-1.5 rounded px-1.5 text-[12.5px] text-muted-foreground/60",
          "transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
          "hover:text-foreground",
          "focus-visible:outline-none focus-visible:text-foreground",
        )}
        aria-label="Search, commands, or files"
        title="Command palette (⌘K)"
      >
        <Search className="h-3.5 w-3.5 shrink-0 opacity-70" strokeWidth={1.75} />
        <span className="font-normal tracking-tight">Search</span>
        <kbd className="ml-1 font-mono text-[10px] tracking-tight text-muted-foreground/50 group-hover:text-muted-foreground">⌘K</kbd>
      </button>

      <div className="flex flex-1 shrink-0 items-center justify-end gap-1">
        {onNewChat && (
          <button
            type="button"
            onClick={onNewChat}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-md",
              "text-muted-foreground transition-colors",
              "hover:bg-foreground/5 hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            )}
            aria-label="New chat"
            title="New chat"
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
        {right}
      </div>
    </header>
  )
}
