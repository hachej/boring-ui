"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { FileText, RefreshCw, Sparkles, X } from "lucide-react"
import { IconButton } from "@hachej/boring-ui-kit"
import { cn } from "../../lib/utils"
import { postUiCommand } from "../../bridge"
import { ManagementOverlaySurface } from "../management/ManagementOverlaySurface"
import { useWorkspacePluginClient } from "../../plugin/useWorkspacePluginClient"
import type { PaneProps } from "../../registry/types"
import { uiFileResourceKey } from "../../../shared/types/filesystem"
import { openableFileResource } from "../../../shared/skills/openableFileResource"
import { parseSkills, type AgentSkillSummary } from "../agents/agentCapabilities"

type LoadState =
  | { status: "loading"; skills: AgentSkillSummary[]; error?: undefined }
  | { status: "ready"; skills: AgentSkillSummary[]; error?: undefined }
  | { status: "error"; skills: AgentSkillSummary[]; error: string }

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

export type SkillsPageProps = Partial<PaneProps> & {
  /** When provided, renders a close control in the header — used when Skills
   *  is hosted as a chat left overlay rather than a workspace panel. */
  onClose?: () => void
  /** Reserve room for shell-level chrome that floats over collapsed app nav. */
  headerInsetStart?: boolean
  /** Reserve room for shell-level top-right controls floating over the overlay. */
  headerInsetEnd?: boolean
}

export function SkillsPage({ onClose, headerInsetStart = false, headerInsetEnd = false }: SkillsPageProps) {
  const client = useWorkspacePluginClient()
  const [state, setState] = useState<LoadState>({ status: "loading", skills: [] })

  // Reload and Retry can be triggered from the same error state, and `client`
  // identity changes on a workspace/agent switch. Every commit is stamped with
  // the generation that started it so a slow stale response cannot land on top
  // of a newer one.
  const generationRef = useRef(0)
  useEffect(() => () => { generationRef.current += 1 }, [])

  const loadSkills = useCallback(async (refresh = false) => {
    const generation = ++generationRef.current
    const isStale = () => generationRef.current !== generation
    setState((current) => ({ status: "loading", skills: current.skills }))
    try {
      const payload = await client.getJson<unknown>(`/api/v1/agents/${encodeURIComponent(client.agentTypeId)}/skills${refresh ? "?refresh=1" : ""}`, {
        missingMessage: "Failed to load workspace skills.",
      })
      if (isStale()) return
      // The SAME hardened parser the Agent details panel uses. This surface
      // previously kept the raw payload after checking only `name`, so a
      // non-string `description` reached React as a child — which, with no
      // error boundary above this pane, blanks the whole app.
      setState({ status: "ready", skills: parseSkills(payload) })
    } catch (error) {
      if (isStale()) return
      setState((current) => ({
        status: "error",
        skills: current.skills,
        error: error instanceof Error ? error.message : "Failed to load workspace skills.",
      }))
    }
  }, [client])

  useEffect(() => {
    void loadSkills(false)
  }, [loadSkills])

  const sortedSkills = [...state.skills].sort(compareSkills)

  // Header subtitle doubles as the count readout so the list size is legible
  // without scrolling the pane.
  const skillsDescription = sortedSkills.length > 0
    ? `${sortedSkills.length} skill${sortedSkills.length === 1 ? "" : "s"} available to slash commands`
    : "Workspace skills available to slash commands"

  return (
    <ManagementOverlaySurface
      part="skills-page"
      title="Skills"
      description={skillsDescription}
      headerInsetStart={headerInsetStart}
      headerInsetEnd={headerInsetEnd}
      icon={(
        <span className="grid size-7 place-items-center rounded-lg bg-[color:oklch(from_var(--accent)_l_c_h/0.12)] text-[color:var(--accent)]">
          <Sparkles className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        </span>
      )}
      actions={(<>
        <IconButton
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={() => void loadSkills(true)}
          disabled={state.status === "loading"}
          aria-label="Refresh skills"
          title="Refresh skills"
          className="text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className={cn("size-3", state.status === "loading" && "animate-spin")} strokeWidth={1.75} />
        </IconButton>
        {onClose ? (
          <IconButton
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onClose}
            aria-label="Close skills"
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
        aria-busy={state.status === "loading"}
      >
        {state.status === "error" ? (
          <div
            role="alert"
            className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive"
          >
            <span className="min-w-0">{state.error}</span>
            <button
              type="button"
              onClick={() => void loadSkills(true)}
              className="shrink-0 rounded-md border border-destructive/40 px-2 py-0.5 text-xs font-medium transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              Retry
            </button>
          </div>
        ) : null}

        {state.status === "loading" && sortedSkills.length === 0 ? (
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
        ) : sortedSkills.length === 0 ? (
          state.status === "error" ? null : (
            <div className="flex h-full min-h-[180px] items-center justify-center text-center text-sm text-muted-foreground">
              <div>
                <div className="font-medium text-foreground/80">No skills found</div>
                <p className="mt-1 max-w-xs">Reload plugins or add workspace skills to make them available in chat.</p>
              </div>
            </div>
          )
        ) : (
          <ul role="list" className="grid gap-2">
            {sortedSkills.map((skill, index) => {
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
                    : `${skill.name}\u0000${skill.source ?? ""}\u0000${skill.description ?? ""}`}\u0000${index}`}
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
      </div>
    </ManagementOverlaySurface>
  )
}
