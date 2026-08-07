"use client"

import { Bot, MessageSquarePlus, Settings, X } from "lucide-react"
import { IconButton } from "@hachej/boring-ui-kit"
import { ManagementOverlaySurface } from "../management/ManagementOverlaySurface"
import { cn } from "../../lib/utils"

export type AgentDetailsSection = "overview" | "settings"

export interface AgentDetailsOverlayAgent {
  agentTypeId: string
  label: string
  description?: string
  sessionsStatus?: "loading" | "loaded" | "error"
}

export interface AgentDetailsOverlayProps {
  agent: AgentDetailsOverlayAgent
  sessionCount: number
  section: AgentDetailsSection
  onSectionChange: (section: AgentDetailsSection) => void
  onCreateSession: () => void
  onClose: () => void
  headerInsetStart?: boolean
  headerInsetEnd?: boolean
}

export function AgentDetailsOverlay({
  agent,
  sessionCount,
  section,
  onSectionChange,
  onCreateSession,
  onClose,
  headerInsetStart = false,
  headerInsetEnd = false,
}: AgentDetailsOverlayProps) {
  const statusLabel = agent.sessionsStatus === "error"
    ? "Unavailable"
    : agent.sessionsStatus === "loading" ? "Loading" : "Ready"
  const idBase = `agent-details-${agent.agentTypeId.replace(/[^a-zA-Z0-9_-]/g, "-")}`

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
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 gap-1 border-b border-border/60 px-4 pt-3" role="tablist" aria-label={`${agent.label} detail sections`}>
          {(["overview", "settings"] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              id={`${idBase}-${candidate}-tab`}
              role="tab"
              aria-selected={section === candidate}
              aria-controls={`${idBase}-${candidate}-panel`}
              tabIndex={section === candidate ? 0 : -1}
              onClick={() => onSectionChange(candidate)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
                event.preventDefault()
                const next = candidate === "overview" ? "settings" : "overview"
                onSectionChange(next)
                const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                tabs?.[next === "overview" ? 0 : 1]?.focus()
              }}
              className={cn(
                "flex h-8 items-center gap-1.5 border-b-2 px-2 text-xs font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                section === candidate
                  ? "border-[color:var(--accent)] text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {candidate === "settings" ? <Settings className="size-3.5" strokeWidth={1.75} aria-hidden="true" /> : <Bot className="size-3.5" strokeWidth={1.75} aria-hidden="true" />}
              {candidate}
            </button>
          ))}
        </div>

        <div
          id={`${idBase}-${section}-panel`}
          aria-labelledby={`${idBase}-${section}-tab`}
          className="boring-scrollbar-discreet min-h-0 flex-1 overflow-y-auto p-4"
          role="tabpanel"
        >
          {section === "overview" ? (
            <div className="grid gap-5">
              <section aria-labelledby="agent-overview-heading">
                <h3 id="agent-overview-heading" className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Overview</h3>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground/85">
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
            </div>
          ) : (
            <div className="grid gap-5">
              <section aria-labelledby="agent-settings-heading">
                <h3 id="agent-settings-heading" className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Agent settings</h3>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground/85">
                  This agent is configured by the host fleet definition. Runtime editing is not available in this playground.
                </p>
              </section>
              <dl className="grid gap-3">
                <div className="rounded-lg border border-border/60 bg-card/50 px-3 py-2.5">
                  <dt className="text-[11px] font-medium text-muted-foreground">Agent ID</dt>
                  <dd className="mt-1 break-all font-mono text-xs text-foreground">{agent.agentTypeId}</dd>
                </div>
                <div className="rounded-lg border border-border/60 bg-card/50 px-3 py-2.5">
                  <dt className="text-[11px] font-medium text-muted-foreground">Session inventory</dt>
                  <dd className="mt-1 text-sm text-foreground">{statusLabel}</dd>
                </div>
              </dl>
            </div>
          )}
        </div>
      </div>
    </ManagementOverlaySurface>
    </div>
  )
}
