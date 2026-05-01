import { createElement } from "react"
import type { PaneProps } from "../../registry/types"
import { ChatPanelHost, type ChatPanelHostShellProps } from "./ChatPanelHost"
import type { WorkspaceChatPanelProps } from "./types"

type ChatPaneParams = (Partial<WorkspaceChatPanelProps> & ChatPanelHostShellProps) | undefined

function ChatPane({ params }: PaneProps<ChatPaneParams>) {
  if (!params || typeof params.sessionId !== "string" || params.sessionId.length === 0) {
    throw new Error("chat panel requires params.sessionId")
  }
  return createElement(ChatPanelHost, { key: params.sessionId, ...params, sessionId: params.sessionId })
}

export const chatPanel = {
  id: "chat",
  title: "Chat",
  component: ChatPane,
  placement: "left",
  source: "builtin",
}
