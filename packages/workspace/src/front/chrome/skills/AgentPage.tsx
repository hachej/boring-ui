"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Bot, ChevronDown, FileText, RefreshCw, X } from "lucide-react"
import { IconButton } from "@hachej/boring-ui-kit"
import { cn } from "../../lib/utils"
import { postUiCommand } from "../../bridge"
import { ManagementOverlaySurface } from "../management/ManagementOverlaySurface"
import { useWorkspacePluginClient } from "../../plugin/useWorkspacePluginClient"
import type { PaneProps } from "../../registry/types"
import { uiFileResourceKey } from "../../../shared/types/filesystem"
import { openableFileResource } from "../../../shared/skills/openableFileResource"
import {
  parseSkills,
  parseTools,
  type AgentSkillSummary,
  type AgentToolSummary,
} from "../agents/agentCapabilities"

/**
 * One request per section, committed together but failing apart: a slow or
 * broken tools route must not blank the skills the user came to see, and vice
 * versa. `status` is the whole-page phase; each section keeps its own outcome.
 */
type SectionResult<T> =
  | { status: "loaded"; value: T[] }
  | { status: "error"; error: string }

interface AgentPageState {
  status: "loading" | "ready"
  skills: SectionResult<AgentSkillSummary>
  tools: SectionResult<AgentToolSummary>
}

const INITIAL_STATE: AgentPageState = {
  status: "loading",
  skills: { status: "loaded", value: [] },
  tools: { status: "loaded", value: [] },
}

/**
 * `parseSkills` already orders by name; this only breaks the ties it leaves —
 * a name can repeat across sources, and an unstable order there makes the list
 * reshuffle on every refresh.
 */
function compareSkills(left: AgentSkillSummary, right: AgentSkillSummary): number {
  return left.name.localeCompare(right.name)
    || Number(left.invocable === false) - Number(right.invocable === false)
    || (left.resource ? uiFileResourceKey(left.resource) : "")
      .localeCompare(right.resource ? uiFileResourceKey(right.resource) : "")
}

export type AgentPageProps = Partial<PaneProps> & {
  /** When provided, renders a close control in the header — used when the Agent
   *  page is hosted as a chat left overlay rather than a workspace panel. */
  onClose?: () => void
  /** Reserve room for shell-level chrome that floats over collapsed app nav. */
  headerInsetStart?: boolean
  /** Reserve room for shell-level top-right controls floating over the overlay. */
  headerInsetEnd?: boolean
}

/**
 * The **Agent** app-left surface: what the currently-addressed agent can do —
 * its Skills (invocable slash commands and management-only sources) and its
 * Tools (the composed tool set the harness exposes). Both are scoped to
 * `client.agentTypeId`, so in a single-agent workspace this is the one agent,
 * and in a fleet it follows the client's addressed agent.
 *
 * Read-only for v1: it *describes* the agent's capabilities. Per-agent
 * enable/disable/grant configuration is deferred to a follow-up.
 */
