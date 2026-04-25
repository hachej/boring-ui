"use client"

import { useContext } from "react"
import { Plus, Search } from "lucide-react"
import { cn } from "../../lib/utils"
import { ChatShellContext } from "./context"

export interface ChatTopBarProps {
  appTitle?: string
  sessionTitle?: string
  userInitial?: string
  onAvatarClick?: () => void
  onCommandPalette?: () => void
  className?: string
}

export function ChatTopBar({
  appTitle = "Boring",
  sessionTitle,
  userInitial = "J",
  onAvatarClick,
  onCommandPalette,
  className,
}: ChatTopBarProps) {
  const shell = useContext(ChatShellContext)

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
        {shell?.onNewChat && (
          <button
            type="button"
            onClick={shell.onNewChat}
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
        <button
          type="button"
          onClick={onAvatarClick}
          className={cn(
            "group relative ml-1 flex h-7 w-7 items-center justify-center rounded-full",
            "bg-gradient-to-br from-[color:var(--accent)] to-[oklch(0.52_0.16_40)] text-[11px] font-semibold text-white",
            "shadow-[0_1px_2px_-1px_oklch(0_0_0/0.1),inset_0_0_0_1px_oklch(1_0_0/0.12)]",
            "transition-all duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
            "hover:shadow-[0_2px_6px_-2px_oklch(0.62_0.14_65/0.4),inset_0_0_0_1px_oklch(1_0_0/0.2)]",
            "hover:-translate-y-[0.5px]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--canvas)]",
          )}
          aria-label="Account"
          title="Account"
        >
          <span aria-hidden="true" className="pointer-events-none select-none tracking-tight">
            {userInitial}
          </span>
        </button>
      </div>
    </header>
  )
}
