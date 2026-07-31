"use client"

import { createContext, createElement, useContext, useMemo, type ComponentType, type ReactNode } from "react"
import type { BoringChatMessage } from "../../shared/chat"

export interface ChatMessageContributionProps {
  message: BoringChatMessage
}

export interface ChatMessageContribution {
  id: string
  /** Pure, hook-free claim predicate. */
  matches(message: BoringChatMessage): boolean
  Component: ComponentType<ChatMessageContributionProps>
}

const ChatMessageContributionContext = createContext<readonly ChatMessageContribution[]>([])

export function ChatMessageContributionProvider({
  contribution,
  children,
}: {
  contribution: ChatMessageContribution
  children: ReactNode
}) {
  const parent = useContext(ChatMessageContributionContext)
  const contributions = useMemo(
    () => [contribution, ...parent.filter((entry) => entry.id !== contribution.id)],
    [contribution, parent],
  )
  return (
    <ChatMessageContributionContext.Provider value={contributions}>
      {children}
    </ChatMessageContributionContext.Provider>
  )
}

export function useCustomChatMessage(message: BoringChatMessage): ReactNode | undefined {
  const contributions = useContext(ChatMessageContributionContext)
  const contribution = contributions.find((entry) => entry.matches(message))
  return contribution ? createElement(contribution.Component, { message }) : undefined
}
