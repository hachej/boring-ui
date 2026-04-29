import { createElement } from "react"
import { definePanel, type PaneProps } from "../../registry/types"
import {
  ChatStagePlaceholder,
  type ChatStagePlaceholderProps,
} from "./ChatStagePlaceholder"

function ChatStagePlaceholderPanel({
  params,
}: PaneProps<ChatStagePlaceholderProps | undefined>) {
  return createElement(ChatStagePlaceholder, params ?? {})
}

export const chatStagePlaceholderPanel = definePanel<ChatStagePlaceholderProps | undefined>({
  id: "chat-stage-placeholder",
  title: "Chat Placeholder",
  component: ChatStagePlaceholderPanel,
  placement: "center",
  source: "builtin",
})
