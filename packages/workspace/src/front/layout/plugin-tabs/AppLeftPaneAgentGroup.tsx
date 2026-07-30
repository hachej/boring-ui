"use client"

import type { ReactNode } from "react"
import { Plus } from "lucide-react"
import {
  Disclosure,
  DisclosureContent,
  DisclosureTrigger,
} from "@hachej/boring-ui-kit"
import { NewChatAction } from "./AppLeftPaneActions"
import type { AppLeftPaneAgent, AppLeftPaneSession } from "./AppLeftPane"

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
  sessions,
  expanded,
  activity,
  onExpandedChange,
  onCreateSession,
  onCreateSplitSession,
  onCreatePopoverSession,
  renderSession,
}: {
  agent: AppLeftPaneAgent
  sessions: readonly AppLeftPaneSession[]
  expanded: boolean
  activity: ReactNode
  onExpandedChange: (expanded: boolean) => void
  onCreateSession: () => void
  onCreateSplitSession?: () => void
  onCreatePopoverSession?: () => void
  renderSession: (session: AppLeftPaneSession) => ReactNode
}) {
  return (
    <Disclosure open={expanded} onOpenChange={onExpandedChange}>
      <section
        aria-label={`${agent.label} agent`}
        data-boring-workspace-part="app-left-agent-group"
        data-boring-agent-type-id={agent.agentTypeId}
        className="space-y-0.5"
      >
        <div className="flex min-w-0 items-center">
          <DisclosureTrigger
            aria-label={`${expanded ? "Collapse" : "Expand"} ${agent.label} agent`}
            className="h-8 w-6 shrink-0 px-0 hover:bg-foreground/[0.045]"
          />
          <div className="min-w-0 flex-1">
            <NewChatAction
              icon={<Plus className="h-4 w-4" strokeWidth={2} />}
              label={activity}
              meta={!expanded && sessions.length > 0 ? (
                <span
                  aria-label={`${sessions.length} chats`}
                  className="text-[10px] font-medium text-muted-foreground/75"
                >
                  ·{sessions.length}
                </span>
              ) : undefined}
              ariaLabel={`New chat with ${agent.label}`}
              splitAriaLabel={`New chat with ${agent.label} in split`}
              quickChatAriaLabel={`Quick chat with ${agent.label}`}
              onCreateSession={onCreateSession}
              onCreateSplitSession={onCreateSplitSession}
              onCreatePopoverSession={onCreatePopoverSession}
            />
          </div>
        </div>
        <DisclosureContent
          data-boring-workspace-part="app-left-agent-sessions"
          className="ml-3 space-y-0.5 border-l border-border/55 pl-2"
        >
          {sessions.length > 0
            ? sessions.map(renderSession)
            : <AgentSessionEmptyState status={agent.sessionsStatus} />}
        </DisclosureContent>
      </section>
    </Disclosure>
  )
}
