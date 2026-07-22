import { createContext, createElement, useContext, type ReactNode } from "react"

export type WorkspaceShellArtifactTarget =
  | { type: "surface"; surfaceKind: string; target?: string; params?: Record<string, unknown> }
  | { type: "panel"; panelComponentId: string; params?: Record<string, unknown> }

export type WorkspaceShellCapabilityResult =
  | { success: true }
  | { success: false; reason: "no-artifact" | "open-failed" | "invalid-session" | "invalid-path" | "placement-failed"; message: string }

export interface WorkspaceShellAnchorRect {
  x: number
  y: number
  width: number
  height: number
  top: number
  right: number
  bottom: number
  left: number
}

export interface WorkspaceShellCapabilities {
  openArtifact(target: WorkspaceShellArtifactTarget | null, options?: { sessionId?: string | null; title?: string; instanceId?: string }): WorkspaceShellCapabilityResult
  openDetachedChat(sessionId: string, options?: { anchor?: WorkspaceShellAnchorRect; title?: string; initialDraft?: string; composingEnabled?: boolean }): WorkspaceShellCapabilityResult
  openFullChat(sessionId: string): WorkspaceShellCapabilityResult
  openInboxItem(itemId: string): WorkspaceShellCapabilityResult
  openBrowserLocalDetachedChat(options?: {
    anchor?: WorkspaceShellAnchorRect
    title?: string
    initialDraft?: string
    composingEnabled?: boolean
    onNativeSessionPersisted?: (sessionId: string) => void | Promise<void>
  }): WorkspaceShellCapabilityResult
}

const failed = (message: string): WorkspaceShellCapabilityResult => ({ success: false, reason: "open-failed", message })

const noopShellCapabilities: WorkspaceShellCapabilities = {
  openArtifact: () => ({ success: false, reason: "no-artifact", message: "No artifact is available." }),
  openDetachedChat: () => failed("Workspace shell capabilities are not available."),
  openFullChat: () => failed("Workspace shell capabilities are not available."),
  openInboxItem: () => failed("Workspace shell capabilities are not available."),
  openBrowserLocalDetachedChat: () => failed("Workspace shell capabilities are not available."),
}

const WorkspaceShellCapabilitiesContext = createContext<WorkspaceShellCapabilities>(noopShellCapabilities)

export function WorkspaceShellCapabilitiesProvider({
  value,
  children,
}: {
  value: WorkspaceShellCapabilities
  children?: ReactNode
}) {
  return createElement(WorkspaceShellCapabilitiesContext.Provider, { value }, children)
}

export function useWorkspaceShellCapabilities(): WorkspaceShellCapabilities {
  return useContext(WorkspaceShellCapabilitiesContext)
}
