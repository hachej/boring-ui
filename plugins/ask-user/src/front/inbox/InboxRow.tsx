"use client"

import { ChevronDown, MessageSquare, Star } from "lucide-react"
import type { ReactNode } from "react"
import { cn } from "@hachej/boring-workspace"
import { formatInboxTime, inboxItemDate, inboxItemSender, type WorkspaceInboxItemViewModel } from "./inboxItemModel"

function badgeTone(kind: WorkspaceInboxItemViewModel["kind"]): string {
  switch (kind) {
    case "review": return "bg-amber-500/12 text-amber-700 dark:text-amber-300"
    case "approval": return "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
    case "notice": return "bg-foreground/[0.07] text-muted-foreground"
    default: return "bg-[color:var(--accent)]/12 text-[color:var(--accent)]"
  }
}

export function InboxRow({
  item,
  onTogglePinned,
  onOpenArtifact,
  onOpenChat,
  expanded = false,
  sessionTitle,
  children,
}: {
  item: WorkspaceInboxItemViewModel
  onTogglePinned: (id: string) => void
  onOpenArtifact: (item: WorkspaceInboxItemViewModel) => void
  onOpenChat: (item: WorkspaceInboxItemViewModel) => void
  expanded?: boolean
  sessionTitle?: string
  children?: ReactNode
}) {
  const subtitle = item.sessionId ? sessionTitle ?? "Linked chat" : item.description
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        className="group flex h-11 w-full items-center gap-2 overflow-hidden px-4 text-left text-[12px] transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        onClick={() => onOpenArtifact(item)}
        onKeyDown={(event) => {
          if (event.currentTarget !== event.target) return
          if (event.key !== "Enter" && event.key !== " ") return
          event.preventDefault()
          onOpenArtifact(item)
        }}
      >
        <span className="size-2 shrink-0 rounded-full bg-[color:var(--accent)]" />
        <span className="max-w-28 shrink-0 truncate font-semibold text-foreground">{inboxItemSender(item)}</span>
        <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden whitespace-nowrap text-foreground">
          <span className="truncate font-medium">{item.title}</span>
          <span className="shrink-0 text-muted-foreground">—</span>
          <span className="truncate text-muted-foreground">{subtitle || item.description}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <ChevronDown className={cn("size-3 text-muted-foreground transition-transform", expanded ? "rotate-0" : "-rotate-90")} aria-hidden="true" />
          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", badgeTone(item.kind))}>{item.kind}</span>
          <span className="text-[11px] font-medium text-muted-foreground" title={inboxItemDate(item).toLocaleString()}>{formatInboxTime(item)}</span>
        </span>
        {item.sessionId && item.chatAvailable ? (
          <button
            type="button"
            aria-label={`Open chat for ${sessionTitle ?? item.title}`}
            title="Open linked chat"
            className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/[0.06] hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 group-hover:opacity-100 group-focus-visible:opacity-100"
            onClick={(event) => {
              event.stopPropagation()
              onOpenChat(item)
            }}
          >
            <MessageSquare className="size-3.5" strokeWidth={1.75} />
          </button>
        ) : null}
        <button
          type="button"
          aria-label={`${item.pinned ? "Unpin" : "Pin"} ${item.title}`}
          title={item.pinned ? "Unpin" : "Pin"}
          className={cn(
            "grid size-6 shrink-0 place-items-center rounded-md transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            item.pinned ? "text-[color:var(--accent)] opacity-100" : "text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
          )}
          onClick={(event) => {
            event.stopPropagation()
            onTogglePinned(item.id)
          }}
        >
          <Star className={cn("size-3.5", item.pinned && "fill-current")} strokeWidth={1.75} />
        </button>
      </div>
      {expanded ? <div className="border-t border-border/60 bg-background">{children}</div> : null}
    </li>
  )
}
