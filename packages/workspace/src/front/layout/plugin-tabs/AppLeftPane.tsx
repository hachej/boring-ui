"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { ChevronRight, Plus, Search } from "lucide-react"
import { AppLeftPaneHeader } from "./AppLeftPaneHeader"
import { AgentChatActions, PrimaryAction, NewChatAction, KbdHint, RailAction } from "./AppLeftPaneActions"
import { ProjectOverview, usePinnedProjectIds } from "./AppLeftPaneProjects"
import { AppSessionRow, type AppSessionRowState } from "./AppLeftPaneSessionRow"
import { SessionSubSection } from "./AppLeftPaneSections"
import { useWorkspaceAttention, workspaceAttentionSessionBadgeForBlocker, type WorkspaceAttentionSessionBadge } from "../../attention/WorkspaceAttentionProvider"
import { workspaceSessionKey, workspaceSessionKeyFor, type WorkspaceSessionRef } from "../../sessionIdentity"
import { useWorkingSessionIds } from "../../sessionActivity"

export interface AppLeftPaneSession {
  id: string
  agentTypeId?: string
  title?: string | null
  updatedAt?: string | number
  turnCount?: number
  nativeSessionId?: string
  hasAssistantReply?: boolean
  ephemeral?: boolean
  status?: "idle" | "running" | "aborting" | "error"
}

export interface AppLeftPaneAgent {
  agentTypeId: string
  label: string
  description?: string
  sessionsStatus?: "loading" | "loaded" | "error"
}

export interface AppLeftPaneProjectSession {
  id: string
  agentTypeId?: string
  title?: string | null
  updatedAt?: string | number
}

export interface AppLeftPaneProject {
  id: string
  name: string
  available?: boolean
  sessionCount?: number
  /** Sessions needing attention (blocked / awaiting input); shown as the row badge. */
  blockedCount?: number
  sessions?: AppLeftPaneProjectSession[]
  hasMoreSessions?: boolean
  loadingSessions?: boolean
}

export type AppLeftPaneLayoutMode = "single-project" | "multi-project"
export type AppLeftPaneHeaderMode = "full" | "workspace" | "hidden"

export interface AppLeftPaneAction {
  id: string
  label: string
  icon: ReactNode
  onClick: () => void
  trailing?: ReactNode
  emphasis?: boolean
  active?: boolean
}

export interface AppLeftPaneProps {
  width?: number
  appTitle?: string
  workspaceLabel?: string
  workspaceSectionTitle?: string
  projects?: AppLeftPaneProject[]
  activeProjectId?: string | null
  onOpenProjectSession?: (projectId: string, sessionId: string) => void
  onShowMoreProjectSessions?: (projectId: string) => void
  onCreateProject?: () => void
  /** Start a new chat inside a specific project (multi-project tree row "+"). */
  onCreateProjectSession?: (projectId: string) => void
  /** Open a project's workspace settings (rename / runtime / deletion). */
  onOpenProjectSettings?: (projectId: string) => void
  /** Open a project in a new browser tab. */
  onOpenProjectInNewTab?: (projectId: string) => void
  sessionTitle?: string
  topSlot?: ReactNode
  bottomSlot?: ReactNode
  /** full: brand + workspace, workspace: workspace picker only, hidden: reserve collapse clearance only. */
  headerMode?: AppLeftPaneHeaderMode
  sessions: AppLeftPaneSession[]
  /** Addressed Host fleet. Omit to preserve the single-Agent shell. */
  agents?: readonly AppLeftPaneAgent[]
  selectedAgentTypeId?: string
  onSelectAgent?: (agentTypeId: string) => void
  /** @deprecated Agent details open exclusively through onOpenAgentSettings. */
  onOpenAgentDetails?: (agentTypeId: string) => void
  onOpenAgentSettings?: (agentTypeId: string) => void
  sessionsLoading?: boolean
  /** Raw legacy native session id. */
  activeSessionId?: string | null
  /** Structured Workspace-internal active session ref. */
  activeSessionRef?: WorkspaceSessionRef | null
  /** When an app-left overlay is active, the overlay owns the selected nav state. */
  muteActiveSession?: boolean
  /** Raw legacy native session ids. */
  openSessionIds?: readonly string[]
  /** Structured Workspace-internal open refs. */
  openSessionRefs?: readonly WorkspaceSessionRef[]
  /** Raw legacy native session ids. */
  pinnedSessionIds?: readonly string[]
  /** Structured Workspace-internal pinned refs. */
  pinnedSessionRefs?: readonly WorkspaceSessionRef[]
  onCreateSession: (agentTypeId?: string) => void
  onCreateSplitSession?: (agentTypeId?: string) => void
  onCreatePopoverSession?: (agentTypeId?: string) => void
  onOpenCommandPalette: () => void
  onSwitchSession: (id: string, agentTypeId?: string) => void
  onOpenSessionAsPane: (id: string, agentTypeId?: string) => void
  onToggleSessionPinned: (id: string, agentTypeId?: string) => void
  onDeleteSession?: (id: string, agentTypeId?: string) => unknown
  onRenameSession?: (id: string, title: string, agentTypeId?: string) => void | Promise<unknown>
  /** Primary app-left actions supplied by the host/app/plugin shell after New chat/Search. */
  actions?: readonly AppLeftPaneAction[]
  /**
   * single-project: workspace shown below the app-title logo, no Workspaces
   * section — just the session list. multi-project: the Workspaces/projects
   * tree (PR2). Defaults to single-project.
   */
  layoutMode?: AppLeftPaneLayoutMode
}

