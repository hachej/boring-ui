"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Plus, Search } from "lucide-react"
import { AppLeftPaneHeader } from "./AppLeftPaneHeader"
import { AgentNewChatActions, PrimaryAction, NewChatAction, KbdHint } from "./AppLeftPaneActions"
import { ProjectOverview, usePinnedProjectIds } from "./AppLeftPaneProjects"
import { AppSessionRow, type AppSessionRowState } from "./AppLeftPaneSessionRow"
import { SessionSubSection } from "./AppLeftPaneSections"
import { useWorkspaceAttention, workspaceAttentionSessionBadgeForBlocker, type WorkspaceAttentionSessionBadge } from "../../attention/WorkspaceAttentionProvider"
import { workspaceSessionKey, workspaceSessionKeyFor, workspaceSessionRefFromKey, type WorkspaceSessionRef } from "../../sessionIdentity"

export interface AppLeftPaneSession {
  id: string
  agentTypeId?: string
  title?: string | null
  updatedAt?: string | number
  turnCount?: number
  ephemeral?: boolean
}

export interface AppLeftPaneAgent {
  agentTypeId: string
  label: string
  description?: string
  sessionsStatus?: "unloaded" | "loading" | "loaded" | "error"
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
  /** Addressed agents already discovered by the host. Omit for the legacy wire. */
  agents?: readonly AppLeftPaneAgent[]
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
  onDeleteSession?: (id: string, agentTypeId?: string) => void
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

const CHAT_SESSION_STATUS_EVENT = "boring:chat-session-status"

function useWorkingSessions(
  sessions: readonly AppLeftPaneSession[],
  agents: readonly AppLeftPaneAgent[],
): {
  sessionIds: ReadonlySet<string>
  agentTypeIds: ReadonlySet<string>
} {
  const [workingOwners, setWorkingOwners] = useState<ReadonlyMap<string, ReadonlySet<string>>>(() => new Map())
  const agentIds = useMemo(() => new Set(agents.map((agent) => agent.agentTypeId)), [agents])
  const loadedAgentIds = useMemo(() => new Set(
    agents
      .filter((agent) => agent.sessionsStatus === "loaded")
      .map((agent) => agent.agentTypeId),
  ), [agents])
  const sessionKeys = useMemo(() => new Set(sessions.map(workspaceSessionKeyFor)), [sessions])
  const agentIdsRef = useRef(agentIds)
  const loadedAgentIdsRef = useRef(loadedAgentIds)
  const sessionKeysRef = useRef(sessionKeys)
  agentIdsRef.current = agentIds
  loadedAgentIdsRef.current = loadedAgentIds
  sessionKeysRef.current = sessionKeys
  useEffect(() => {
    const onStatus = (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        sessionId?: unknown
        agentTypeId?: unknown
        presenceOwnerId?: unknown
        working?: unknown
      } | undefined
      if (typeof detail?.sessionId !== "string") return
      const owner = typeof detail.agentTypeId === "string" ? detail.agentTypeId : undefined
      const key = workspaceSessionKey(detail.sessionId, owner)
      const presenceOwnerId = typeof detail.presenceOwnerId === "string" ? detail.presenceOwnerId : "legacy"
      const isWorking = detail.working === true
      if (isWorking && owner && (
        !agentIdsRef.current.has(owner)
        || (loadedAgentIdsRef.current.has(owner) && !sessionKeysRef.current.has(key))
      )) return
      setWorkingOwners((current) => {
        const currentOwners = current.get(key) ?? new Set<string>()
        if (currentOwners.has(presenceOwnerId) === isWorking) return current
        const nextOwners = new Set(currentOwners)
        if (isWorking) nextOwners.add(presenceOwnerId)
        else nextOwners.delete(presenceOwnerId)
        const next = new Map(current)
        if (nextOwners.size > 0) next.set(key, nextOwners)
        else next.delete(key)
        return next
      })
    }
    window.addEventListener(CHAT_SESSION_STATUS_EVENT, onStatus)
    return () => window.removeEventListener(CHAT_SESSION_STATUS_EVENT, onStatus)
  }, [])
  useEffect(() => {
    setWorkingOwners((current) => {
      const next = new Map([...current].filter(([key]) => {
        const ref = workspaceSessionRefFromKey(key)
        if (!ref.agentTypeId) return true
        if (!agentIds.has(ref.agentTypeId)) return false
        return !loadedAgentIds.has(ref.agentTypeId) || sessionKeys.has(key)
      }))
      return next.size === current.size && [...next.keys()].every((key) => current.has(key)) ? current : next
    })
  }, [agentIds, loadedAgentIds, sessionKeys])
  const working = useMemo(() => new Set(workingOwners.keys()), [workingOwners])
  const agentTypeIds = useMemo(() => {
    const result = new Set<string>()
    for (const key of working) {
      const agentTypeId = workspaceSessionRefFromKey(key).agentTypeId
      if (agentTypeId) result.add(agentTypeId)
    }
    return result
  }, [working])
  return { sessionIds: working, agentTypeIds }
}

