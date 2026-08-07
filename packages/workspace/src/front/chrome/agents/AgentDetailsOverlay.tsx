"use client"

import { Bot, MessageSquarePlus, X } from "lucide-react"
import { IconButton } from "@hachej/boring-ui-kit"
import { ManagementOverlaySurface } from "../management/ManagementOverlaySurface"

export interface AgentDetailsOverlayAgent {
  agentTypeId: string
  label: string
  description?: string
  sessionsStatus?: "loading" | "loaded" | "error"
}

export interface AgentDetailsOverlayProps {
  agent: AgentDetailsOverlayAgent
  sessionCount: number
  onCreateSession: () => void
  onClose: () => void
  headerInsetStart?: boolean
  headerInsetEnd?: boolean
}

export function AgentDetailsOverlay({
  agent,
  sessionCount,
  onCreateSession,
  onClose,
  headerInsetStart = false,
  headerInsetEnd = false,
}: AgentDetailsOverlayProps) {
  const statusLabel = agent.sessionsStatus === "error"
    ? "Unavailable"
    : agent.sessionsStatus === "loading" ? "Loading" : "Ready"

  return (
    <div role="region" aria-label={`${agent.label} details`} className="h-full min-h-0">
      <ManagementOverlaySurface
        part="agent-details-overlay"
        title={agent.label}
        description={agent.description || "Addressed workspace agent"}
        headerInsetStart={headerInsetStart}
        headerInsetEnd={headerInsetEnd}
        icon={(
          <span className="grid size-7 place-items-center rounded-lg bg-[color:oklch(from_var(--accent)_l_c_h/0.12)] text-[color:var(--accent)]">
            <Bot className="size-4" strokeWidth={1.75} aria-hidden="true" />
          </span>
        )}
        actions={(<>
          <IconButton
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onCreateSession}
            aria-label={`New chat with ${agent.label}`}
            title="New chat"
            className="text-muted-foreground hover:text-foreground"
          >
            <MessageSquarePlus className="size-3" strokeWidth={1.75} />
          </IconButton>
          <IconButton
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onClose}
            aria-label={`Close ${agent.label} details`}
            title="Close"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-3" strokeWidth={1.75} />
          </IconButton>
        </>)}
      >
        <div className="boring-scrollbar-discreet min-h-0 flex-1 overflow-y-auto p-4">
          <div className="grid max-w-3xl gap-6">
            <section aria-labelledby="agent-overview-heading">
              <h3 id="agent-overview-heading" className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Agent</h3>
              <p className="mt-2 text-sm leading-6 text-foreground/85">
                {agent.description || `${agent.label} is available for addressed workspace chats.`}
              </p>
            </section>

            <dl className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border/60 bg-card/50 px-3 py-2.5">
                <dt className="text-[11px] font-medium text-muted-foreground">Sessions</dt>
                <dd className="mt-1 text-sm font-semibold tabular-nums text-foreground">{sessionCount}</dd>
              </div>
              <div className="rounded-lg border border-border/60 bg-card/50 px-3 py-2.5">
                <dt className="text-[11px] font-medium text-muted-foreground">Status</dt>
                <dd className="mt-1 text-sm font-semibold text-foreground">{statusLabel}</dd>
              </div>
            </dl>

            <section aria-labelledby="agent-configuration-heading">
              <h3 id="agent-configuration-heading" className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Configuration</h3>
              <p className="mt-2 text-sm leading-6 text-foreground/85">
                This agent is configured by the host fleet definition. Runtime editing is not available in this playground.
              </p>
              <dl className="mt-3 grid gap-3">
                <div className="rounded-lg border border-border/60 bg-card/50 px-3 py-2.5">
                  <dt className="text-[11px] font-medium text-muted-foreground">Agent ID</dt>
                  <dd className="mt-1 break-all font-mono text-xs text-foreground">{agent.agentTypeId}</dd>
                </div>
              </dl>
            </section>
          </div>
        </div>
      </ManagementOverlaySurface>
    </div>
  )
}
