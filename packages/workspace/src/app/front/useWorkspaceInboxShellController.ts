"use client"

import { useMemo, type Dispatch, type SetStateAction } from "react"
import { dispatchUiCommand, type DispatchContext } from "../../front/bridge"
import {
  WORKSPACE_INBOX_DETAIL_PANEL_ID,
  WORKSPACE_INBOX_PREVIEW_PANEL_ID,
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
    openInboxPreview: (item: WorkspaceInboxItem) => {
      dispatchUiCommand({
        kind: "openPanel",
        params: {
          id: WORKSPACE_INBOX_PREVIEW_PANEL_ID,
          component: WORKSPACE_INBOX_PREVIEW_PANEL_ID,
          title: "Inbox Preview",
          params: { itemId: item.id, blockerId: item.id },
        },
      }, surfaceDispatch)
      return { success: true }
    },
    openInboxItemPanel: (item: WorkspaceInboxItem) => {
      dispatchUiCommand({
        kind: "openPanel",
        params: {
          id: panelInstanceId(WORKSPACE_INBOX_DETAIL_PANEL_ID, item.id),
          component: WORKSPACE_INBOX_DETAIL_PANEL_ID,
          title: item.title,
          params: { itemId: item.id, blockerId: item.id },
        },
      }, surfaceDispatch)
      return { success: true }
    },
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
          meta: item.sessionId ? { sessionId: item.sessionId, openOnlyWhenSessionOpen: true } : {},
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
