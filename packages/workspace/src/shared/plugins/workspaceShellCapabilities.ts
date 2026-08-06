import { createContext, createElement, useContext, type Context, type ReactNode } from "react"

export type WorkspaceShellArtifactTarget =
  | { type: "surface"; surfaceKind: string; target?: string; params?: Record<string, unknown> }
  | { type: "panel"; panelComponentId: string; params?: Record<string, unknown> }

export type WorkspaceShellCapabilityResult =
  | { success: true }
  | { success: false; reason: "no-artifact" | "open-failed" | "invalid-session" | "placement-failed"; message: string }

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

export interface WorkspaceShellSessionRef {
  agentTypeId: string
  sessionId: string
}

export const WORKSPACE_CHAT_PROMPT_ACCEPTED_EVENT = "boring-workspace:chat-prompt-accepted"
export const WORKSPACE_DETACHED_CHAT_VISIBILITY_EVENT = "boring-workspace:detached-chat-visibility"

export interface WorkspaceChatPromptAcceptedDetail extends WorkspaceShellSessionRef {
  clientNonce: string
}

export interface WorkspaceDetachedChatVisibilityDetail {
  open: boolean
  ref?: WorkspaceShellSessionRef
}

export type WorkspaceShellCreatedSessionResult =
  | { success: true; ref: WorkspaceShellSessionRef }
  | { success: false; reason: "create-failed"; message: string }

export interface WorkspaceShellCapabilities {
  openArtifact(target: WorkspaceShellArtifactTarget | null, options?: { sessionId?: string | null; title?: string; instanceId?: string }): WorkspaceShellCapabilityResult
  createChatSession?(options?: { title?: string }): Promise<WorkspaceShellCreatedSessionResult>
  deleteChatSession?(ref: WorkspaceShellSessionRef): Promise<WorkspaceShellCapabilityResult>
  openDetachedChat(ref: WorkspaceShellSessionRef, options?: { anchor?: WorkspaceShellAnchorRect; title?: string; initialDraft?: string; composingEnabled?: boolean }): WorkspaceShellCapabilityResult
  openFullChat(ref: WorkspaceShellSessionRef): WorkspaceShellCapabilityResult
  openInboxItem(itemId: string): WorkspaceShellCapabilityResult
  refreshChatSessions?(): Promise<void>
}

const failed = (message: string): WorkspaceShellCapabilityResult => ({ success: false, reason: "open-failed", message })

const noopShellCapabilities: WorkspaceShellCapabilities = {
  openArtifact: () => ({ success: false, reason: "no-artifact", message: "No artifact is available." }),
  openDetachedChat: () => failed("Workspace shell capabilities are not available."),
  openFullChat: () => failed("Workspace shell capabilities are not available."),
  openInboxItem: () => failed("Workspace shell capabilities are not available."),
}

// Front plugins load through separate package entry bundles. Keep one context
// per browser realm so those bundles consume the host provider rather than a
// private context copy that silently returns the no-op capabilities.
const WORKSPACE_SHELL_CAPABILITIES_CONTEXT_KEY = "__BORING_WORKSPACE_SHELL_CAPABILITIES_CONTEXT_V1__"
const contextHost = globalThis as Record<string, unknown>
const WorkspaceShellCapabilitiesContext = (
  contextHost[WORKSPACE_SHELL_CAPABILITIES_CONTEXT_KEY] as Context<WorkspaceShellCapabilities> | undefined
) ?? createContext<WorkspaceShellCapabilities>(noopShellCapabilities)
contextHost[WORKSPACE_SHELL_CAPABILITIES_CONTEXT_KEY] = WorkspaceShellCapabilitiesContext

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
