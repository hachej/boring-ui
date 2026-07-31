"use client"

import type { ReactNode } from "react"
import { AgentNewChatAction } from "./AppLeftPaneActions"
import type { AppLeftPaneAgent } from "./AppLeftPane"

export function AgentSessionEmptyState({
  status,
}: {
  status?: AppLeftPaneAgent["sessionsStatus"]
}) {
  return (
    <div className="px-2 py-1.5 text-xs text-muted-foreground">
      {status === "loaded"
        ? "No chats yet."
        : status === "error"
          ? "Chats unavailable."
          : "Loading chats…"}
    </div>
  )
}

export function AppLeftPaneAgentGroup({
  agent,
  activity,
  onCreateSession,
  onCreateSplitSession,
  onCreatePopoverSession,
}: {
  agent: AppLeftPaneAgent
  activity: ReactNode
  onCreateSession: () => void
  onCreateSplitSession?: () => void
  onCreatePopoverSession?: () => void
}) {
  return (
    <section
      aria-label={`${agent.label} agent`}
      data-boring-workspace-part="app-left-agent-group"
      data-boring-agent-type-id={agent.agentTypeId}
    >
      <AgentNewChatAction
        label={activity}
        ariaLabel={`New chat with ${agent.label}`}
        splitAriaLabel={`New chat with ${agent.label} in split`}
        quickChatAriaLabel={`Quick chat with ${agent.label}`}
        onCreateSession={onCreateSession}
        onCreateSplitSession={onCreateSplitSession}
        onCreatePopoverSession={onCreatePopoverSession}
      />
    </section>
  )
}
