"use client"

import { useMemo, useState, type ReactNode } from "react"
import { Inbox } from "lucide-react"
import type { DispatchContext } from "../../front/bridge"
import type { PanelConfig } from "../../front/registry/types"
import { DetachedChatPopover } from "../../front/chrome/chat/DetachedChatPopover"
import type { ChatPanelHostProps } from "../../front/chrome/chat/ChatPanelHost"
import { InboxOverlay } from "../../plugins/inboxPlugin/front/InboxOverlay"
import { WorkspaceInboxShellProvider, type WorkspaceInboxShellApi } from "../../plugins/inboxPlugin/front"
import { useWorkspaceInboxShellController } from "./useWorkspaceInboxShellController"

export interface WorkspaceInboxHostResult {
  providerPanels?: PanelConfig[]
  primaryActions: Array<{ id: string; label: string; icon: ReactNode; onClick: () => void }>
  leftOverlayNode: ReactNode
  floatingChatNode: ReactNode
  shellApi: WorkspaceInboxShellApi
}

export function useWorkspaceInboxHost({
  enabled,
  panels,
  leftOverlay,
  setLeftOverlay,
  appLeftPaneCollapsed,
  surfaceOpen,
  workspaceId,
  effectiveAppLeftPaneWidth,
  sessionTitleById,
  defaultSessionTitle,
  makeCenterParams,
  openChatPane,
  surfaceDispatch,
}: {
  enabled: boolean
  panels?: PanelConfig[]
  leftOverlay: "inbox" | "skills" | "plugins" | null
  setLeftOverlay: (next: "inbox" | "skills" | "plugins" | null | ((current: "inbox" | "skills" | "plugins" | null) => "inbox" | "skills" | "plugins" | null)) => void
  appLeftPaneCollapsed: boolean
  surfaceOpen: boolean
  workspaceId: string
  effectiveAppLeftPaneWidth: number
  sessionTitleById: Map<string, string | null | undefined>
  defaultSessionTitle: string
  makeCenterParams: (sessionId: string, options?: { bridgeEnabled?: boolean }) => unknown
  openChatPane: (sessionId: string) => void
  surfaceDispatch: DispatchContext
}): WorkspaceInboxHostResult {
  const [floatingChatSessionId, setFloatingChatSessionId] = useState<string | null>(null)
  const inboxShellApi = useWorkspaceInboxShellController({ setFloatingChatSessionId, surfaceDispatch })
  const providerPanels = panels
  const primaryActions = useMemo(() => enabled ? [{
    id: "inbox",
    label: "Inbox",
    icon: <Inbox className="h-4 w-4" strokeWidth={1.75} />,
    onClick: () => setLeftOverlay((cur) => cur === "inbox" ? null : "inbox"),
  }] : [], [enabled, setLeftOverlay])

  const leftOverlayNode = leftOverlay === "inbox" && enabled ? (
    <WorkspaceInboxShellProvider value={inboxShellApi}>
      <InboxOverlay
        onClose={() => setLeftOverlay(null)}
        headerInsetStart={appLeftPaneCollapsed}
        headerInsetEnd={!surfaceOpen}
        pinStorageKey={`boring-workspace:inbox-pins:${workspaceId}`}
      />
    </WorkspaceInboxShellProvider>
  ) : null

  const floatingChatTitle = floatingChatSessionId
    ? sessionTitleById.get(floatingChatSessionId) ?? (floatingChatSessionId === "default" ? defaultSessionTitle : floatingChatSessionId)
    : null
  const floatingChatParams = floatingChatSessionId
    ? makeCenterParams(floatingChatSessionId, { bridgeEnabled: false }) as ChatPanelHostProps
    : null
  const floatingChatNode = floatingChatSessionId && floatingChatParams ? (
    <DetachedChatPopover
      sessionId={floatingChatSessionId}
      title={floatingChatTitle ?? floatingChatSessionId}
      chatParams={floatingChatParams}
      initialPosition={{ left: appLeftPaneCollapsed ? 24 : effectiveAppLeftPaneWidth + 24, top: 72 }}
      composingEnabled={false}
      onClose={() => setFloatingChatSessionId(null)}
      onDock={() => {
        openChatPane(floatingChatSessionId)
        setFloatingChatSessionId(null)
        setLeftOverlay(null)
      }}
    />
  ) : null

  return {
    providerPanels,
    primaryActions,
    leftOverlayNode,
    floatingChatNode,
    shellApi: inboxShellApi,
  }
}
