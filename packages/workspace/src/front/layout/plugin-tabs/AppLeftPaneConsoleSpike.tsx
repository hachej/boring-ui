"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { ArrowLeft, Bot, Columns2, Folder, MessageSquarePlus, SlidersHorizontal, Zap } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@hachej/boring-ui-kit"
import { cn } from "../../lib/utils"
import { AppLeftPaneAgentCard, shortAgentLabel } from "./AppLeftPaneAgentCards"
import { ProjectOverview } from "./AppLeftPaneProjects"
import { useWorkspaceAttention, workspaceAttentionSessionBadgeForBlocker } from "../../attention/WorkspaceAttentionProvider"
import { useWorkingSessionIds } from "../../sessionActivity"
import { workspaceSessionKey, workspaceSessionKeyFor } from "../../sessionIdentity"
import type { AppLeftPaneAgent, AppLeftPaneProject, AppLeftPaneSession } from "./AppLeftPane"

/**
 * The pane shows one list and lets you choose which dimension groups it.
 * `recent` is flat across every Project; the other two group by exactly ONE
 * dimension. Whichever dimension is NOT grouping renders as row metadata, so
 * the pane never nests two grouping levels.
 */
export type AppLeftPaneConsoleSpikeView = "recent" | "project" | "agent"

interface OrganizedSession {
  session: AppLeftPaneSession
  project: AppLeftPaneProject
}

/** One collapsible group: Projects and Agents share the shape. */
interface SessionGroup<Meta> {
  meta: Meta
  items: OrganizedSession[]
}

type ChatPlacement = "default" | "split" | "quick"

/** Extras the spike layers onto a row without owning how the row is built. */
export interface ConsoleSpikeRowSlots {
  leadingBadge?: ReactNode
  metaTag?: ReactNode
}

const createActionClassName = "app-left-secondary-action grid shrink-0 place-items-center rounded-md bg-background text-muted-foreground/75 transition-[color,background-color] duration-150 hover:bg-foreground/[0.07] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"

const VIEW_STORAGE_KEY = "boring-workspace:console-spike-view"

const consoleSpikeViews: readonly AppLeftPaneConsoleSpikeView[] = ["recent", "project", "agent"]

/** Past this the section stops being a glance and starts being a second list. */
const NEEDS_YOU_LIMIT = 5

function isConsoleSpikeView(value: unknown): value is AppLeftPaneConsoleSpikeView {
  return consoleSpikeViews.includes(value as AppLeftPaneConsoleSpikeView)
}

/** Storage is a convenience, never a requirement: any failure renders the default. */
function readStoredView(): AppLeftPaneConsoleSpikeView | undefined {
  try {
    const raw = globalThis.localStorage?.getItem(VIEW_STORAGE_KEY)
    return isConsoleSpikeView(raw) ? raw : undefined
  } catch {
    return undefined
  }
}

function writeStoredView(view: AppLeftPaneConsoleSpikeView): void {
  try {
    globalThis.localStorage?.setItem(VIEW_STORAGE_KEY, view)
  } catch {
    // ignore storage failures
  }
}

function consoleViewLabel(view: AppLeftPaneConsoleSpikeView): string {
  if (view === "project") return "By project"
  if (view === "agent") return "By agent"
  return "Recent"
}

/**
 * Agent identity as colour, not as a folder. Every entry is a token-friendly
 * Tailwind pair already used elsewhere in this pane (see the amber attention
 * badge in AppLeftPaneSessionRow): a low-alpha tint that works on either
 * ground, plus a text weight per scheme. No hex, no runtime colour maths.
 */
const agentChipPalette = [
  "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
] as const

const neutralChipClassName = "bg-foreground/[0.07] text-muted-foreground"

/** Deterministic per Agent id, so a colour means the same Agent every session. */
function agentChipClassName(agentTypeId: string | undefined): string {
  if (!agentTypeId) return neutralChipClassName
  let hash = 0
  for (let index = 0; index < agentTypeId.length; index += 1) {
    hash = (hash * 31 + agentTypeId.charCodeAt(index)) >>> 0
  }
  return agentChipPalette[hash % agentChipPalette.length] ?? neutralChipClassName
}

