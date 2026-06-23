"use client"

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react"

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

const noopAttention: WorkspaceAttentionContextValue = {
  blockers: [],
  addBlocker: () => undefined,
  removeBlocker: () => undefined,
}

const WorkspaceAttentionContext = createContext<WorkspaceAttentionContextValue | null>(null)

export function useWorkspaceAttention(): WorkspaceAttentionContextValue {
  return useContext(WorkspaceAttentionContext) ?? noopAttention
}

export function WorkspaceAttentionProvider({ children }: { children: ReactNode }) {
  const [blockers, setBlockers] = useState<WorkspaceAttentionBlocker[]>([])
  const addBlocker = useCallback((blocker: WorkspaceAttentionBlocker) => {
    setBlockers((current) => [...current.filter((item) => item.id !== blocker.id), blocker])
  }, [])
  const removeBlocker = useCallback((id: string) => {
    setBlockers((current) => current.filter((item) => item.id !== id))
  }, [])
  const value = useMemo<WorkspaceAttentionContextValue>(
    () => ({ blockers, addBlocker, removeBlocker }),
    [blockers, addBlocker, removeBlocker],
  )

  return <WorkspaceAttentionContext.Provider value={value}>{children}</WorkspaceAttentionContext.Provider>
}
