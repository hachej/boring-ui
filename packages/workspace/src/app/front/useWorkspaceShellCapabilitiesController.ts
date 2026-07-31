"use client"

import { useMemo, useRef, type Dispatch, type SetStateAction } from "react"
import { dispatchUiCommand, type DispatchContext } from "../../front/bridge"
import type { WorkspaceShellCapabilities, WorkspaceShellArtifactTarget } from "../../front/shell/WorkspaceShellCapabilitiesContext"
import type { WorkspaceSessionRef } from "../../front/sessionIdentity"

function panelInstanceId(prefix: string, id: string): string {
  const safe = id.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 96)
  return `${prefix}.${safe || "item"}`
}

export interface FloatingChatSession {
  viewKey: string
  session: WorkspaceSessionRef
  title?: string
  initialDraft?: string
  composingEnabled?: boolean
}

export function useWorkspaceShellCapabilitiesController({
  setFloatingChatSession,
  openChatPane,
  refreshChatSessions,
  surfaceDispatch,
  resolveSessionRef,
}: {
  setFloatingChatSession: Dispatch<SetStateAction<FloatingChatSession | null>>
  openChatPane: (sessionId: string) => void
  refreshChatSessions: () => Promise<void>
  surfaceDispatch: DispatchContext
  resolveSessionRef: (sessionId: string) => WorkspaceSessionRef | null
}): WorkspaceShellCapabilities {
  const nextFloatingChatViewKey = useRef(0)
  return useMemo<WorkspaceShellCapabilities>(() => ({
    openArtifact: (artifact: WorkspaceShellArtifactTarget | null, options) => {
      if (!artifact) return { success: false, reason: "no-artifact", message: "This item has no artifact target." }
      if (artifact.type === "panel") {
        dispatchUiCommand({
          kind: "openPanel",
          params: {
            id: panelInstanceId(artifact.panelComponentId, options?.instanceId ?? artifact.panelComponentId),
            component: artifact.panelComponentId,
            title: options?.title ?? artifact.panelComponentId,
            params: artifact.params,
          },
        }, surfaceDispatch)
        return { success: true }
      }
      if (!artifact.target) return { success: false, reason: "open-failed", message: "This item has no surface target." }
      if (options?.sessionId) openChatPane(options.sessionId)
      dispatchUiCommand({
        kind: "openSurface",
        params: {
          kind: artifact.surfaceKind,
          target: artifact.target,
          meta: {
            ...(artifact.params ?? {}),
            ...(options?.sessionId ? { sessionId: options.sessionId } : {}),
          },
        },
      }, surfaceDispatch)
      return { success: true }
    },
    openDetachedChat: (sessionId: string, options) => {
      if (!sessionId) return { success: false, reason: "invalid-session", message: "Missing chat session id." }
      const session = resolveSessionRef(sessionId)
      if (!session) return { success: false, reason: "invalid-session", message: "Chat session id is missing or ambiguous." }
      setFloatingChatSession({
        viewKey: `floating-chat-${++nextFloatingChatViewKey.current}`,
        session,
        title: options?.title,
        initialDraft: options?.initialDraft,
        composingEnabled: options?.composingEnabled,
      })
      return { success: true }
    },
    refreshChatSessions,
  }), [openChatPane, refreshChatSessions, resolveSessionRef, setFloatingChatSession, surfaceDispatch])
}
