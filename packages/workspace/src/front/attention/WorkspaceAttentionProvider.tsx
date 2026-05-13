"use client"

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react"

export type WorkspaceAttentionBlocker = {
  id: string
  reason: string
  surfaceKind?: string
  target?: string
  label?: string
  sessionId?: string
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
