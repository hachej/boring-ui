"use client"

import { useMemo, useState, type ReactNode } from "react"
import { ChevronRight, Clock3, ExternalLink, MessageSquarePlus, MoreHorizontal, Pin, PinOff, Plug, Plus, Search, Settings, Sparkles } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@hachej/boring-ui-kit"
import { cn } from "../../lib/utils"
import { CHAT_SESSION_DRAG_TYPE } from "../ChatPaneStage"

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

export interface AppLeftPaneProps {
  width?: number
  appTitle?: string
  workspaceLabel?: string
  workspaceSectionTitle?: string
  projects?: AppLeftPaneProject[]
  activeProjectId?: string | null
  onSwitchProject?: (projectId: string) => void
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
  sessions: AppLeftPaneSession[]
  activeSessionId?: string | null
  openSessionIds: readonly string[]
  pinnedSessionIds: readonly string[]
  onCreateSession: () => void
  onOpenCommandPalette: () => void
  onSwitchSession: (id: string) => void
  onOpenSessionAsPane: (id: string) => void
  onToggleSessionPinned: (id: string) => void
  showPlugins?: boolean
  showSkills?: boolean
  onOpenPlugins: () => void
  onOpenSkills: () => void
  /**
   * single-project: workspace shown below the app-title logo, no Workspaces
   * section — just the session list. multi-project: the Workspaces/projects
   * tree (PR2). Defaults to single-project.
   */
  layoutMode?: AppLeftPaneLayoutMode
}

type SessionRowState = "normal" | "open" | "active"

// Pinned projects are a cross-workspace UI preference (which projects to surface
// in the Pinned section), so they live in one global localStorage key rather
// than the per-workspace pinned-sessions key.
const PINNED_PROJECTS_KEY = "boring-workspace:pinned-projects"
function readPinnedProjectIds(): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(PINNED_PROJECTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as { ids?: unknown }
    return Array.isArray(parsed?.ids) ? parsed.ids.filter((id): id is string => typeof id === "string") : []
  } catch {
    return []
  }
}
function writePinnedProjectIds(ids: readonly string[]): void {
  try {
    globalThis.localStorage?.setItem(PINNED_PROJECTS_KEY, JSON.stringify({ ids }))
  } catch {
    // ignore storage failures
  }
}