/** One letter for a one-word Agent, two for a compound one. */
function agentInitials(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean)
  const first = words[0]?.[0]
  if (!first) return "?"
  const second = words[1]?.[0]
  return (second ? `${first}${second}` : first).toUpperCase()
}

/** The row's identity mark: colour carries the Agent, the letters disambiguate. */
function AgentChip({ agentTypeId, label }: { agentTypeId?: string; label: string }) {
  return (
    <span
      data-boring-workspace-part="console-spike-agent-chip"
      data-boring-agent-type-id={agentTypeId}
      title={label}
      className={cn(
        "grid size-4 shrink-0 place-items-center rounded-full text-[9px] font-semibold leading-none",
        agentChipClassName(agentTypeId),
      )}
    >
      <span aria-hidden="true">{agentInitials(label)}</span>
      <span className="sr-only">{label}</span>
    </span>
  )
}

/** The same colour at group scale, so a header and its rows read as one family. */
function AgentDot({ agentTypeId }: { agentTypeId?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("size-2 rounded-full", agentChipClassName(agentTypeId))}
    />
  )
}

/** Where a chat lives, stated quietly enough to skip when you are not looking for it. */
function ProjectTag({ name }: { name: string }) {
  return (
    <span
      data-boring-workspace-part="console-spike-project-tag"
      title={name}
      className="pointer-events-none max-w-[6.5rem] truncate rounded-sm bg-foreground/[0.05] px-1 py-0.5 text-[10px] font-medium leading-none text-muted-foreground"
    >
      {name}
    </span>
  )
}

function placementDetails(placement: ChatPlacement): { label: string; icon: ReactNode } {
  if (placement === "split") return { label: "New split chat", icon: <Columns2 className="size-3.5" strokeWidth={1.75} /> }
  if (placement === "quick") return { label: "Quick chat", icon: <Zap className="size-3.5" strokeWidth={1.75} /> }
  return { label: "New chat", icon: <MessageSquarePlus className="size-4" strokeWidth={1.75} /> }
}

const placements: readonly ChatPlacement[] = ["default", "quick", "split"]

function useMenuStepFocus(open: boolean, step: string) {
  const contentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => contentRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open, step])
  return contentRef
}

