"use client"

import { cn } from "../../../front/lib/utils"
import type { InboxFilter } from "./inboxItemModel"

export function InboxFilterBar({
  filter,
  counts,
  onFilterChange,
}: {
  filter: InboxFilter
  counts: Record<InboxFilter, number>
  onFilterChange: (filter: InboxFilter) => void
}) {
  return (
    <div className="flex shrink-0 gap-1 border-b border-border/60 bg-[color:oklch(from_var(--background)_calc(l-0.012)_c_h)] px-4 py-2">
      {([
        ["all", "All", counts.all],
        ["questions", "Questions", counts.questions],
        ["reviews", "Reviews", counts.reviews],
      ] as const).map(([id, label, count]) => (
        <button
          key={id}
          type="button"
          onClick={() => onFilterChange(id)}
          className={cn(
            "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            filter === id
              ? "bg-[color:oklch(from_var(--accent)_l_c_h/0.14)] text-[color:var(--accent)]"
              : "bg-transparent text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground",
          )}
        >
          {label} <span className="ml-1 opacity-70">{count}</span>
        </button>
      ))}
    </div>
  )
}
