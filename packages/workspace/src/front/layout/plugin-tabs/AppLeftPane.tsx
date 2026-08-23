"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { MessageSquare, Plus, Search, X } from "lucide-react"
import { Skeleton } from "@hachej/boring-ui-kit"
import { AppLeftPaneHeader } from "./AppLeftPaneHeader"
import { FleetNewChatAction, PrimaryAction, NewChatAction, KbdHint, RailAction } from "./AppLeftPaneActions"
import { AppLeftPaneAgentCard, shortAgentLabel, type AppLeftPaneAgentStats } from "./AppLeftPaneAgentCards"
import { ProjectOverview, usePinnedProjectIds } from "./AppLeftPaneProjects"
import { AppSessionRow, type AppSessionRowState } from "./AppLeftPaneSessionRow"
import { SessionSubSection } from "./AppLeftPaneSections"
import { AppLeftPaneConsoleSpike, type ConsoleSpikeRowSlots } from "./AppLeftPaneConsoleSpike"
import { useWorkspaceAttention, workspaceAttentionSessionBadgeForBlocker, type WorkspaceAttentionSessionBadge } from "../../attention/WorkspaceAttentionProvider"
import { workspaceSessionKey, workspaceSessionKeyFor, type WorkspaceSessionRef } from "../../sessionIdentity"
import { useWorkingSessionIds } from "../../sessionActivity"
import { cn } from "../../lib/utils"

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

export interface AppLeftNavigationEntry extends AppLeftPaneAction {
  key: string
  kind: "primary" | "chats"
  collapsedTrailing?: ReactNode
  expandedTrailing?: ReactNode
}

export function createAppLeftNavigationEntries({
  actions,
  onOpenChats,
  onOpenCommandPalette,
}: {
  actions: readonly AppLeftPaneAction[]
  onOpenChats: () => void
  onOpenCommandPalette: () => void
}): AppLeftNavigationEntry[] {
  return [
    {
      key: "search",
      id: "search",
      kind: "primary",
      icon: <Search className="h-4 w-4" strokeWidth={1.75} />,
      label: "Search",
      onClick: onOpenCommandPalette,
      expandedTrailing: <KbdHint keys="⌘K" />,
    },
    ...actions.map((action) => ({
      ...action,
      key: `action:${action.id}`,
      kind: "primary" as const,
      collapsedTrailing: action.trailing,
      expandedTrailing: action.trailing,
    })),
    {
      key: "chats",
      id: "chats",
      kind: "chats",
      icon: <MessageSquare className="size-4" strokeWidth={1.75} />,
      label: "Chats",
      onClick: onOpenChats,
    },
  ]
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
  /** The Agent the NEXT chat targets (the New chat picker's choice). */
  selectedAgentTypeId?: string
  /**
   * The Agent the host considers addressed, used when no active session names
   * its owner. Supplying it is what keeps the pane off the New chat picker
   * target — two different questions that only look alike. The picker target
   * remains the last resort for hosts that pass neither.
   */
  addressedAgentTypeId?: string
  onSelectAgent?: (agentTypeId: string) => void
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
  navigationEntries: readonly AppLeftNavigationEntry[]
  onSwitchSession: (id: string, agentTypeId?: string) => void
  onOpenSessionAsPane: (id: string, agentTypeId?: string) => void
  /** Opens an existing chat in the detached quick-chat overlay. */
  onOpenSessionDetached?: (id: string, agentTypeId?: string) => void
  onToggleSessionPinned: (id: string, agentTypeId?: string) => void
  onDeleteSession?: (id: string, agentTypeId?: string) => unknown
  onRenameSession?: (id: string, title: string, agentTypeId?: string) => void | Promise<unknown>
  /**
   * single-project: workspace shown below the app-title logo, no Workspaces
   * section — just the session list. multi-project: the Workspaces/projects
   * tree (PR2). Defaults to single-project.
   */
  layoutMode?: AppLeftPaneLayoutMode
  /** Test override for the disposable #1355 route; hosts use ?consoleSpike=1. */
  consoleSpike?: boolean
  consoleSpikeCreateSession?: (agentTypeId: string, projectId: string, placement: "default" | "split" | "quick") => void
  consoleSpikeRenameProject?: (projectId: string, name: string) => void
}