export function AgentPage({ onClose, headerInsetStart = false, headerInsetEnd = false }: AgentPageProps) {
  const client = useWorkspacePluginClient()
  const [state, setState] = useState<AgentPageState>(INITIAL_STATE)
  const [expandedTool, setExpandedTool] = useState<string | null>(null)

  // Reload and Retry can be triggered from the same error state, and `client`
  // identity changes on a workspace/agent switch. Every commit is stamped with
  // the generation that started it so a slow stale response cannot land on top
  // of a newer one.
  const generationRef = useRef(0)
  useEffect(() => () => { generationRef.current += 1 }, [])

  const load = useCallback(async (refresh = false) => {
    const generation = ++generationRef.current
    const isStale = () => generationRef.current !== generation
    const id = encodeURIComponent(client.agentTypeId)
    const query = refresh ? "?refresh=1" : ""
    setState((current) => ({ ...current, status: "loading" }))
    // Each route is spelled in full — a shared base prefix would hide these
    // literal Agent routes from the route-matrix checker.
    const [skills, tools] = await Promise.allSettled([
      client.getJson<unknown>(`/api/v1/agents/${id}/skills${query}`, {
        missingMessage: "Failed to load this agent's skills.",
      }),
      client.getJson<unknown>(`/api/v1/agents/${id}/tools${query}`, {
        missingMessage: "Failed to load this agent's tools.",
      }),
    ])
    if (isStale()) return
    setState({
      status: "ready",
      // Parse-then-rebuild (see agentCapabilities): a hostile `description`
      // reaching React as a child blanks the whole pane with no boundary above.
      skills: skills.status === "fulfilled"
        ? { status: "loaded", value: parseSkills(skills.value) }
        : { status: "error", error: errorMessage(skills.reason, "Failed to load this agent's skills.") },
      tools: tools.status === "fulfilled"
        ? { status: "loaded", value: parseTools(tools.value) }
        : { status: "error", error: errorMessage(tools.reason, "Failed to load this agent's tools.") },
    })
  }, [client])

  useEffect(() => {
    setExpandedTool(null)
    void load(false)
  }, [load])

  const loading = state.status === "loading"
  const sortedSkills = state.skills.status === "loaded" ? [...state.skills.value].sort(compareSkills) : []
  const tools = state.tools.status === "loaded" ? state.tools.value : []

  return (
    <ManagementOverlaySurface
      part="agent-page"
      title="Agent"
      description="Skills and tools available to this agent"
      headerInsetStart={headerInsetStart}
      headerInsetEnd={headerInsetEnd}
      icon={(
        <span className="grid size-7 place-items-center rounded-lg bg-[color:oklch(from_var(--accent)_l_c_h/0.12)] text-[color:var(--accent)]">
          <Bot className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        </span>
      )}
      actions={(<>
        <IconButton
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={() => void load(true)}
          disabled={loading}
          aria-label="Refresh agent"
          title="Refresh"
          className="text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className={cn("size-3", loading && "animate-spin")} strokeWidth={1.75} />
        </IconButton>
        {onClose ? (
          <IconButton
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onClose}
            aria-label="Close agent"
            title="Close"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-3" strokeWidth={1.75} />
          </IconButton>
        ) : null}
      </>)}
    >
      <div
        className="boring-scrollbar-discreet min-h-0 flex-1 overflow-y-auto p-4"
        aria-busy={loading}
      >
        <div className="grid gap-7">
          <SkillsSection
            loading={loading}
            skills={sortedSkills}
            error={state.skills.status === "error" ? state.skills.error : undefined}
            onRetry={() => void load(true)}
          />
          <ToolsSection
            loading={loading}
            tools={tools}
            error={state.tools.status === "error" ? state.tools.error : undefined}
            onRetry={() => void load(true)}
            expandedTool={expandedTool}
            onToggleTool={(key) => setExpandedTool((current) => current === key ? null : key)}
          />
        </div>
      </div>
    </ManagementOverlaySurface>
  )
}

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback
}

function SectionHeading({ id, title, count }: { id: string; title: string; count?: number }) {
  return (
    <h3 id={id} className="mb-2 flex items-baseline gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      <span>{title}</span>
      {typeof count === "number" ? (
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground">
          {count}
        </span>
      ) : null}
    </h3>
  )
}

function SectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-start justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive"
    >
      <span className="min-w-0">{message}</span>
      <button
        type="button"
        onClick={onRetry}
        className="shrink-0 rounded-md border border-destructive/40 px-2 py-0.5 text-xs font-medium transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        Retry
      </button>
    </div>
  )
}

