"use client"

import { useMemo, useState, type ReactNode } from "react"
import { ChevronRight, Clock3, Folder, FolderOpen, MessageSquarePlus, Pin, Plug, Plus, Search, Sparkles } from "lucide-react"
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
  sessions?: AppLeftPaneProjectSession[]
  hasMoreSessions?: boolean
  loadingSessions?: boolean
}

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
  layoutMode?: "single-project" | "multi-project"
}

type SessionRowState = "normal" | "open" | "active"

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
  const projectItems = useMemo(() => projects ?? [], [projects])
  const renderSession = (session: AppLeftPaneSession, pinned: boolean) => {
    const state: SessionRowState = session.id === activeSessionId
      ? "active"
      : openSet.has(session.id)
        ? "open"
        : "normal"
    return (
      <AppSessionRow
        key={session.id}
        session={session}
        state={state}
        pinned={pinned}
        onSwitch={onSwitchSession}
        onOpenAsPane={onOpenSessionAsPane}
        onTogglePinned={onToggleSessionPinned}
      />
    )
  }

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
      <div className="shrink-0 border-b border-border/60 px-2 pb-2 pt-2">
        {/* Text-only brand: the collapse button is the only box at the top-left,
            so a glyph box here collided with it. Inline paddingLeft clears the
            fixed collapse button (inline so it works even if the Tailwind class
            isn't in the host's prebuilt CSS). */}
        <div className="flex h-8 items-center pr-1" style={{ paddingLeft: "2.5rem" }}>
          <span className="truncate text-[15px] font-semibold tracking-tight text-foreground" data-boring-workspace-part="app-left-pane-brand">
            {appTitle || "Boring UI"}
          </span>
        </div>
        {topSlot ? (
          /* Workspace switcher (workspace-only display) — a dropdown that
             switches workspaces when there are several, and reads as a label
             when there's one. */
          <div className="mt-1 min-w-0" data-boring-workspace-part="app-left-pane-workspace">{topSlot}</div>
        ) : workspaceLabel && workspaceLabel !== appTitle ? (
          <div
            className="mt-0.5 flex min-h-8 items-center gap-2 rounded-md px-2 text-[13px] text-foreground/72"
            data-boring-workspace-part="app-left-pane-workspace"
          >
            <span className="truncate">{workspaceLabel}</span>
          </div>
        ) : null}
      </div>

      <nav className="shrink-0 space-y-1 border-b border-border/60 px-2 py-2" aria-label="Primary workspace actions">
        <PrimaryAction icon={<Plus className="h-4 w-4" strokeWidth={1.75} />} label="New chat" onClick={onCreateSession} />
        <PrimaryAction icon={<Search className="h-4 w-4" strokeWidth={1.75} />} label="Search" onClick={onOpenCommandPalette} />
        {showPlugins ? <PrimaryAction icon={<Plug className="h-4 w-4" strokeWidth={1.75} />} label="Plugins" onClick={onOpenPlugins} /> : null}
        {showSkills ? <PrimaryAction icon={<Sparkles className="h-4 w-4" strokeWidth={1.75} />} label="Skills" onClick={onOpenSkills} /> : null}
      </nav>

      <div className="boring-scrollbar-discreet min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {/* Multi-project (PR2): the Workspaces/projects tree. Single-project
            shows no projects section — the workspace lives in the header above
            and the body is just the session list. */}
        {layoutMode === "multi-project" && projectItems.length > 0 ? (
          <CollapsibleSection title={workspaceSectionTitle} defaultOpen>
            <ProjectOverview
              projects={projectItems}
              activeProjectId={activeProjectId}
              fallbackName={workspaceLabel || appTitle || "Boring UI"}
              onSwitchProject={onSwitchProject}
              onOpenProjectSession={onOpenProjectSession}
              onShowMoreProjectSessions={onShowMoreProjectSessions}
            />
          </CollapsibleSection>
        ) : null}
        {layoutMode === "multi-project" ? (
          <CollapsibleSection title="Chats" defaultOpen>
            <SessionSubSection title="Pinned" empty="No pinned sessions yet.">
              {pinnedSessions.map((session) => renderSession(session, true))}
            </SessionSubSection>
            <SessionSubSection title="Sessions" empty="No sessions yet.">
              {regularSessions.map((session) => renderSession(session, false))}
            </SessionSubSection>
          </CollapsibleSection>
        ) : (
          /* Single-project: no "Chats" wrapper — the session list is the whole
             point of the body, so show Pinned + Sessions directly. */
          <div className="space-y-3 py-1">
            <SessionSubSection title="Pinned" empty="No pinned sessions yet.">
              {pinnedSessions.map((session) => renderSession(session, true))}
            </SessionSubSection>
            <SessionSubSection title="Sessions" empty="No sessions yet.">
              {regularSessions.map((session) => renderSession(session, false))}
            </SessionSubSection>
          </div>
        )}
      </div>

      {bottomSlot ? <footer className="shrink-0 border-t border-border/60 p-2">{bottomSlot}</footer> : null}
    </aside>
  )
}

