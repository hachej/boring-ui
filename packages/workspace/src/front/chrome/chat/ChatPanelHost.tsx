"use client"

import { useCallback, useEffect, useRef } from "react"
import { emitWorkspaceAttentionAction, useWorkspaceAttention, useWorkspaceChatPanel } from "../../provider"
import { emitAgentData } from "../../events"
import { dispatchUiCommand, startUiCommandStream } from "../../bridge"
import { relativizeWorkspacePath } from "../../../app/front/workspacePreload"
import { normalizeUiFilesystem, type FilesystemId } from "../../../shared/types/filesystem"
import type { DispatchContext } from "../../bridge"
import { WORKSPACE_COMPOSER_STOP_REASONS, emitWorkspaceComposerStop } from "./composerStop"
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
      ...(typeof event.filesystem === "string" && event.filesystem.length > 0
        ? { filesystem: event.filesystem }
        : {}),
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
    (path: string, options?: { filesystem?: FilesystemId }) => {
      const filesystem = normalizeUiFilesystem(options?.filesystem)
      const resolved = filesystem === "user" ? relativizeWorkspacePath(path, workspaceRootRef.current) : path
      if (surfaceDispatch) {
        dispatchUiCommand({ kind: "openFile", params: { path: resolved, filesystem } }, surfaceDispatch)
      }
      if (filesystem === "user") props.onOpenArtifact?.(resolved)
      else props.onOpenArtifact?.(resolved, { filesystem })
    },
    [surfaceDispatch, props.onOpenArtifact],
  )

  const uiWorkspaceId = workspaceIdFromHeaders(chatPanelProps.requestHeaders)
  // A missing host session id means a single/sessionless chat host. In that
  // mode, keep scoped blockers visible instead of hiding the only attention UI.
  // Multi-session hosts should pass `sessionId` so unrelated blockers filter out.
  const attentionComposerBlockers = blockers.filter((blocker) => !blocker.sessionId || !chatPanelProps.sessionId || blocker.sessionId === chatPanelProps.sessionId)
  const composerBlockers = [...(chatPanelProps.composerBlockers ?? []), ...attentionComposerBlockers]

  useEffect(() => {
    if (bridgeEndpoint === null || !surfaceDispatch) return
    return startUiCommandStream({
      endpoint: streamEndpointFromBridgeEndpoint(bridgeEndpoint),
      query: uiWorkspaceId ? { workspaceId: uiWorkspaceId } : undefined,
      ctx: surfaceDispatch,
    })
  }, [bridgeEndpoint, surfaceDispatch, uiWorkspaceId])

  const handleComposerStop = useCallback(() => {
    emitWorkspaceComposerStop({ sessionId: chatPanelProps.sessionId, reason: WORKSPACE_COMPOSER_STOP_REASONS.userStop })
    props.onComposerStop?.()
  }, [chatPanelProps.sessionId, props.onComposerStop])

  const handleComposerBlockerAction = useCallback(
    (blocker: NonNullable<WorkspaceChatPanelProps["composerBlockers"]>[number], action: string) => {
      const sessionId = blocker.sessionId ?? chatPanelProps.sessionId
      chatPanelProps.onComposerBlockerAction?.(blocker, action)
      emitWorkspaceAttentionAction({ blockerId: blocker.id, actionId: action, blocker, sessionId })
      if (action !== "open" || !blocker.surfaceKind) return
      if (surfaceDispatch) {
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
    [chatPanelProps, surfaceDispatch],
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
