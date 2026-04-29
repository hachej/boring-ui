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
      if (props.onOpenArtifact) {
        props.onOpenArtifact(path)
        return
      }
      const current = shellRef.current
      if (!current) return
      if (!current.surfaceOpen) current.setSurfaceOpen(true)
      const open = () => shellRef.current?.surface?.openFile(path)
      if (current.surface) open()
      else requestAnimationFrame(() => requestAnimationFrame(open))
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

  return (
    <ChatPanelImpl
      {...props}
      onOpenArtifact={openArtifact}
      onData={props.onData ?? emitAgentFileChange}
    />
  )
}
