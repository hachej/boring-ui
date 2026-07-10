import type { AutomationRun, AutomationRunStatus } from "../shared"

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date)
}

export function formatDuration(run: AutomationRun): string {
  const value = run.durationMs ?? inferDuration(run)
  if (value == null) return "—"
  if (value < 1000) return `${value}ms`
  const seconds = Math.round(value / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`
}

export function tokenTotal(run: AutomationRun): number | null {
  if (run.totalTokens != null) return run.totalTokens
  if (run.inputTokens != null || run.outputTokens != null) return (run.inputTokens ?? 0) + (run.outputTokens ?? 0)
  return null
}

export function statusLabel(status: AutomationRunStatus): string {
  switch (status) {
    case "queued": return "Queued"
    case "running": return "Running"
    case "succeeded": return "Succeeded"
    case "failed": return "Failed"
    case "cancelled": return "Cancelled"
  }
}

export function statusTone(status: AutomationRunStatus): string {
  switch (status) {
    case "succeeded": return "bg-[color:var(--success-soft)] text-success"
    case "failed": return "bg-destructive/10 text-destructive"
    case "running": return "bg-foreground/[0.07] text-foreground"
    case "cancelled": return "bg-foreground/[0.07] text-muted-foreground"
    case "queued": return "bg-foreground/[0.07] text-muted-foreground"
  }
}

function inferDuration(run?: AutomationRun): number | null {
  if (!run?.startedAt || !run.completedAt) return null
  const started = new Date(run.startedAt).getTime()
  const completed = new Date(run.completedAt).getTime()
  if (Number.isNaN(started) || Number.isNaN(completed) || completed < started) return null
  return completed - started
}
