"use client"

import { Bot, MessageSquarePlus, X } from "lucide-react"
import { IconButton } from "@hachej/boring-ui-kit"
import { ManagementOverlaySurface } from "../management/ManagementOverlaySurface"

export interface AgentDetailsOverlayAgent {
  agentTypeId: string
  label: string
  description?: string
  pluginIds?: readonly string[]
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

            <dl className="flex flex-wrap items-center gap-x-8 gap-y-2 border-y border-border/60 py-3">
              <div className="flex items-baseline gap-2">
                <dt className="text-[11px] font-medium text-muted-foreground">Sessions</dt>
                <dd className="text-sm font-semibold tabular-nums text-foreground">{sessionCount}</dd>
              </div>
              <div className="flex items-baseline gap-2">
                <dt className="text-[11px] font-medium text-muted-foreground">Status</dt>
                <dd className="text-sm font-semibold text-foreground">{statusLabel}</dd>
              </div>
            </dl>

            <section aria-labelledby="agent-plugins-heading">
              <h3 id="agent-plugins-heading" className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Plugins</h3>
              <p className="mt-2 text-sm leading-6 text-foreground/85">
                Runtime plugins explicitly bound to this Agent. Workspace UI plugins do not automatically grant Agent tools.
              </p>
              {agent.pluginIds?.length ? (
                <ul className="mt-3 divide-y divide-border/50 border-y border-border/60">
                  {agent.pluginIds.map((pluginId) => (
                    <li key={pluginId} className="flex items-center justify-between gap-3 py-2.5">
                      <span className="min-w-0 truncate text-sm font-medium text-foreground">{pluginId}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">Configured</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 border-y border-border/60 py-3 text-sm text-muted-foreground">No runtime plugins configured.</p>
              )}
            </section>

            <section aria-labelledby="agent-configuration-heading">
              <h3 id="agent-configuration-heading" className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Configuration</h3>
              <p className="mt-2 text-sm leading-6 text-foreground/85">
                This agent is configured by the host fleet definition. Runtime editing is not available in this playground.
              </p>
              <dl className="mt-3 border-y border-border/60 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <dt className="text-[11px] font-medium text-muted-foreground">Agent ID</dt>
                  <dd className="break-all font-mono text-xs text-foreground">{agent.agentTypeId}</dd>
                </div>
              </dl>
            </section>
          </div>
        </div>
      </ManagementOverlaySurface>
    </div>
  )
}
