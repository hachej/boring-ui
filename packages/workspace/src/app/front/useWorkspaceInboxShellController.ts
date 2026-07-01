"use client"

import { useMemo, type Dispatch, type SetStateAction } from "react"
import { dispatchUiCommand, type DispatchContext } from "../../front/bridge"
import {
  type WorkspaceInboxItem,
  type WorkspaceInboxShellApi,
} from "../../plugins/inboxPlugin/front"

function panelInstanceId(prefix: string, id: string): string {
  const safe = id.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 96)
  return `${prefix}.${safe || "item"}`
}

export function useWorkspaceInboxShellController({
  setFloatingChatSessionId,
  surfaceDispatch,
}: {
  setFloatingChatSessionId: Dispatch<SetStateAction<string | null>>
  surfaceDispatch: DispatchContext
}): WorkspaceInboxShellApi {
  return useMemo<WorkspaceInboxShellApi>(() => ({
    openInboxArtifact: (item: WorkspaceInboxItem) => {
      if (!item.artifact) return { success: false, reason: "no-artifact", message: "This inbox item has no artifact target." }
      if (item.artifact.type === "panel") {
        dispatchUiCommand({
          kind: "openPanel",
          params: {
            id: panelInstanceId(item.artifact.panelComponentId, item.id),
            component: item.artifact.panelComponentId,
            title: item.title,
            params: item.artifact.params,
          },
        }, surfaceDispatch)
        return { success: true }
      }
      dispatchUiCommand({
        kind: "openSurface",
        params: {
          kind: item.artifact.surfaceKind,
          target: item.artifact.target,
          meta: item.sessionId ? { sessionId: item.sessionId } : {},
        },
      }, surfaceDispatch)
      return { success: true }
    },
    openDetachedChat: (sessionId: string) => {
      if (!sessionId) return { success: false, reason: "invalid-session", message: "Missing chat session id." }
      setFloatingChatSessionId(sessionId)
      return { success: true }
    },
  }), [setFloatingChatSessionId, surfaceDispatch])
}
