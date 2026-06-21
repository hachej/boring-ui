"use client"

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react"

export type WorkspaceAttentionBlockerAction = {
  id: string
  label: string
}

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
