"use client"

import { ExternalLink, MessageSquare, Star } from "lucide-react"
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
  onOpenPreview,
  onOpenDedicated,
  onOpenChat,
}: {
  item: WorkspaceInboxItemViewModel
  onTogglePinned: (id: string) => void
  onOpenPreview: (item: WorkspaceInboxItemViewModel) => void
  onOpenDedicated: (item: WorkspaceInboxItemViewModel) => void
  onOpenChat: (item: WorkspaceInboxItemViewModel) => void
}) {
  const subtitle = [item.sessionId ? `Session ${item.sessionId}` : null, item.targetLabel || null].filter(Boolean).join(" · ")
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        className="group grid w-full grid-cols-[18px_minmax(78px,0.5fr)_minmax(0,1fr)_auto_auto_auto_auto] items-center gap-2 px-4 py-2.5 text-left text-[12px] transition-colors hover:bg-[color:oklch(from_var(--accent)_l_c_h/0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        onClick={() => onOpenPreview(item)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return
          event.preventDefault()
          onOpenPreview(item)
        }}
      >
        <span className="size-2 rounded-full bg-[color:var(--accent)]" />
        <span className="min-w-0 truncate font-semibold text-foreground">{inboxItemSender(item)}</span>
        <span className="min-w-0 truncate text-foreground">
          <span className="font-medium">{item.title}</span>
          <span className="text-muted-foreground"> — {subtitle || item.description}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", badgeTone(item.kind))}>{item.kind}</span>
          <span className="text-[11px] font-medium text-muted-foreground" title={inboxItemDate(item).toLocaleString()}>{formatInboxTime(item)}</span>
        </span>
        {item.sessionId ? (
          <button
            type="button"
            aria-label={`Open chat session ${item.sessionId}`}
            title="Open chat session"
            className="grid size-6 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/[0.06] hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 group-hover:opacity-100 group-focus-visible:opacity-100"
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
            "grid size-6 place-items-center rounded-md transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            item.pinned ? "text-[color:var(--accent)] opacity-100" : "text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
          )}
          onClick={(event) => {
            event.stopPropagation()
            onTogglePinned(item.id)
          }}
        >
          <Star className={cn("size-3.5", item.pinned && "fill-current")} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          aria-label={`Open ${item.title} in new tab`}
          title="Open in new tab"
          className="grid size-6 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/[0.06] hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 group-hover:opacity-100 group-focus-visible:opacity-100"
          onClick={(event) => {
            event.stopPropagation()
            onOpenDedicated(item)
          }}
        >
          <ExternalLink className="size-3.5" strokeWidth={1.75} />
        </button>
      </div>
    </li>
  )
}
