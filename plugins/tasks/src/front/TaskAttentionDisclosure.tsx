import { useState, type MouseEvent } from "react"
import { ChevronDown, Inbox, MessageSquare } from "lucide-react"
import type { WorkspaceShellCapabilities } from "@hachej/boring-workspace/plugin"
import type { TaskAttentionItem } from "./useTaskAttention"

function ageLabel(value: string | number | Date | undefined): string {
  if (value === undefined) return "now"
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return "now"
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000))
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

export function TaskAttentionDisclosure({
  items,
  shell,
}: {
  items: readonly TaskAttentionItem[]
  shell: WorkspaceShellCapabilities
}) {
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (items.length === 0) return null

  const stop = (event: MouseEvent<HTMLElement>) => event.stopPropagation()
  return (
    <div className="w-full" data-task-attention-disclosure="true" onClick={stop}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={(event) => { stop(event); setExpanded((value) => !value) }}
        className="flex min-h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-[11px] font-medium text-amber-700 outline-none transition-colors hover:bg-amber-500/10 focus-visible:ring-2 focus-visible:ring-amber-500/40 dark:text-amber-300"
      >
        <span className="size-1.5 rounded-full bg-amber-500" aria-hidden="true" />
        <span>Needs you{items.length > 1 ? ` · ${items.length}` : ""}</span>
        <ChevronDown className={`ml-auto size-3 transition-transform ${expanded ? "rotate-0" : "-rotate-90"}`} aria-hidden="true" />
      </button>
      {expanded ? (
        <div className="mt-1 grid gap-1 border-t border-border/60 pt-1.5">
          {items.map((item) => (
            <div key={item.id} className="rounded-lg bg-amber-500/[0.06] px-2 py-1.5">
              <div className="flex min-w-0 items-start gap-1">
                <button
                  type="button"
                  className="group/inbox min-w-0 flex-1 rounded-md px-1 py-0.5 text-left outline-none hover:bg-background focus-visible:ring-2 focus-visible:ring-amber-500/40"
                  aria-label={`Open Inbox item ${item.title}`}
                  onClick={(event) => {
                    stop(event)
                    const result = shell.openInboxItem(item.id)
                    setError(result.success ? null : result.message)
                  }}
                >
                  <p className="truncate text-[11px] font-medium text-foreground group-hover/inbox:underline">{item.title}</p>
                  <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Inbox className="size-3" aria-hidden="true" />
                    <span>Open in Inbox</span>
                    <span aria-hidden="true">·</span>
                    <span>{item.kind}</span>
                    <span aria-hidden="true">·</span>
                    <span>{ageLabel(item.createdAt)}</span>
                  </p>
                </button>
                <button
                  type="button"
                  className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground"
                  aria-label={`Open chat for ${item.title}`}
                  onClick={(event) => {
                    stop(event)
                    const result = shell.openDetachedChat(item.sessionId, { title: item.title })
                    setError(result.success ? null : result.message)
                  }}
                >
                  <MessageSquare className="size-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
          {error ? <p className="px-2 text-[10px] text-destructive">{error}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
