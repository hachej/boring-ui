"use client"

import { useEffect, useState, type ReactNode } from "react"
import type { DispatchContext } from "../../front/bridge"
import { DetachedChatPopover } from "../../front/chrome/chat/DetachedChatPopover"
import type { ChatPanelHostProps } from "../../front/chrome/chat/ChatPanelHost"
import type { WorkspaceShellCapabilities } from "../../front/shell/WorkspaceShellCapabilitiesContext"
import { useWorkspaceShellCapabilitiesController } from "./useWorkspaceShellCapabilitiesController"

export interface WorkspaceShellCapabilitiesHostResult {
  floatingChatNode: ReactNode
  shellCapabilities: WorkspaceShellCapabilities
}

export function useWorkspaceShellCapabilitiesHost({
  appLeftPaneCollapsed,
  workspaceId,
  effectiveAppLeftPaneWidth,
  sessionTitleById,
  defaultSessionTitle,
  makeCenterParams,
  openChatPane,
  surfaceDispatch,
  onDockOverlay,
}: {
  appLeftPaneCollapsed: boolean
  workspaceId: string
  effectiveAppLeftPaneWidth: number
  sessionTitleById: Map<string, string | null | undefined>
  defaultSessionTitle: string
  makeCenterParams: (sessionId: string, options?: { bridgeEnabled?: boolean }) => unknown
  openChatPane: (sessionId: string) => void
  surfaceDispatch: DispatchContext
  onDockOverlay?: () => void
}): WorkspaceShellCapabilitiesHostResult {
  const [floatingChatSessionId, setFloatingChatSessionId] = useState<string | null>(null)
  useEffect(() => {
    setFloatingChatSessionId(null)
  }, [workspaceId])
  const shellCapabilities = useWorkspaceShellCapabilitiesController({ setFloatingChatSessionId, openChatPane, surfaceDispatch })

  const floatingChatTitle = floatingChatSessionId
    ? sessionTitleById.get(floatingChatSessionId) ?? (floatingChatSessionId === "default" ? defaultSessionTitle : floatingChatSessionId)
    : null
  const floatingChatParams = floatingChatSessionId
    ? makeCenterParams(floatingChatSessionId, { bridgeEnabled: false }) as ChatPanelHostProps
    : null
  const floatingChatNode = floatingChatSessionId && floatingChatParams ? (
    <DetachedChatPopover
      key={floatingChatSessionId}
      sessionId={floatingChatSessionId}
      title={floatingChatTitle ?? floatingChatSessionId}
      chatParams={floatingChatParams}
      initialPosition={{ left: appLeftPaneCollapsed ? 24 : effectiveAppLeftPaneWidth + 24, top: 72 }}
      composingEnabled={false}
      onClose={() => setFloatingChatSessionId(null)}
      onDock={() => {
        openChatPane(floatingChatSessionId)
        setFloatingChatSessionId(null)
        onDockOverlay?.()
      }}
    />
  ) : null

  return {
    floatingChatNode,
    shellCapabilities,
  }
}
