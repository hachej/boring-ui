"use client"

import { useMemo } from "react"
import { openHumanArtifact, useWorkspaceShellCapabilities } from "@hachej/boring-workspace"
import type { WorkspaceInboxShellApi } from "./inboxItemModel"

export function useWorkspaceInboxShell(): WorkspaceInboxShellApi {
  const shell = useWorkspaceShellCapabilities()
  return useMemo<WorkspaceInboxShellApi>(() => ({
    openInboxArtifact: (item, artifact) => openHumanArtifact(shell, artifact, {
      sessionId: item.sessionId,
    }),
    openDetachedChat: shell.openDetachedChat,
  }), [shell])
}
