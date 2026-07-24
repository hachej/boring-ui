"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import type { EphemeralSessionCoordinatorApi } from "@hachej/boring-agent/front"
import type { DispatchContext } from "../../front/bridge"
import { DetachedChatPopover } from "../../front/chrome/chat/DetachedChatPopover"
import type { ChatPanelHostProps } from "../../front/chrome/chat/ChatPanelHost"
import type { WorkspaceShellCapabilities } from "../../front/shell/WorkspaceShellCapabilitiesContext"
import { useWorkspaceShellCapabilitiesController, type FloatingChatSession } from "./useWorkspaceShellCapabilitiesController"

export function fullChatSessionIdFromEvent(event: Event): string | null {
  const detail = (event as CustomEvent<unknown>).detail as { sessionId?: unknown } | undefined
  const sessionId = typeof detail?.sessionId === "string" ? detail.sessionId.trim() : ""
  return sessionId && sessionId.length <= 128 ? sessionId : null
}

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
  isAppLeftOverlayAvailable,
  ephemeralSessionCoordinator,
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
  isAppLeftOverlayAvailable: (id: string) => boolean
  ephemeralSessionCoordinator: EphemeralSessionCoordinatorApi
}): WorkspaceShellCapabilitiesHostResult {
  const [floatingChatSession, setFloatingChatSession] = useState<FloatingChatSession | null>(null)
  const materializationCallbacks = useRef(new Map<string, (sessionId: string) => void | Promise<void>>())
  useEffect(() => {
    materializationCallbacks.current.clear()
    setFloatingChatSession(null)
  }, [workspaceId])
  const registerBrowserLocalSession = useCallback((localId: string, callback?: (sessionId: string) => void | Promise<void>) => {
    ephemeralSessionCoordinator.register(localId)
    if (callback) materializationCallbacks.current.set(localId, callback)
  }, [ephemeralSessionCoordinator])
  useEffect(() => ephemeralSessionCoordinator.subscribe(({ localId, session }) => {
    const callback = materializationCallbacks.current.get(localId)
    const adoptFloatingSession = () => setFloatingChatSession((current) => current?.browserLocalId === localId
      ? { ...current, sessionId: session.id, browserLocalId: undefined }
      : current)
    if (!callback) {
      adoptFloatingSession()
      return
    }
    void Promise.resolve(callback(session.id)).then(() => {
      materializationCallbacks.current.delete(localId)
      adoptFloatingSession()
    }).catch(async (error) => {
      materializationCallbacks.current.delete(localId)
      setFloatingChatSession((current) => current?.browserLocalId === localId ? null : current)
      try {
        await ephemeralSessionCoordinator.discard(localId)
      } catch {
        // The binding failed closed; deletion is best-effort and the original error is retained for diagnostics.
      }
      console.error("Failed to persist browser-local chat handoff", error)
    })
  }), [ephemeralSessionCoordinator])
  const shellCapabilities = useWorkspaceShellCapabilitiesController({
    setFloatingChatSession,
    openChatPane,
    surfaceDispatch,
    registerBrowserLocalSession,
    isAppLeftOverlayAvailable,
  })

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
    const onOpenFullChat = (event: Event) => {
      const sessionId = fullChatSessionIdFromEvent(event)
      if (!sessionId) return
      shellCapabilities.openFullChat(sessionId)
    }
    const onOpenBrowserLocalDetachedChat = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail as {
        title?: unknown
        initialDraft?: unknown
        composingEnabled?: unknown
        onNativeSessionPersisted?: unknown
      } | undefined
      if (!detail) return
      shellCapabilities.openBrowserLocalDetachedChat({
        ...(typeof detail.title === "string" ? { title: detail.title } : {}),
        ...(typeof detail.initialDraft === "string" ? { initialDraft: detail.initialDraft } : {}),
        ...(typeof detail.composingEnabled === "boolean" ? { composingEnabled: detail.composingEnabled } : {}),
        ...(typeof detail.onNativeSessionPersisted === "function"
          ? { onNativeSessionPersisted: detail.onNativeSessionPersisted as (sessionId: string) => void | Promise<void> }
          : {}),
      })
    }
    window.addEventListener("boring-workspace:open-detached-chat", onOpenDetachedChat)
    window.addEventListener("boring-workspace:open-full-chat", onOpenFullChat)
    window.addEventListener("boring-workspace:open-browser-local-detached-chat", onOpenBrowserLocalDetachedChat)
    return () => {
      window.removeEventListener("boring-workspace:open-detached-chat", onOpenDetachedChat)
      window.removeEventListener("boring-workspace:open-full-chat", onOpenFullChat)
      window.removeEventListener("boring-workspace:open-browser-local-detached-chat", onOpenBrowserLocalDetachedChat)
    }
  }, [shellCapabilities])

  const floatingChatSessionId = floatingChatSession?.sessionId ?? null
  const floatingChatTitle = floatingChatSessionId
    ? floatingChatSession?.title ?? sessionTitleById.get(floatingChatSessionId) ?? (floatingChatSessionId === "default" ? defaultSessionTitle : floatingChatSessionId)
    : null
  const floatingChatParams = floatingChatSessionId
    ? {
        ...makeCenterParams(floatingChatSessionId, { bridgeEnabled: false }) as ChatPanelHostProps,
        ...(floatingChatSession?.initialDraft !== undefined ? { initialDraft: floatingChatSession.initialDraft } : {}),
      }
    : null
  const floatingChatNode = floatingChatSessionId && floatingChatParams ? (
    <DetachedChatPopover
      key={floatingChatSessionId}
      sessionId={floatingChatSessionId}
      title={floatingChatTitle ?? floatingChatSessionId}
      chatParams={floatingChatParams}
      initialPosition={{ left: appLeftPaneCollapsed ? 24 : effectiveAppLeftPaneWidth + 24, top: 72 }}
      composingEnabled={floatingChatSession?.composingEnabled ?? false}
      onClose={() => {
        const localId = floatingChatSession?.browserLocalId
        if (localId) {
          materializationCallbacks.current.delete(localId)
          void ephemeralSessionCoordinator.discard(localId).catch(() => {})
        }
        setFloatingChatSession(null)
      }}
      onDock={() => {
        if (floatingChatSession?.browserLocalId) return
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