function ProjectOverview({
  projects,
  activeProjectId,
  fallbackName,
  onSwitchProject,
  onOpenProjectSession,
  onShowMoreProjectSessions,
}: {
  projects: AppLeftPaneProject[]
  activeProjectId?: string | null
  fallbackName: string
  onSwitchProject?: (projectId: string) => void
  onOpenProjectSession?: (projectId: string, sessionId: string) => void
  onShowMoreProjectSessions?: (projectId: string) => void
}) {
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => (
    activeProjectId ? new Set([activeProjectId]) : new Set(projects[0]?.id ? [projects[0].id] : [])
  ))

  const activeId = activeProjectId ?? projects[0]?.id ?? null

  return (
    <div className="space-y-1">
      {projects.map((project) => {
        const active = project.id === activeId
        const expanded = expandedIds.has(project.id) || active
        const sessions = project.sessions ?? []
        const count = project.sessionCount ?? sessions.length
        const unavailable = project.available === false
        return (
          <div key={project.id} className="space-y-0.5">
            <button
              type="button"
              aria-expanded={expanded}
              aria-current={active ? "page" : undefined}
              onClick={() => {
                if (!active && !unavailable) onSwitchProject?.(project.id)
                setExpandedIds((current) => {
                  const next = new Set(current)
                  if (next.has(project.id) && !active) next.delete(project.id)
                  else next.add(project.id)
                  return next
                })
              }}
              className={cn(
                "group flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                active
                  ? "bg-foreground/[0.085] text-foreground"
                  : unavailable
                    ? "text-muted-foreground/45"
                    : "text-foreground/84 hover:bg-foreground/[0.055] hover:text-foreground",
              )}
            >
              {expanded ? (
                <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
              ) : (
                <Folder className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{project.name || fallbackName}</span>
              {count > 0 ? (
                <span className="grid min-w-6 place-items-center rounded-full bg-foreground/[0.08] px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {count > 99 ? "99+" : count}
                </span>
              ) : null}
            </button>
            {expanded ? (
              <div className="space-y-0.5 pl-8">
                {project.loadingSessions && sessions.length === 0 ? (
                  <div className="px-1 py-1.5 text-xs text-muted-foreground/70">Loading sessions…</div>
                ) : sessions.length === 0 ? (
                  <div className="px-1 py-1.5 text-xs text-muted-foreground/70">No sessions yet.</div>
                ) : (
                  sessions.map((session) => (
                    <button
                      key={session.id}
                      type="button"
                      onClick={() => onOpenProjectSession?.(project.id, session.id)}
                      className="flex min-h-8 w-full items-center gap-2 rounded-md px-1 py-1 text-left text-[13px] text-foreground/78 hover:bg-foreground/[0.045] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    >
                      <span className="min-w-0 flex-1 truncate">{session.title || "Untitled"}</span>
                      {session.updatedAt ? <span className="shrink-0 text-xs text-muted-foreground/70">{relativeSessionTime(session.updatedAt)}</span> : null}
                    </button>
                  ))
                )}
                {project.hasMoreSessions ? (
                  <button
                    type="button"
                    onClick={() => onShowMoreProjectSessions?.(project.id)}
                    className="rounded-md px-1 py-1 text-left text-[13px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  >
                    Show more
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function relativeSessionTime(value: string | number): string {
  const timestamp = typeof value === "number" ? value : Date.parse(value)
  if (!Number.isFinite(timestamp)) return ""
  const diffMs = Date.now() - timestamp
  if (diffMs < 60_000) return "now"
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 14) return `${days}d`
  const weeks = Math.floor(days / 7)
  if (weeks < 10) return `${weeks}w`
  return `${Math.floor(days / 30)}mo`
}

function PrimaryAction({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] font-medium text-foreground/82 transition-colors hover:bg-foreground/[0.055] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <span className="grid size-5 shrink-0 place-items-center text-muted-foreground" aria-hidden="true">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  )
}

/**
 * Collapsible section header with a rotating chevron. Matches the reference
 * shape: "Workspaces >" / "Chats >" — right-pointing chevron when collapsed,
 * rotating 90° to point down when expanded.
 */
function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section data-boring-workspace-part="app-left-pane-section" className="py-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70 transition-colors hover:bg-foreground/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <ChevronRight
          className={cn("h-3.5 w-3.5 shrink-0 transition-transform duration-150", open && "rotate-90")}
          strokeWidth={1.75}
          aria-hidden="true"
        />
        <span>{title}</span>
      </button>
      {open ? <div className="mt-0.5 space-y-1.5 pl-5">{children}</div> : null}
    </section>
  )
}

function SessionSubSection({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children)
  return (
    <div className="space-y-0.5">
      <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/50">
        {title}
      </div>
      <div className="space-y-0.5">
        {hasChildren ? children : <div className="px-2 py-1.5 text-xs text-muted-foreground/70">{empty}</div>}
      </div>
    </div>
  )
}

function AppSessionRow({
  session,
  state,
  pinned,
  onSwitch,
  onOpenAsPane,
  onTogglePinned,
}: {
  session: AppLeftPaneSession
  state: SessionRowState
  pinned: boolean
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
      // stage accepts CHAT_SESSION_DRAG_TYPE; see ChatPaneStageDock).
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(CHAT_SESSION_DRAG_TYPE, session.id)
        event.dataTransfer.setData("text/plain", title)
        event.dataTransfer.effectAllowed = "copyMove"
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        activate()
      }}
      className={cn(
        "group flex min-h-9 w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        state === "active"
          ? "border-[color:oklch(from_var(--accent)_l_c_h/0.28)] bg-[color:oklch(from_var(--accent)_l_c_h/0.10)] text-foreground"
          : state === "open"
            ? "border-border/45 bg-background/25 text-foreground/90 hover:bg-foreground/[0.04]"
            : "border-transparent text-foreground/78 hover:border-border/35 hover:bg-foreground/[0.055] hover:text-foreground",
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
      </span>
    </div>
  )
}
