"use client"

import { useMemo, type Dispatch, type SetStateAction } from "react"
import { dispatchUiCommand, type DispatchContext } from "../../front/bridge"
import type { WorkspaceShellCapabilities, WorkspaceShellArtifactTarget } from "../../front/shell/WorkspaceShellCapabilitiesContext"

function panelInstanceId(prefix: string, id: string): string {
  const safe = id.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 96)
  return `${prefix}.${safe || "item"}`
}

export function useWorkspaceShellCapabilitiesController({
  setFloatingChatSessionId,
  openChatPane,
  surfaceDispatch,
}: {
  setFloatingChatSessionId: Dispatch<SetStateAction<string | null>>
  openChatPane: (sessionId: string) => void
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
    openDetachedChat: (sessionId: string) => {
      if (!sessionId) return { success: false, reason: "invalid-session", message: "Missing chat session id." }
      setFloatingChatSessionId(sessionId)
      return { success: true }
    },
  }), [openChatPane, setFloatingChatSessionId, surfaceDispatch])
}
