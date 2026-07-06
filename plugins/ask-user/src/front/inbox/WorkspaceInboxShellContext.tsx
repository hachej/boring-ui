"use client"

import { useMemo } from "react"
import { useWorkspaceShellCapabilities } from "@hachej/boring-workspace"
import type { WorkspaceInboxShellApi } from "./inboxItemModel"

export function useWorkspaceInboxShell(): WorkspaceInboxShellApi {
  const shell = useWorkspaceShellCapabilities()
  return useMemo<WorkspaceInboxShellApi>(() => ({
    openInboxArtifact: (item) => shell.openArtifact(item.artifact, {
      // Row clicks open the workspace artifact/question only. The explicit chat
      // icon owns chat opening; otherwise ask-user inbox rows jump to chat
      // instead of showing the Questions form.
      sessionId: null,
      title: item.title,
      instanceId: item.id,
    }),
    openDetachedChat: shell.openDetachedChat,
  }), [shell])
}
