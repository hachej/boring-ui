"use client"

import { Pin } from "lucide-react"
import type { WorkspaceInboxItemArtifactTarget, WorkspaceInboxItemViewModel } from "./inboxItemModel"
import { InboxRow } from "./InboxRow"

export function InboxSection({
  title,
  items,
  expandedIds,
  onTogglePinned,
  onToggleExpanded,
  onOpenChat,
  onOpenArtifact,
}: {
  title: string
  items: WorkspaceInboxItemViewModel[]
  expandedIds: ReadonlySet<string>
  onTogglePinned: (id: string) => void
  onToggleExpanded: (id: string) => void
  onOpenChat: (item: WorkspaceInboxItemViewModel) => void
  onOpenArtifact: (item: WorkspaceInboxItemViewModel, artifact: WorkspaceInboxItemArtifactTarget) => void
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
            expanded={expandedIds.has(item.id)}
            onTogglePinned={onTogglePinned}
            onToggleExpanded={onToggleExpanded}
            onOpenChat={onOpenChat}
            onOpenArtifact={onOpenArtifact}
          />
        ))}
      </ul>
    </section>
  )
}
