"use client"

import { MessageSquare, Star } from "lucide-react"
import { cn } from "@hachej/boring-workspace"
import { formatInboxTime, inboxItemDate, inboxItemSender, type WorkspaceInboxItemArtifactTarget, type WorkspaceInboxItemViewModel } from "./inboxItemModel"

function badgeTone(kind: WorkspaceInboxItemViewModel["kind"]): string {
  switch (kind) {
    case "review": return "bg-amber-500/12 text-amber-700 dark:text-amber-300"
    case "approval": return "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
    case "notice": return "bg-foreground/[0.07] text-muted-foreground"
    default: return "bg-[color:var(--accent)]/12 text-[color:var(--accent)]"
  }
}

function artifactLabel(artifact: WorkspaceInboxItemArtifactTarget, index: number): string {
  if (artifact.label) return artifact.label
  if (artifact.type === "surface") return artifact.target ?? artifact.surfaceKind
  return artifact.panelComponentId || `Artifact ${index + 1}`
}

export function InboxRow({
  item,
  expanded,
  onTogglePinned,
  onToggleExpanded,
  onOpenChat,
  onOpenArtifact,
}: {
  item: WorkspaceInboxItemViewModel
  expanded: boolean
  onTogglePinned: (id: string) => void
  onToggleExpanded: (id: string) => void
  onOpenChat: (item: WorkspaceInboxItemViewModel) => void
  onOpenArtifact: (item: WorkspaceInboxItemViewModel, artifact: WorkspaceInboxItemArtifactTarget) => void
}) {
  const subtitle = [item.sessionId ? `Session ${item.sessionId}` : null, item.targetLabel || null].filter(Boolean).join(" · ")
  const artifacts = item.artifacts
  const canExpand = artifacts.length > 1
  const activateRow = () => {
    if (artifacts.length === 1) {
      onOpenArtifact(item, artifacts[0]!)
      return
    }
    if (canExpand) onToggleExpanded(item.id)
  }
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        className="group flex h-11 w-full items-center gap-2 overflow-hidden px-4 text-left text-[12px] transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        aria-expanded={canExpand ? expanded : undefined}
        onClick={activateRow}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return
          event.preventDefault()
          activateRow()
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
          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", badgeTone(item.kind))}>{item.kind}</span>
          <span className="text-[11px] font-medium text-muted-foreground" title={inboxItemDate(item).toLocaleString()}>{formatInboxTime(item)}</span>
        </span>
        {item.sessionId ? (
          <button
            type="button"
            aria-label={`Open chat session ${item.sessionId}`}
            title="Open chat session"
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
      {expanded && canExpand ? (
        <div className="ml-[calc(18px+1rem)] border-l border-border/60 px-4 pb-3 pt-1">
          <div className="flex flex-wrap gap-2" aria-label={`Artifacts for ${item.title}`}>
            {artifacts.map((artifact, index) => {
              const label = artifactLabel(artifact, index)
              return (
                <button
                  key={artifact.id ?? `${artifact.type}:${label}:${index}`}
                  type="button"
                  className="rounded-md border border-border/70 bg-background px-2.5 py-1.5 text-[11px] font-medium text-foreground shadow-sm transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  onClick={() => onOpenArtifact(item, artifact)}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </li>
  )
}
