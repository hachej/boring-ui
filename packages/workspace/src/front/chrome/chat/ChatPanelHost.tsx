"use client"

import { useCallback, useContext, useEffect, useRef } from "react"
import type { ChatPanelProps } from "@boring/agent"
import { useWorkspaceChatPanel } from "../../WorkspaceProvider"
import { ChatShellContext } from "../../components/chat/context"
import { emitAgentFileChange } from "../../events"
import { useAutoOpenAgentFiles } from "../../hooks/useAutoOpenAgentFiles"
import { startUiCommandStream } from "../../bridge/uiCommandStream"

export function ChatPanelHost(props: ChatPanelProps) {
  const ChatPanelImpl = useWorkspaceChatPanel()
  const shell = useContext(ChatShellContext)
  const shellRef = useRef(shell)
  shellRef.current = shell

  const openArtifact = useCallback(
    (path: string) => {
      const current = shellRef.current
      if (current) {
        if (!current.surfaceOpen) current.setSurfaceOpen(true)
        const open = () => shellRef.current?.surface?.openFile(path)
        if (current.surface) open()
        else requestAnimationFrame(() => requestAnimationFrame(open))
      }
      props.onOpenArtifact?.(path)
    },
    [props.onOpenArtifact],
  )

  useAutoOpenAgentFiles(openArtifact)

  useEffect(() => {
    if (!shellRef.current) return
    return startUiCommandStream({
      ctx: {
        surface: () => shellRef.current?.surface ?? null,
        isWorkbenchOpen: () => shellRef.current?.surfaceOpen ?? false,
        openWorkbench: () => shellRef.current?.setSurfaceOpen(true),
      },
    })
  }, [])

  const handleData = useCallback(
    (part: unknown) => {
      emitAgentFileChange(part)
      props.onData?.(part)
    },
    [props.onData],
  )

  return (
    <ChatPanelImpl
      {...props}
      onOpenArtifact={openArtifact}
      onData={handleData}
    />
  )
}
