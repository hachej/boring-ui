"use client"

import { useCallback, useEffect, useRef } from "react"
import { useWorkspaceAttention, useWorkspaceChatPanel } from "../../provider"
import { emitAgentData } from "../../events"
import { dispatchUiCommand, startUiCommandStream } from "../../bridge"
import { relativizeWorkspacePath } from "../../../app/front/workspacePreload"
import type { DispatchContext } from "../../bridge"
import type { WorkspaceChatPanelProps } from "./types"

export interface ChatPanelHostShellProps {
  /** Headers forwarded to the embedded ChatPanel's agent API requests. */
  requestHeaders?: Record<string, string>
  /** Endpoint base for agent → UI commands. Empty string = same origin. */
  bridgeEndpoint?: string | null
  /**
   * Agent → UI command dispatch context (surface handle, open/close workbench,
   * and the pending-op queue). Built once by the host and shared by every
   * dispatch site here. Absent when the workbench surface isn't available.
   */
  surfaceDispatch?: DispatchContext
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

function workspaceAgentDataPart(part: unknown): unknown {
  if (typeof part !== "object" || part === null) return part
  const event = part as Record<string, unknown>
  if (event.type !== "file-changed" || typeof event.path !== "string") return part
  return {
    type: "data-file-changed",
    data: {
      op: typeof event.changeType === "string" ? event.changeType : "edit",
      path: event.path,
      toolCallId: typeof event.seq === "number" ? `pi:${event.seq}` : "pi:file-changed",
    },
  }
}

export function ChatPanelHost(props: ChatPanelHostProps) {
  const ChatPanelImpl = useWorkspaceChatPanel()
  const { blockers } = useWorkspaceAttention()
  const {
    surfaceDispatch,
    bridgeEndpoint,
    ...chatPanelProps
  } = props

  // Agent tool inputs (read/write/edit) carry absolute filesystem paths, but
  // the workspace file API is relative-only (absolute paths 403). Learn the
  // workspace root once so click-to-open can translate absolute → relative.
  const workspaceRootRef = useRef<string | null>(null)
  const apiBase = streamEndpointFromBridgeEndpoint(bridgeEndpoint) ?? ""
  const metaWorkspaceId = workspaceIdFromHeaders(chatPanelProps.requestHeaders)
  useEffect(() => {
    let cancelled = false
    const headers: Record<string, string> = metaWorkspaceId ? { "x-boring-workspace-id": metaWorkspaceId } : {}
    void fetch(`${apiBase}/api/v1/workspace/meta`, { headers })
      .then((res) => (res.ok ? res.json() as Promise<{ workspaceRoot?: unknown }> : null))
      .then((meta) => {
        if (cancelled) return
        if (meta && typeof meta.workspaceRoot === "string") workspaceRootRef.current = meta.workspaceRoot
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [apiBase, metaWorkspaceId])

  const openArtifact = useCallback(
    (path: string) => {
      const resolved = relativizeWorkspacePath(path, workspaceRootRef.current)
      if (surfaceDispatch) {
        dispatchUiCommand({ kind: "openFile", params: { path: resolved } }, surfaceDispatch)
      }
      props.onOpenArtifact?.(resolved)
    },
    [surfaceDispatch, props.onOpenArtifact],
  )

  const uiWorkspaceId = workspaceIdFromHeaders(chatPanelProps.requestHeaders)
  const composerBlockers = blockers.filter((blocker) => !blocker.sessionId || !chatPanelProps.sessionId || blocker.sessionId === chatPanelProps.sessionId)

  useEffect(() => {
    if (bridgeEndpoint === null || !surfaceDispatch) return
    return startUiCommandStream({
      endpoint: streamEndpointFromBridgeEndpoint(bridgeEndpoint),
      query: uiWorkspaceId ? { workspaceId: uiWorkspaceId } : undefined,
      ctx: surfaceDispatch,
    })
  }, [bridgeEndpoint, surfaceDispatch, uiWorkspaceId])

  const handleComposerStop = useCallback(() => {
    window.dispatchEvent(new CustomEvent("boring:workspace-composer-stop", { detail: { sessionId: chatPanelProps.sessionId, reason: "user-stop" } }))
    props.onComposerStop?.()
  }, [chatPanelProps.sessionId, props.onComposerStop])

  const handleComposerBlockerAction = useCallback(
    (blocker: NonNullable<WorkspaceChatPanelProps["composerBlockers"]>[number], action: string) => {
      if (action === "cancel") {
        window.dispatchEvent(new CustomEvent("boring:workspace-composer-stop", { detail: { sessionId: chatPanelProps.sessionId, reason: "blocker-cancel" } }))
        return
      }
      if (action !== "open" || !blocker.surfaceKind) return
      if (surfaceDispatch) {
        const sessionId = blocker.sessionId ?? chatPanelProps.sessionId
        dispatchUiCommand(
          {
            kind: "openSurface",
            params: {
              kind: blocker.surfaceKind,
              target: blocker.target,
              meta: sessionId ? { sessionId, openOnlyWhenSessionOpen: true } : {},
            },
          },
          surfaceDispatch,
        )
      }
    },
    [chatPanelProps.sessionId, surfaceDispatch],
  )

  const handleData = useCallback(
    (part: unknown) => {
      emitAgentData(workspaceAgentDataPart(part))
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
