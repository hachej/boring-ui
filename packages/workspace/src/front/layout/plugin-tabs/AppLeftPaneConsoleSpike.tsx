"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { ArrowLeft, Bot, Columns2, Folder, MessageSquarePlus, Pin, Zap } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@hachej/boring-ui-kit"
import { cn } from "../../lib/utils"
import { AppLeftPaneAgentCard, shortAgentLabel } from "./AppLeftPaneAgentCards"
import { ProjectOverview } from "./AppLeftPaneProjects"
import type { AppLeftPaneAgent, AppLeftPaneProject, AppLeftPaneSession } from "./AppLeftPane"

export type AppLeftPaneConsoleSpikeView = "projects" | "agents" | "chats"

interface OrganizedSession {
  session: AppLeftPaneSession
  project: AppLeftPaneProject
}

type ChatPlacement = "default" | "split" | "quick"

const createActionClassName = "app-left-secondary-action grid shrink-0 place-items-center rounded-md bg-background text-muted-foreground/75 transition-[color,background-color] duration-150 hover:bg-foreground/[0.07] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"

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

function toggleSet(current: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(current)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

export function AppLeftPaneConsoleSpike({
  projects,
  sessions,
  agents,
  activeSessionId,
  activeSessionAgentTypeId,
  onCreateSession,
  onRenameProject,
  isSessionPinned,
  renderSession,
}: {
  projects: readonly AppLeftPaneProject[]
  sessions: readonly AppLeftPaneSession[]
  agents: readonly AppLeftPaneAgent[]
  activeSessionId?: string | null
  activeSessionAgentTypeId?: string
  onCreateSession: (agentTypeId?: string, projectId?: string, placement?: ChatPlacement) => void
  onRenameProject?: (projectId: string, name: string) => void
  isSessionPinned: (session: AppLeftPaneSession) => boolean
  renderSession: (session: AppLeftPaneSession, contextLabel?: string) => ReactNode
}) {
  const [view, setView] = useState<AppLeftPaneConsoleSpikeView>("projects")
  const [expandedProjects, setExpandedProjects] = useState<ReadonlySet<string>>(
    () => new Set(projects[0] ? [projects[0].id] : []),
  )
  const [expandedAgents, setExpandedAgents] = useState<ReadonlySet<string>>(() => {
    const firstAgent = agents[0]?.agentTypeId
    const firstProject = projects[0]?.id
    return new Set([
      ...(firstAgent ? [`agent:${firstAgent}`] : []),
      ...(firstAgent && firstProject ? [`project:${firstProject}:${firstAgent}`] : []),
    ])
  })
  const [expandedAgentProjects, setExpandedAgentProjects] = useState<ReadonlySet<string>>(() => {
    const firstAgent = agents[0]?.agentTypeId
    const firstProject = projects[0]?.id
    return new Set(firstAgent && firstProject ? [`agent-project:${firstAgent}:${firstProject}`] : [])
  })
  const agentLabelById = useMemo(
    () => new Map(agents.map((agent) => [agent.agentTypeId, shortAgentLabel(agent.label)])),
    [agents],
  )
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
    return organized
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
    const agentTypeId = active.session.agentTypeId
    setExpandedProjects((current) => current.has(active.project.id) ? current : new Set([...current, active.project.id]))
    if (!agentTypeId) return
    const projectAgentKey = `project:${active.project.id}:${agentTypeId}`
    const agentKey = `agent:${agentTypeId}`
    const agentProjectKey = `agent-project:${agentTypeId}:${active.project.id}`
    setExpandedAgents((current) => current.has(projectAgentKey) && current.has(agentKey) ? current : new Set([...current, projectAgentKey, agentKey]))
    setExpandedAgentProjects((current) => current.has(agentProjectKey) ? current : new Set([...current, agentProjectKey]))
  }, [activeSessionAgentTypeId, activeSessionId, organizedSessions])
  const pinnedSessions = organizedSessions.filter((item) => isSessionPinned(item.session))
  const unpinnedSessions = organizedSessions.filter((item) => !isSessionPinned(item.session))
  const views: AppLeftPaneConsoleSpikeView[] = agents.length > 1
    ? ["projects", "agents", "chats"]
    : ["projects", "chats"]
  const agentLabel = (agentTypeId?: string) => agentLabelById.get(agentTypeId ?? "") ?? agentTypeId ?? "Agent"
  const sessionsFor = (projectId: string, agentTypeId: string) => organizedSessions.filter(
    (item) => item.project.id === projectId && item.session.agentTypeId === agentTypeId,
  )
  const agentStats = (agentTypeId: string, items = organizedSessions) => ({
    sessions: items.filter((item) => item.session.agentTypeId === agentTypeId).length,
    working: 0,
    attention: 0,
  })

  const sessionList = (items: readonly OrganizedSession[], context?: (item: OrganizedSession) => string | undefined) => (
    <div className="space-y-0.5">
      {items.map((item) => (
        <div key={`${item.project.id}\u0000${item.session.agentTypeId ?? ""}\u0000${item.session.id}`}>
          {renderSession(item.session, context?.(item))}
        </div>
      ))}
    </div>
  )

  const projectAgentRows = projects.map((project) => {
    const projectSessions = organizedSessions.filter((item) => item.project.id === project.id)
    const agentIds = [...new Set(projectSessions.map((item) => item.session.agentTypeId).filter((id): id is string => Boolean(id)))]
    return {
      ...project,
      sessions: agentIds.map((agentTypeId) => ({ id: agentTypeId, agentTypeId, title: agentLabel(agentTypeId) })),
      sessionCount: projectSessions.length,
    }
  })

  const projectsView = (
    <div data-boring-workspace-part="console-spike-projects-view">
      {projectAgentRows.length > 0 ? <ProjectOverview
        projects={projectAgentRows}
        activeProjectId={activeItem?.project.id ?? "__organization_only__"}
        fallbackName="Unassigned"
        expandedIds={expandedProjects}
        onToggleExpanded={(projectId) => setExpandedProjects((current) => toggleSet(current, projectId))}
        pinnedProjectIds={new Set()}
        onTogglePinnedProject={() => undefined}
        onRenameProject={onRenameProject}
        allowPinning={false}
        compactTree
        leadingIcon={() => <Folder className="size-3.5" strokeWidth={1.75} />}
        renderProjectSession={(project, agentRow) => {
          const agentTypeId = agentRow.agentTypeId ?? agentRow.id
          const agent = agents.find((candidate) => candidate.agentTypeId === agentTypeId)
          if (!agent) return null
          const key = `project:${project.id}:${agentTypeId}`
          const items = sessionsFor(project.id, agentTypeId)
          const expanded = expandedAgents.has(key)
          return (
            <div className="space-y-0.5">
              <AppLeftPaneAgentCard
                agentTypeId={agent.agentTypeId}
                label={agent.label}
                description={agent.description}
                leadingIcon={<Bot className="size-3.5" strokeWidth={1.75} />}
                stats={agentStats(agentTypeId, items)}
                sessionsStatus={agent.sessionsStatus}
                filtered={false}
                active={activeItem?.project.id === project.id && activeItem.session.agentTypeId === agentTypeId}
                expandable
                expanded={expanded}
                onToggle={() => setExpandedAgents((current) => toggleSet(current, key))}
                onCreateSession={() => undefined}
                showCreate={false}
              />
              {expanded ? <div className="ml-3 border-l border-border pl-0.5">{sessionList(items)}</div> : null}
            </div>
          )
        }}
      /> : (
        <div className="px-2 py-6 text-center text-xs text-muted-foreground">No Projects yet.</div>
      )}
    </div>
  )

  const agentsView = (
    <div className="space-y-0.5" data-boring-workspace-part="console-spike-agents-view">
      {agents.map((agent) => {
        const agentItems = organizedSessions.filter((item) => item.session.agentTypeId === agent.agentTypeId)
        const agentKey = `agent:${agent.agentTypeId}`
        const expanded = expandedAgents.has(agentKey)
        const nestedProjects = projects
          .map((project) => {
            const items = sessionsFor(project.id, agent.agentTypeId)
            return {
              ...project,
              id: `agent-project:${agent.agentTypeId}:${project.id}`,
              sessions: items.map((item) => item.session),
              sessionCount: items.length,
            }
          })
          .filter((project) => (project.sessions?.length ?? 0) > 0)
        return (
          <div key={agent.agentTypeId} className="space-y-0.5">
            <AppLeftPaneAgentCard
              agentTypeId={agent.agentTypeId}
              label={agent.label}
              description={agent.description}
              leadingIcon={<Bot className="size-3.5" strokeWidth={1.75} />}
              stats={agentStats(agent.agentTypeId)}
              sessionsStatus={agent.sessionsStatus}
              filtered={false}
              active={activeItem?.session.agentTypeId === agent.agentTypeId}
              expandable
              expanded={expanded}
              onToggle={() => setExpandedAgents((current) => toggleSet(current, agentKey))}
              onCreateSession={() => undefined}
              showCreate={false}
            />
            {expanded ? (
              <div className="ml-3 border-l border-border/70 pl-0.5">
                {nestedProjects.length > 0 ? <ProjectOverview
                  projects={nestedProjects}
                  activeProjectId={activeItem?.session.agentTypeId === agent.agentTypeId
                    ? `agent-project:${agent.agentTypeId}:${activeItem.project.id}`
                    : "__organization_only__"}
                  fallbackName="Unassigned"
                  expandedIds={expandedAgentProjects}
                  onToggleExpanded={(projectId) => setExpandedAgentProjects((current) => toggleSet(current, projectId))}
                  pinnedProjectIds={new Set()}
                  onTogglePinnedProject={() => undefined}
                  allowPinning={false}
                  compactTree
                  leadingIcon={() => <Folder className="size-3.5" strokeWidth={1.75} />}
                  renderProjectSession={(_project, session) => renderSession(session)}
                /> : (
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
      <div className="flex shrink-0 items-center gap-2 px-2 pb-3">
        <div className="flex min-h-8 min-w-0 flex-1 items-center gap-1" role="group" aria-label="Organize chats by">
          {views.map((candidate) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={view === candidate}
              onClick={() => setView(candidate)}
              className={cn(
                "app-left-console-view-action inline-flex min-h-8 min-w-0 flex-1 items-center justify-center rounded-md px-2 py-1 text-[11px] font-semibold capitalize transition-[color,background-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                view === candidate ? "bg-foreground/[0.065] text-foreground" : "text-muted-foreground/75 hover:bg-foreground/[0.03] hover:text-foreground",
              )}
            >
              {candidate}
            </button>
          ))}
        </div>
        <ProjectAgentCreateControl
          projects={projects}
          agents={agents}
          onCreate={(placement, agentTypeId, projectId) => onCreateSession(agentTypeId, projectId, placement)}
        />
      </div>
      <div className="boring-scrollbar-discreet min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <div className="py-1">
          {view === "projects" ? projectsView : null}
          {view === "agents" ? agentsView : null}
          {view === "chats" ? (
            <div className="space-y-3" data-boring-workspace-part="console-spike-chats-view">
              {pinnedSessions.length > 0 ? (
                <section aria-label="Pinned chats">
                  <div className="mb-1 flex h-5 items-center gap-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/75">
                    <Pin className="size-3" strokeWidth={1.75} aria-hidden="true" />
                    Pinned
                  </div>
                  {sessionList(pinnedSessions, ({ project, session }) => `${project.name} · ${agentLabel(session.agentTypeId)}`)}
                </section>
              ) : null}
              {unpinnedSessions.length > 0 ? (
                <section aria-label={pinnedSessions.length > 0 ? "All other chats" : "Chats"}>
                  {pinnedSessions.length > 0 ? <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/75">All chats</div> : null}
                  {sessionList(unpinnedSessions, ({ project, session }) => `${project.name} · ${agentLabel(session.agentTypeId)}`)}
                </section>
              ) : pinnedSessions.length === 0 ? (
                <div className="px-2 py-8 text-center text-xs text-muted-foreground">No chats yet. Start one with +.</div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
