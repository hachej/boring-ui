"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ChevronRight, Plus } from "lucide-react"
import { IconButton } from "@hachej/boring-ui-kit"
import { cn } from "../../lib/utils"
import { ControlTooltip } from "../../components/ControlTooltip"
import type { SessionItem } from "../../components/SessionList"
import { SessionRow, groupSessions } from "../session-list/SessionBrowser"

/**
 * WorkspaceProjectsNav — the persistent left bar that lists workspaces as
 * "Projects" and nests each project's chat sessions inline on expand. It is a
 * pure presentational component: it owns expand/collapse state and rendering,
 * the host supplies the project list, the per-project session data, and all
 * navigation/lifecycle callbacks. That keeps the workspace package free of any
 * value import from core/agent (architectural invariant #7) while letting both
 * the authed full-app and the CLI hub reuse the exact same nav.
 *
 * Single workspace degrades to a flat, time-grouped session list with no
 * "Projects" tree — the folder layer only earns its keep with 2+ projects.
 */

export type ProjectRuntimeStatus = "running" | "starting" | "idle"

export interface NavProject {
  id: string
  name: string
  /** Trailing session count; shown muted on the project row. */
  sessionCount?: number
  /** Runtime state, surfaced as a small status dot. Often only known for the
   * active project (we don't boot cold sandboxes just to colour a dot). */
  status?: ProjectRuntimeStatus
}

export interface ProjectSessionsState {
  sessions: SessionItem[]
  loading?: boolean
  error?: boolean
  hasMore?: boolean
  loadingMore?: boolean
}

export interface WorkspaceProjectsNavProps {
  projects: NavProject[]
  activeProjectId?: string | null
  /** Per-project session data, filled by the host in response to
   * onExpandProject. Keyed by project id. */
  projectSessions?: Record<string, ProjectSessionsState | undefined>
  /** Session ids open as panes in the active project (in pane order). */
  openSessionIds?: string[]
  activeSessionId?: string | null
  /** Live status for the active project's sessions only. */
  workingSessionIds?: ReadonlySet<string>
  needsInputSessionIds?: ReadonlySet<string>

  onExpandProject?: (projectId: string) => void
  onCollapseProject?: (projectId: string) => void
  /** Open a session — the host opens it immediately and boots its workspace in
   * the background (no blocking switch screen). */
  onOpenSession?: (projectId: string, sessionId: string) => void
  onDeleteSession?: (projectId: string, sessionId: string) => void
  onNewChat?: (projectId: string) => void
  onLoadMoreSessions?: (projectId: string) => void
  onNewProject?: () => void

  /** Persist the expanded-project set across reloads. */
  expandedStorageKey?: string
  /** Account row, pinned to the bottom. */
  footer?: React.ReactNode
  className?: string
}

function readExpanded(key: string | undefined): string[] {
  if (!key || typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(key)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []
  } catch {
    return []
  }
}

