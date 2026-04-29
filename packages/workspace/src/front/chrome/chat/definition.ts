import { createElement } from "react"
import type { ChatPanelProps } from "@boring/agent"
import { definePanel, type PaneProps } from "../../registry/types"
import { ChatPanelHost } from "./ChatPanelHost"

type ChatPaneParams = Partial<ChatPanelProps> | undefined

function ChatPane({ params }: PaneProps<ChatPaneParams>) {
  if (!params || typeof params.sessionId !== "string" || params.sessionId.length === 0) {
    throw new Error("chat panel requires params.sessionId")
  }
  return createElement(ChatPanelHost, { ...params, sessionId: params.sessionId })
}

export const chatPanel = definePanel<ChatPaneParams>({
  id: "chat",
  title: "Chat",
  component: ChatPane,
  placement: "left",
  source: "builtin",
})