export function AppLeftPane({
  width = 268,
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
  const working = useWorkingSessions(sessions, agents)
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
  const projectItems = useMemo(() => {
    const source = projects ?? []
    if (layoutMode !== "multi-project") return source
    return source.map((project) => {
      if (project.id !== activeProjectId) return project
      return {
        ...project,
        sessions: agents.length > 0
          ? []
          : project.sessions ?? regularSessions.map((session) => ({
              id: session.id,
              agentTypeId: session.agentTypeId,
              title: session.title,
              updatedAt: session.updatedAt,
            })),
        sessionCount: project.sessionCount ?? regularSessions.length,
      }
    })
  }, [activeProjectId, agents.length, layoutMode, projects, regularSessions])
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
  const renderSession = (session: AppLeftPaneSession, pinned: boolean, projectId = activeProjectId ?? undefined) => {
    const isActiveProjectSession = !projectId || projectId === activeProjectId
    const sessionKey = workspaceSessionKeyFor(session)
    const state: SessionRowState = isActiveProjectSession && sessionKey === normalizedActiveSessionId && !muteActiveSession
      ? "active"
      : isActiveProjectSession && openSet.has(sessionKey)
        ? "open"
        : "normal"
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
        working={isActiveProjectSession && working.sessionIds.has(sessionKey)}
        attentionBadge={isActiveProjectSession ? sessionBadges.get(sessionKey) : undefined}
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
  const addressedSessionGroups = useMemo(() => agents.map((agent) => ({
    agent,
    sessions: sessions.filter((session) => session.agentTypeId === agent.agentTypeId),
  })), [agents, sessions])
  const renderAddressedSessionGroups = () => addressedSessionGroups.map(({ agent, sessions: agentSessions }) => (
    <SessionSubSection
      key={agent.agentTypeId}
      title={renderAgentTitle(agent)}
    >
      {agentSessions.length > 0
        ? agentSessions.map((session) => renderSession(session, pinnedSet.has(workspaceSessionKeyFor(session))))
        : (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              {agent.sessionsStatus === "loaded"
                ? "No chats yet."
                : agent.sessionsStatus === "error"
                  ? "Chats unavailable."
                  : "Loading chats…"}
            </div>
          )}
    </SessionSubSection>
  ))
  const renderAgentTitle = (agent: AppLeftPaneAgent) => {
    const activity = working.agentTypeIds.has(agent.agentTypeId) ? "streaming" : "idle"
    return (
      <span
        role="status"
        aria-label={`${agent.label} ${activity}`}
        data-boring-agent-activity={activity}
        className="flex items-center gap-1.5"
      >
        <span
          aria-hidden="true"
          className={activity === "streaming"
            ? "size-1.5 rounded-full bg-[color:var(--accent)]"
            : "size-1.5 rounded-full bg-muted-foreground/35"}
        />
        <span>{agent.label}</span>
      </span>
    )
  }

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
        <div className="h-12 shrink-0" aria-hidden="true" />
      )}

      <nav className="shrink-0 space-y-0.5 px-2 pb-1 pt-1" aria-label="Primary workspace actions">
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

      <div className="boring-scrollbar-discreet min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <div className="pb-2">
          {agents.length > 0 ? (
            <AgentNewChatActions
              agents={agents}
              onCreateSession={onCreateSession}
              onCreateSplitSession={onCreateSplitSession}
              onCreatePopoverSession={onCreatePopoverSession}
            />
          ) : (
            <NewChatAction icon={<Plus className="h-4 w-4" strokeWidth={2} />} onCreateSession={onCreateSession} onCreateSplitSession={onCreateSplitSession} onCreatePopoverSession={onCreatePopoverSession} />
          )}
        </div>
        {/* Multi-project (PR2): the Workspaces/projects tree. Single-project
            shows no projects section — the workspace lives in the header above
            and the body is just the session list. */}
        {layoutMode === "multi-project" ? (
          <div className="space-y-3 py-1">
            {/* Pinned: pinned sessions + pinned projects (as full, expandable
                rows). Pinned projects are removed from the Projects list below so
                they're never shown twice. Hidden entirely when empty. */}
            {(agents.length === 0 && pinnedSessions.length > 0) || pinnedProjects.length > 0 ? (
              <SessionSubSection title="Pinned">
                {agents.length === 0 ? pinnedSessions.map((session) => renderSession(session, true)) : null}
                {pinnedProjects.length > 0 ? renderProjectTree(pinnedProjects) : null}
              </SessionSubSection>
            ) : null}
            {addressedSessionGroups.length > 0 ? renderAddressedSessionGroups() : null}
            <section data-boring-workspace-part="app-left-pane-section" className="space-y-1">
              {/* Plain label header (matches "Pinned") — projects collapse
                  individually via their own chevrons, so a section-level chevron
                  here would just stutter against the first project's. */}
              <div className="flex items-center justify-between gap-1 px-2 pb-0.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/65">{workspaceSectionTitle}</span>
                {onCreateProject ? (
                  <button
                    type="button"
                    aria-label="New project"
                    title="New project"
                    onClick={onCreateProject}
                    className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.055] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  >
                    <Plus className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
              {renderProjectTree(unpinnedProjectItems)}
            </section>
          </div>
        ) : (
          /* Single-project: no "Chats" wrapper — the session list is the whole
             point of the body, so show Pinned + Sessions directly. */
          <div className="space-y-4 py-1">
            {agents.length === 0 && pinnedSessions.length > 0 ? (
              <SessionSubSection title="Pinned">
                {pinnedSessions.map((session) => renderSession(session, true))}
              </SessionSubSection>
            ) : null}
            {addressedSessionGroups.length > 0 ? renderAddressedSessionGroups() : (
              <SessionSubSection title="Chats" empty="No chats yet.">
                {regularSessions.map((session) => renderSession(session, false))}
              </SessionSubSection>
            )}
          </div>
        )}
      </div>

      {bottomSlot ? <footer className="shrink-0 border-t border-border/40 p-2">{bottomSlot}</footer> : null}
    </aside>
  )
}