export function WorkspaceProjectsNav({
  projects,
  activeProjectId,
  projectSessions,
  openSessionIds,
  activeSessionId,
  workingSessionIds,
  needsInputSessionIds,
  onExpandProject,
  onCollapseProject,
  onOpenSession,
  onDeleteSession,
  onNewChat,
  onLoadMoreSessions,
  onNewProject,
  expandedStorageKey,
  footer,
  className,
}: WorkspaceProjectsNavProps) {
  const single = projects.length === 1
  const soleProject = single ? projects[0] : undefined

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(readExpanded(expandedStorageKey)))
  // The active project is always expanded — opening it should never bury its
  // sessions one click away. Done as an effect (not in state init) so it tracks
  // workspace switches without remounting the nav.
  useEffect(() => {
    if (!activeProjectId) return
    setExpanded((current) => {
      if (current.has(activeProjectId)) return current
      const next = new Set(current)
      next.add(activeProjectId)
      return next
    })
    onExpandProject?.(activeProjectId)
    // onExpandProject is intentionally not a dep — it only fires on id change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId])

  // Degrade mode loads the sole project's sessions on mount.
  useEffect(() => {
    if (soleProject) onExpandProject?.(soleProject.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soleProject?.id])

  useEffect(() => {
    if (!expandedStorageKey || typeof window === "undefined") return
    window.localStorage.setItem(expandedStorageKey, JSON.stringify([...expanded]))
  }, [expanded, expandedStorageKey])

  const toggleProject = useCallback(
    (id: string) => {
      setExpanded((current) => {
        const next = new Set(current)
        if (next.has(id)) {
          next.delete(id)
          onCollapseProject?.(id)
        } else {
          next.add(id)
          onExpandProject?.(id)
        }
        return next
      })
    },
    [onCollapseProject, onExpandProject],
  )

  const openSet = useMemo(() => new Set(openSessionIds ?? []), [openSessionIds])

  return (
    <div
      data-boring-workspace-part="workspace-nav"
      className={cn(
        "flex h-full min-h-0 flex-col bg-[color:oklch(from_var(--background)_calc(l-0.01)_c_h)]",
        className,
      )}
      role="navigation"
      aria-label={single ? "Chats" : "Projects"}
    >
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border/60 px-3.5">
        <span className="text-[12px] font-medium tracking-tight text-foreground/70">
          {single ? "Chats" : "Projects"}
        </span>
        <div className="flex items-center gap-0.5">
          {single
            ? onNewChat && soleProject && (
                <ControlTooltip label="New chat" side="bottom">
                  <IconButton
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => onNewChat(soleProject.id)}
                    aria-label="New chat"
                  >
                    <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </IconButton>
                </ControlTooltip>
              )
            : onNewProject && (
                <ControlTooltip label="New project" side="bottom">
                  <IconButton
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={onNewProject}
                    aria-label="New project"
                  >
                    <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </IconButton>
                </ControlTooltip>
              )}
        </div>
      </div>

      <div className="boring-scrollbar-discreet min-h-0 flex-1 overflow-y-auto py-2.5">
        {projects.length === 0 ? (
          <EmptyProjects onNewProject={onNewProject} />
        ) : single && soleProject ? (
          <FlatSessions
            state={projectSessions?.[soleProject.id]}
            activeSessionId={activeSessionId}
            openSet={openSet}
            workingSessionIds={workingSessionIds}
            needsInputSessionIds={needsInputSessionIds}
            onOpen={(sessionId) => onOpenSession?.(soleProject.id, sessionId)}
            onDelete={onDeleteSession ? (sessionId) => onDeleteSession(soleProject.id, sessionId) : undefined}
            onNewChat={onNewChat ? () => onNewChat(soleProject.id) : undefined}
            onRetry={() => onExpandProject?.(soleProject.id)}
            onLoadMore={onLoadMoreSessions ? () => onLoadMoreSessions(soleProject.id) : undefined}
          />
        ) : (
          <ul role="list" className="flex flex-col">
            {projects.map((project) => {
              const isActive = project.id === activeProjectId
              return (
                <ProjectRow
                  key={project.id}
                  project={project}
                  active={isActive}
                  expanded={expanded.has(project.id)}
                  state={projectSessions?.[project.id]}
                  // Live session state only applies to the active project.
                  activeSessionId={isActive ? activeSessionId : undefined}
                  openSet={isActive ? openSet : EMPTY_SET}
                  workingSessionIds={isActive ? workingSessionIds : undefined}
                  needsInputSessionIds={isActive ? needsInputSessionIds : undefined}
                  onToggle={() => toggleProject(project.id)}
                  onOpen={(sessionId) => onOpenSession?.(project.id, sessionId)}
                  onDelete={onDeleteSession ? (sessionId) => onDeleteSession(project.id, sessionId) : undefined}
                  onNewChat={onNewChat ? () => onNewChat(project.id) : undefined}
                  onRetry={() => onExpandProject?.(project.id)}
                  onLoadMore={onLoadMoreSessions ? () => onLoadMoreSessions(project.id) : undefined}
                />
              )
            })}
          </ul>
        )}
      </div>

      {footer ? (
        <div
          data-boring-workspace-part="workspace-nav-footer"
          className="shrink-0 border-t border-border/60"
        >
          {footer}
        </div>
      ) : null}
    </div>
  )
}

const EMPTY_SET: ReadonlySet<string> = new Set()

function StatusDot({ status }: { status?: ProjectRuntimeStatus }) {
  if (!status || status === "idle") return null
  return (
    <span
      aria-hidden="true"
      data-boring-workspace-part="project-status-dot"
      data-status={status}
      className={cn(
        "h-1.5 w-1.5 shrink-0 rounded-full",
        status === "running" && "bg-[color:oklch(0.72_0.17_150)]",
        status === "starting" && "animate-pulse bg-[color:var(--accent)]",
      )}
    />
  )
}

function ProjectRow({
  project,
  active,
  expanded,
  state,
  activeSessionId,
  openSet,
  workingSessionIds,
  needsInputSessionIds,
  onToggle,
  onOpen,
  onDelete,
  onNewChat,
  onRetry,
  onLoadMore,
}: {
  project: NavProject
  active: boolean
  expanded: boolean
  state?: ProjectSessionsState
  activeSessionId?: string | null
  openSet: ReadonlySet<string>
  workingSessionIds?: ReadonlySet<string>
  needsInputSessionIds?: ReadonlySet<string>
  onToggle: () => void
  onOpen: (sessionId: string) => void
  onDelete?: (sessionId: string) => void
  onNewChat?: () => void
  onRetry: () => void
  onLoadMore?: () => void
}) {
  const count = project.sessionCount ?? state?.sessions.length
  return (
    <li role="listitem" data-boring-workspace-part="project" data-boring-state={active ? "selected" : undefined}>
      <div
        className={cn(
          "group/proj relative mx-2 mt-px flex items-center gap-1.5 rounded-md py-1.5 pl-1.5 pr-2 text-[13px]",
          "cursor-pointer transition-colors hover:bg-foreground/[0.04]",
          active && "bg-foreground/[0.06]",
        )}
        onClick={onToggle}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`${project.name}${count !== undefined ? `, ${count} chats` : ""}`}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            onToggle()
          }
        }}
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground/55 transition-transform duration-150 motion-reduce:transition-none",
            expanded && "rotate-90",
          )}
          strokeWidth={2}
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate leading-5",
            active ? "font-medium text-foreground" : "text-foreground/90",
          )}
          title={project.name}
        >
          {project.name}
        </span>
        <StatusDot status={project.status} />
        {onNewChat ? (
          <ControlTooltip label="New chat" side="bottom">
            <IconButton
              type="button"
              variant="ghost"
              size="icon-xs"
              // Reveal reserves nothing: hidden (display:none, no layout space)
              // until the row is hovered or focused — then it takes the count's
              // slot, so the two never co-occupy and nothing shifts.
              className="hidden shrink-0 text-muted-foreground/70 hover:text-foreground group-hover/proj:inline-flex group-focus-within/proj:inline-flex"
              onClick={(e) => {
                e.stopPropagation()
                onNewChat()
              }}
              aria-label={`New chat in ${project.name}`}
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
            </IconButton>
          </ControlTooltip>
        ) : null}
        {count !== undefined && count > 0 ? (
          <span
            aria-hidden="true"
            className={cn(
              "shrink-0 tabular-nums text-[10.5px] text-muted-foreground/45",
              // The hover/focus "+" takes this slot's place.
              onNewChat && "group-hover/proj:hidden group-focus-within/proj:hidden",
            )}
          >
            {count}
          </span>
        ) : null}
      </div>

      {/* Animate reveal via grid-template-rows (0fr→1fr) — never height. */}
      <div
        className="grid transition-[grid-template-rows] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
        style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="ml-[18px] border-l border-border/50 py-0.5 pl-1">
            {expanded ? (
              <ProjectSessions
                state={state}
                activeSessionId={activeSessionId}
                openSet={openSet}
                workingSessionIds={workingSessionIds}
                needsInputSessionIds={needsInputSessionIds}
                onOpen={onOpen}
                onDelete={onDelete}
                onNewChat={onNewChat}
                onRetry={onRetry}
                onLoadMore={onLoadMore}
              />
            ) : null}
          </div>
        </div>
      </div>
    </li>
  )
}

