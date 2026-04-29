"use client"

import { useCallback, useEffect } from "react"
import type { ChatPanelProps } from "@boring/agent"
import { useWorkspaceChatPanel } from "../../WorkspaceProvider"
import { emitAgentFileChange } from "../../events"
import { useAutoOpenAgentFiles } from "../../hooks/useAutoOpenAgentFiles"
import { startUiCommandStream } from "../../bridge/uiCommandStream"
import type { SurfaceShellApi } from "../artifact-surface/SurfaceShell"

export interface ChatPanelHostShellProps {
  getSurface?: () => SurfaceShellApi | null
  isWorkbenchOpen?: () => boolean
  openWorkbench?: () => void
}

export type ChatPanelHostProps = ChatPanelProps & ChatPanelHostShellProps

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

  useAutoOpenAgentFiles(openArtifact)

  useEffect(() => {
    if (!getSurface || !isWorkbenchOpen || !openWorkbench) return
    return startUiCommandStream({
      ctx: {
        surface: getSurface,
        isWorkbenchOpen,
        openWorkbench,
      },
    })
  }, [getSurface, isWorkbenchOpen, openWorkbench])

  const handleData = useCallback(
    (part: unknown) => {
      emitAgentFileChange(part)
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
