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
  return blocker.inbox?.sourceLabel ?? workspaceAttentionSessionBadgeForBlocker(blocker)?.label ?? "workspace"
}

export function isInboxAttentionBlocker(blocker: WorkspaceAttentionBlocker): boolean {
  return !!blocker.inbox
}

export function attentionBlockerToInboxItem(blocker: WorkspaceAttentionBlocker): WorkspaceInboxItem {
  const updatedAt = blockerTimestamp(blocker)
  const assocArtifact = blocker.inbox?.artifact
  const resolvedArtifact = assocArtifact
    ? {
        type: "surface" as const,
        surfaceKind: assocArtifact.surfaceKind,
        target: assocArtifact.target,
        params: blocker.sessionId ? { sessionId: blocker.sessionId } : undefined,
      }
    : blocker.surfaceKind
      ? {
          type: "surface" as const,
          surfaceKind: blocker.surfaceKind,
          target: blocker.target,
          params: blocker.sessionId ? { sessionId: blocker.sessionId } : undefined,
        }
      : null

  return {
    id: blocker.id,
    kind: blockerKind(blocker),
    status: "open",
    title: blockerTitle(blocker),
    description: blocker.reason,
    source: { type: "plugin", pluginId: blocker.reason, label: blockerSourceLabel(blocker) },
    sessionId: blocker.sessionId ?? null,
    chatAvailable: blocker.pruneWhenSessionMissing === true && !!blocker.sessionId,
    targetLabel: blocker.target ?? "",
    artifact: resolvedArtifact,
    createdAt: dateValue(blocker.inbox?.createdAt) ?? updatedAt,
    updatedAt,
    priority: blocker.inbox?.priority ?? workspaceAttentionSessionBadgeForBlocker(blocker)?.priority ?? 0,
    actions: blocker.actions?.map((action) => ({ id: action.id, label: action.label })) ?? [],
  }
}