type SessionRowState = AppSessionRowState

export function AppLeftRail({
  actions = [],
  footerSlot,
  onCreateSession,
  onOpenCommandPalette,
}: Pick<AppLeftPaneProps, "actions" | "onCreateSession" | "onOpenCommandPalette"> & { footerSlot?: ReactNode }) {
  return (
    <aside
      data-boring-workspace-part="app-left-rail"
      className="flex h-full w-11 shrink-0 flex-col items-center border-r border-border bg-[color:oklch(from_var(--background)_calc(l-0.012)_c_h)] px-1 pb-1 pt-12"
      aria-label="Collapsed app navigation"
    >
      <nav className="boring-scrollbar-discreet flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto overflow-x-hidden" aria-label="Workspace shortcuts">
        <RailAction
          icon={<Search className="h-4 w-4" strokeWidth={1.75} />}
          label="Search"
          onClick={onOpenCommandPalette}
        />
        {actions.map((action) => (
          <RailAction
            key={action.id}
            icon={action.icon}
            label={action.label}
            onClick={action.onClick}
            active={action.active}
            trailing={action.trailing}
          />
        ))}
      </nav>
      <div className="flex w-full shrink-0 flex-col items-center gap-1 border-t border-border/50 pt-1">
        <RailAction
          icon={<Plus className="h-4 w-4" strokeWidth={2} />}
          label="New chat"
          onClick={onCreateSession}
        />
        {footerSlot ? (
          <div className="flex w-9 justify-center" data-boring-workspace-part="app-left-rail-footer">
            {footerSlot}
          </div>
        ) : null}
      </div>
    </aside>
  )
}