function ProjectSessions({
  state,
  activeSessionId,
  openSet,
  workingSessionIds,
  needsInputSessionIds,
  onOpen,
  onDelete,
  onNewChat,
  onRetry,
  onLoadMore,
}: {
  state?: ProjectSessionsState
  activeSessionId?: string | null
  openSet: ReadonlySet<string>
  workingSessionIds?: ReadonlySet<string>
  needsInputSessionIds?: ReadonlySet<string>
  onOpen: (sessionId: string) => void
  onDelete?: (sessionId: string) => void
  onNewChat?: () => void
  onRetry: () => void
  onLoadMore?: () => void
}) {
  const sessions = state?.sessions ?? []

  if (state?.loading && sessions.length === 0) {
    return <NestedNote>Loading…</NestedNote>
  }
  if (state?.error && sessions.length === 0) {
    return (
      <NestedNote>
        Couldn’t load ·{" "}
        <button type="button" onClick={onRetry} className="text-foreground/80 underline-offset-2 hover:underline">
          Retry
        </button>
      </NestedNote>
    )
  }
  if (sessions.length === 0) {
    return (
      <NestedNote>
        No chats yet
        {onNewChat ? (
          <>
            {" · "}
            <button type="button" onClick={onNewChat} className="text-foreground/80 underline-offset-2 hover:underline">
              Start one
            </button>
          </>
        ) : null}
      </NestedNote>
    )
  }

  return (
    <>
      <ul role="list" className="flex flex-col">
        {sessions.map((session) => (
          <SessionRow
            key={session.id}
            session={session}
            active={session.id === activeSessionId}
            open={openSet.has(session.id)}
            pinned={false}
            working={workingSessionIds?.has(session.id) ?? false}
            needsInput={needsInputSessionIds?.has(session.id) ?? false}
            onSwitch={onOpen}
            onDelete={onDelete}
          />
        ))}
      </ul>
      {state?.hasMore && onLoadMore ? (
        <div className="px-2 py-1.5">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={state.loadingMore}
            className="text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-60"
          >
            {state.loadingMore ? "Loading…" : "Show more"}
          </button>
        </div>
      ) : null}
    </>
  )
}

