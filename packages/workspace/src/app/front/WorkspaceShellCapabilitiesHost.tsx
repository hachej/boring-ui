"use client"

import { useEffect, useState, type ReactNode } from "react"
import type { DispatchContext } from "../../front/bridge"
import { DetachedChatPopover } from "../../front/chrome/chat/DetachedChatPopover"
import type { ChatPanelHostProps } from "../../front/chrome/chat/ChatPanelHost"
import type { WorkspaceShellCapabilities } from "../../front/shell/WorkspaceShellCapabilitiesContext"
import type { WorkspaceShellSessionRef } from "../../front/shell/WorkspaceShellCapabilitiesContext"
import { workspaceSessionKey } from "../../front/sessionIdentity"
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
  refreshChatSessions,
  surfaceDispatch,
  onDockOverlay,
}: {
  appLeftPaneCollapsed: boolean
  workspaceId: string
  effectiveAppLeftPaneWidth: number
  sessionTitleById: Map<string, string | null | undefined>
  defaultSessionTitle: string
  makeCenterParams: (sessionKey: string, options?: { bridgeEnabled?: boolean }) => unknown
  openChatPane: (sessionId: string, agentTypeId?: string) => void
  refreshChatSessions: () => Promise<void>
  surfaceDispatch: DispatchContext
  onDockOverlay?: () => void
}): WorkspaceShellCapabilitiesHostResult {
  const [floatingChatSession, setFloatingChatSession] = useState<{ ref: WorkspaceShellSessionRef; title?: string; initialDraft?: string; composingEnabled?: boolean } | null>(null)
  useEffect(() => {
    setFloatingChatSession(null)
  }, [workspaceId])
  const shellCapabilities = useWorkspaceShellCapabilitiesController({ setFloatingChatSession, openChatPane, refreshChatSessions, surfaceDispatch })

  useEffect(() => {
    const onOpenDetachedChat = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail as { agentTypeId?: unknown; sessionId?: unknown; title?: unknown; initialDraft?: unknown; composingEnabled?: unknown } | undefined
      if (!detail || typeof detail.agentTypeId !== "string" || typeof detail.sessionId !== "string") return
      shellCapabilities.openDetachedChat({ agentTypeId: detail.agentTypeId, sessionId: detail.sessionId }, {
        ...(typeof detail.title === "string" ? { title: detail.title } : {}),
        ...(typeof detail.initialDraft === "string" ? { initialDraft: detail.initialDraft } : {}),
        ...(typeof detail.composingEnabled === "boolean" ? { composingEnabled: detail.composingEnabled } : {}),
      })
    }
    window.addEventListener("boring-workspace:open-detached-chat", onOpenDetachedChat)
    return () => window.removeEventListener("boring-workspace:open-detached-chat", onOpenDetachedChat)
  }, [shellCapabilities])

  const floatingChatRef = floatingChatSession?.ref ?? null
  const floatingChatSessionId = floatingChatRef?.sessionId ?? null
  const floatingChatSessionKey = floatingChatRef ? workspaceSessionKey(floatingChatRef.sessionId, floatingChatRef.agentTypeId) : null
  const floatingChatTitle = floatingChatSessionId
    ? floatingChatSession?.title ?? sessionTitleById.get(floatingChatSessionKey!) ?? (floatingChatSessionId === "default" ? defaultSessionTitle : floatingChatSessionId)
    : null
  const floatingChatParams = floatingChatSessionKey
    ? {
        ...makeCenterParams(floatingChatSessionKey, { bridgeEnabled: false }) as ChatPanelHostProps,
        ...(floatingChatSession?.initialDraft !== undefined ? { initialDraft: floatingChatSession.initialDraft } : {}),
      }
    : null
  const floatingChatNode = floatingChatRef && floatingChatSessionKey && floatingChatParams ? (
    <DetachedChatPopover
      key={floatingChatSessionKey}
      sessionId={floatingChatRef.sessionId}
      title={floatingChatTitle ?? floatingChatRef.sessionId}
      chatParams={floatingChatParams}
      initialPosition={{ left: appLeftPaneCollapsed ? 24 : effectiveAppLeftPaneWidth + 24, top: 72 }}
      composingEnabled={floatingChatSession?.composingEnabled ?? false}
      onClose={() => setFloatingChatSession(null)}
      onDock={() => {
        openChatPane(floatingChatRef.sessionId, floatingChatRef.agentTypeId)
        setFloatingChatSession(null)
        onDockOverlay?.()
      }}
    />
  ) : null

  return {
    floatingChatNode,
    shellCapabilities,
  }
}