function SkillsSection({
  loading,
  skills,
  error,
  onRetry,
}: {
  loading: boolean
  skills: AgentSkillSummary[]
  error?: string
  onRetry: () => void
}) {
  return (
    <section aria-labelledby="agent-skills-heading">
      <SectionHeading id="agent-skills-heading" title="Skills" count={loading ? undefined : skills.length} />
      {error ? (
        <SectionError message={error} onRetry={onRetry} />
      ) : loading && skills.length === 0 ? (
        <ul role="list" aria-label="Loading skills" className="grid gap-2">
          {[0, 1, 2, 3].map((row) => (
            <li
              key={row}
              aria-hidden="true"
              className="animate-pulse rounded-xl border border-border/60 bg-card/70 px-3 py-2.5"
            >
              <div className="h-3.5 w-1/3 rounded bg-foreground/[0.08]" />
              <div className="mt-2 h-3 w-4/5 rounded bg-foreground/[0.06]" />
            </li>
          ))}
          <li className="sr-only">Loading skills…</li>
        </ul>
      ) : skills.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border/60 px-3 py-4 text-center text-sm text-muted-foreground">
          No skills. Reload plugins or add workspace skills to make them available in chat.
        </p>
      ) : (
        <ul role="list" className="grid gap-2">
          {skills.map((skill, index) => {
            const resource = openableFileResource(skill.resource)
            const managementOnly = skill.invocable === false
            const body = (
              <div className="flex min-h-11 w-full items-start justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className="min-w-0 truncate text-sm font-medium leading-5 text-foreground">
                      {managementOnly ? skill.name : `/${skill.name}`}
                    </span>
                    {managementOnly ? (
                      <span className="rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        Management source
                      </span>
                    ) : skill.source ? (
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground">
                        {skill.source}
                      </span>
                    ) : null}
                  </div>
                  {managementOnly && skill.source ? (
                    <p className="mt-1 truncate text-[11px] text-muted-foreground" title={skill.source}>
                      Source: {skill.source}
                    </p>
                  ) : null}
                  {skill.description ? (
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{skill.description}</p>
                  ) : null}
                </div>
                {resource ? (
                  <FileText
                    className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/70 transition-colors group-hover:text-foreground"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                ) : null}
              </div>
            )
            return (
              <li
                key={`${skill.resource
                  ? uiFileResourceKey(skill.resource)
                  : `${skill.name} ${skill.source ?? ""} ${skill.description ?? ""}`} ${index}`}
                className="min-w-0"
              >
                {resource ? (
                  <button
                    type="button"
                    onClick={() => postUiCommand({
                      kind: "openFile",
                      params: { ...resource, mode: "view" },
                    })}
                    title="Open skill source"
                    aria-label={`Open ${managementOnly ? "management source" : "skill"} ${skill.name} from ${skill.source ?? resource.filesystem}`}
                    className={cn(
                      "group block w-full rounded-xl border border-border/60 bg-card/70 text-left transition-colors hover:border-border hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                      managementOnly && "border-dashed bg-muted/25",
                    )}
                  >
                    {body}
                  </button>
                ) : (
                  <div
                    className={cn(
                      "rounded-xl border border-border/60 bg-card/70",
                      managementOnly && "border-dashed bg-muted/25",
                    )}
                  >
                    {body}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function ToolsSection({
  loading,
  tools,
  error,
  onRetry,
  expandedTool,
  onToggleTool,
}: {
  loading: boolean
  tools: AgentToolSummary[]
  error?: string
  onRetry: () => void
  expandedTool: string | null
  onToggleTool: (key: string) => void
}) {
  return (
    <section aria-labelledby="agent-tools-heading">
      <SectionHeading id="agent-tools-heading" title="Tools" count={loading ? undefined : tools.length} />
      {error ? (
        <SectionError message={error} onRetry={onRetry} />
      ) : loading && tools.length === 0 ? (
        <ul role="list" aria-label="Loading tools" className="grid gap-2">
          {[0, 1].map((row) => (
            <li
              key={row}
              aria-hidden="true"
              className="animate-pulse rounded-xl border border-border/60 bg-card/70 px-3 py-2.5"
            >
              <div className="h-3.5 w-1/4 rounded bg-foreground/[0.08]" />
              <div className="mt-2 h-3 w-3/5 rounded bg-foreground/[0.06]" />
            </li>
          ))}
          <li className="sr-only">Loading tools…</li>
        </ul>
      ) : tools.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border/60 px-3 py-4 text-center text-sm text-muted-foreground">
          No tools. This agent has no tools registered.
        </p>
      ) : (
        <ul role="list" className="divide-y divide-border/50 rounded-xl border border-border/60 bg-card/70 px-3">
          {tools.map((tool, index) => {
            // The server may report duplicate names; a name-only key collides
            // AND makes both rows expand together.
            const toolKey = `${tool.name} ${index}`
            const expanded = expandedTool === toolKey
            return (
              <li key={toolKey} className="min-w-0">
                <button
                  type="button"
                  onClick={() => onToggleTool(toolKey)}
                  aria-expanded={expanded}
                  disabled={!tool.description}
                  className="group flex min-h-11 w-full items-start justify-between gap-3 py-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-default sm:min-h-0"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-[13px] font-medium leading-5 text-foreground">{tool.name}</span>
                    {tool.description ? (
                      <span className={cn(
                        "mt-0.5 block text-xs leading-5 text-muted-foreground",
                        expanded ? "whitespace-pre-wrap break-words" : "line-clamp-1",
                      )}>{tool.description}</span>
                    ) : null}
                  </span>
                  {tool.description ? (
                    <ChevronDown className={cn("mt-1 size-3.5 shrink-0 text-muted-foreground/60 transition-transform group-hover:text-foreground", expanded && "rotate-180")} strokeWidth={1.75} aria-hidden="true" />
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