function ProjectAgentCreateControl({
  projects,
  agents,
  onCreate,
}: {
  projects: readonly AppLeftPaneProject[]
  agents: readonly AppLeftPaneAgent[]
  onCreate: (placement: ChatPlacement, agentTypeId: string, projectId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [selectedPlacement, setSelectedPlacement] = useState<ChatPlacement | null>(null)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const selectedProject = projects.find((project) => project.id === selectedProjectId)
  const step = selectedProject ? "agent" : selectedPlacement ? "project" : "placement"
  const contentRef = useMenuStepFocus(open, step)
  const reset = () => {
    setSelectedPlacement(null)
    setSelectedProjectId(null)
  }
  return (
    <DropdownMenu
      modal={false}
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) reset()
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Choose placement, Project, and Agent for new chat"
          title="New chat…"
          disabled={projects.length === 0 || agents.length === 0}
          className={createActionClassName}
        >
          <MessageSquarePlus className="size-4" strokeWidth={1.75} aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent ref={contentRef} data-boring-workspace-part="app-left-menu" align="end" sideOffset={6} className="w-48 border-border/60">
        {selectedProject && selectedPlacement ? (
          <>
            <DropdownMenuItem
              aria-label="Back to Projects"
              onSelect={(event) => {
                event.preventDefault()
                setSelectedProjectId(null)
              }}
              className="gap-2 text-[13px] text-muted-foreground"
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              Projects
            </DropdownMenuItem>
            <DropdownMenuLabel className="truncate px-2 pb-1 pt-2 text-[11px] font-semibold text-foreground/80">
              {selectedProject.name} · {placementDetails(selectedPlacement).label}
            </DropdownMenuLabel>
            {agents.map((agent) => (
              <DropdownMenuItem
                key={agent.agentTypeId}
                aria-label={`${selectedProject.name} · ${shortAgentLabel(agent.label)}`}
                onSelect={() => {
                  onCreate(selectedPlacement, agent.agentTypeId, selectedProject.id)
                  setOpen(false)
                }}
                className="gap-2 text-[13px]"
              >
                <Bot className="size-3.5 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 truncate">{shortAgentLabel(agent.label)}</span>
              </DropdownMenuItem>
            ))}
          </>
        ) : selectedPlacement ? (
          <>
            <DropdownMenuItem
              aria-label="Back to placement"
              onSelect={(event) => {
                event.preventDefault()
                setSelectedPlacement(null)
              }}
              className="gap-2 text-[13px] text-muted-foreground"
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              Placement
            </DropdownMenuItem>
            <DropdownMenuLabel className="px-2 pb-1 pt-2 text-[11px] font-semibold text-foreground/80">
              {placementDetails(selectedPlacement).label}
            </DropdownMenuLabel>
            {projects.map((project) => (
              <DropdownMenuItem
                key={project.id}
                aria-label={project.name}
                onSelect={(event) => {
                  event.preventDefault()
                  setSelectedProjectId(project.id)
                }}
                className="gap-2 text-[13px]"
              >
                <Folder className="size-3.5 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{project.name}</span>
              </DropdownMenuItem>
            ))}
          </>
        ) : placements.map((placement) => {
          const details = placementDetails(placement)
          return (
            <DropdownMenuItem
              key={placement}
              aria-label={details.label}
              onSelect={(event) => {
                event.preventDefault()
                setSelectedPlacement(placement)
              }}
              className="gap-2 text-[13px]"
            >
              <span className="text-muted-foreground" aria-hidden="true">{details.icon}</span>
              {details.label}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Grouping gets its OWN control, not a share of a generic kebab: it is a
 * display choice the operator returns to, and burying it beside unrelated
 * actions is what makes grouping undiscoverable in panes that do that.
 */
function ConsoleViewMenu({
  view,
  views,
  onSelect,
}: {
  view: AppLeftPaneConsoleSpikeView
  views: readonly AppLeftPaneConsoleSpikeView[]
  onSelect: (view: AppLeftPaneConsoleSpikeView) => void
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Display"
          title="Display"
          className={createActionClassName}
        >
          <SlidersHorizontal className="size-4" strokeWidth={1.75} aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent data-boring-workspace-part="app-left-menu" align="end" sideOffset={6} className="w-44 border-border/60">
        <DropdownMenuLabel className="px-2 pb-1 pt-2 text-[11px] font-semibold text-foreground/80">
          Group chats by
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={view} onValueChange={(next) => { if (isConsoleSpikeView(next)) onSelect(next) }}>
          {views.map((candidate) => (
            <DropdownMenuRadioItem key={candidate} value={candidate} className="text-[13px]">
              {consoleViewLabel(candidate)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function toggleSet(current: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(current)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

function sessionTimestamp(session: AppLeftPaneSession): number {
  const value = session.updatedAt
  if (value === undefined) return 0
  const parsed = typeof value === "number" ? value : Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function organizedKey(item: OrganizedSession): string {
  return `${item.project.id}\u0000${item.session.agentTypeId ?? ""}\u0000${item.session.id}`
}

export function AppLeftPaneConsoleSpike({
  projects,
  sessions,
  agents,
  activeSessionId,
  activeSessionAgentTypeId,
  onCreateSession,
  onRenameProject,
  renderSession,
}: {
  projects: readonly AppLeftPaneProject[]
  sessions: readonly AppLeftPaneSession[]
  agents: readonly AppLeftPaneAgent[]
  activeSessionId?: string | null
  activeSessionAgentTypeId?: string
  onCreateSession: (agentTypeId?: string, projectId?: string, placement?: ChatPlacement) => void
  onRenameProject?: (projectId: string, name: string) => void
  renderSession: (session: AppLeftPaneSession, slots?: ConsoleSpikeRowSlots) => ReactNode
}) {
  const [storedView, setStoredView] = useState<AppLeftPaneConsoleSpikeView>(() => readStoredView() ?? "recent")
  const [expandedProjects, setExpandedProjects] = useState<ReadonlySet<string>>(
    () => new Set(projects[0] ? [projects[0].id] : []),
  )
  const [expandedAgents, setExpandedAgents] = useState<ReadonlySet<string>>(
    () => new Set(agents[0] ? [agents[0].agentTypeId] : []),
  )
  const [needsYouExpanded, setNeedsYouExpanded] = useState(false)
  // Grouping by Agent is meaningless for a single-Agent workspace, so it is not
  // offered — and a stored choice from a richer workspace falls back rather
  // than rendering a menu state the user cannot reach.
  const views: readonly AppLeftPaneConsoleSpikeView[] = agents.length > 1
    ? consoleSpikeViews
    : ["recent", "project"]
  const view = views.includes(storedView) ? storedView : "recent"
  const chooseView = (next: AppLeftPaneConsoleSpikeView) => {
    setStoredView(next)
    writeStoredView(next)
  }

  const agentLabelById = useMemo(
    () => new Map(agents.map((agent) => [agent.agentTypeId, shortAgentLabel(agent.label)])),
    [agents],
  )
  const agentLabel = (agentTypeId?: string) => agentLabelById.get(agentTypeId ?? "") ?? agentTypeId ?? "Agent"

  const { blockers } = useWorkspaceAttention()
  const workingSessionIds = useWorkingSessionIds(sessions)
  // Only the KEYS matter here: the row itself renders the badge, the groups
  // only need to know how many of their chats are waiting on a human.
  const attentionSessionKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const blocker of blockers) {
      if (!blocker.sessionId) continue
      if (!workspaceAttentionSessionBadgeForBlocker(blocker)) continue
      keys.add(workspaceSessionKey(blocker.sessionId, blocker.agentTypeId))
    }
    return keys
  }, [blockers])
  const countAttention = (items: readonly OrganizedSession[]) =>
    items.filter((item) => attentionSessionKeys.has(workspaceSessionKeyFor(item.session))).length
  const countWorking = (items: readonly OrganizedSession[]) =>
    items.filter((item) => workingSessionIds.has(workspaceSessionKeyFor(item.session))).length

  const organizedSessions = useMemo(() => {
    const sessionByKey = new Map(sessions.map((session) => [`${session.agentTypeId ?? ""}\u0000${session.id}`, session]))
    const claimed = new Set<string>()
    const organized: OrganizedSession[] = []
    for (const project of projects) {
      for (const projectSession of project.sessions ?? []) {
        const requestedKey = `${projectSession.agentTypeId ?? ""}\u0000${projectSession.id}`
        const idMatches = projectSession.agentTypeId
          ? []
          : sessions.filter((item) => item.id === projectSession.id)
        const session = sessionByKey.get(requestedKey) ?? (idMatches.length === 1 ? idMatches[0] : undefined)
        if (!session) continue
        const resolvedKey = `${session.agentTypeId ?? ""}\u0000${session.id}`
        if (claimed.has(resolvedKey)) continue
        claimed.add(resolvedKey)
        organized.push({ session, project })
      }
    }
    const fallbackProject = { id: "unassigned", name: "Unassigned" }
    for (const session of sessions) {
      const key = `${session.agentTypeId ?? ""}\u0000${session.id}`
      if (!claimed.has(key)) organized.push({ session, project: fallbackProject })
    }
    // One ordering for the whole pane. Grouping slices this list; it never
    // re-sorts it, so a chat keeps its place relative to its siblings in every
    // view. Sort is stable, so undated chats hold their source order.
    return [...organized].sort((left, right) => sessionTimestamp(right.session) - sessionTimestamp(left.session))
  }, [projects, sessions])

  const activeItem = organizedSessions.find(({ session }) => (
    session.id === activeSessionId
    && (!activeSessionAgentTypeId || session.agentTypeId === activeSessionAgentTypeId)
  ))
  useEffect(() => {
    if (!activeSessionId) return
    const active = organizedSessions.find(({ session }) => (
      session.id === activeSessionId
      && (!activeSessionAgentTypeId || session.agentTypeId === activeSessionAgentTypeId)
    ))
    if (!active) return
    setExpandedProjects((current) => current.has(active.project.id) ? current : new Set([...current, active.project.id]))
    const agentTypeId = active.session.agentTypeId
    if (!agentTypeId) return
    setExpandedAgents((current) => current.has(agentTypeId) ? current : new Set([...current, agentTypeId]))
  }, [activeSessionAgentTypeId, activeSessionId, organizedSessions])

  const projectGroups = useMemo(() => {
    const groups = new Map<string, SessionGroup<AppLeftPaneProject>>()
    for (const project of projects) groups.set(project.id, { meta: project, items: [] })
    for (const item of organizedSessions) {
      const group = groups.get(item.project.id)
      if (group) group.items.push(item)
      // The synthetic "Unassigned" collection is appended last, after every
      // real Project, because it is a remainder and not a place.
      else groups.set(item.project.id, { meta: item.project, items: [item] })
    }
    return [...groups.values()]
  }, [organizedSessions, projects])

  const agentGroups = useMemo(() => {
    const known = new Set(agents.map((agent) => agent.agentTypeId))
    const orphans = organizedSessions.filter((item) => !item.session.agentTypeId || !known.has(item.session.agentTypeId))
    return [
      ...agents.map((agent) => ({
        meta: agent,
        items: organizedSessions.filter((item) => item.session.agentTypeId === agent.agentTypeId),
      })),
      // A chat whose Agent the fleet no longer lists still has to be reachable;
      // dropping it would make the Agent view quietly lose chats.
      ...(orphans.length > 0
        ? [{ meta: { agentTypeId: "", label: "No Agent" } as AppLeftPaneAgent, items: orphans }]
        : []),
    ]
  }, [agents, organizedSessions])

  // A chat waiting on a human is the one thing the pane must never bury, so it
  // sits above the list in EVERY view and keeps its place there whatever the
  // grouping or recency does below. These rows stay in the list too: removing
  // them would empty the group headers' rollup of the very thing it counts.
  const needsYouItems = organizedSessions.filter((item) => attentionSessionKeys.has(workspaceSessionKeyFor(item.session)))
  const shownNeedsYou = needsYouExpanded ? needsYouItems : needsYouItems.slice(0, NEEDS_YOU_LIMIT)
  const hiddenNeedsYou = needsYouItems.length - shownNeedsYou.length
  const needsYouSection = needsYouItems.length > 0 ? (
    <section
      data-boring-workspace-part="console-spike-needs-you"
      aria-label="Chats that need you"
      className="shrink-0 border-b border-border/50 bg-amber-500/[0.04] px-2 pb-1.5"
    >
      <div className="flex h-6 items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-700 dark:text-amber-300">
        <span className="size-1.5 rounded-full bg-amber-500" aria-hidden="true" />
        Needs you
        <span className="tabular-nums text-muted-foreground/80">
          {needsYouItems.length > 99 ? "99+" : needsYouItems.length}
        </span>
      </div>
      <div className="space-y-0.5">
        {shownNeedsYou.map((item) => (
          <div key={organizedKey(item)}>
            {/* Nothing groups this section, so both dimensions are metadata. */}
            {renderSession(item.session, {
              leadingBadge: <AgentChip agentTypeId={item.session.agentTypeId} label={agentLabel(item.session.agentTypeId)} />,
              metaTag: <ProjectTag name={item.project.name} />,
            })}
          </div>
        ))}
      </div>
      {hiddenNeedsYou > 0 || needsYouExpanded ? (
        <button
          type="button"
          onClick={() => setNeedsYouExpanded((current) => !current)}
          className="mt-0.5 rounded-md px-1 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          {hiddenNeedsYou > 0 ? `+${hiddenNeedsYou} more` : "Show less"}
        </button>
      ) : null}
    </section>
  ) : null

  const emptyState = (
    <div className="px-2 py-8 text-center text-xs text-muted-foreground">No chats yet. Start one with +.</div>
  )

  const recentView = (
    <div className="space-y-0.5" data-boring-workspace-part="console-spike-recent-view">
      {organizedSessions.length > 0 ? organizedSessions.map((item) => (
        <div key={organizedKey(item)}>
          {renderSession(item.session, {
            leadingBadge: <AgentChip agentTypeId={item.session.agentTypeId} label={agentLabel(item.session.agentTypeId)} />,
            metaTag: <ProjectTag name={item.project.name} />,
          })}
        </div>
      )) : emptyState}
    </div>
  )

  const projectView = (
    <div data-boring-workspace-part="console-spike-project-view">
      {projectGroups.length > 0 ? <ProjectOverview
        projects={projectGroups.map((group) => {
          const expanded = expandedProjects.has(group.meta.id)
          const attention = countAttention(group.items)
          return {
            ...group.meta,
            sessions: group.items.map((item) => item.session),
            sessionCount: group.items.length,
            // The rollup exists so a collapsed Project cannot hide a chat that
            // is waiting on a human. Expanded, the rows say it themselves, so
            // the header stays quiet rather than saying it twice.
            ...(!expanded && attention > 0 ? { blockedCount: attention } : {}),
          }
        })}
        activeProjectId={activeItem?.project.id ?? "__organization_only__"}
        fallbackName="Unassigned"
        expandedIds={expandedProjects}
        onToggleExpanded={(projectId) => setExpandedProjects((current) => toggleSet(current, projectId))}
        pinnedProjectIds={new Set()}
        onTogglePinnedProject={() => undefined}
        {...(onRenameProject ? { onRenameProject } : {})}
        allowPinning={false}
        compactTree
        leadingIcon={() => <Folder className="size-3.5" strokeWidth={1.75} />}
        // Grouping by Project already answers "where"; only the Agent is left
        // to say, so the row carries the chip and no tag.
        renderProjectSession={(_project, session) => renderSession(session, {
          leadingBadge: <AgentChip agentTypeId={session.agentTypeId} label={agentLabel(session.agentTypeId)} />,
        })}
      /> : emptyState}
    </div>
  )

  const agentView = (
    <div className="space-y-0.5" data-boring-workspace-part="console-spike-agent-view">
      {agentGroups.map((group) => {
        const expanded = expandedAgents.has(group.meta.agentTypeId)
        return (
          <div key={group.meta.agentTypeId} className="space-y-0.5">
            <AppLeftPaneAgentCard
              agentTypeId={group.meta.agentTypeId}
              label={group.meta.label}
              {...(group.meta.description ? { description: group.meta.description } : {})}
              leadingIcon={<AgentDot agentTypeId={group.meta.agentTypeId} />}
              stats={{
                sessions: group.items.length,
                working: countWorking(group.items),
                attention: countAttention(group.items),
              }}
              {...(group.meta.sessionsStatus ? { sessionsStatus: group.meta.sessionsStatus } : {})}
              filtered={false}
              active={activeItem?.session.agentTypeId === group.meta.agentTypeId}
              expandable
              expanded={expanded}
              onToggle={() => setExpandedAgents((current) => toggleSet(current, group.meta.agentTypeId))}
              onCreateSession={() => undefined}
              showCreate={false}
            />
            {expanded ? (
              <div className="ml-3 space-y-0.5 border-l border-border pl-0.5">
                {group.items.length > 0 ? group.items.map((item) => (
                  <div key={organizedKey(item)}>
                    {/* Grouping by Agent already answers "who"; the Project is
                        the dimension still worth stating. */}
                    {renderSession(item.session, { metaTag: <ProjectTag name={item.project.name} /> })}
                  </div>
                )) : (
                  <div className="px-2 py-3 text-[11px] leading-4 text-muted-foreground">No chats yet. Use + to choose a Project.</div>
                )}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-boring-workspace-part="app-left-console-spike">
      <div className="flex min-h-8 shrink-0 items-center gap-1 px-2 pb-3">
        <span
          data-boring-workspace-part="console-spike-view-label"
          className="min-w-0 flex-1 truncate pl-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/75"
        >
          {consoleViewLabel(view)}
        </span>
        <ConsoleViewMenu view={view} views={views} onSelect={chooseView} />
        <ProjectAgentCreateControl
          projects={projects}
          agents={agents}
          onCreate={(placement, agentTypeId, projectId) => onCreateSession(agentTypeId, projectId, placement)}
        />
      </div>
      {needsYouSection}
      <div className="boring-scrollbar-discreet min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <div data-boring-workspace-part="console-spike-list" className="py-1">
          {view === "recent" ? recentView : null}
          {view === "project" ? projectView : null}
          {view === "agent" ? agentView : null}
        </div>
      </div>
    </div>
  )
}
