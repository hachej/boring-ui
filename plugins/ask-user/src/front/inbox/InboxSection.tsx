"use client"

import { Pin } from "lucide-react"
import type { ReactNode } from "react"
import type { WorkspaceInboxItemViewModel } from "./inboxItemModel"
import { InboxRow } from "./InboxRow"

export function InboxSection({
  title,
  items,
  onTogglePinned,
  onOpenArtifact,
  onOpenChat,
  expandedItemId,
  renderExpanded,
}: {
  title: string
  items: WorkspaceInboxItemViewModel[]
  onTogglePinned: (id: string) => void
  onOpenArtifact: (item: WorkspaceInboxItemViewModel) => void
  onOpenChat: (item: WorkspaceInboxItemViewModel) => void
  expandedItemId?: string | null
  renderExpanded?: (item: WorkspaceInboxItemViewModel) => ReactNode
}) {
  if (items.length === 0) return null
  return (
    <section className="py-1">
      <div className="flex items-center gap-1 px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
        {title === "Pinned" ? <Pin className="size-3" strokeWidth={1.75} /> : null}
        {title}
      </div>
      <ul role="list" className="divide-y divide-border/60 bg-card/80">
        {items.map((item) => (
          <InboxRow
            key={item.id}
            item={item}
            onTogglePinned={onTogglePinned}
            onOpenArtifact={onOpenArtifact}
            onOpenChat={onOpenChat}
            expanded={expandedItemId === item.id}
          >
            {expandedItemId === item.id ? renderExpanded?.(item) : null}
          </InboxRow>
        ))}
      </ul>
    </section>
  )
}
