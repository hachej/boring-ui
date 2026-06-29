"use client"

import { useState, type ReactNode } from "react"
import { ChevronRight, ExternalLink, MessageSquarePlus, MoreHorizontal, Pin, PinOff, Plus, Settings } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@hachej/boring-ui-kit"
import { cn } from "../../lib/utils"
import { AppSessionRow } from "./AppLeftPaneSessionRow"
import type { AppLeftPaneProject, AppLeftPaneProjectSession } from "./AppLeftPane"

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

export function usePinnedProjectIds(): [readonly string[], (projectId: string) => void] {
  const [pinnedProjectIds, setPinnedProjectIds] = useState<readonly string[]>(() => readPinnedProjectIds())
  const togglePinnedProject = (projectId: string) => setPinnedProjectIds((current) => {
    const next = current.includes(projectId) ? current.filter((id) => id !== projectId) : [...current, projectId]
    writePinnedProjectIds(next)
    return next
  })
  return [pinnedProjectIds, togglePinnedProject]
}

export function ProjectOverview({
  projects,
  activeProjectId,
  fallbackName,
  expandedIds,
  onToggleExpanded,
  pinnedProjectIds,
  onTogglePinnedProject,
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
