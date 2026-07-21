"use client"

import { MessageSquare } from "lucide-react"
import { DetachedPanelPopover } from "../../detached/DetachedPanelPopover"
import type { DetachedPanelPosition } from "../../detached/detachedPanelTypes"
import { ChatPanelHost, type ChatPanelHostProps } from "./ChatPanelHost"

const READ_ONLY_BLOCKER = {
  id: "detached-chat-read-only",
  reason: "detached-chat.read-only",
  label: "Dock this chat to reply.",
  sessionBadge: { kind: "detached-chat", label: "read only", tone: "neutral" as const, priority: -10 },
}

export function DetachedChatPopover({
  sessionId,
  title,
  chatParams,
  initialPosition,
  onClose,
  onDock,
  composingEnabled = false,
}: {
  sessionId: string
  title: string
  chatParams: ChatPanelHostProps
  initialPosition: DetachedPanelPosition
  onClose: () => void
  onDock: () => void
  composingEnabled?: boolean
}) {
  const readOnlyParams = composingEnabled
    ? chatParams
    : {
        ...chatParams,
        composerBlockers: [READ_ONLY_BLOCKER, ...(chatParams.composerBlockers ?? [])],
      }
  return (
    <DetachedPanelPopover
      title={title}
      subtitle={composingEnabled ? "Detached chat" : "Detached chat · dock to reply"}
      icon={<MessageSquare className="size-4" strokeWidth={1.75} aria-hidden="true" />}
      ariaLabel={`Chat session ${title || sessionId}`}
      initialPosition={initialPosition}
      size={{ width: 520, height: 720 }}
      onClose={onClose}
      onDock={onDock}
    >
      <ChatPanelHost {...readOnlyParams} sessionId={sessionId} />
    </DetachedPanelPopover>
  )
}
