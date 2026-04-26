"use client"

import { createContext, useContext } from "react"
import type { SurfaceShellApi } from "./SurfaceShell"

export interface ChatShellContextValue {
  drawerOpen: boolean
  setDrawerOpen: (open: boolean) => void
  toggleDrawer: () => void

  surfaceOpen: boolean
  setSurfaceOpen: (open: boolean) => void
  toggleSurface: () => void

  onNewChat?: () => void
  focusComposer?: () => void

  /**
   * Imperative handle to the workbench surface. `null` until SurfaceShell's
   * dockview is ready (one or two frames after mount). Child apps grab this
   * via `useChatSurface()` to open custom panes from outside the workbench
   * (e.g. catalog clicks, agent tool callbacks).
   */
  surface: SurfaceShellApi | null
}

export const ChatShellContext = createContext<ChatShellContextValue | null>(null)

export function useChatShell(): ChatShellContextValue {
  const ctx = useContext(ChatShellContext)
  if (!ctx) {
    throw new Error("useChatShell must be used inside ChatCenteredShell")
  }
  return ctx
}

/**
 * Returns the workbench surface API, or `null` until it's ready.
 * Equivalent to `useChatShell().surface` — provided as a focused hook so
 * child apps can subscribe just to surface readiness.
 */
export function useChatSurface(): SurfaceShellApi | null {
  return useChatShell().surface
}
