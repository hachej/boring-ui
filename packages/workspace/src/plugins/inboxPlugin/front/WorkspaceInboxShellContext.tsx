"use client"

import { useMemo } from "react"
import { useWorkspaceShellCapabilities } from "../../../front/shell/WorkspaceShellCapabilitiesContext"
import type { WorkspaceInboxShellApi } from "./inboxItemModel"

export function useWorkspaceInboxShell(): WorkspaceInboxShellApi {
  const shell = useWorkspaceShellCapabilities()
  return useMemo<WorkspaceInboxShellApi>(() => ({
    openInboxArtifact: (item) => shell.openArtifact(item.artifact, {
      sessionId: item.chatAvailable ? item.sessionId : null,
      title: item.title,
      instanceId: item.id,
    }),
    openDetachedChat: shell.openDetachedChat,
  }), [shell])
}