/** Single-workspace mode: a flat, time-grouped list with no folder tree. */
function FlatSessions({
  state,
  activeSessionId,
  openSet,
  workingSessionIds,
  needsInputSessionIds,
  onOpen,
  onDelete,
  onNewChat,
  onRetry,
  onLoadMore,
}: {
  state?: ProjectSessionsState
  activeSessionId?: string | null
  openSet: ReadonlySet<string>
  workingSessionIds?: ReadonlySet<string>
  needsInputSessionIds?: ReadonlySet<string>
  onOpen: (sessionId: string) => void
  onDelete?: (sessionId: string) => void
  onNewChat?: () => void
  onRetry: () => void
  onLoadMore?: () => void
}) {
  const sessions = state?.sessions ?? []
  const groups = useMemo(() => groupSessions(sessions), [sessions])

  if (state?.loading && sessions.length === 0) {
    return <div className="px-3.5"><NestedNote>Loading…</NestedNote></div>
  }
  if (state?.error && sessions.length === 0) {
    return (
      <div className="px-3.5">
        <NestedNote>
          Couldn’t load ·{" "}
          <button type="button" onClick={onRetry} className="text-foreground/80 underline-offset-2 hover:underline">
            Retry
          </button>
        </NestedNote>
      </div>
    )
  }
  if (sessions.length === 0) {
    return (
      <div className="px-3 py-8 text-center text-[13px] text-muted-foreground">
        No chats yet.
        <br />
        Start a new chat to begin.
      </div>
    )
  }

  return (
    <>
      {groups.map((group, i) => (
        <section key={group.key} className={cn(i > 0 && "mt-2")}>
          <div className="flex items-baseline justify-between gap-2 px-3.5 pb-1.5 pt-2 text-[11px] font-medium tracking-tight text-muted-foreground/60">
            <span>{group.label}</span>
            <span aria-hidden="true" className="text-[10.5px] tabular-nums text-muted-foreground/40">
              {group.items.length}
            </span>
          </div>
          <ul role="list" className="flex flex-col">
            {group.items.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                active={session.id === activeSessionId}
                open={openSet.has(session.id)}
                pinned={false}
                working={workingSessionIds?.has(session.id) ?? false}
                needsInput={needsInputSessionIds?.has(session.id) ?? false}
                onSwitch={onOpen}
                onDelete={onDelete}
              />
            ))}
          </ul>
        </section>
      ))}
      {state?.hasMore && onLoadMore ? (
        <div className="px-3 py-3">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={state.loadingMore}
            className="w-full rounded-md border border-border/60 px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-60"
          >
            {state.loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      ) : null}
    </>
  )
}

function NestedNote({ children }: { children: React.ReactNode }) {
  return <div className="px-2.5 py-1.5 text-[12px] leading-5 text-muted-foreground/70">{children}</div>
}

function EmptyProjects({ onNewProject }: { onNewProject?: () => void }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="text-[13px] text-muted-foreground">No projects yet.</p>
      {onNewProject ? (
        <button
          type="button"
          onClick={onNewProject}
          className="mt-3 rounded-md border border-border/60 px-2.5 py-1.5 text-[12px] font-medium text-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
        >
          Create your first project
        </button>
      ) : null}
    </div>
  )
}
