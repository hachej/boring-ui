"use client"

import { createContext, useContext, type ReactNode } from "react"
import type { WorkspaceInboxShellApi, WorkspaceInboxShellResult } from "./inboxItemModel"

const failed = (message: string): WorkspaceInboxShellResult => ({ success: false, reason: "open-failed", message })

const noopShellApi: WorkspaceInboxShellApi = {
  openInboxPreview: () => failed("Inbox shell is not available."),
  openInboxItemPanel: () => failed("Inbox shell is not available."),
  openInboxArtifact: () => failed("Inbox shell is not available."),
  openDetachedChat: () => failed("Inbox shell is not available."),
}

const WorkspaceInboxShellContext = createContext<WorkspaceInboxShellApi>(noopShellApi)

export function WorkspaceInboxShellProvider({ value, children }: { value: WorkspaceInboxShellApi; children: ReactNode }) {
  return <WorkspaceInboxShellContext.Provider value={value}>{children}</WorkspaceInboxShellContext.Provider>
}

export function useWorkspaceInboxShell(): WorkspaceInboxShellApi {
  return useContext(WorkspaceInboxShellContext)
}
