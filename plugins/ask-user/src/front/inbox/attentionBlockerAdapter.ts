import { workspaceAttentionSessionBadgeForBlocker, type WorkspaceAttentionBlocker } from "@hachej/boring-workspace"
import type { InboxItemKind, WorkspaceInboxItem } from "./inboxItemModel"

const FALLBACK_TIMESTAMP = "1970-01-01T00:00:00.000Z"

function dateValue(value: string | number | Date | undefined): string | null {
  if (value === undefined || value === null) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function blockerTimestamp(blocker: WorkspaceAttentionBlocker): string {
  return dateValue(blocker.inbox?.updatedAt) ?? dateValue(blocker.inbox?.createdAt) ?? FALLBACK_TIMESTAMP
}

function blockerKind(blocker: WorkspaceAttentionBlocker): InboxItemKind {
  if (blocker.inbox?.kind) return blocker.inbox.kind
  const badge = workspaceAttentionSessionBadgeForBlocker(blocker)
  if (badge?.kind === "question" || badge?.kind === "review" || badge?.kind === "approval" || badge?.kind === "notice") return badge.kind
  return "notice"
}

function blockerTitle(blocker: WorkspaceAttentionBlocker): string {
  return blocker.label || blocker.reason || "Workspace item"
}

function blockerSourceLabel(blocker: WorkspaceAttentionBlocker): string {
  return blocker.inbox?.source?.label ?? blocker.inbox?.sourceLabel ?? workspaceAttentionSessionBadgeForBlocker(blocker)?.label ?? "workspace"
}

function blockerSource(blocker: WorkspaceAttentionBlocker): WorkspaceInboxItem["source"] {
  const source = blocker.inbox?.source
  const label = blockerSourceLabel(blocker)
  if (source?.type === "plugin") return { type: "plugin", pluginId: source.id, label }
  if (source?.type === "external-hook") return { type: "external-hook", externalId: source.id, label }
  if (source?.type === "review") return { type: "review", reviewId: source.id, label }
  return { type: "plugin", pluginId: source?.id ?? blocker.reason, label }
}

export function isInboxAttentionBlocker(blocker: WorkspaceAttentionBlocker): boolean {
  return !!blocker.inbox
}

export function attentionBlockerToInboxItem(blocker: WorkspaceAttentionBlocker): WorkspaceInboxItem {
  const updatedAt = blockerTimestamp(blocker)
  return {
    id: blocker.id,
    kind: blockerKind(blocker),
    status: "open",
    title: blockerTitle(blocker),
    description: blocker.reason,
    source: blockerSource(blocker),
    sessionId: blocker.sessionId ?? null,
    targetLabel: blocker.target ?? "",
    artifact: blocker.surfaceKind ? { type: "surface", surfaceKind: blocker.surfaceKind, target: blocker.target } : null,
    createdAt: dateValue(blocker.inbox?.createdAt) ?? updatedAt,
    updatedAt,
    priority: blocker.inbox?.priority ?? workspaceAttentionSessionBadgeForBlocker(blocker)?.priority ?? 0,
    actions: blocker.actions?.map((action) => ({ id: action.id, label: action.label })) ?? [],
  }
}
