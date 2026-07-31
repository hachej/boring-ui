"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import type { DispatchContext } from "../../front/bridge"
import { DetachedChatPopover } from "../../front/chrome/chat/DetachedChatPopover"
import type { ChatPanelHostProps } from "../../front/chrome/chat/ChatPanelHost"
import type { WorkspaceShellCapabilities } from "../../front/shell/WorkspaceShellCapabilitiesContext"
import { workspaceSessionKey, workspaceSessionRefFromKey, type WorkspaceSessionRef } from "../../front/sessionIdentity"
import { useWorkspaceShellCapabilitiesController, type FloatingChatSession } from "./useWorkspaceShellCapabilitiesController"

export interface WorkspaceShellCapabilitiesHostResult {
  floatingChatNode: ReactNode
  shellCapabilities: WorkspaceShellCapabilities
  /** Trusted internal path that preserves the canonical session owner. */
  openDetachedChatRef: (
    session: WorkspaceSessionRef | string,
    options?: Parameters<WorkspaceShellCapabilities["openDetachedChat"]>[1],
  ) => ReturnType<WorkspaceShellCapabilities["openDetachedChat"]>
}

export function useWorkspaceShellCapabilitiesHost({
  appLeftPaneCollapsed,
  workspaceId,
  effectiveAppLeftPaneWidth,
  sessionTitleById,
  defaultSessionTitle,
  makeCenterParams,
  suppressDetachedInitialDraft,
  resolveSessionKey,
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
  makeCenterParams: (sessionId: string, options?: { bridgeEnabled?: boolean; view?: "pane" | "detached" }) => unknown
  suppressDetachedInitialDraft?: boolean
  /** Resolves a bare session id from the shell-capability contract to a workspace session key. */
  resolveSessionKey: (sessionId: string) => string
  openChatPane: (sessionId: string, agentTypeId?: string) => void
  refreshChatSessions: () => Promise<void>
  surfaceDispatch: DispatchContext
  onDockOverlay?: () => void
}): WorkspaceShellCapabilitiesHostResult {
  const [floatingChatSession, setFloatingChatSession] = useState<FloatingChatSession | null>(null)
  const nextInternalFloatingChatViewKey = useRef(0)
  const openDetachedChatRef = useCallback<WorkspaceShellCapabilitiesHostResult["openDetachedChatRef"]>((session, options) => {
    const sessionKey = typeof session === "string"
      ? session
      : workspaceSessionKey(session.sessionId, session.agentTypeId)
    const sessionRef = workspaceSessionRefFromKey(sessionKey)
    if (!sessionRef.sessionId) return { success: false, reason: "invalid-session", message: "Missing chat session id." }
    setFloatingChatSession({
      viewKey: `floating-chat-internal-${++nextInternalFloatingChatViewKey.current}`,
      sessionId: sessionRef.sessionId,
      sessionKey,
      title: options?.title,
      initialDraft: options?.initialDraft,
      composingEnabled: options?.composingEnabled,
    })
    return { success: true }
  }, [])
  useEffect(() => {
    setFloatingChatSession(null)
  }, [workspaceId])
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
    // Public callers remain bare-id compatible; trusted internal callers carry
    // the canonical owner key and bypass potentially stale/colliding list rows.
    ? floatingChatSession?.sessionKey ?? resolveSessionKey(floatingChatSessionId)
    : null
  const floatingChatTitle = floatingChatSessionId
    ? floatingChatSession?.title ?? sessionTitleById.get(floatingChatSessionKey ?? "") ?? (floatingChatSessionId === "default" ? defaultSessionTitle : floatingChatSessionId)
    : null
  const floatingChatParams = floatingChatSessionKey
    ? {
        ...makeCenterParams(floatingChatSessionKey, { bridgeEnabled: false, view: "detached" }) as ChatPanelHostProps,
        ...(!suppressDetachedInitialDraft && floatingChatSession?.initialDraft !== undefined
          ? { initialDraft: floatingChatSession.initialDraft }
          : {}),
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
        const sessionRef = workspaceSessionRefFromKey(floatingChatSessionKey ?? floatingChatSessionId)
        openChatPane(sessionRef.sessionId, sessionRef.agentTypeId)
        setFloatingChatSession(null)
        onDockOverlay?.()
      }}
    />
  ) : null

  return {
    floatingChatNode,
    shellCapabilities,
    openDetachedChatRef,
  }
}