type SessionRowState = AppSessionRowState

export function AppLeftRail({
  navigationEntries,
  footerSlot,
  onCreateSession,
}: Pick<AppLeftPaneProps, "navigationEntries" | "onCreateSession"> & {
  footerSlot?: ReactNode
}) {
  return (
    <aside
      data-boring-workspace-part="app-left-rail"
      className="flex h-full w-11 shrink-0 flex-col items-center border-r border-border bg-[color:oklch(from_var(--background)_calc(l-0.012)_c_h)] px-1 pb-1 pt-12"
      aria-label="Collapsed app navigation"
    >
      <nav className="boring-scrollbar-discreet flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto overflow-x-hidden" aria-label="Workspace shortcuts">
        {navigationEntries.map((entry) => (
          <RailAction
            key={entry.key}
            entryKey={entry.key}
            icon={entry.icon}
            label={entry.label}
            onClick={entry.onClick}
            active={entry.active}
            trailing={entry.collapsedTrailing}
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

/** Shared zero-stats object: an Agent with no chats allocates nothing. */
const EMPTY_AGENT_STATS: AppLeftPaneAgentStats = { sessions: 0, working: 0, attention: 0 }

/**
 * The #1355 console's row layout, hoisted to module scope so every row shares
 * one array identity instead of allocating two per render.
 * Pin and split are the two verbs an operator repeats; quick chat is real but
 * occasional, so it earns a menu entry rather than a permanent slot on every
 * row. Both placements stay in the menu as well, because the menu is also the
 * touch and keyboard path.
 */
const CONSOLE_HOVER_SHORTCUTS = ["pin", "split"] as const
const CONSOLE_MENU_SHORTCUTS = ["split", "quick"] as const

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
  addressedAgentTypeId: addressedAgentTypeIdProp,
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
  navigationEntries,
  onSwitchSession,
  onOpenSessionAsPane,
  onOpenSessionDetached,
  onToggleSessionPinned,
  onDeleteSession,
  onRenameSession,
  layoutMode = "single-project",
  consoleSpike: consoleSpikeProp = false,
  consoleSpikeCreateSession,
  consoleSpikeRenameProject,
}: AppLeftPaneProps) {
  // Disposable #1355 frontend-only route. It reuses the real current-app
  // component tree and leaves every unflagged host byte-for-byte unchanged.
  const consoleSpike = consoleSpikeProp || (typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("consoleSpike") === "1")
  const primaryNavigationEntries = navigationEntries.filter((entry) => entry.kind === "primary")
  const chatsNavigationEntry = navigationEntries.find((entry) => entry.kind === "chats")
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
  // Fleet row idiom (accent dot, compact rows, owner labels): any addressed
  // fleet gets it, including a fleet of one, so chat cards look identical in
  // both cardinalities. Hosts wanting the plain shell omit `agents` entirely.
  const agentRowsEnabled = agents.length > 0
  // Fleet CHROME — per-Agent sections and the New chat Agent picker — only
  // earns its keep once there is more than one Agent to choose between. With a
  // single Agent (the default seat) the pane is a flat "Chats" list, owner
  // spec; the fleet hub (many seats) keeps the full tree.
  const fleetChromeEnabled = agents.length > 1
  // Ratified layout: each Agent's chats nest under its card in single-project
  // mode; multi-project keeps chats inside the project tree instead.
  const nestedAgentChats = fleetChromeEnabled && layoutMode !== "multi-project"
  const [agentFilter, setAgentFilter] = useState("")
  // The filter input hides behind its icon until asked for (owner spec); it
  // stays open while it holds a query so active filtering is never invisible.
  const [agentFilterOpen, setAgentFilterOpen] = useState(false)
  const agentFilterInputRef = useRef<HTMLInputElement | null>(null)
  const filteredAgents = useMemo(() => {
    const query = agentFilter.trim().toLocaleLowerCase()
    return query ? agents.filter((agent) => agent.label.toLocaleLowerCase().includes(query)) : agents
  }, [agentFilter, agents])
  // Per-Agent disclosure of the nested chat list; the addressed Agent starts
  // open so the pane never boots to an all-collapsed, chat-less wall.
  // Disclosure follows the chat the user is actually reading, never the New
  // chat picker: retargeting the next chat must not reshuffle the tree.
  const addressedAgentTypeId = activeSessionRef?.agentTypeId ?? addressedAgentTypeIdProp ?? selectedAgentTypeId
  const [expandedAgentIds, setExpandedAgentIds] = useState<ReadonlySet<string>>(
    () => new Set(addressedAgentTypeId ? [addressedAgentTypeId] : []),
  )
  // Selection often resolves after the first render (async Agent discovery).
  // Disclose the addressed Agent whenever selection lands on a new one, but
  // never fight an explicit collapse of the currently selected Agent.
  const lastAutoExpandedAgentIdRef = useRef<string | undefined>(addressedAgentTypeId ?? undefined)
  useEffect(() => {
    if (!addressedAgentTypeId || lastAutoExpandedAgentIdRef.current === addressedAgentTypeId) return
    lastAutoExpandedAgentIdRef.current = addressedAgentTypeId
    setExpandedAgentIds((current) => (
      current.has(addressedAgentTypeId) ? current : new Set([...current, addressedAgentTypeId])
    ))
  }, [addressedAgentTypeId])
  const toggleAgentExpanded = (agentTypeId: string) => setExpandedAgentIds((current) => {
    const next = new Set(current)
    if (next.has(agentTypeId)) next.delete(agentTypeId)
    else next.add(agentTypeId)
    return next
  })
  // The Chats lens is deliberately independent from the selected Agent: picking
  // a different Agent (or starting a chat with it) must never silently rewrite
  // or clear what the operator chose to look at.
  const [chatsAgentLens, setChatsAgentLens] = useState<string | null>(null)
  useEffect(() => {
    // Only drop the lens when its Agent leaves the fleet entirely.
    if (!chatsAgentLens) return
    if (!agents.some((agent) => agent.agentTypeId === chatsAgentLens)) setChatsAgentLens(null)
  }, [agents, chatsAgentLens])
  const toggleChatsAgentLens = (agentTypeId: string) =>
    setChatsAgentLens((current) => (current === agentTypeId ? null : agentTypeId))
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
  // One pass, three numbers. These used to be a memoized count plus two full
  // `sessions` scans re-run per Agent per render one line below it.
  const agentStats = useMemo(() => {
    const stats = new Map(agents.map((agent) => [agent.agentTypeId, { sessions: 0, working: 0, attention: 0 }]))
    for (const session of sessions) {
      if (!session.agentTypeId) continue
      const entry = stats.get(session.agentTypeId)
      if (!entry) continue
      const key = workspaceSessionKeyFor(session)
      entry.sessions += 1
      if (workingSessionIds.has(key)) entry.working += 1
      if (sessionBadges.has(key)) entry.attention += 1
    }
    return stats
  }, [agents, sessionBadges, sessions, workingSessionIds])
  const agentLabelById = useMemo(
    () => new Map(agents.map((agent) => [agent.agentTypeId, shortAgentLabel(agent.label)])),
    [agents],
  )
  const projectItems = useMemo(() => {
    const source = projects ?? []
    if (layoutMode !== "multi-project") return source
    // The lens is one control over one unified set of chats, so it narrows the
    // project tree exactly as it narrows the flat list. Leaving project rows
    // unfiltered would make the lens look broken in multi-project mode.
    const applyLens = <T extends { agentTypeId?: string }>(list: readonly T[]) =>
      chatsAgentLens ? list.filter((session) => session.agentTypeId === chatsAgentLens) : list
    return source.map((project) => {
      const injected = project.id === activeProjectId && !project.sessions
        ? regularSessions.map((session) => ({
          id: session.id,
          agentTypeId: session.agentTypeId,
          title: session.title,
          updatedAt: session.updatedAt,
        }))
        : project.sessions
      if (!injected) return project
      const lensed = applyLens(injected)
      return {
        ...project,
        sessions: [...lensed],
        loadingSessions: project.loadingSessions ?? (project.id === activeProjectId && sessionsLoading),
        // The count stays the true owned total; the lens narrows the rows, not
        // the workspace's real size.
        sessionCount: project.sessionCount ?? (project.id === activeProjectId ? regularSessions.length : injected.length),
      }
    })
  }, [activeProjectId, chatsAgentLens, layoutMode, projects, regularSessions, sessionsLoading])
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
  const renderSession = (
    session: AppLeftPaneSession,
    pinned: boolean,
    projectId = activeProjectId ?? undefined,
    showOwnerLabel = pinned,
    nested = false,
    ownerLabelOverride?: string,
    activeDotOverride?: boolean,
    showPlacementShortcuts = true,
    /** Surface-specific row extras (the console spike's Agent chip / Project tag). */
    slots?: ConsoleSpikeRowSlots,
    /**
     * The #1355 console's researched row layout: pin + split as the two
     * hover icons (the highest-frequency verbs), every other verb in a menu
     * that right-click also opens, and a confirmed Delete. The unflagged
     * hosts keep the shipped split/quick pair and the immediate Delete.
     */
    consoleRow = false,
  ) => {
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
        activeDot={activeDotOverride ?? agentRowsEnabled}
        // The accent dot marks the active chat (spike idiom) and any working one.
        activeDotActive={working || state === "active"}
        compact={agentRowsEnabled && (nested || !pinned)}
        showPlacementShortcuts={showPlacementShortcuts}
        {...(consoleRow ? {
          hoverShortcuts: CONSOLE_HOVER_SHORTCUTS,
          menuShortcuts: CONSOLE_MENU_SHORTCUTS,
          // The verb list must not change shape on the one row that happens to
          // be open — that reads as an unreliable menu, not as "this is open".
          placementScope: "always" as const,
          confirmDelete: true,
        } : {})}
        ownerLabel={ownerLabelOverride ?? (showOwnerLabel && session.agentTypeId ? agentLabelById.get(session.agentTypeId) : undefined)}
        {...(slots?.leadingBadge ? { leadingBadge: slots.leadingBadge } : {})}
        {...(slots?.metaTag ? { metaTag: slots.metaTag } : {})}
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
        onOpenDetached={onOpenSessionDetached && isActiveProjectSession
          ? () => onOpenSessionDetached(session.id, session.agentTypeId)
          : undefined}
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
  const renderAgentCards = () => filteredAgents.map((agent) => {
    const createForAgent = (create: ((agentTypeId?: string) => void) | undefined) => () => {
      onSelectAgent?.(agent.agentTypeId)
      create?.(agent.agentTypeId)
    }
    const expanded = nestedAgentChats && expandedAgentIds.has(agent.agentTypeId)
    // Pinning is a shortcut, not a move: the Agent's nested list keeps every
    // chat it owns (pinned ones carry the pin glyph), matching the count.
    const agentSessions = nestedAgentChats && expanded
      ? sessions.filter((session) => session.agentTypeId === agent.agentTypeId)
      : []
    const card = (
      <AppLeftPaneAgentCard
        key={nestedAgentChats ? undefined : agent.agentTypeId}
        agentTypeId={agent.agentTypeId}
        label={agent.label}
        description={agent.description}
        stats={agentStats.get(agent.agentTypeId) ?? EMPTY_AGENT_STATS}
        sessionsStatus={agent.sessionsStatus}
        filtered={chatsAgentLens === agent.agentTypeId}
        expandable={nestedAgentChats}
        expanded={expanded}
        // Owner-ratified: card click means exactly one thing — disclose the
        // Agent's chats. New-chat targeting lives on the picker and the "+".
        onToggle={nestedAgentChats ? () => toggleAgentExpanded(agent.agentTypeId) : undefined}
        // The per-Agent lens only exists where a shared list remains to
        // filter (the multi-project tree); nesting replaces it elsewhere.
        onToggleFilter={nestedAgentChats ? undefined : () => toggleChatsAgentLens(agent.agentTypeId)}
        onCreateSession={createForAgent(onCreateSession)}
        onCreateSplitSession={onCreateSplitSession ? createForAgent(onCreateSplitSession) : undefined}
        onCreatePopoverSession={onCreatePopoverSession ? createForAgent(onCreatePopoverSession) : undefined}
        onOpenSettings={onOpenAgentSettings ? () => onOpenAgentSettings(agent.agentTypeId) : undefined}
      />
    )
    if (!nestedAgentChats) return card
    return (
      <div
        key={agent.agentTypeId}
        data-boring-workspace-part="app-left-agent-tree"
        data-boring-agent-type-id={agent.agentTypeId}
        className="space-y-0.5"
      >
        {card}
        {expanded ? (
          <div
            data-boring-workspace-part="app-left-agent-sessions"
            role="region"
            aria-label={`${agent.label} sessions`}
            className="ml-3 space-y-px border-l border-border pl-0.5"
          >
            {agentSessions.length > 0
              ? agentSessions.map((session) => renderSession(session, pinnedSet.has(workspaceSessionKeyFor(session)), activeProjectId ?? undefined, false, true))
              : (agent.sessionsStatus ?? "loading") === "loading"
                ? renderChatsLoading()
                : (
                  <div className="flex min-h-[26px] items-center gap-1.5 pl-6 pr-1.5 text-[12px] text-muted-foreground/80">
                    <span>No chats yet.</span>
                    <button
                      type="button"
                      data-boring-mobile-dismiss="true"
                      onClick={() => {
                        onSelectAgent?.(agent.agentTypeId)
                        onCreateSession(agent.agentTypeId)
                      }}
                      className="app-left-empty-start rounded-sm text-[12px] font-medium text-[color:var(--accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    >
                      Start one
                    </button>
                  </div>
                )}
          </div>
        ) : null}
      </div>
    )
  })

  const renderChatsLoading = () => (
    <div
      data-boring-workspace-part="app-left-chats-loading-surface"
      className="space-y-1 px-1 py-1"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Loading chats"
    >
      <div className="space-y-1" aria-hidden="true">
        <Skeleton className="h-6 w-full rounded-md" />
        <Skeleton className="h-6 w-3/4 rounded-md" />
      </div>
    </div>
  )

  const renderAgentsSection = () => (
    <section data-boring-workspace-part="app-left-pane-agents" aria-label="Agents" className="space-y-1 border-t border-border/50 pt-3">
      {/*
        Owner decision: Agents is a plain section title, not a disclosure. It
        matches the "Pinned chats" heading above it exactly — same element
        shape, size, weight, tracking and muted tone, same right-aligned
        summary — so the two sections read as one idiom rather than two.
        The separator rule that used to hang off the pinned section lives here
        now, so the block is delimited even when nothing is pinned.
      */}
      <div className="flex items-center gap-1.5 px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/75">
        <span data-boring-workspace-part="app-left-agents-heading" className="shrink-0">Agents</span>
        {agentFilterOpen || agentFilter.trim() !== "" ? (
          <label className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-1.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/65" strokeWidth={1.75} aria-hidden="true" />
            <input
              ref={agentFilterInputRef}
              type="search"
              value={agentFilter}
              onChange={(event) => setAgentFilter(event.target.value)}
              onBlur={() => { if (agentFilter.trim() === "") setAgentFilterOpen(false) }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setAgentFilter("")
                  setAgentFilterOpen(false)
                }
              }}
              aria-label="Filter Agents"
              placeholder="Filter Agents"
              className="app-left-filter-input w-full rounded-md border border-border/60 bg-transparent pl-6 pr-2 text-[11px] font-normal tracking-normal text-foreground outline-none placeholder:text-muted-foreground/55 focus:border-ring/60 focus:ring-1 focus:ring-ring/25"
            />
          </label>
        ) : (
          <span className="flex min-w-0 flex-1 items-center justify-end gap-1">
            {/* Lowercased against the row's uppercase: "5 SEATS" in the title's
                tracking shouts louder than the title. */}
            <span data-boring-workspace-part="app-left-agents-count" className="shrink-0 normal-case font-normal tabular-nums tracking-normal text-muted-foreground">
              {agents.length} {agents.length === 1 ? "seat" : "seats"}
            </span>
            <button
              type="button"
              aria-label="Filter Agents"
              title="Filter Agents"
              onClick={() => {
                setAgentFilterOpen(true)
                requestAnimationFrame(() => agentFilterInputRef.current?.focus())
              }}
              className="app-left-secondary-action grid shrink-0 place-items-center rounded-md text-muted-foreground/70 transition-colors motion-reduce:transition-none hover:bg-foreground/[0.055] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <Search className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            </button>
          </span>
        )}
      </div>
      <div className="space-y-0.5 px-0.5">
        {filteredAgents.length > 0
          ? renderAgentCards()
          : <div className="px-2 py-2 text-[11px] text-muted-foreground">No matching Agents.</div>}
      </div>
    </section>
  )

  // Item 6: one global new-chat entry point for both layouts, targeting the
  // Agent the pane is currently addressing (the host resolves that to the
  // default Agent until one is explicitly picked).
  const renderFleetNewChat = () => (
    <div className="px-0">
      <FleetNewChatAction
        agents={agents}
        selectedAgentTypeId={selectedAgentTypeId}
        onSelectAgent={onSelectAgent}
        onCreateSession={(agentTypeId) => {
          onSelectAgent?.(agentTypeId)
          onCreateSession(agentTypeId)
        }}
        onCreateSplitSession={onCreateSplitSession ? (agentTypeId) => {
          onSelectAgent?.(agentTypeId)
          onCreateSplitSession(agentTypeId)
        } : undefined}
        onCreatePopoverSession={onCreatePopoverSession ? (agentTypeId) => {
          onSelectAgent?.(agentTypeId)
          onCreatePopoverSession(agentTypeId)
        } : undefined}
      />
    </div>
  )

  const lensAgentLabel = chatsAgentLens ? agentLabelById.get(chatsAgentLens) : undefined
  // Wherever fleet chats are listed, the active lens is visible and clearable
  // from right there — single-project and multi-project alike.
  const renderLensChip = () => lensAgentLabel ? (
    <button
      type="button"
      onClick={() => setChatsAgentLens(null)}
      aria-label={`Clear ${lensAgentLabel} chat filter`}
      title="Show chats from every Agent"
      data-boring-workspace-part="app-left-chats-lens"
      className="flex h-5 min-w-0 items-center gap-1 rounded-full bg-[color:oklch(from_var(--accent)_l_c_h/0.14)] pl-2 pr-1 text-[10px] font-medium tracking-normal text-[color:var(--accent)] transition-colors motion-reduce:transition-none hover:bg-[color:oklch(from_var(--accent)_l_c_h/0.2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <span className="min-w-0 truncate">{lensAgentLabel}</span>
      <X className="size-3 shrink-0" strokeWidth={2} aria-hidden="true" />
    </button>
  ) : null
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
      // Every fleet chat row names its owner, in the project tree too.
      renderProjectSession={(project, session) => renderSession({
        id: session.id,
        agentTypeId: session.agentTypeId,
        title: session.title,
        updatedAt: session.updatedAt,
      }, pinnedSet.has(workspaceSessionKeyFor(session)), project.id, agentRowsEnabled)}
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
          {primaryNavigationEntries.map((entry) => (
            <PrimaryAction
              key={entry.key}
              entryKey={entry.key}
              icon={entry.icon}
              label={entry.label}
              onClick={entry.onClick}
              trailing={entry.expandedTrailing}
              emphasis={entry.emphasis}
              active={entry.active}
            />
          ))}
        </nav>
      </section>

      <section
        data-boring-app-left-nav-key={chatsNavigationEntry?.key}
        className="flex min-h-24 flex-1 flex-col border-t border-border/40 pt-3"
        aria-labelledby={!consoleSpike && !fleetChromeEnabled ? "app-left-chats-heading" : undefined}
        aria-label={consoleSpike ? "Chat navigation" : fleetChromeEnabled ? "Agent navigation" : undefined}
      >
        {consoleSpike ? (
          <AppLeftPaneConsoleSpike
            projects={projects ?? []}
            sessions={sessions}
            agents={agents}
            activeSessionId={activeSessionRef?.sessionId ?? activeSessionId}
            activeSessionAgentTypeId={activeSessionRef?.agentTypeId ?? sessions.find((session) => session.id === activeSessionId)?.agentTypeId}
            {...(addressedAgentTypeId ? { defaultAgentTypeId: addressedAgentTypeId } : {})}
            pinnedSessionKeys={pinnedSet}
            pinnedProjectIds={pinnedProjectSet}
            onTogglePinnedProject={togglePinnedProject}
            sessionsLoading={sessionsLoading}
            renderLoading={renderChatsLoading}
            onCreateSession={(agentTypeId, projectId, placement = "default") => {
              if (agentTypeId && projectId && consoleSpikeCreateSession) consoleSpikeCreateSession(agentTypeId, projectId, placement)
              // A Project header's "+" names a place; without the scoped seam
              // the host's own in-project create is the honest fallback.
              else if (projectId) onCreateProjectSession?.(projectId)
              else if (placement === "split") onCreateSplitSession?.(agentTypeId)
              else if (placement === "quick") onCreatePopoverSession?.(agentTypeId)
              else onCreateSession(agentTypeId)
            }}
            onRenameProject={consoleSpikeRenameProject}
            renderSession={(session, slots) => renderSession(
              session,
              pinnedSet.has(workspaceSessionKeyFor(session)),
              // Collection labels are organization only in the spike. Every
              // row still opens in the already-authorized Workspace scope.
              undefined,
              false,
              true,
              // The spike states the Agent as a leading colour chip, not as the
              // trailing owner label — that slot keeps the relative age.
              undefined,
              false,
              // Placement IS offered here — as the researched pin+split pair
              // on the row and both placements in the menu below.
              true,
              slots,
              true,
            )}
          />
        ) : null}
        {!consoleSpike && !fleetChromeEnabled ? (
          <h2 id="app-left-chats-heading" className="shrink-0 px-4 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/75">
            {chatsNavigationEntry?.label}
          </h2>
        ) : null}
        {!consoleSpike && !fleetChromeEnabled ? (
          <div data-boring-workspace-part="app-left-new-chat" className="shrink-0 px-2 pb-2">
            <NewChatAction icon={<Plus className="h-4 w-4" strokeWidth={2} />} onCreateSession={onCreateSession} onCreateSplitSession={onCreateSplitSession} onCreatePopoverSession={onCreatePopoverSession} />
          </div>
        ) : null}
        {!consoleSpike ? <div
          data-boring-workspace-part="app-left-session-scroll"
          className="boring-scrollbar-discreet min-h-0 flex-1 overflow-y-auto px-2 pb-2 [mask-image:linear-gradient(to_bottom,transparent_0,black_8px,black_calc(100%_-_8px),transparent_100%)] motion-reduce:[mask-image:none]"
        >
          {/* Multi-project (PR2): projects remain inside the Chats region. */}
          {layoutMode === "multi-project" ? sessionsLoading && !fleetChromeEnabled ? (
            renderChatsLoading()
          ) : (
            <div className="space-y-3 py-1">
              {fleetChromeEnabled ? renderFleetNewChat() : null}
              {pinnedSessions.length > 0 || pinnedProjects.length > 0 ? (
                <SessionSubSection title="Pinned">
                  {pinnedSessions.map((session) => renderSession(session, true))}
                  {pinnedProjects.length > 0 ? renderProjectTree(pinnedProjects) : null}
                </SessionSubSection>
              ) : null}
              {fleetChromeEnabled ? renderAgentsSection() : null}
              <section data-boring-workspace-part="app-left-pane-section" className="space-y-1">
                <div className="flex items-center justify-between gap-1 px-2 pb-0.5">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/65">{workspaceSectionTitle}</span>
                  {renderLensChip()}
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
            <div className={fleetChromeEnabled ? "space-y-3 py-1" : "space-y-4 py-1"}>
              {fleetChromeEnabled ? renderFleetNewChat() : null}
              {sessionsLoading && !fleetChromeEnabled ? renderChatsLoading() : (
                <>
                  {pinnedSessions.length > 0 ? (
                    fleetChromeEnabled ? (
                      <section className="mb-3 px-0" aria-label="Pinned chats">
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
                  {/* Nested layout: each Agent's chats live under its card. */}
                  {fleetChromeEnabled ? (
                    renderAgentsSection()
                  ) : (
                    <SessionSubSection title={pinnedSessions.length > 0 ? "Recent" : undefined} empty="No chats yet.">
                      {regularSessions.map((session) => renderSession(session, false))}
                    </SessionSubSection>
                  )}
                </>
              )}
            </div>
          )}
        </div> : null}
      </section>

      {bottomSlot ? <footer data-boring-workspace-part="app-left-footer" className="shrink-0 border-t border-border/40 p-2">{bottomSlot}</footer> : null}
    </aside>
  )
}
