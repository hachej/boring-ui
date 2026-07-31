"use client"

import { createContext, useContext, useMemo, type ComponentType, type ReactNode } from "react"

export type ComposerDraftUpdate = (currentDraft: string) => string

export interface ComposerActionContributionProps {
  updateDraft(update: ComposerDraftUpdate, options?: { focus?: boolean }): void
}

export interface ComposerContribution {
  id: string
  Top?: ComponentType
  Action?: ComponentType<ComposerActionContributionProps>
}

const ComposerContributionContext = createContext<readonly ComposerContribution[]>([])

export function ComposerContributionProvider({
  contribution,
  children,
}: {
  contribution: ComposerContribution
  children: ReactNode
}) {
  const parent = useContext(ComposerContributionContext)
  const contributions = useMemo(
    () => [contribution, ...parent.filter((entry) => entry.id !== contribution.id)],
    [contribution, parent],
  )
  return (
    <ComposerContributionContext.Provider value={contributions}>
      {children}
    </ComposerContributionContext.Provider>
  )
}

export function useComposerContributions(): readonly ComposerContribution[] {
  return useContext(ComposerContributionContext)
}
