"use client"

import { createContext, useContext } from "react"

export interface ChatShellContextValue {
  drawerOpen: boolean
  setDrawerOpen: (open: boolean) => void
  toggleDrawer: () => void

  surfaceOpen: boolean
  setSurfaceOpen: (open: boolean) => void
  toggleSurface: () => void

  onNewChat?: () => void
  focusComposer?: () => void
}

export const ChatShellContext = createContext<ChatShellContextValue | null>(null)

export function useChatShell(): ChatShellContextValue {
  const ctx = useContext(ChatShellContext)
  if (!ctx) {
    throw new Error("useChatShell must be used inside ChatCenteredShell")
  }
  return ctx
}
