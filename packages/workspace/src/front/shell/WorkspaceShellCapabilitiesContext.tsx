"use client"

import { createContext, useContext, type ReactNode } from "react"

export type WorkspaceShellArtifactTarget =
  | { type: "surface"; surfaceKind: string; target?: string; params?: Record<string, unknown> }
  | { type: "panel"; panelComponentId: string; params?: Record<string, unknown> }

export type WorkspaceShellCapabilityResult =
  | { success: true }
  | { success: false; reason: "no-artifact" | "open-failed" | "invalid-session" | "placement-failed"; message: string }

export interface WorkspaceShellCapabilities {
  openArtifact(target: WorkspaceShellArtifactTarget | null, options?: { sessionId?: string | null; title?: string; instanceId?: string }): WorkspaceShellCapabilityResult
  openDetachedChat(sessionId: string, options?: { anchor?: DOMRect; title?: string }): WorkspaceShellCapabilityResult
}

const failed = (message: string): WorkspaceShellCapabilityResult => ({ success: false, reason: "open-failed", message })

const noopShellCapabilities: WorkspaceShellCapabilities = {
  openArtifact: () => ({ success: false, reason: "no-artifact", message: "No artifact is available." }),
  openDetachedChat: () => failed("Workspace shell capabilities are not available."),
}

const WorkspaceShellCapabilitiesContext = createContext<WorkspaceShellCapabilities>(noopShellCapabilities)

export function WorkspaceShellCapabilitiesProvider({
  value,
  children,
}: {
  value: WorkspaceShellCapabilities
  children: ReactNode
}) {
  return <WorkspaceShellCapabilitiesContext.Provider value={value}>{children}</WorkspaceShellCapabilitiesContext.Provider>
}

export function useWorkspaceShellCapabilities(): WorkspaceShellCapabilities {
  return useContext(WorkspaceShellCapabilitiesContext)
}
