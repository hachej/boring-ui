"use client"

import { useEffect, useState, type ReactNode } from "react"
import type { DispatchContext } from "../../front/bridge"
import { DetachedChatPopover } from "../../front/chrome/chat/DetachedChatPopover"
import type { ChatPanelHostProps } from "../../front/chrome/chat/ChatPanelHost"
import type { WorkspaceShellCapabilities } from "../../front/shell/WorkspaceShellCapabilitiesContext"
import { useWorkspaceShellCapabilitiesController, type FloatingChatSession } from "./useWorkspaceShellCapabilitiesController"

export interface WorkspaceShellCapabilitiesHostResult {
  floatingChatNode: ReactNode
  shellCapabilities: WorkspaceShellCapabilities
}

export interface NativeSessionIdReplacement {
  workspaceId: string
  fromSessionId: string
  toSessionId: string
}

export function useWorkspaceShellCapabilitiesHost({
  appLeftPaneCollapsed,
  workspaceId,
  nativeSessionIdReplacement,
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
  nativeSessionIdReplacement: NativeSessionIdReplacement | null
  effectiveAppLeftPaneWidth: number
  sessionTitleById: Map<string, string | null | undefined>
  defaultSessionTitle: string
  makeCenterParams: (sessionId: string, options?: { bridgeEnabled?: boolean }) => unknown
  openChatPane: (sessionId: string) => void
  surfaceDispatch: DispatchContext
  onDockOverlay?: () => void
}): WorkspaceShellCapabilitiesHostResult {
  const [floatingChatSession, setFloatingChatSession] = useState<FloatingChatSession | null>(null)
  useEffect(() => {
    setFloatingChatSession(null)
  }, [workspaceId])
  useEffect(() => {
    if (!nativeSessionIdReplacement || nativeSessionIdReplacement.workspaceId !== workspaceId) return
    setFloatingChatSession((previous) => previous?.sessionId === nativeSessionIdReplacement.fromSessionId
      ? { ...previous, sessionId: nativeSessionIdReplacement.toSessionId }
      : previous)
  }, [nativeSessionIdReplacement, workspaceId])
  const shellCapabilities = useWorkspaceShellCapabilitiesController({ setFloatingChatSession, openChatPane, surfaceDispatch })

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
  const floatingChatTitle = floatingChatSessionId
    ? floatingChatSession?.title ?? sessionTitleById.get(floatingChatSessionId) ?? (floatingChatSessionId === "default" ? defaultSessionTitle : floatingChatSessionId)
    : null
  const floatingChatParams = floatingChatSessionId
    ? (() => {
        const params = makeCenterParams(floatingChatSessionId, { bridgeEnabled: false }) as ChatPanelHostProps
        return {
          ...params,
          onNativeSessionAdopt: (session: Parameters<NonNullable<ChatPanelHostProps["onNativeSessionAdopt"]>>[0]) => {
            params.onNativeSessionAdopt?.(session)
          },
          ...(floatingChatSession?.initialDraft !== undefined ? { initialDraft: floatingChatSession.initialDraft } : {}),
        }
      })()
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
        openChatPane(floatingChatSessionId)
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
