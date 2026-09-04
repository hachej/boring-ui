import type { HumanArtifact, WorkspaceShellCapabilityResult, WorkspaceShellAnchorRect, WorkspaceShellSessionRef } from "@hachej/boring-workspace"
import type { AskUserAnsweredSummary, AskUserPendingSummary } from "../../shared/bridge"
import type { AskUserAnswerValue } from "../../shared/types"
import { ASK_USER_PLUGIN_ID, ASK_USER_SURFACE_KIND } from "../../shared/constants"

export type InboxItemKind = "question" | "review" | "approval" | "notice"
export type InboxItemStatus = "open" | "resolved" | "dismissed"
export type InboxFilter = "all" | "questions" | "reviews" | "answered"

export interface WorkspaceInboxItemAction {
  id: string
  label: string
  tone?: "primary" | "neutral" | "danger"
}

export interface WorkspaceInboxItemSourceBase {
  label: string
}

export type WorkspaceInboxItemSource =
  | WorkspaceInboxItemSourceBase & { type: "ask-user" }
  | WorkspaceInboxItemSourceBase & { type: "external-hook"; externalId: string }
  | WorkspaceInboxItemSourceBase & { type: "review"; reviewId: string }
  | WorkspaceInboxItemSourceBase & { type: "plugin"; pluginId: string }

export interface WorkspaceInboxItem {
  id: string
  kind: InboxItemKind
  status: InboxItemStatus
  title: string
  description: string
  source: WorkspaceInboxItemSource
  sessionId: string | null
  agentTypeId?: string | null
  /** True only when sessionId is known to be a local workspace chat session. */
  chatAvailable?: boolean
  targetLabel: string
  artifacts: HumanArtifact[]
  createdAt: string
  updatedAt: string
  priority: number
  actions: WorkspaceInboxItemAction[]
  /** Owner verdict on a resolved item — the first single-choice answer field. */
  decision?: string
  /** Every field the owner filled in, so the row can show their notes. */
  answerValues?: Record<string, AskUserAnswerValue>
}

export type WorkspaceInboxItemViewModel = WorkspaceInboxItem & {
  pinned: boolean
}

export type WorkspaceInboxShellResult = WorkspaceShellCapabilityResult

export interface WorkspaceInboxShellApi {
  openInboxArtifact(item: WorkspaceInboxItem, artifact: HumanArtifact): WorkspaceInboxShellResult
  openDetachedChat(ref: WorkspaceShellSessionRef, options?: { anchor?: WorkspaceShellAnchorRect; title?: string }): WorkspaceInboxShellResult
}

export function inboxItemDate(item: WorkspaceInboxItem): Date {
  const date = new Date(item.updatedAt || item.createdAt)
  return Number.isNaN(date.getTime()) ? new Date(0) : date
}

