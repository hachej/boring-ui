"use client"

import { useCallback, useEffect } from "react"
import { useWorkspaceChatPanel } from "../../provider"
import { emitAgentData } from "../../events"
import { startUiCommandStream } from "../../bridge/uiCommandStream"
import type { SurfaceShellApi } from "../artifact-surface/SurfaceShell"
import type { WorkspaceChatPanelProps } from "./types"

export interface ChatPanelHostShellProps {
  /** Headers forwarded to the embedded ChatPanel's agent API requests. */
  requestHeaders?: Record<string, string>
  getSurface?: () => SurfaceShellApi | null
  isWorkbenchOpen?: () => boolean
  openWorkbench?: () => void
}

export type ChatPanelHostProps = WorkspaceChatPanelProps & ChatPanelHostShellProps

function workspaceIdFromHeaders(headers?: Record<string, string>): string | null {
  return headers?.["x-boring-workspace-id"] ?? headers?.["X-Boring-Workspace-Id"] ?? null
}

export function ChatPanelHost(props: ChatPanelHostProps) {
  const ChatPanelImpl = useWorkspaceChatPanel()
  const {
    getSurface,
    isWorkbenchOpen,
    openWorkbench,
    ...chatPanelProps
  } = props

  const openArtifact = useCallback(
    (path: string) => {
      if (getSurface && openWorkbench) {
        if (!isWorkbenchOpen?.()) openWorkbench()
        const open = () => getSurface()?.openFile(path)
        if (getSurface()) open()
        else requestAnimationFrame(() => requestAnimationFrame(open))
      }
      props.onOpenArtifact?.(path)
    },
    [getSurface, isWorkbenchOpen, openWorkbench, props.onOpenArtifact],
  )

  const uiWorkspaceId = workspaceIdFromHeaders(chatPanelProps.requestHeaders)

  useEffect(() => {
    if (!getSurface || !isWorkbenchOpen || !openWorkbench) return
    return startUiCommandStream({
      query: uiWorkspaceId ? { workspaceId: uiWorkspaceId } : undefined,
      ctx: {
        surface: getSurface,
        isWorkbenchOpen,
        openWorkbench,
      },
    })
  }, [getSurface, isWorkbenchOpen, openWorkbench, uiWorkspaceId])

  const handleData = useCallback(
    (part: unknown) => {
      emitAgentData(part)
      props.onData?.(part)
    },
    [props.onData],
  )

  return (
    <ChatPanelImpl
      {...chatPanelProps}
      onOpenArtifact={openArtifact}
      onData={handleData}
    />
  )
}
