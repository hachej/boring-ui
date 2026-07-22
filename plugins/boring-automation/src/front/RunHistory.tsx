"use client"

import { MessageSquare } from "lucide-react"
import { Button, cn } from "@hachej/boring-ui-kit"
import type { AutomationRun } from "../shared"
import { formatDateTime, formatDuration, statusLabel, statusTone, tokenTotal } from "./format"

export function RunHistory({
  compactControls,
  runs,
  loading,
  onOpenRun,
}: {
  compactControls: boolean
  runs: AutomationRun[]
  loading: boolean
  onOpenRun: (run: AutomationRun) => void
}) {
  if (loading) {
    return <div className="px-4 py-5 text-sm text-muted-foreground">Loading run history…</div>
  }

  if (runs.length === 0) {
    return (
      <div className="px-4 py-5 text-sm text-muted-foreground">
        No runs yet. Completed runs appear here.
      </div>
    )
  }

  return (
    <ul role="list" className="divide-y divide-border/60 bg-card/70">
      {runs.map((run) => {
        const tokens = tokenTotal(run)
        const startedOrScheduled = run.startedAt ?? run.scheduledFor ?? run.createdAt
        const title = run.sessionId ? `Open session ${run.sessionId}` : "Run has no session"
        return (
          <li key={run.id} className="group flex min-h-12 items-center gap-2 px-4 py-2 text-left text-[12px] focus-within:bg-muted/40 hover:bg-muted/40 motion-reduce:transition-none">
            <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium", statusTone(run.status))}>{statusLabel(run.status)}</span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-y-1 text-foreground">
                <span className="mr-2 font-medium">{run.trigger === "scheduled" ? "Scheduled" : "Manual"}</span>
                <span className="mr-2 text-muted-foreground">Start {formatDateTime(startedOrScheduled)}</span>
                <span className="mr-2 text-muted-foreground">Duration {formatDuration(run)}</span>
                {tokens != null ? <span className="mr-2 text-muted-foreground">Tokens {tokens.toLocaleString()}</span> : null}
              </div>
              {run.error ? <div className="mt-1 line-clamp-2 text-destructive">{run.error}</div> : null}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!run.sessionId}
              aria-label={title}
              title={title}
              className="shrink-0 px-2 text-xs"
              style={{ minHeight: compactControls ? 28 : 44 }}
              onClick={() => onOpenRun(run)}
            >
              <MessageSquare className="mr-1 size-3.5" aria-hidden="true" />
              Session
            </Button>
          </li>
        )
      })}
    </ul>
  )
}