export function AppLeftPane({
  width = 276,
  appTitle,
  workspaceLabel,
  workspaceSectionTitle = "Workspaces",
  projects,
  activeProjectId,
  onOpenProjectSession,
  onShowMoreProjectSessions,
  onCreateProject,
  onCreateProjectSession,
  onOpenProjectSettings,
  onOpenProjectInNewTab,
  topSlot,
  bottomSlot,
  headerMode = "full",
  sessions,
  agents = [],
  selectedAgentTypeId,
  onSelectAgent,
  onOpenAgentSettings,
  sessionsLoading = false,
  activeSessionId,
  activeSessionRef,
  muteActiveSession = false,
  openSessionIds = [],
  openSessionRefs,
  pinnedSessionIds = [],
  pinnedSessionRefs,
  onCreateSession,
  onCreateSplitSession,
  onCreatePopoverSession,
  onOpenCommandPalette,
  onSwitchSession,
  onOpenSessionAsPane,
  onToggleSessionPinned,
  onDeleteSession,
  onRenameSession,
  actions = [],
  layoutMode = "single-project",
}: AppLeftPaneProps) {
  const normalizedActiveSessionId = activeSessionRef
    ? workspaceSessionKey(activeSessionRef.sessionId, activeSessionRef.agentTypeId)
    : activeSessionId ? workspaceSessionKey(activeSessionId) : activeSessionId
  const normalizedOpenSessionIds = useMemo(
    () => openSessionRefs
      ? openSessionRefs.map((ref) => workspaceSessionKey(ref.sessionId, ref.agentTypeId))
      : openSessionIds.map((id) => workspaceSessionKey(id)),
    [openSessionIds, openSessionRefs],
  )
  const normalizedPinnedSessionIds = useMemo(
    () => pinnedSessionRefs
      ? pinnedSessionRefs.map((ref) => workspaceSessionKey(ref.sessionId, ref.agentTypeId))
      : pinnedSessionIds.map((id) => workspaceSessionKey(id)),
    [pinnedSessionIds, pinnedSessionRefs],
  )
  const openSet = useMemo(() => new Set(normalizedOpenSessionIds), [normalizedOpenSessionIds])
  const pinnedSet = useMemo(() => new Set(normalizedPinnedSessionIds), [normalizedPinnedSessionIds])
  const workingSessionIds = useWorkingSessionIds(sessions)
  const agentTreeEnabled = agents.length > 0
  const [agentFilter, setAgentFilter] = useState("")
  const filteredAgents = useMemo(() => {
    const query = agentFilter.trim().toLocaleLowerCase()
    return query ? agents.filter((agent) => agent.label.toLocaleLowerCase().includes(query)) : agents
  }, [agentFilter, agents])
  const [expandedAgentIds, setExpandedAgentIds] = useState<ReadonlySet<string>>(() => new Set())
  useEffect(() => {
    if (!selectedAgentTypeId) return
    setExpandedAgentIds((current) => current.has(selectedAgentTypeId)
      ? current
      : new Set(current).add(selectedAgentTypeId))
  }, [selectedAgentTypeId])
  const toggleAgentExpanded = (agentTypeId: string) => setExpandedAgentIds((current) => {
    const next = new Set(current)
    if (next.has(agentTypeId)) next.delete(agentTypeId)
    else next.add(agentTypeId)
    return next
  })
  const expandAgent = (agentTypeId: string) => setExpandedAgentIds((current) => current.has(agentTypeId)
    ? current
    : new Set(current).add(agentTypeId))
  const { blockers } = useWorkspaceAttention()
  const sessionBadges = useMemo(() => {
    const badges = new Map<string, WorkspaceAttentionSessionBadge>()
    for (const blocker of blockers) {
      if (!blocker.sessionId) continue
      const badge = workspaceAttentionSessionBadgeForBlocker(blocker)
      if (!badge) continue
      const key = workspaceSessionKey(blocker.sessionId, blocker.agentTypeId)
      const existing = badges.get(key)
      if (!existing || (badge.priority ?? 0) > (existing.priority ?? 0)) badges.set(key, badge)
    }
    return badges
  }, [blockers])
  const pinnedSessions = useMemo(
    () => normalizedPinnedSessionIds
      .map((id) => sessions.find((session) => workspaceSessionKeyFor(session) === id))
      .filter((session): session is AppLeftPaneSession => Boolean(session)),
    [normalizedPinnedSessionIds, sessions],
  )
  const regularSessions = useMemo(
    () => sessions.filter((session) => !pinnedSet.has(workspaceSessionKeyFor(session))),
    [pinnedSet, sessions],
  )
  const sessionsByAgent = useMemo(() => new Map(agents.map((agent) => [
    agent.agentTypeId,
    sessions.filter((session) => session.agentTypeId === agent.agentTypeId),
  ])), [agents, sessions])
  const sessionCountByAgent = useMemo(() => new Map(agents.map((agent) => [
    agent.agentTypeId,
    sessions.filter((session) => session.agentTypeId === agent.agentTypeId).length,
  ])), [agents, sessions])
  const agentLabelById = useMemo(() => new Map(agents.map((agent) => [
    agent.agentTypeId,
    agent.label.replace(/^Boring\s+/i, "") || agent.label,
  ])), [agents])
  const projectItems = useMemo(() => {
    const source = projects ?? []
    if (layoutMode !== "multi-project") return source
    return source.map((project) => {
      if (project.id !== activeProjectId) return project
      return {
        ...project,
        sessions: project.sessions ?? regularSessions.map((session) => ({
          id: session.id,
          agentTypeId: session.agentTypeId,
          title: session.title,
          updatedAt: session.updatedAt,
        })),
        sessionCount: project.sessionCount ?? regularSessions.length,
      }
    })
  }, [activeProjectId, layoutMode, projects, regularSessions])
  // Expansion is owned here (lifted from the tree) so pinned-project rows in the
  // Pinned section can expand their project in the tree on click.
  const [expandedProjectIds, setExpandedProjectIds] = useState<ReadonlySet<string>>(() => {
    const seed = activeProjectId ?? projects?.[0]?.id
    return new Set(seed ? [seed] : [])
  })
  const toggleProjectExpanded = (projectId: string) => setExpandedProjectIds((current) => {
    const next = new Set(current)
    if (next.has(projectId)) next.delete(projectId)
    else next.add(projectId)
    return next
  })
  const [pinnedProjectIds, togglePinnedProject] = usePinnedProjectIds()
  const pinnedProjectSet = useMemo(() => new Set(pinnedProjectIds), [pinnedProjectIds])
  // Pinned projects "graduate" to the Pinned section as full, expandable rows;
  // they're removed from the main list below so they're never shown twice.
  const pinnedProjects = useMemo(
    () => pinnedProjectIds
      .map((id) => projectItems.find((project) => project.id === id))
      .filter((project): project is AppLeftPaneProject => Boolean(project)),
    [pinnedProjectIds, projectItems],
  )
  const unpinnedProjectItems = useMemo(
    () => projectItems.filter((project) => !pinnedProjectSet.has(project.id)),
    [projectItems, pinnedProjectSet],
  )
  const headerVisible = headerMode !== "hidden" && (layoutMode !== "multi-project" || headerMode === "workspace")
  const headerShowsBrand = headerMode === "full" && layoutMode !== "multi-project"
  const renderSession = (session: AppLeftPaneSession, pinned: boolean, projectId = activeProjectId ?? undefined, showOwnerLabel = pinned) => {
    const isActiveProjectSession = !projectId || projectId === activeProjectId
    const sessionKey = workspaceSessionKeyFor(session)
    const state: SessionRowState = isActiveProjectSession && sessionKey === normalizedActiveSessionId && !muteActiveSession
      ? "active"
      : isActiveProjectSession && openSet.has(sessionKey)
        ? "open"
        : "normal"
    const working = isActiveProjectSession && workingSessionIds.has(sessionKey)
    return (
      <AppSessionRow
        key={sessionKey}
        session={session}
        state={state}
        pinned={pinned}
        // Split panes only make sense within the loaded workspace, so only the
        // active project's sessions are draggable / offer "open in a new pane".
        // A session from another project switches to that workspace instead.
        canSplit={isActiveProjectSession}
        canPin={isActiveProjectSession}
        working={working}
        attentionBadge={isActiveProjectSession ? sessionBadges.get(sessionKey) : undefined}
        activeDot={agentTreeEnabled}
        activeDotActive={working}
        compact={agentTreeEnabled && !pinned}
        ownerLabel={showOwnerLabel && session.agentTypeId ? agentLabelById.get(session.agentTypeId) : undefined}
        onSwitch={isActiveProjectSession
          ? session.agentTypeId
            ? () => onSwitchSession(session.id, session.agentTypeId)
            : () => onSwitchSession(session.id)
          : () => onOpenProjectSession?.(projectId, session.id)}
        onOpenAsPane={isActiveProjectSession
          ? session.agentTypeId
            ? () => onOpenSessionAsPane(session.id, session.agentTypeId)
            : () => onOpenSessionAsPane(session.id)
          : () => onOpenProjectSession?.(projectId, session.id)}
        onTogglePinned={session.agentTypeId
          ? () => onToggleSessionPinned(session.id, session.agentTypeId)
          : () => onToggleSessionPinned(session.id)}
        onRename={isActiveProjectSession && onRenameSession
          ? (id, title) => onRenameSession(id, title, session.agentTypeId)
          : undefined}
        onDelete={isActiveProjectSession && onDeleteSession
          ? session.agentTypeId
            ? () => onDeleteSession(session.id, session.agentTypeId)
            : () => onDeleteSession(session.id)
          : undefined}
      />
    )
  }
  const renderAgentTree = (showSessions: boolean) => filteredAgents.map((agent) => {
    const ownedSessions = sessionsByAgent.get(agent.agentTypeId) ?? []
    const totalSessionCount = sessionCountByAgent.get(agent.agentTypeId) ?? 0
    const expanded = showSessions && expandedAgentIds.has(agent.agentTypeId)
    const panelId = `boring-agent-sessions-${agent.agentTypeId}`
    const empty = agent.sessionsStatus === "error"
      ? "Chats unavailable."
      : agent.sessionsStatus === "loaded" ? "No chats yet." : "Loading chats…"
    const createForAgent = (create: ((agentTypeId?: string) => void) | undefined) => () => {
      if (showSessions) expandAgent(agent.agentTypeId)
      onSelectAgent?.(agent.agentTypeId)
      create?.(agent.agentTypeId)
    }
    return (
      <section key={agent.agentTypeId} data-boring-workspace-part="app-left-agent-tree" data-boring-agent-type-id={agent.agentTypeId} className="space-y-0.5">
        <div
          data-selected={selectedAgentTypeId === agent.agentTypeId ? "true" : "false"}
          className="app-left-agent-row group relative flex h-8 w-full items-center gap-1 rounded-md pr-1 text-foreground/82 transition-colors hover:bg-foreground/[0.055] hover:text-foreground focus-within:bg-foreground/[0.055] data-[selected=true]:text-foreground"
        >
          {showSessions ? (
            <button
              type="button"
              aria-label={`${expanded ? "Collapse" : "Expand"} ${agent.label} sessions`}
              aria-expanded={expanded}
              aria-controls={panelId}
              onClick={() => toggleAgentExpanded(agent.agentTypeId)}
              className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronRight className={`size-3.5 transition-transform motion-reduce:transition-none ${expanded ? "rotate-90" : ""}`} strokeWidth={1.75} aria-hidden="true" />
            </button>
          ) : <span className="size-7 shrink-0" aria-hidden="true" />}
          <button
            type="button"
            data-boring-mobile-dismiss="true"
            aria-label={`${showSessions ? expanded ? "Collapse" : "Expand" : "Select"} ${agent.label}; ${totalSessionCount} ${totalSessionCount === 1 ? "session" : "sessions"}`}
            aria-expanded={showSessions ? expanded : undefined}
            aria-controls={showSessions ? panelId : undefined}
            title={showSessions ? `${expanded ? "Collapse" : "Expand"} ${agent.label} chats` : `Select ${agent.label}`}
            onClick={() => showSessions ? toggleAgentExpanded(agent.agentTypeId) : onSelectAgent?.(agent.agentTypeId)}
            className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{agent.label.replace(/^Boring\s+/i, "") || agent.label}</span>
            <span data-boring-agent-session-count="true" className="shrink-0 text-[11px] font-normal tabular-nums text-muted-foreground/75" aria-hidden="true">{totalSessionCount}</span>
          </button>
          <AgentChatActions
            agentLabel={agent.label}
            onCreateSession={createForAgent(onCreateSession)}
            onCreateSplitSession={onCreateSplitSession ? createForAgent(onCreateSplitSession) : undefined}
            onCreatePopoverSession={onCreatePopoverSession ? createForAgent(onCreatePopoverSession) : undefined}
            onOpenSettings={onOpenAgentSettings ? () => onOpenAgentSettings(agent.agentTypeId) : undefined}
          />
        </div>
        {expanded ? (
          <div id={panelId} role="region" aria-label={`${agent.label} sessions`} className="ml-[31px] space-y-0.5 border-l border-border/60 pl-2">
            <SessionSubSection empty={empty}>
              {ownedSessions.map((session) => renderSession(session, pinnedSet.has(workspaceSessionKeyFor(session)), activeProjectId ?? undefined, false))}
            </SessionSubSection>
          </div>
        ) : null}
      </section>
    )
  })

  // Shared renderer for both the pinned project rows (in Pinned) and the rest
  // (in Projects), so they share one expand/pin state and identical behavior.
  const renderProjectTree = (items: AppLeftPaneProject[]) => (
    <ProjectOverview
      projects={items}
      activeProjectId={activeProjectId}
      fallbackName={workspaceLabel || appTitle || "Boring UI"}
      expandedIds={expandedProjectIds}
      onToggleExpanded={toggleProjectExpanded}
      pinnedProjectIds={pinnedProjectSet}
      onTogglePinnedProject={togglePinnedProject}
      onOpenProjectSession={(projectId, sessionId) => {
        if (projectId === activeProjectId) onSwitchSession(sessionId)
        else onOpenProjectSession?.(projectId, sessionId)
      }}
      onShowMoreProjectSessions={onShowMoreProjectSessions}
      onCreateProjectSession={onCreateProjectSession}
      onOpenProjectSettings={onOpenProjectSettings}
      onOpenProjectInNewTab={onOpenProjectInNewTab}
      renderProjectSession={(project, session) => renderSession({
        id: session.id,
        agentTypeId: session.agentTypeId,
        title: session.title,
        updatedAt: session.updatedAt,
      }, pinnedSet.has(workspaceSessionKeyFor(session)), project.id)}
    />
  )

  return (
    <aside
      data-boring-workspace-part="app-left-pane"
      className="flex h-full min-h-0 shrink-0 flex-col border-r border-border bg-[color:oklch(from_var(--background)_calc(l-0.012)_c_h)] text-sm"
      style={{ width, minWidth: width, maxWidth: width }}
      aria-label="App navigation"
    >
      {headerVisible ? (
        <AppLeftPaneHeader
          appTitle={appTitle}
          workspaceLabel={workspaceLabel}
          topSlot={topSlot}
          showBrand={headerShowsBrand}
        />
      ) : (
        <div className="h-[50px] shrink-0" aria-hidden="true" />
      )}

      <section className="boring-scrollbar-discreet min-h-0 max-h-[45%] shrink overflow-y-auto px-2 py-2.5" aria-labelledby="app-left-workspace-heading">
        <h2 id="app-left-workspace-heading" className="sr-only">Workspace</h2>
        <nav aria-label="Workspace actions">
          <PrimaryAction icon={<Search className="h-4 w-4" strokeWidth={1.75} />} label="Search" onClick={onOpenCommandPalette} trailing={<KbdHint keys="⌘K" />} />
          {actions.map((action) => (
            <PrimaryAction
              key={action.id}
              icon={action.icon}
              label={action.label}
              onClick={action.onClick}
              trailing={action.trailing}
              emphasis={action.emphasis}
              active={action.active}
            />
          ))}
        </nav>
      </section>

      <section
        className="flex min-h-24 flex-1 flex-col border-t border-border/40 pt-3"
        aria-labelledby={agentTreeEnabled ? undefined : "app-left-chats-heading"}
        aria-label={agentTreeEnabled ? "Agent navigation" : undefined}
      >
        {!agentTreeEnabled ? (
          <h2 id="app-left-chats-heading" className="shrink-0 px-4 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/75">
            Chats
          </h2>
        ) : null}
        {!agentTreeEnabled ? (
          <div data-boring-workspace-part="app-left-new-chat" className="shrink-0 px-2 pb-2">
            <NewChatAction icon={<Plus className="h-4 w-4" strokeWidth={2} />} onCreateSession={onCreateSession} onCreateSplitSession={onCreateSplitSession} onCreatePopoverSession={onCreatePopoverSession} />
          </div>
        ) : null}
        <div
          data-boring-workspace-part="app-left-session-scroll"
          className="boring-scrollbar-discreet min-h-0 flex-1 overflow-y-auto px-2 pb-2 [mask-image:linear-gradient(to_bottom,transparent_0,black_8px,black_calc(100%_-_8px),transparent_100%)] motion-reduce:[mask-image:none]"
        >
          {/* Multi-project (PR2): projects remain inside the Chats region. */}
          {layoutMode === "multi-project" ? (
            <div className="space-y-3 py-1">
              {pinnedSessions.length > 0 || pinnedProjects.length > 0 ? (
                <SessionSubSection title="Pinned">
                  {pinnedSessions.map((session) => renderSession(session, true))}
                  {pinnedProjects.length > 0 ? renderProjectTree(pinnedProjects) : null}
                </SessionSubSection>
              ) : null}
              {agentTreeEnabled ? (
                <section data-boring-workspace-part="app-left-pane-agents" className="space-y-1">
                  <div className="px-2 pb-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/65">Agents</div>
                  {renderAgentTree(false)}
                </section>
              ) : null}
              <section data-boring-workspace-part="app-left-pane-section" className="space-y-1">
                <div className="flex items-center justify-between gap-1 px-2 pb-0.5">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/65">{workspaceSectionTitle}</span>
                  {onCreateProject ? (
                    <button
                      type="button"
                      aria-label="New project"
                      title="New project"
                      onClick={onCreateProject}
                      className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors motion-reduce:transition-none hover:bg-foreground/[0.055] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    >
                      <Plus className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
                {renderProjectTree(unpinnedProjectItems)}
              </section>
            </div>
          ) : (
            <div className={agentTreeEnabled ? "space-y-0.5 py-1" : "space-y-4 py-1"}>
              {pinnedSessions.length > 0 ? (
                agentTreeEnabled ? (
                  <section className="mb-3 border-b border-border/50 px-0 pb-3" aria-label="Pinned chats">
                    <div className="flex items-center justify-between px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/75">
                      <span>Pinned chats</span>
                      <span className="font-normal tabular-nums text-muted-foreground">{pinnedSessions.length}</span>
                    </div>
                    <div className="space-y-0.5">{pinnedSessions.map((session) => renderSession(session, true))}</div>
                  </section>
                ) : (
                  <SessionSubSection title="Pinned">
                    {pinnedSessions.map((session) => renderSession(session, true))}
                  </SessionSubSection>
                )
              ) : null}
              {agentTreeEnabled ? (
                <section aria-label="Agents" className="space-y-0.5">
                  <div className="flex items-center justify-between gap-3 px-2 pb-1">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/75">Agents</span>
                    <label className="relative min-w-0 flex-1">
                      <Search className="pointer-events-none absolute left-1.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/65" strokeWidth={1.75} aria-hidden="true" />
                      <input
                        type="search"
                        value={agentFilter}
                        onChange={(event) => setAgentFilter(event.target.value)}
                        aria-label="Filter Agents"
                        placeholder="Filter Agents"
                        className="h-6 w-full rounded-md border border-border/60 bg-transparent pl-6 pr-2 text-[11px] font-normal tracking-normal text-foreground outline-none placeholder:text-muted-foreground/55 focus:border-ring/60 focus:ring-1 focus:ring-ring/25"
                      />
                    </label>
                  </div>
                  {filteredAgents.length > 0 ? renderAgentTree(true) : <div className="px-2 py-2 text-[11px] text-muted-foreground">No matching Agents.</div>}
                </section>
              ) : (
                <SessionSubSection title={pinnedSessions.length > 0 ? "Recent" : undefined} empty={sessionsLoading ? "Loading chats…" : "No chats yet."}>
                  {regularSessions.map((session) => renderSession(session, false))}
                </SessionSubSection>
              )}
            </div>
          )}
        </div>
      </section>

      {bottomSlot ? <footer data-boring-workspace-part="app-left-footer" className="shrink-0 border-t border-border/40 p-2">{bottomSlot}</footer> : null}
    </aside>
  )
}