export function formatInboxTime(item: WorkspaceInboxItem, now = Date.now()): string {
  const date = inboxItemDate(item)
  const diff = now - date.getTime()
  if (diff < 60_000) return "now"
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

export function inboxItemSender(item: WorkspaceInboxItem): string {
  return item.source.label || item.source.type
}

/** Answered items live in their own tab: the open tabs are a to-do list, and a
 * decision the owner already made must not sit in it. */
export function filterInboxItems(items: readonly WorkspaceInboxItem[], filter: InboxFilter): WorkspaceInboxItem[] {
  if (filter === "answered") return items.filter((item) => item.status !== "open")
  const open = items.filter((item) => item.status === "open")
  if (filter === "all") return open
  return open.filter((item) => filter === "questions" ? item.kind === "question" : item.kind === "review")
}

export function sortInboxItems(items: readonly WorkspaceInboxItem[]): WorkspaceInboxItem[] {
  return [...items].sort((a, b) => {
    const byTime = inboxItemDate(b).getTime() - inboxItemDate(a).getTime()
    if (byTime !== 0) return byTime
    const byPriority = b.priority - a.priority
    if (byPriority !== 0) return byPriority
    return a.title.localeCompare(b.title)
  })
}

export function mergeInboxPinnedState(
  items: readonly WorkspaceInboxItem[],
  pinnedIds: ReadonlySet<string>,
): WorkspaceInboxItemViewModel[] {
  return items.map((item) => ({ ...item, pinned: pinnedIds.has(item.id) }))
}

/** Blocker id shape shared with `useAskUserAttentionBlockers`, so the same
 * question read from the workspace-wide list and from an attention blocker is
 * one Inbox row rather than two. */
export function inboxItemIdForQuestion(sessionId: string, questionId: string): string {
  return `${ASK_USER_PLUGIN_ID}:${sessionId}:${questionId}`
}

/**
 * Inbox row for a pending question read straight from the workspace-wide
 * `ask-user.v1.pending-all` op. Attention blockers only exist for sessions the
 * browser shell already knows about, so questions raised by background agent
 * sessions (Orchestrator, Workers) reach the Inbox only through this path.
 */
export function pendingSummaryToInboxItem(
  summary: AskUserPendingSummary,
  options: { fallbackAgentTypeId?: string } = {},
): WorkspaceInboxItem {
  const title = summary.title ?? "Answer the question in Questions to continue"
  const surfaceArtifact: HumanArtifact = {
    id: `${inboxItemIdForQuestion(summary.sessionId, summary.questionId)}:surface`,
    surfaceKind: ASK_USER_SURFACE_KIND,
    target: summary.questionId,
    title,
  }
  const artifacts = summary.artifacts ?? []
  return {
    id: inboxItemIdForQuestion(summary.sessionId, summary.questionId),
    kind: "question",
    status: "open",
    title,
    description: summary.context ?? "ask-user.question",
    source: { type: "ask-user", label: "question" },
    sessionId: summary.sessionId,
    agentTypeId: options.fallbackAgentTypeId ?? null,
    chatAvailable: !!options.fallbackAgentTypeId,
    targetLabel: summary.questionId,
    artifacts: [
      surfaceArtifact,
      ...artifacts.filter((artifact) => !(artifact.surfaceKind === ASK_USER_SURFACE_KIND && artifact.target === summary.questionId)),
    ],
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt || summary.createdAt,
    priority: 10,
    actions: [],
  }
}

/**
 * Union of the session-scoped attention blockers and the workspace-wide pending
 * list, keyed by question. Blocker items win on conflict because they carry the
 * hydrated payload (actions, artifacts) for sessions the shell already tracks.
 */
export function mergeInboxItems(
  blockerItems: readonly WorkspaceInboxItem[],
  workspaceItems: readonly WorkspaceInboxItem[],
): WorkspaceInboxItem[] {
  const byId = new Map<string, WorkspaceInboxItem>()
  for (const item of workspaceItems) byId.set(item.id, item)
  for (const item of blockerItems) byId.set(item.id, item)
  return [...byId.values()]
}

export type InboxDecisionTone = "approve" | "changes" | "defer" | "reject" | "neutral"

/**
 * Badge colours come from the workspace token contract as inline styles, not
 * from palette utilities (`bg-emerald-500/12` and friends). The host app's
 * Tailwind build scans `@hachej/boring-workspace` sources, not this plugin's,
 * so a palette class that workspace itself never writes is generated nowhere
 * and renders transparent. Tokens are always defined.
 */
export function inboxDecisionBadgeStyle(decision: string | undefined): { backgroundColor: string; color: string } {
  const token = {
    approve: "--success",
    changes: "--attention",
    reject: "--destructive",
    defer: "--muted-foreground",
    neutral: "--muted-foreground",
  }[inboxDecisionTone(decision)]
  return {
    backgroundColor: `color-mix(in oklab, var(${token}) 14%, transparent)`,
    color: `var(${token})`,
  }
}

/** Maps the owner's verdict onto the row badge tone. Unknown verdicts stay
 * neutral rather than being guessed into a colour that implies a judgement. */
export function inboxDecisionTone(decision: string | undefined): InboxDecisionTone {
  const value = decision?.trim().toLowerCase() ?? ""
  if (!value) return "neutral"
  if (value.startsWith("approve") || value === "yes" || value === "accept") return "approve"
  if (value.startsWith("change") || value.startsWith("revise") || value.startsWith("request")) return "changes"
  if (value.startsWith("reject") || value === "no" || value.startsWith("decline")) return "reject"
  if (value.startsWith("defer") || value.startsWith("later") || value.startsWith("snooze")) return "defer"
  return "neutral"
}

/**
 * Inbox row for a question the owner already resolved, read from
 * `ask-user.v1.answered-all`. Same id shape as the pending row so a question
 * that moves from pending to answered keeps its identity (and its pin).
 */
export function answeredSummaryToInboxItem(
  summary: AskUserAnsweredSummary,
  options: { fallbackAgentTypeId?: string } = {},
): WorkspaceInboxItem {
  const agentTypeId = summary.agentTypeId ?? options.fallbackAgentTypeId
  return {
    id: inboxItemIdForQuestion(summary.sessionId, summary.questionId),
    kind: "question",
    status: summary.status === "answered" ? "resolved" : "dismissed",
    title: summary.title,
    description: summary.contextFirstLine ?? "",
    source: { type: "ask-user", label: summary.status === "answered" ? "answered" : summary.status },
    sessionId: summary.sessionId,
    agentTypeId: agentTypeId ?? null,
    chatAvailable: !!agentTypeId,
    targetLabel: summary.questionId,
    artifacts: [],
    createdAt: summary.askedAt,
    updatedAt: summary.answeredAt,
    priority: 0,
    actions: [],
    ...(summary.decision ? { decision: summary.decision } : {}),
    answerValues: summary.values,
  }
}
