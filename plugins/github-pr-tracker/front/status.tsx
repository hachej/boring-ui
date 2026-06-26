import React from "react"
import type { PullRequest, Tone } from "./types"
import { classes } from "./ui"

/**
 * Single source of truth for diff semantics. Additions/deletions keep the
 * conventional emerald/red, tuned down so they read as data, not decoration.
 */
export const ADD_TEXT = "text-emerald-600 dark:text-emerald-400"
export const DEL_TEXT = "text-red-600 dark:text-red-400"
export const addFill = (alpha: number) => `rgba(16, 185, 129, ${alpha})`
export const delFill = (alpha: number) => `rgba(239, 68, 68, ${alpha})`

export const toneText: Record<Tone, string> = {
  success: "text-emerald-600 dark:text-emerald-400",
  warning: "text-amber-600 dark:text-amber-400",
  danger: "text-red-600 dark:text-red-400",
  neutral: "text-muted-foreground",
  info: "text-sky-600 dark:text-sky-400",
}

export const toneDot: Record<Tone, string> = {
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
  neutral: "bg-muted-foreground/50",
  info: "bg-sky-500",
}

export const toneSoftBadge: Record<Tone, string> = {
  success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warning: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  danger: "bg-red-500/10 text-red-700 dark:text-red-300",
  neutral: "bg-muted text-muted-foreground",
  info: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
}

export function statusLabel(tag: string): string {
  return tag.replace(/^status:/, "").replace(/[_-]/g, " ").trim() || "open"
}

export function StatusDot({ tone, className }: { tone: Tone; className?: string }) {
  return <span aria-hidden className={classes("inline-block size-1.5 shrink-0 rounded-full", toneDot[tone], className)} />
}

/** Compact "● Ready" status, used in dense list rows. */
export function StatusInline({ pr }: { pr: PullRequest }) {
  return (
    <span className={classes("inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs font-medium", toneText[pr.statusTone])}>
      <StatusDot tone={pr.statusTone} />
      {statusLabel(pr.statusTag)}
    </span>
  )
}

/**
 * The states worth surfacing without a click: failing/pending CI and
 * branches that can't merge cleanly. Healthy PRs stay quiet.
 */
export function attentionNotes(pr: PullRequest): Array<{ key: string; text: string; tone: Tone }> {
  const notes: Array<{ key: string; text: string; tone: Tone }> = []
  const { pending, failed } = pr.checkSummary
  if (failed > 0) notes.push({ key: "ci-failed", text: `${failed} check${failed === 1 ? "" : "s"} failing`, tone: "danger" })
  else if (pending > 0) notes.push({ key: "ci-pending", text: `${pending} pending`, tone: "warning" })
  if (pr.mergeStateStatus === "DIRTY") notes.push({ key: "merge", text: "conflicts", tone: "danger" })
  else if (pr.mergeStateStatus === "BEHIND") notes.push({ key: "merge", text: "behind base", tone: "warning" })
  else if (pr.mergeStateStatus === "BLOCKED") notes.push({ key: "merge", text: "blocked", tone: "warning" })
  return notes
}

export function needsAttention(pr: PullRequest): boolean {
  return pr.statusTone === "danger" || pr.statusTone === "warning" || attentionNotes(pr).length > 0
}
