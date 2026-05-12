"use client"

import { useCallback, useEffect } from "react"
import { useWorkspaceAttention, useWorkspaceChatPanel } from "../../provider"
import { emitAgentData } from "../../events"
import { dispatchUiCommand, startUiCommandStream } from "../../bridge"
import type { SurfaceShellApi } from "../artifact-surface/SurfaceShell"
import type { WorkspaceChatPanelProps } from "./types"

export interface ChatPanelHostShellProps {
  /** Headers forwarded to the embedded ChatPanel's agent API requests. */
  requestHeaders?: Record<string, string>
  /** Endpoint base for agent → UI commands. Empty string = same origin. */
  bridgeEndpoint?: string | null
  getSurface?: () => SurfaceShellApi | null
  isWorkbenchOpen?: () => boolean
  openWorkbench?: () => void
  closeWorkbench?: () => void
}

export type ChatPanelHostProps = WorkspaceChatPanelProps & ChatPanelHostShellProps

function workspaceIdFromHeaders(headers?: Record<string, string>): string | null {
  return headers?.["x-boring-workspace-id"] ?? headers?.["X-Boring-Workspace-Id"] ?? null
}

function streamEndpointFromBridgeEndpoint(endpoint: string | null | undefined): string | undefined {
  if (!endpoint) return undefined
  const normalized = endpoint.replace(/\/$/, "")
  const suffix = "/api/v1/ui"
  if (normalized.endsWith(suffix)) return normalized.slice(0, -suffix.length) || undefined
  return normalized
}

export function ChatPanelHost(props: ChatPanelHostProps) {
  const ChatPanelImpl = useWorkspaceChatPanel()
  const { blockers } = useWorkspaceAttention()
  const {
    getSurface,
    isWorkbenchOpen,
    openWorkbench,
    closeWorkbench,
    bridgeEndpoint,
    ...chatPanelProps
  } = props

  const openArtifact = useCallback(
    (path: string) => {
      if (getSurface && isWorkbenchOpen && openWorkbench) {
        dispatchUiCommand(
          { kind: "openFile", params: { path } },
          { surface: getSurface, isWorkbenchOpen, openWorkbench, closeWorkbench },
        )
      }
      props.onOpenArtifact?.(path)
    },
    [getSurface, isWorkbenchOpen, openWorkbench, closeWorkbench, props.onOpenArtifact],
  )

  const uiWorkspaceId = workspaceIdFromHeaders(chatPanelProps.requestHeaders)
  const composerBlockers = blockers.filter((blocker) => !blocker.sessionId || blocker.sessionId === chatPanelProps.sessionId)

  useEffect(() => {
    if (bridgeEndpoint === null || !getSurface || !isWorkbenchOpen || !openWorkbench) return
    return startUiCommandStream({
      endpoint: streamEndpointFromBridgeEndpoint(bridgeEndpoint),
      query: uiWorkspaceId ? { workspaceId: uiWorkspaceId } : undefined,
      ctx: {
        surface: getSurface,
        isWorkbenchOpen,
        openWorkbench,
        closeWorkbench,
      },
    })
  }, [bridgeEndpoint, getSurface, isWorkbenchOpen, openWorkbench, closeWorkbench, uiWorkspaceId])

  const handleComposerStop = useCallback(() => {
    window.dispatchEvent(new CustomEvent("boring:workspace-composer-stop", { detail: { sessionId: chatPanelProps.sessionId } }))
    props.onComposerStop?.()
  }, [chatPanelProps.sessionId, props.onComposerStop])

  const handleComposerBlockerAction = useCallback(
    (blocker: NonNullable<WorkspaceChatPanelProps["composerBlockers"]>[number], action: "open" | "cancel") => {
      if (action === "cancel") {
        window.dispatchEvent(new CustomEvent("boring:workspace-composer-stop", { detail: { sessionId: chatPanelProps.sessionId } }))
        return
      }
      if (blocker.surfaceKind) {
        if (getSurface && isWorkbenchOpen && openWorkbench) {
          dispatchUiCommand(
            { kind: "openSurface", params: { kind: blocker.surfaceKind, target: blocker.target, meta: {} } },
            { surface: getSurface, isWorkbenchOpen, openWorkbench, closeWorkbench },
          )
        }
        window.dispatchEvent(new CustomEvent("boring:ask-user-open", { detail: { sessionId: blocker.sessionId, questionId: blocker.target } }))
      }
    },
    [chatPanelProps.sessionId, closeWorkbench, getSurface, isWorkbenchOpen, openWorkbench],
  )

  const handleData = useCallback(
    (part: unknown) => {
      emitAgentData(part)
      props.onData?.(part)
    },
    [props.onData],
  )

  return (
    <ChatPanelImpl
      chrome={false}
      {...chatPanelProps}
      onOpenArtifact={openArtifact}
      onData={handleData}
      composerBlockers={composerBlockers}
      onComposerStop={handleComposerStop}
      onComposerBlockerAction={handleComposerBlockerAction}
    />
  )
}
