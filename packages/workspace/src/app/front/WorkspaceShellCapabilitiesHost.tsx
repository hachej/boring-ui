"use client"

import { useEffect, useState, type ReactNode } from "react"
import type { DispatchContext } from "../../front/bridge"
import { DetachedChatPopover } from "../../front/chrome/chat/DetachedChatPopover"
import type { ChatPanelHostProps } from "../../front/chrome/chat/ChatPanelHost"
import type { WorkspaceShellCapabilities } from "../../front/shell/WorkspaceShellCapabilitiesContext"
import { workspaceSessionKey, workspaceSessionRefFromKey } from "../../front/sessionIdentity"
import { useWorkspaceShellCapabilitiesController, type FloatingChatSession } from "./useWorkspaceShellCapabilitiesController"

export interface WorkspaceShellCapabilitiesHostResult {
  floatingChatNode: ReactNode
  shellCapabilities: WorkspaceShellCapabilities
}

interface NativeSessionIdReplacement {
  fromSessionId: string
  toSessionId: string
}

export function useWorkspaceShellCapabilitiesHost({
  appLeftPaneCollapsed,
  workspaceId,
  nativeSessionHandoffs,
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
  nativeSessionHandoffs: Readonly<Record<string, NativeSessionIdReplacement>> | null
  effectiveAppLeftPaneWidth: number
  sessionTitleById: Map<string, string | null | undefined>
  defaultSessionTitle: string
  makeCenterParams: (sessionId: string, options?: { bridgeEnabled?: boolean }) => unknown
  openChatPane: (sessionId: string, agentTypeId?: string) => void
  refreshChatSessions: () => Promise<void>
  surfaceDispatch: DispatchContext
  onDockOverlay?: () => void
}): WorkspaceShellCapabilitiesHostResult {
  const [floatingChatSession, setFloatingChatSession] = useState<FloatingChatSession | null>(null)
  useEffect(() => {
    setFloatingChatSession(null)
  }, [workspaceId])
  useEffect(() => {
    if (!nativeSessionHandoffs) return
    setFloatingChatSession((previous) => {
      if (!previous) return previous
      const handoff = Object.values(nativeSessionHandoffs).find(({ fromSessionId }) => fromSessionId === previous.sessionId)
      return handoff ? { ...previous, sessionId: handoff.toSessionId } : previous
    })
  }, [nativeSessionHandoffs])
  const shellCapabilities = useWorkspaceShellCapabilitiesController({ setFloatingChatSession, openChatPane, refreshChatSessions, surfaceDispatch })

  useEffect(() => {
    const onOpenDetachedChat = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail as { sessionId?: unknown; title?: unknown; initialDraft?: unknown; composingEnabled?: unknown } | undefined
      if (!detail || typeof detail.sessionId !== "string") return
      shellCapabilities.openDetachedChat(detail.sessionId, {
        ...(typeof detail.title === "string" ? { title: detail.title } : {}),
        ...(typeof detail.initialDraft === "string" ? { initialDraft: detail.initialDraft } : {}),
        ...(typeof detail.composingEnabled === "boolean" ? { composingEnabled: detail.composingEnabled } : {}),
      })
    }
    window.addEventListener("boring-workspace:open-detached-chat", onOpenDetachedChat)
    return () => window.removeEventListener("boring-workspace:open-detached-chat", onOpenDetachedChat)
  }, [shellCapabilities])

  const floatingChatSessionId = floatingChatSession?.sessionId ?? null
  const floatingChatSessionKey = floatingChatSessionId
    ? Object.entries(nativeSessionHandoffs ?? {}).find(([, handoff]) => handoff.toSessionId === floatingChatSessionId)?.[0]
      ?? workspaceSessionKey(floatingChatSessionId)
    : null
  const floatingChatTitle = floatingChatSessionId
    ? floatingChatSession?.title ?? sessionTitleById.get(floatingChatSessionKey ?? "") ?? (floatingChatSessionId === "default" ? defaultSessionTitle : floatingChatSessionId)
    : null
  const floatingChatParams = floatingChatSessionKey
    ? {
        ...makeCenterParams(floatingChatSessionKey, { bridgeEnabled: false }) as ChatPanelHostProps,
        ...(floatingChatSession?.initialDraft !== undefined ? { initialDraft: floatingChatSession.initialDraft } : {}),
      }
    : null
  const floatingChatNode = floatingChatSession && floatingChatSessionId && floatingChatParams ? (
    <DetachedChatPopover
      key={floatingChatSession.viewKey}
      sessionId={floatingChatSessionId}
      title={floatingChatTitle ?? floatingChatSessionId}
      chatParams={floatingChatParams}
      initialPosition={{ left: appLeftPaneCollapsed ? 24 : effectiveAppLeftPaneWidth + 24, top: 72 }}
      composingEnabled={floatingChatSession?.composingEnabled ?? false}
      onClose={() => setFloatingChatSession(null)}
      onDock={() => {
        const sessionRef = workspaceSessionRefFromKey(floatingChatSessionKey)
        openChatPane(sessionRef.sessionId, sessionRef.agentTypeId)
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
