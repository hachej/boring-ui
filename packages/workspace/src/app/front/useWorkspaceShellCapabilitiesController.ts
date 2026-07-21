"use client"

import { useMemo, type Dispatch, type SetStateAction } from "react"
import { dispatchUiCommand, type DispatchContext } from "../../front/bridge"
import type { WorkspaceShellCapabilities, WorkspaceShellArtifactTarget } from "../../front/shell/WorkspaceShellCapabilitiesContext"
import { requestAppLeftOverlay } from "../../shared/plugins/appLeftOverlay"

function panelInstanceId(prefix: string, id: string): string {
  const safe = id.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 96)
  return `${prefix}.${safe || "item"}`
}

function revealableWorkspacePath(path: string): string | null {
  const normalized = path.trim()
  if (!normalized || normalized.length > 1024 || normalized.includes("\0") || normalized.includes("\\")) return null
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) return null
  const segments = normalized.split("/")
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null
  return normalized
}

function browserLocalSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export interface FloatingChatSession {
  sessionId: string
  title?: string
  initialDraft?: string
  composingEnabled?: boolean
  browserLocalId?: string
}

export function useWorkspaceShellCapabilitiesController({
  setFloatingChatSession,
  openChatPane,
  surfaceDispatch,
  registerBrowserLocalSession,
  isAppLeftOverlayAvailable,
}: {
  setFloatingChatSession: Dispatch<SetStateAction<FloatingChatSession | null>>
  openChatPane: (sessionId: string) => void
  surfaceDispatch: DispatchContext
  registerBrowserLocalSession?: (localId: string, onNativeSessionPersisted?: (sessionId: string) => void | Promise<void>) => void
  isAppLeftOverlayAvailable?: (id: string) => boolean
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
    openDetachedChat: (sessionId: string, options) => {
      if (!sessionId) return { success: false, reason: "invalid-session", message: "Missing chat session id." }
      setFloatingChatSession({
        sessionId,
        title: options?.title,
        initialDraft: options?.initialDraft,
        composingEnabled: options?.composingEnabled,
      })
      return { success: true }
    },
    openFullChat: (sessionId: string) => {
      const normalized = sessionId.trim()
      if (!normalized) return { success: false, reason: "invalid-session", message: "Missing chat session id." }
      openChatPane(normalized)
      return { success: true }
    },
    openInboxItem: (itemId: string) => {
      const normalized = itemId.trim()
      if (!normalized || normalized.length > 512 || /[\u0000-\u001f\u007f]/.test(normalized)) {
        return { success: false, reason: "open-failed", message: "Invalid Inbox item id." }
      }
      if (!isAppLeftOverlayAvailable?.("inbox")) {
        return { success: false, reason: "open-failed", message: "Inbox is unavailable." }
      }
      return requestAppLeftOverlay("inbox", { itemId: normalized })
        ? { success: true }
        : { success: false, reason: "open-failed", message: "Inbox is unavailable." }
    },
    revealWorkspacePath: (path: string) => {
      const normalized = revealableWorkspacePath(path)
      if (!normalized) return { success: false, reason: "invalid-path", message: "Workspace path must be a safe relative path." }
      dispatchUiCommand({ kind: "expandToFile", params: { path: normalized } }, surfaceDispatch)
      return { success: true }
    },
    openBrowserLocalDetachedChat: (options) => {
      if (!registerBrowserLocalSession) return { success: false, reason: "open-failed", message: "Browser-local chat sessions are not available." }
      const localId = browserLocalSessionId()
      registerBrowserLocalSession(localId, options?.onNativeSessionPersisted)
      setFloatingChatSession({
        sessionId: localId,
        browserLocalId: localId,
        title: options?.title,
        initialDraft: options?.initialDraft,
        composingEnabled: options?.composingEnabled,
      })
      return { success: true }
    },
  }), [isAppLeftOverlayAvailable, openChatPane, registerBrowserLocalSession, setFloatingChatSession, surfaceDispatch])
}