export function AppLeftPane({
  width = 268,
  appTitle,
  workspaceLabel,
  workspaceSectionTitle = "Workspaces",
  projects,
  activeProjectId,
  onSwitchProject,
  onOpenProjectSession,
  onShowMoreProjectSessions,
  onCreateProject,
  onCreateProjectSession,
  onOpenProjectSettings,
  onOpenProjectInNewTab,
  topSlot,
  bottomSlot,
  sessions,
  activeSessionId,
  openSessionIds,
  pinnedSessionIds,
  onCreateSession,
  onOpenCommandPalette,
  onSwitchSession,
  onOpenSessionAsPane,
  onToggleSessionPinned,
  showPlugins = true,
  showSkills = true,
  onOpenPlugins,
  onOpenSkills,
  layoutMode = "single-project",
}: AppLeftPaneProps) {
  const openSet = useMemo(() => new Set(openSessionIds), [openSessionIds])
  const pinnedSet = useMemo(() => new Set(pinnedSessionIds), [pinnedSessionIds])
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
  const [pinnedProjectIds, setPinnedProjectIds] = useState<readonly string[]>(() => readPinnedProjectIds())
  const togglePinnedProject = (projectId: string) => setPinnedProjectIds((current) => {
    const next = current.includes(projectId) ? current.filter((id) => id !== projectId) : [...current, projectId]
    writePinnedProjectIds(next)
    return next
  })
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
  const renderSession = (session: AppLeftPaneSession, pinned: boolean, projectId = activeProjectId ?? undefined) => {
    const isActiveProjectSession = !projectId || projectId === activeProjectId
    const state: SessionRowState = isActiveProjectSession && session.id === activeSessionId
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
        onSwitch={isActiveProjectSession ? onSwitchSession : () => onOpenProjectSession?.(projectId, session.id)}
        onOpenAsPane={isActiveProjectSession ? onOpenSessionAsPane : () => onOpenProjectSession?.(projectId, session.id)}
        onTogglePinned={onToggleSessionPinned}
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
      onSwitchProject={onSwitchProject}
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
      {/* Brand (glyph + app name) on the first line — leading padding clears
          the fixed collapse button rendered by the shell at top-left. The
          current workspace sits BELOW it, showing only the workspace name (never
          the app title, so it never reads "Seneca AI / Seneca AI"). In
          multi-project mode the host topSlot (switcher) can replace the label. */}
      <div className="shrink-0 px-2 pb-2 pt-2">
        {/* Text-only brand: the collapse button is the only box at the top-left,
            so a glyph box here collided with it. Inline paddingLeft clears the
            fixed collapse button (inline so it works even if the Tailwind class
            isn't in the host's prebuilt CSS). */}
        <div className="flex h-8 items-center pr-1" style={{ paddingLeft: "2.5rem" }}>
          <span className="truncate text-[15px] font-semibold tracking-tight text-foreground" data-boring-workspace-part="app-left-pane-brand">
            {appTitle || "Boring UI"}
          </span>
        </div>
        {layoutMode === "single-project" && topSlot ? (
          /* Workspace switcher (workspace-only display) — a dropdown that
             switches workspaces when there are several, and reads as a label
             when there's one. */
          <div className="mt-1 min-w-0" data-boring-workspace-part="app-left-pane-workspace">{topSlot}</div>
        ) : layoutMode === "single-project" && workspaceLabel && workspaceLabel !== appTitle ? (
          <div
            className="mt-0.5 flex min-h-8 items-center gap-2 rounded-md px-2 text-[13px] text-foreground/72"
            data-boring-workspace-part="app-left-pane-workspace"
          >
            <span className="truncate">{workspaceLabel}</span>
          </div>
        ) : null}
      </div>

      <nav className="shrink-0 space-y-0.5 px-2 pb-1 pt-1" aria-label="Primary workspace actions">
        <PrimaryAction icon={<Plus className="h-4 w-4" strokeWidth={2} />} label="New chat" onClick={onCreateSession} emphasis />
        <PrimaryAction icon={<Search className="h-4 w-4" strokeWidth={1.75} />} label="Search" onClick={onOpenCommandPalette} trailing={<KbdHint keys="⌘K" />} />
        {showPlugins ? <PrimaryAction icon={<Plug className="h-4 w-4" strokeWidth={1.75} />} label="Plugins" onClick={onOpenPlugins} /> : null}
        {showSkills ? <PrimaryAction icon={<Sparkles className="h-4 w-4" strokeWidth={1.75} />} label="Skills" onClick={onOpenSkills} /> : null}
      </nav>

      <div className="boring-scrollbar-discreet min-h-0 flex-1 overflow-y-auto px-2 py-2">
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

function ProjectOverview({
  projects,
  activeProjectId,
  fallbackName,
  expandedIds,
  onToggleExpanded,
  pinnedProjectIds,
  onTogglePinnedProject,
  onSwitchProject: _onSwitchProject,
  onOpenProjectSession,
  onShowMoreProjectSessions,
  onCreateProjectSession,
  onOpenProjectSettings,
  onOpenProjectInNewTab,
  renderProjectSession,
}: {
  projects: AppLeftPaneProject[]
  activeProjectId?: string | null
  fallbackName: string
  expandedIds: ReadonlySet<string>
  onToggleExpanded: (projectId: string) => void
  pinnedProjectIds: ReadonlySet<string>
  onTogglePinnedProject: (projectId: string) => void
  onSwitchProject?: (projectId: string) => void
  onOpenProjectSession?: (projectId: string, sessionId: string) => void
  onShowMoreProjectSessions?: (projectId: string) => void
  onCreateProjectSession?: (projectId: string) => void
  onOpenProjectSettings?: (projectId: string) => void
  onOpenProjectInNewTab?: (projectId: string) => void
  renderProjectSession?: (project: AppLeftPaneProject, session: AppLeftPaneProjectSession) => ReactNode
}) {
  const activeId = activeProjectId ?? projects[0]?.id ?? null

  return (
    <div className="space-y-0.5">
      {projects.map((project) => (
        <ProjectRow
          key={project.id}
          project={project}
          fallbackName={fallbackName}
          active={project.id === activeId}
          expanded={expandedIds.has(project.id)}
          pinned={pinnedProjectIds.has(project.id)}
          onTogglePinned={() => onTogglePinnedProject(project.id)}
          onToggleExpanded={() => onToggleExpanded(project.id)}
          // Clicking a project only browses it (expand/collapse). It never loads
          // the workspace — that happens solely when a session is clicked. So a
          // project's chats are visible without "opening" the project.
          onActivate={() => onToggleExpanded(project.id)}
          onOpenSession={onOpenProjectSession}
          onShowMore={onShowMoreProjectSessions}
          onCreateSession={onCreateProjectSession}
          onOpenSettings={onOpenProjectSettings}
          onOpenInNewTab={onOpenProjectInNewTab}
          renderProjectSession={renderProjectSession}
        />
      ))}
    </div>
  )
}

function ProjectRow({
  project,
  fallbackName,
  active,
  expanded,
  pinned,
  onTogglePinned,
  onToggleExpanded,
  onActivate,
  onOpenSession,
  onShowMore,
  onCreateSession,
  onOpenSettings,
  onOpenInNewTab,
  renderProjectSession,
}: {
  project: AppLeftPaneProject
  fallbackName: string
  active: boolean
  expanded: boolean
  pinned: boolean
  onTogglePinned: () => void
  onToggleExpanded: () => void
  onActivate: () => void
  onOpenSession?: (projectId: string, sessionId: string) => void
  onShowMore?: (projectId: string) => void
  onCreateSession?: (projectId: string) => void
  onOpenSettings?: (projectId: string) => void
  onOpenInNewTab?: (projectId: string) => void
  renderProjectSession?: (project: AppLeftPaneProject, session: AppLeftPaneProjectSession) => ReactNode
}) {
  // Keep the hover actions visible while the "•••" menu is open, even if the
  // pointer has moved into the (portaled) menu.
  const [menuOpen, setMenuOpen] = useState(false)
  const sessions = project.sessions ?? []
  // Badge shows sessions that NEED ATTENTION (blocked / awaiting input), not the
  // total session count — a quiet list with a loud "you have N waiting" signal.
  const blocked = project.blockedCount ?? 0
  const unavailable = project.available === false
  const name = project.name || fallbackName
  // Pinning is always available; settings/new-tab are host-provided.
  const moreItems = true
  const hasActions = Boolean(onCreateSession || moreItems)

  return (
    <div className="space-y-0.5">
      {/* The row is a plain container — the chevron, name, and actions are each
          their own button, so nested-interactive clicks never fight a wrapping
          handler (an earlier role="button" wrapper swallowed the "•••" click and
          switched projects). */}
      <div
        className={cn(
          "group relative flex min-h-8 w-full items-center gap-2 rounded-md py-1 pl-2 pr-2 transition-colors",
          active
            // Background-only active state: the accent color is reserved for the
            // deepest selected item (the active session), so the parent project
            // and its open chat don't fight for attention.
            ? "bg-foreground/[0.07] text-foreground"
            : unavailable
              ? "text-muted-foreground/45"
              : "text-foreground/82 hover:bg-foreground/[0.05] hover:text-foreground",
        )}
      >
        {/* Chevron toggles expansion ONLY (decoupled from switching). */}
        <button
          type="button"
          aria-label={expanded ? `Collapse ${name}` : `Expand ${name}`}
          aria-expanded={expanded}
          onClick={onToggleExpanded}
          className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground/55 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <ChevronRight className={cn("h-3.5 w-3.5 transition-transform duration-150", expanded && "rotate-90")} strokeWidth={2} aria-hidden="true" />
        </button>
        {/* Name activates / switches to the project. */}
        <button
          type="button"
          aria-current={active ? "page" : undefined}
          disabled={unavailable}
          onClick={() => { if (!unavailable) onActivate() }}
          className="min-w-0 flex-1 truncate rounded text-left text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-default"
        >
          {name}
        </button>
        {/* Right slot: session count at rest, swapped for actions on hover/focus
            (or while the menu is open). Reserves width so the name truncates and
            never sits under the icons. */}
        <span className="relative flex h-6 w-[3.25rem] shrink-0 items-center justify-end">
          {blocked > 0 ? (
            <span className={cn(
              "pointer-events-none absolute inset-0 flex items-center justify-end transition-opacity",
              hasActions && "group-hover:opacity-0 group-focus-within:opacity-0",
              menuOpen && "opacity-0",
            )}>
              <span
                title={`${blocked} session${blocked === 1 ? "" : "s"} waiting`}
                className="grid min-w-5 place-items-center rounded-full bg-[color:oklch(from_var(--accent)_l_c_h/0.18)] px-1.5 py-0.5 text-[11px] font-semibold text-[color:var(--accent)]"
              >
                {blocked > 99 ? "99+" : blocked}
              </span>
            </span>
          ) : null}
          {hasActions ? (
            <span className={cn(
              "flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100",
              menuOpen && "opacity-100",
            )}>
              {onCreateSession ? (
                <button
                  type="button"
                  aria-label={`New chat in ${name}`}
                  title="New chat"
                  onClick={(event) => { event.stopPropagation(); onCreateSession(project.id) }}
                  className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              ) : null}
              {moreItems ? (
                <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={`${name} options`}
                      title="More"
                      onClick={(event) => event.stopPropagation()}
                      className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" sideOffset={6} className="w-48 border-border/50 shadow-[0_12px_28px_-6px_rgba(0,0,0,0.55)]">
                    <DropdownMenuItem onSelect={onTogglePinned} className="gap-2 text-[13px]">
                      {pinned ? <PinOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Pin className="h-3.5 w-3.5" aria-hidden="true" />}
                      {pinned ? "Unpin project" : "Pin project"}
                    </DropdownMenuItem>
                    {onCreateSession ? (
                      <DropdownMenuItem onSelect={() => onCreateSession(project.id)} className="gap-2 text-[13px]">
                        <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden="true" />
                        New chat
                      </DropdownMenuItem>
                    ) : null}
                    {onOpenSettings ? (
                      <DropdownMenuItem onSelect={() => onOpenSettings(project.id)} className="gap-2 text-[13px]">
                        <Settings className="h-3.5 w-3.5" aria-hidden="true" />
                        Workspace settings
                      </DropdownMenuItem>
                    ) : null}
                    {onOpenInNewTab ? (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => onOpenInNewTab(project.id)} className="gap-2 text-[13px]">
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                          Open in new tab
                        </DropdownMenuItem>
                      </>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </span>
          ) : null}
        </span>
      </div>
      {expanded ? (
        <div className="space-y-0.5 pl-6">
          {project.loadingSessions && sessions.length === 0 ? (
            <div className="px-1 py-1.5 text-xs text-muted-foreground">Loading chats…</div>
          ) : sessions.length === 0 ? (
            <div className="px-1 py-1.5 text-xs text-muted-foreground">No chats yet.</div>
          ) : (
            sessions.map((session) => (
              <div key={session.id}>
                {renderProjectSession ? renderProjectSession(project, session) : (
                  <AppSessionRow
                    session={session}
                    state="normal"
                    pinned={false}
                    onSwitch={() => onOpenSession?.(project.id, session.id)}
                    onOpenAsPane={() => onOpenSession?.(project.id, session.id)}
                    onTogglePinned={() => undefined}
                  />
                )}
              </div>
            ))
          )}
          {project.hasMoreSessions ? (
            <button
              type="button"
              onClick={() => onShowMore?.(project.id)}
              className="rounded-md px-1 py-1 text-left text-[13px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              Show more
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function PrimaryAction({ icon, label, onClick, emphasis = false, trailing }: { icon: ReactNode; label: string; onClick: () => void; emphasis?: boolean; trailing?: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        emphasis
          // Primary CTA: a solid (borderless) filled surface so it reads as a
          // button, not an input field.
          ? "bg-foreground/[0.06] text-foreground hover:bg-foreground/[0.1]"
          : "text-foreground/82 hover:bg-foreground/[0.055] hover:text-foreground",
      )}
    >
      <span className={cn("grid size-5 shrink-0 place-items-center", emphasis ? "text-foreground/90" : "text-muted-foreground")} aria-hidden="true">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing ? <span className="shrink-0">{trailing}</span> : null}
    </button>
  )
}

/** Small keyboard-shortcut hint badge (e.g. ⌘K), Linear/Stripe-style. */
function KbdHint({ keys }: { keys: string }) {
  return (
    <kbd aria-hidden="true" className="rounded border border-border/60 bg-foreground/[0.08] px-1.5 py-px text-[10px] font-medium leading-[1.4] tracking-wide text-muted-foreground">
      {keys}
    </kbd>
  )
}

function SessionSubSection({ title, empty, children }: { title: string; empty?: string; children: ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children)
  if (!hasChildren && !empty) return null
  return (
    <div className="space-y-1">
      <div className="px-2 pb-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/65">
        {title}
      </div>
      <div className="space-y-0.5">
        {hasChildren ? children : <div className="px-2 py-1.5 text-xs text-muted-foreground/60">{empty}</div>}
      </div>
    </div>
  )
}

function AppSessionRow({
  session,
  state,
  pinned,
  canSplit = true,
  onSwitch,
  onOpenAsPane,
  onTogglePinned,
}: {
  session: AppLeftPaneSession
  state: SessionRowState
  pinned: boolean
  /** Whether this session can be split-paned/dragged (same-project only). */
  canSplit?: boolean
  onSwitch: (id: string) => void
  onOpenAsPane: (id: string) => void
  onTogglePinned: (id: string) => void
}) {
  const title = session.title || "Untitled"
  const activate = () => {
    if (state !== "active") onSwitch(session.id)
  }
  return (
    <div
      role="button"
      tabIndex={0}
      data-boring-workspace-part="app-session-row"
      data-boring-session-state={state}
      onClick={activate}
      // Drag a session onto the chat stage to open it as a split pane (the
      // stage accepts CHAT_SESSION_DRAG_TYPE; see ChatPaneStageDock). Only
      // same-project sessions are draggable — a split pane lives in the loaded
      // workspace's stage, so cross-project sessions can't join it.
      draggable={canSplit}
      onDragStart={canSplit ? (event) => {
        event.dataTransfer.setData(CHAT_SESSION_DRAG_TYPE, session.id)
        event.dataTransfer.setData("text/plain", title)
        event.dataTransfer.effectAllowed = "copyMove"
      } : undefined}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        activate()
      }}
      className={cn(
        "group flex min-h-8 w-full items-center gap-2 rounded-md border px-2.5 py-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        state === "active"
          // Subtle accent-tinted fill, no heavy colored border (Linear/Stripe style).
          ? "border-transparent bg-[color:oklch(from_var(--accent)_l_c_h/0.14)] text-foreground"
          : state === "open"
            ? "border-transparent bg-foreground/[0.05] text-foreground/90 hover:bg-foreground/[0.07]"
            : "border-transparent text-foreground/78 hover:bg-foreground/[0.055] hover:text-foreground",
      )}
    >
      <Clock3
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          state === "active" ? "text-[color:var(--accent)]" : "text-muted-foreground/65",
        )}
        strokeWidth={1.75}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-5" title={title}>{title}</span>
      <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-focus-within:opacity-100">
        <span
          role="button"
          tabIndex={0}
          aria-label={pinned ? `Unpin ${title}` : `Pin ${title}`}
          title={pinned ? "Unpin" : "Pin"}
          aria-pressed={pinned}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onTogglePinned(session.id)
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return
            event.preventDefault()
            event.stopPropagation()
            onTogglePinned(session.id)
          }}
          className={cn(
            "grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            pinned && "text-[color:var(--accent)]",
          )}
        >
          <Pin className={cn("h-3.5 w-3.5", pinned && "fill-current")} strokeWidth={1.75} />
        </span>
        {/* "Open in new chat pane" only for closed, same-project sessions —
            it's pointless once open, and a cross-project session can't share
            this workspace's split stage. */}
        {state === "normal" && canSplit ? (
          <span
            role="button"
            tabIndex={0}
            aria-label={`Open ${title} in new chat pane`}
            title="Open in new chat pane"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onOpenAsPane(session.id)
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return
              event.preventDefault()
              event.stopPropagation()
              onOpenAsPane(session.id)
            }}
            className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <MessageSquarePlus className="h-3.5 w-3.5" strokeWidth={1.75} />
          </span>
        ) : null}
      </span>
    </div>
  )
}
