import type { HumanArtifact, WorkspaceShellCapabilityResult, WorkspaceShellAnchorRect } from "@hachej/boring-workspace"

export type InboxItemKind = "question" | "review" | "approval" | "notice"
export type InboxItemStatus = "open" | "resolved" | "dismissed"
export type InboxFilter = "all" | "questions" | "reviews"

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
  /** True only when sessionId is known to be a local workspace chat session. */
  chatAvailable?: boolean
  targetLabel: string
  artifacts: HumanArtifact[]
  createdAt: string
  updatedAt: string
  priority: number
  actions: WorkspaceInboxItemAction[]
}

export type WorkspaceInboxItemViewModel = WorkspaceInboxItem & {
  pinned: boolean
}

export type WorkspaceInboxShellResult = WorkspaceShellCapabilityResult

export interface WorkspaceInboxShellApi {
  openInboxArtifact(item: WorkspaceInboxItem, artifact: HumanArtifact): WorkspaceInboxShellResult
  openDetachedChat(sessionId: string, options?: { anchor?: WorkspaceShellAnchorRect; title?: string }): WorkspaceInboxShellResult
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

export function filterInboxItems(items: readonly WorkspaceInboxItem[], filter: InboxFilter): WorkspaceInboxItem[] {
  if (filter === "all") return [...items]
  return items.filter((item) => filter === "questions" ? item.kind === "question" : item.kind === "review")
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
