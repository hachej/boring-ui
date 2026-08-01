"use client"

import { useMemo, type Dispatch, type SetStateAction } from "react"
import { dispatchUiCommand, type DispatchContext } from "../../front/bridge"
import type { WorkspaceShellCapabilities, WorkspaceShellArtifactTarget, WorkspaceShellSessionRef } from "../../front/shell/WorkspaceShellCapabilitiesContext"

function panelInstanceId(prefix: string, id: string): string {
  const safe = id.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 96)
  return `${prefix}.${safe || "item"}`
}

export function useWorkspaceShellCapabilitiesController({
  setFloatingChatSession,
  openChatPane,
  refreshChatSessions,
  surfaceDispatch,
}: {
  setFloatingChatSession: Dispatch<SetStateAction<{ ref: WorkspaceShellSessionRef; title?: string; initialDraft?: string; composingEnabled?: boolean } | null>>
  openChatPane: (sessionId: string) => void
  refreshChatSessions: () => Promise<void>
  surfaceDispatch: DispatchContext
}): WorkspaceShellCapabilities {
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
    openDetachedChat: (ref, options) => {
      if (!ref.agentTypeId || !ref.sessionId) return { success: false, reason: "invalid-session", message: "Missing chat Agent or session id." }
      setFloatingChatSession({
        ref,
        title: options?.title,
        initialDraft: options?.initialDraft,
        composingEnabled: options?.composingEnabled,
      })
      return { success: true }
    },
    refreshChatSessions,
  }), [openChatPane, refreshChatSessions, setFloatingChatSession, surfaceDispatch])
}
