"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { FileText, RefreshCw, Sparkles, X } from "lucide-react"
import { IconButton } from "@hachej/boring-ui-kit"
import { cn } from "../../lib/utils"
import { postUiCommand } from "../../bridge"
import { ManagementOverlaySurface } from "../management/ManagementOverlaySurface"
import { useWorkspacePluginClient } from "../../plugin/useWorkspacePluginClient"
import type { PaneProps } from "../../registry/types"
import { uiFileResourceKey, type UiFileResource } from "../../../shared/types/filesystem"

interface SkillSummary {
  name: string
  description?: string
  source?: string
  /** False when the row exists for source management but Pi did not retain it as invocable. */
  invocable?: boolean
  /** Browser-safe resource identity. */
  resource?: UiFileResource
}

interface SkillsResponse {
  skills?: SkillSummary[]
}

type LoadState =
  | { status: "loading"; skills: SkillSummary[]; error?: undefined }
  | { status: "ready"; skills: SkillSummary[]; error?: undefined }
  | { status: "error"; skills: SkillSummary[]; error: string }

type IndexedSkill = { skill: SkillSummary; sourceIndex: number }

function isSafeRelativeSkillPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0") || value.includes("\\")) return false
  if (value.startsWith("/") || /^[A-Za-z]:/.test(value) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return false
  if (/%(?:2e|2f|5c)/i.test(value)) return false
  const segments = value.split("/")
  return !segments.some((segment) => segment === "" || segment === "." || segment === "..")
}

function openableResource(skill: SkillSummary): UiFileResource | undefined {
  const resource = skill.resource
  return resource
    && typeof resource.filesystem === "string"
    && resource.filesystem.length > 0
    && isSafeRelativeSkillPath(resource.path)
    ? resource
    : undefined
}

function compareSkills(left: IndexedSkill, right: IndexedSkill): number {
  const a = left.skill
  const b = right.skill
  return a.name.localeCompare(b.name)
    || Number(a.invocable === false) - Number(b.invocable === false)
    || (a.source ?? "").localeCompare(b.source ?? "")
    || (a.resource?.filesystem ?? "").localeCompare(b.resource?.filesystem ?? "")
    || (a.resource?.path ?? "").localeCompare(b.resource?.path ?? "")
    || (a.description ?? "").localeCompare(b.description ?? "")
    || left.sourceIndex - right.sourceIndex
}

function skillRowKey({ skill, sourceIndex }: IndexedSkill): string {
  const resource = openableResource(skill)
  if (resource) return `resource:${uiFileResourceKey(resource)}`
  return `management:${skill.name}\0${skill.source ?? ""}\0${skill.description ?? ""}\0${sourceIndex}`
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

  const openSkillInWorkspace = useCallback((skill: SkillSummary) => {
    const resource = openableResource(skill)
    if (!resource) return
    postUiCommand({
      kind: "openFile",
      params: {
        path: resource.path,
        filesystem: resource.filesystem,
        mode: "view",
      },
    })
  }, [])

  const loadSkills = useCallback(async (refresh = false) => {
    setState((current) => ({ status: "loading", skills: current.skills }))
    try {
      const payload = await client.getJson<SkillsResponse>(`/api/v1/agent/skills${refresh ? "?refresh=1" : ""}`, {
        missingMessage: "Failed to load workspace skills.",
      })
      const skills = Array.isArray(payload.skills)
        ? payload.skills.filter((skill): skill is SkillSummary => typeof skill?.name === "string" && skill.name.length > 0)
        : []
      setState({ status: "ready", skills })
    } catch (error) {
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

  const sortedSkills = useMemo(
    () => state.skills.map((skill, sourceIndex) => ({ skill, sourceIndex })).sort(compareSkills),
    [state.skills],
  )

  return (
    <ManagementOverlaySurface
      part="skills-page"
      title="Skills"
      description="Invocable skills and their registered source resources"
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
      <div className="boring-scrollbar-discreet min-h-0 flex-1 overflow-y-auto p-4" aria-live="polite">
        {state.status === "error" ? (
          <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">
            {state.error}
          </div>
        ) : null}

        {state.status === "loading" && sortedSkills.length === 0 ? (
          <div className="flex h-full min-h-[180px] items-center justify-center text-sm text-muted-foreground">
            Loading skills…
          </div>
        ) : sortedSkills.length === 0 ? (
          <div className="flex h-full min-h-[180px] items-center justify-center text-center text-sm text-muted-foreground">
            <div>
              <div className="font-medium text-foreground/80">No skills found</div>
              <p className="mt-1 max-w-xs">Reload plugins or add workspace skills to make them available in chat.</p>
            </div>
          </div>
        ) : (
          <ul role="list" className="grid gap-2">
            {sortedSkills.map((entry) => {
              const { skill } = entry
              const resource = openableResource(skill)
              const managementOnly = skill.invocable === false
              const content = (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <span className="min-w-0 truncate text-sm font-medium text-foreground">
                        {managementOnly ? skill.name : `/${skill.name}`}
                      </span>
                      {managementOnly ? (
                        <span className="rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          Management source
                        </span>
                      ) : null}
                    </div>
                    {skill.source ? (
                      <p className="mt-1 truncate text-[11px] text-muted-foreground" title={skill.source}>
                        Source: {skill.source}
                      </p>
                    ) : null}
                    {skill.description ? (
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{skill.description}</p>
                    ) : null}
                  </div>
                  {resource ? <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" /> : null}
                </div>
              )
              return (
                <li
                  key={skillRowKey(entry)}
                  className={cn(
                    "rounded-xl border border-border/60 bg-card/70 px-3 py-2.5",
                    resource && "transition-colors hover:border-border hover:bg-muted/60",
                    managementOnly && "border-dashed bg-muted/25",
                  )}
                >
                  {resource ? (
                    <button
                      type="button"
                      onClick={() => openSkillInWorkspace(skill)}
                      title="Open skill source"
                      aria-label={`Open ${managementOnly ? "management source" : "skill"} ${skill.name} from ${skill.source ?? resource.filesystem}`}
                      className="block w-full cursor-pointer text-left"
                    >
                      {content}
                    </button>
                  ) : (
                    <div>{content}</div>
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
