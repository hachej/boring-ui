"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import type { HumanArtifact } from "../../shared/artifacts"

export const WORKSPACE_ATTENTION_ACTION_EVENT = "boring-workspace:attention-action" as const

export type WorkspaceAttentionBlockerAction = {
  id: string
  label: string
}

// Runtime-only compatibility for older blockers. New plugins must provide
// `sessionBadge` and must not depend on workspace interpreting reason strings.
const WAITING_FOR_USER_INPUT_REASON = "waiting_for_user_input" as const

export type WorkspaceAttentionSessionBadge = {
  /** Stable badge kind for data attributes and plugin-specific styling hooks. */
  kind: string
  /** Short text rendered on the session row, e.g. "question", "review", "approval". */
  label: string
  /** Visual tone only; semantics are owned by the plugin-specific kind/reason. */
  tone?: "attention" | "danger" | "neutral" | "warning"
  /** Higher priority wins when several plugins mark the same session. */
  priority?: number
}

export type WorkspaceAttentionInboxMetadata = {
  kind: "question" | "review" | "approval" | "notice"
  sourceLabel: string
  createdAt?: string | number | Date
  updatedAt?: string | number | Date
  priority?: number
  artifacts?: HumanArtifact[]
}

export type WorkspaceAttentionFocusMetadata = {
  /** Close the workbench left pane when this blocker becomes active for the current session. */
  closeWorkbenchLeftPane?: boolean
}

export type WorkspaceAttentionBlocker = {
  id: string
  /** Plugin/domain-specific reason, e.g. "ask-user.question" or "pr-review.review". */
  reason: string
  surfaceKind?: string
  target?: string
  label?: string
  sessionId?: string
  /** Optional generic session-row badge contributed by the plugin that owns this attention. */
  sessionBadge?: WorkspaceAttentionSessionBadge
  /**
   * Remove this blocker once its workspace chat session disappears from the
   * authoritative session list. Leave unset for external inbox items whose
   * `sessionId` is a source/thread identifier rather than a local chat id.
   */
  pruneWhenSessionMissing?: boolean
  /** Explicit inbox projection metadata. New inbox-aware plugins should provide this instead of relying on reason parsing. */
  inbox?: WorkspaceAttentionInboxMetadata
  /** Optional shell focus behavior requested by the plugin that owns this blocker. */
  focus?: WorkspaceAttentionFocusMetadata
  actions?: WorkspaceAttentionBlockerAction[]
}

export type WorkspaceAttentionActionDetail = {
  blockerId: string
  actionId: string
  blocker: WorkspaceAttentionBlocker
  sessionId?: string
}

export function emitWorkspaceAttentionAction(detail: WorkspaceAttentionActionDetail): void {
  if (typeof globalThis.dispatchEvent !== "function" || typeof CustomEvent === "undefined") return
  globalThis.dispatchEvent(new CustomEvent<WorkspaceAttentionActionDetail>(WORKSPACE_ATTENTION_ACTION_EVENT, { detail }))
}

export function workspaceAttentionSessionBadgeForBlocker(blocker: Pick<WorkspaceAttentionBlocker, "reason" | "sessionBadge">): WorkspaceAttentionSessionBadge | null {
  if (blocker.sessionBadge) return blocker.sessionBadge
  // Runtime compatibility for older blockers. New plugins must provide their
  // own sessionBadge instead of relying on this deprecated public reason.
  if (blocker.reason === WAITING_FOR_USER_INPUT_REASON) return { kind: "needs-input", label: "needs input", tone: "attention", priority: -1 }
  return null
}

export interface WorkspaceAttentionContextValue {
  blockers: WorkspaceAttentionBlocker[]
  addBlocker: (blocker: WorkspaceAttentionBlocker) => void
  removeBlocker: (id: string) => void
}

export type WorkspaceAttentionProviderProps = {
  children: ReactNode
  /** Authoritative set of existing chat sessions. Blockers that opt into pruning outside this set are stale and removed. */
  knownSessionIds?: readonly string[]
  /** Keep false while sessions are still loading/paginated so valid blockers are not pruned early. */
  knownSessionsAuthoritative?: boolean
}

const noopAttention: WorkspaceAttentionContextValue = {
  blockers: [],
  addBlocker: () => undefined,
  removeBlocker: () => undefined,
}

const WorkspaceAttentionContext = createContext<WorkspaceAttentionContextValue | null>(null)

function knownSessionSetFromKey(key: string | undefined): ReadonlySet<string> | null {
  if (key === undefined) return null
  return new Set(key.length > 0 ? key.split("\0") : [])
}

function blockerBelongsToKnownSession(blocker: WorkspaceAttentionBlocker, known: ReadonlySet<string> | null): boolean {
  return !known || !blocker.pruneWhenSessionMissing || !blocker.sessionId || known.has(blocker.sessionId)
}

export function useWorkspaceAttention(): WorkspaceAttentionContextValue {
  return useContext(WorkspaceAttentionContext) ?? noopAttention
}

export function WorkspaceAttentionProvider({ children, knownSessionIds, knownSessionsAuthoritative = true }: WorkspaceAttentionProviderProps) {
  const [blockers, setBlockers] = useState<WorkspaceAttentionBlocker[]>([])
  const knownSessionKey = knownSessionIds?.join("\0")
  const authoritativeKnownSessions = useMemo(
    () => (knownSessionsAuthoritative ? knownSessionSetFromKey(knownSessionKey) : null),
    [knownSessionKey, knownSessionsAuthoritative],
  )
  const addBlocker = useCallback((blocker: WorkspaceAttentionBlocker) => {
    setBlockers((current) => {
      const withoutExisting = current.filter((item) => item.id !== blocker.id)
      if (!blockerBelongsToKnownSession(blocker, authoritativeKnownSessions)) {
        return withoutExisting.length === current.length ? current : withoutExisting
      }
      return [...withoutExisting, blocker]
    })
  }, [authoritativeKnownSessions])
  const removeBlocker = useCallback((id: string) => {
    setBlockers((current) => current.filter((item) => item.id !== id))
  }, [])
  useEffect(() => {
    if (!authoritativeKnownSessions) return
    setBlockers((current) => {
      const next = current.filter((blocker) => blockerBelongsToKnownSession(blocker, authoritativeKnownSessions))
      return next.length === current.length ? current : next
    })
  }, [authoritativeKnownSessions])
  const value = useMemo<WorkspaceAttentionContextValue>(
    () => ({ blockers, addBlocker, removeBlocker }),
    [blockers, addBlocker, removeBlocker],
  )

  return <WorkspaceAttentionContext.Provider value={value}>{children}</WorkspaceAttentionContext.Provider>
}
