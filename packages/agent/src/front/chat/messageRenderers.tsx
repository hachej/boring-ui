"use client"

import { createContext, useContext, useMemo, type ReactNode } from "react"
import type { BoringChatMessage } from "../../shared/chat"

export type ChatMessageRenderer = (message: BoringChatMessage) => ReactNode | undefined

const ChatMessageRendererContext = createContext<readonly ChatMessageRenderer[]>([])

export function ChatMessageRendererProvider({
  renderer,
  children,
}: {
  renderer: ChatMessageRenderer
  children: ReactNode
}) {
  const parent = useContext(ChatMessageRendererContext)
  const renderers = useMemo(() => [renderer, ...parent], [parent, renderer])
  return <ChatMessageRendererContext.Provider value={renderers}>{children}</ChatMessageRendererContext.Provider>
}

export function useCustomChatMessage(message: BoringChatMessage): ReactNode | undefined {
  const renderers = useContext(ChatMessageRendererContext)
  for (const renderer of renderers) {
    const rendered = renderer(message)
    if (rendered !== undefined) return rendered
  }
  return undefined
}
