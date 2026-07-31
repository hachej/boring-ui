"use client"

import { ChevronDown, FileText, Pause, Play, Trash2 } from "lucide-react"
import { Button, cn } from "@hachej/boring-ui-kit"
import type { Automation, AutomationRun } from "../shared"
import { formatDateTime, statusLabel, statusTone } from "./format"
import { RunHistory } from "./RunHistory"

export function AutomationCard({
  automation,
  compactControls,
  expanded,
  deleting,
  runs,
  runsLoading,
  runsUnavailable,
  runningNow,
  togglingEnabled,
  onToggle,
  onEdit,
  onRunNow,
  onToggleEnabled,
  onOpenPrompt,
  onDeleteRequest,
  onDeleteCancel,
  onDeleteConfirm,
  onOpenRun,
}: {
  automation: Automation
  compactControls: boolean
  expanded: boolean
  deleting: boolean
  runs: AutomationRun[]
  runsLoading: boolean
  runsUnavailable: boolean
  runningNow: boolean
  togglingEnabled: boolean
  onToggle: () => void
  onEdit: () => void
  onRunNow: () => void
  onToggleEnabled: () => void
  onOpenPrompt: () => void
  onDeleteRequest: () => void
  onDeleteCancel: () => void
  onDeleteConfirm: () => void
  onOpenRun: (run: AutomationRun) => void
}) {
  const historyId = `automation-runs-${automation.id}`
  const deleteTitleId = `automation-delete-title-${automation.id}`
  const lastRun = runs[0]
  return (
    <article className="border-b border-border/60 bg-card/80 last:border-b-0">
      <div className="group flex min-h-14 w-full flex-wrap items-center gap-x-2 gap-y-1.5 px-3 text-[13px] transition-colors hover:bg-muted/50 focus-within:bg-muted/50 motion-reduce:transition-none sm:flex-nowrap" style={{ minHeight: compactControls ? 48 : 56, paddingBlock: compactControls ? 4 : 6 }}>
        <button
          type="button"
          className="flex min-w-0 items-center gap-2.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          style={{ flex: "1 1 32rem", minHeight: compactControls ? 36 : 44 }}
          aria-expanded={expanded}
          aria-controls={historyId}
          onClick={onToggle}
        >
          <ChevronDown className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none", expanded && "rotate-180")} aria-hidden="true" />
          <span className={cn("size-2 shrink-0 rounded-full", automation.enabled ? "bg-[color:var(--success)]" : "bg-muted-foreground/40")} aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-foreground">{automation.title}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {automation.enabled ? "Active" : "Paused"} · {automation.cron} · {automation.timezone} · {automation.model}
              <span className="ml-1.5">· Last run </span>
              {runsLoading ? (
                <span>Loading…</span>
              ) : runsUnavailable ? (
                <span>Unavailable</span>
              ) : lastRun ? (
                <span aria-label={`Last run ${statusLabel(lastRun.status)}`} className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-medium", statusTone(lastRun.status))}>{statusLabel(lastRun.status)}</span>
              ) : (
                <span>None</span>
              )}
            </span>
          </span>
          <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">Updated {formatDateTime(automation.updatedAt)}</span>
        </button>
        <div className="flex min-w-0 items-center gap-1" style={{ marginLeft: "auto" }}>
          <Button className="text-[13px]" style={{ minHeight: compactControls ? 32 : 44 }} type="button" variant="ghost" size="sm" onClick={onToggleEnabled} disabled={togglingEnabled || deleting} aria-label={`${automation.enabled ? "Pause" : "Resume"} ${automation.title}`}>
            {automation.enabled ? <Pause className="size-3.5" aria-hidden="true" /> : <Play className="size-3.5" aria-hidden="true" />}
            {togglingEnabled ? "Saving…" : automation.enabled ? "Pause" : "Resume"}
          </Button>
          <Button className="text-[13px]" style={{ minHeight: compactControls ? 32 : 44 }} type="button" variant="ghost" size="sm" onClick={onRunNow} disabled={runningNow || togglingEnabled || deleting} aria-label={`Run ${automation.title} now`}>
            <Play className="size-3.5" aria-hidden="true" />
            {runningNow ? "Running…" : "Run now"}
          </Button>
          <Button className="text-[13px]" style={{ minHeight: compactControls ? 32 : 44 }} type="button" variant="ghost" size="sm" onClick={onOpenPrompt} disabled={togglingEnabled || deleting} aria-label={`Open prompt for ${automation.title}`}>
            <FileText className="size-3.5" aria-hidden="true" />
            Prompt
          </Button>
          <Button className="text-[13px]" style={{ minHeight: compactControls ? 32 : 44 }} type="button" variant="ghost" size="sm" onClick={onEdit} disabled={togglingEnabled || deleting}>Edit</Button>
          <Button style={{ height: compactControls ? 32 : 44, minHeight: compactControls ? 32 : 44, minWidth: compactControls ? 32 : 44, width: compactControls ? 32 : 44 }} type="button" variant="ghost" size="icon-sm" aria-label={`Delete ${automation.title}`} title="Delete" onClick={onDeleteRequest} disabled={togglingEnabled || deleting}>
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {deleting ? (
        <div className="border-t border-border/60 bg-background px-4 py-3 text-sm" role="region" aria-labelledby={deleteTitleId}>
          <div id={deleteTitleId} className="font-medium text-foreground">Delete this automation?</div>
          <p className="mt-1 text-muted-foreground">Metadata only; prompts, runs, and sessions stay.</p>
          <div className="mt-3 flex gap-2">
            <Button className="text-[13px]" style={{ minHeight: compactControls ? 32 : 44 }} type="button" variant="destructive" size="sm" onClick={onDeleteConfirm} disabled={togglingEnabled}>Delete</Button>
            <Button className="text-[13px]" style={{ minHeight: compactControls ? 32 : 44 }} type="button" variant="ghost" size="sm" onClick={onDeleteCancel}>Cancel</Button>
          </div>
        </div>
      ) : null}

      {expanded ? (
        <div id={historyId} className="border-t border-border/60">
          <div className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">Run history</div>
          <RunHistory compactControls={compactControls} runs={runs} loading={runsLoading} onOpenRun={onOpenRun} />
        </div>
      ) : null}
    </article>
  )
}
