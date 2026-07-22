"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Plus, Search } from "lucide-react"
import { AppLeftPaneHeader } from "./AppLeftPaneHeader"
import { PrimaryAction, NewChatAction, KbdHint } from "./AppLeftPaneActions"
import { ProjectOverview, usePinnedProjectIds } from "./AppLeftPaneProjects"
import { AppSessionRow, type AppSessionRowState } from "./AppLeftPaneSessionRow"
import { SessionSubSection } from "./AppLeftPaneSections"
import { useWorkspaceAttention, workspaceAttentionSessionBadgeForBlocker, type WorkspaceAttentionSessionBadge } from "../../attention/WorkspaceAttentionProvider"

export interface AppLeftPaneSession {
  id: string
  title?: string | null
  updatedAt?: string | number
  turnCount?: number
}

export interface AppLeftPaneProjectSession {
  id: string
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
  activeSessionId?: string | null
  /** When an app-left overlay is active, the overlay owns the selected nav state. */
  muteActiveSession?: boolean
  openSessionIds: readonly string[]
  pinnedSessionIds: readonly string[]
  onCreateSession: () => void
  onCreateSplitSession?: () => void
  onCreatePopoverSession?: () => void
  onOpenCommandPalette: () => void
  onSwitchSession: (id: string) => void
  onOpenSessionAsPane: (id: string) => void
  onToggleSessionPinned: (id: string) => void
  onDeleteSession?: (id: string) => void
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

function useWorkingSessionIds(): ReadonlySet<string> {
  const [working, setWorking] = useState<ReadonlySet<string>>(() => new Set())
  useEffect(() => {
    const onStatus = (event: Event) => {
      const detail = (event as CustomEvent).detail as { sessionId?: unknown; working?: unknown } | undefined
      if (typeof detail?.sessionId !== "string") return
      const isWorking = detail.working === true
      setWorking((current) => {
        if (current.has(detail.sessionId as string) === isWorking) return current
        const next = new Set(current)
        if (isWorking) next.add(detail.sessionId as string)
        else next.delete(detail.sessionId as string)
        return next
      })
    }
    window.addEventListener(CHAT_SESSION_STATUS_EVENT, onStatus)
    return () => window.removeEventListener(CHAT_SESSION_STATUS_EVENT, onStatus)
  }, [])
  return working
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
  activeSessionId,
  muteActiveSession = false,
  openSessionIds,
  pinnedSessionIds,
  onCreateSession,
  onCreateSplitSession,
  onCreatePopoverSession,
  onOpenCommandPalette,
  onSwitchSession,
  onOpenSessionAsPane,
  onToggleSessionPinned,
  onDeleteSession,
  actions = [],
  layoutMode = "single-project",
}: AppLeftPaneProps) {
  const openSet = useMemo(() => new Set(openSessionIds), [openSessionIds])
  const pinnedSet = useMemo(() => new Set(pinnedSessionIds), [pinnedSessionIds])
  const workingSessionIds = useWorkingSessionIds()
  const { blockers } = useWorkspaceAttention()
  const sessionBadges = useMemo(() => {
    const badges = new Map<string, WorkspaceAttentionSessionBadge>()
    for (const blocker of blockers) {
      if (!blocker.sessionId) continue
      const badge = workspaceAttentionSessionBadgeForBlocker(blocker)
      if (!badge) continue
      const existing = badges.get(blocker.sessionId)
      if (!existing || (badge.priority ?? 0) > (existing.priority ?? 0)) badges.set(blocker.sessionId, badge)
    }
    return badges
  }, [blockers])
  const pinnedSessions = useMemo(
    () => pinnedSessionIds
      .map((id) => sessions.find((session) => session.id === id))
      .filter((session): session is AppLeftPaneSession => Boolean(session)),
    [pinnedSessionIds, sessions],
  )
  const regularSessions = useMemo(
    () => sessions.filter((session) => !pinnedSet.has(session.id)),
    [pinnedSet, sessions],
  )
  const projectItems = useMemo(() => {
    const source = projects ?? []
    if (layoutMode !== "multi-project") return source
    return source.map((project) => {
      if (project.id !== activeProjectId) return project
      return {
        ...project,
        sessions: project.sessions ?? regularSessions.map((session) => ({
          id: session.id,
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
  const renderSession = (session: AppLeftPaneSession, pinned: boolean, projectId = activeProjectId ?? undefined) => {
    const isActiveProjectSession = !projectId || projectId === activeProjectId
    const state: SessionRowState = isActiveProjectSession && session.id === activeSessionId && !muteActiveSession
      ? "active"
      : isActiveProjectSession && openSet.has(session.id)
        ? "open"
        : "normal"
    return (
      <AppSessionRow
        key={session.id}
        session={session}
        state={state}
        pinned={pinned}
        // Split panes only make sense within the loaded workspace, so only the
        // active project's sessions are draggable / offer "open in a new pane".
        // A session from another project switches to that workspace instead.
        canSplit={isActiveProjectSession}
        canPin={isActiveProjectSession}
        working={isActiveProjectSession && workingSessionIds.has(session.id)}
        attentionBadge={isActiveProjectSession ? sessionBadges.get(session.id) : undefined}
        onSwitch={isActiveProjectSession ? onSwitchSession : () => onOpenProjectSession?.(projectId, session.id)}
        onOpenAsPane={isActiveProjectSession ? onOpenSessionAsPane : () => onOpenProjectSession?.(projectId, session.id)}
        onTogglePinned={onToggleSessionPinned}
        onDelete={isActiveProjectSession ? onDeleteSession : undefined}
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
        title: session.title,
        updatedAt: session.updatedAt,
      }, pinnedSet.has(session.id), project.id)}
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
          <NewChatAction icon={<Plus className="h-4 w-4" strokeWidth={2} />} onCreateSession={onCreateSession} onCreateSplitSession={onCreateSplitSession} onCreatePopoverSession={onCreatePopoverSession} />
        </div>
        {/* Multi-project (PR2): the Workspaces/projects tree. Single-project
            shows no projects section — the workspace lives in the header above
            and the body is just the session list. */}
        {layoutMode === "multi-project" ? (
          <div className="space-y-3 py-1">
            {/* Pinned: pinned sessions + pinned projects (as full, expandable
                rows). Pinned projects are removed from the Projects list below so
                they're never shown twice. Hidden entirely when empty. */}
            {pinnedSessions.length > 0 || pinnedProjects.length > 0 ? (
              <SessionSubSection title="Pinned">
                {pinnedSessions.map((session) => renderSession(session, true))}
                {pinnedProjects.length > 0 ? renderProjectTree(pinnedProjects) : null}
              </SessionSubSection>
            ) : null}
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
            {pinnedSessions.length > 0 ? (
              <SessionSubSection title="Pinned">
                {pinnedSessions.map((session) => renderSession(session, true))}
              </SessionSubSection>
            ) : null}
            <SessionSubSection title="Chats" empty="No chats yet.">
              {regularSessions.map((session) => renderSession(session, false))}
            </SessionSubSection>
          </div>
        )}
      </div>

      {bottomSlot ? <footer className="shrink-0 border-t border-border/40 p-2">{bottomSlot}</footer> : null}
    </aside>
  )
}
