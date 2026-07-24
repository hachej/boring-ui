"use client"

import { useMemo, useRef, type Dispatch, type SetStateAction } from "react"
import { dispatchUiCommand, type DispatchContext } from "../../front/bridge"
import type { WorkspaceShellCapabilities, WorkspaceShellArtifactTarget } from "../../front/shell/WorkspaceShellCapabilitiesContext"
import { requestAppLeftOverlay } from "../../shared/plugins/appLeftOverlay"
import { WORKSPACE_OPEN_PATH_SURFACE_KIND } from "../../shared/types/surface"

function panelInstanceId(prefix: string, id: string): string {
  const safe = id.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 96)
  return `${prefix}.${safe || "item"}`
}

function browserLocalSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export interface FloatingChatSession {
  viewKey?: string
  sessionId: string
  title?: string
  initialDraft?: string
  composingEnabled?: boolean
  onNativeSessionPersisted?: (sessionId: string) => void | Promise<void>
  browserLocalId?: string
}

export function useWorkspaceShellCapabilitiesController({
  setFloatingChatSession,
  openChatPane,
  surfaceDispatch,
  isAppLeftOverlayAvailable,
  registerBrowserLocalSession,
}: {
  setFloatingChatSession: Dispatch<SetStateAction<FloatingChatSession | null>>
  openChatPane: (sessionId: string) => void
  surfaceDispatch: DispatchContext
  isAppLeftOverlayAvailable?: (id: string) => boolean
  registerBrowserLocalSession?: (localId: string, onNativeSessionPersisted?: (sessionId: string) => void | Promise<void>) => void
}): WorkspaceShellCapabilities {
  const nextFloatingChatViewKey = useRef(0)
  const nextViewKey = () => `floating-chat-${++nextFloatingChatViewKey.current}`
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
      if (artifact.surfaceKind === WORKSPACE_OPEN_PATH_SURFACE_KIND) {
        dispatchUiCommand({
          kind: "openFile",
          params: {
            path: artifact.target,
            ...(typeof artifact.params?.filesystem === "string" ? { filesystem: artifact.params.filesystem } : {}),
          },
        }, surfaceDispatch)
        return { success: true }
      }
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
        viewKey: nextViewKey(),
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
    openBrowserLocalDetachedChat: (options) => {
      const localId = browserLocalSessionId()
      registerBrowserLocalSession?.(localId, options?.onNativeSessionPersisted)
      setFloatingChatSession({
        viewKey: nextViewKey(),
        sessionId: localId,
        browserLocalId: localId,
        title: options?.title,
        initialDraft: options?.initialDraft,
        composingEnabled: options?.composingEnabled,
        onNativeSessionPersisted: options?.onNativeSessionPersisted,
      })
      return { success: true }
    },
  }), [isAppLeftOverlayAvailable, openChatPane, registerBrowserLocalSession, setFloatingChatSession, surfaceDispatch])
}
