"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { ChevronRight, ExternalLink, MessageSquarePlus, MoreHorizontal, Pencil, Pin, PinOff, Plus, Settings } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Skeleton,
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
  onRenameProject,
  renderProjectSession,
  leadingIcon,
  allowPinning = true,
  compactTree = false,
  attentionTone = "accent",
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
  onRenameProject?: (projectId: string, name: string) => void
  renderProjectSession?: (project: AppLeftPaneProject, session: AppLeftPaneProjectSession) => ReactNode
  leadingIcon?: (project: AppLeftPaneProject) => ReactNode
  allowPinning?: boolean
  compactTree?: boolean
  /**
   * Colour of the collapsed-header "waiting" rollup. Amber is the pane-wide
   * language for "a human is blocking" (the Needs you band, the Agent card
   * rollup, the row badge); accent is the shipped project-tree look.
   */
  attentionTone?: "accent" | "amber"
}) {
  const activeId = activeProjectId ?? projects[0]?.id ?? null

  return (
    <div className="space-y-0.5">
      {/* Every list on this surface tiebreaks its key with the row index: the
          host supplies projects and their chats, and nothing upstream promises
          the ids are unique. A duplicate id makes React reconcile two rows as
          one, and the expanded/pinned state lands on the wrong project. */}
      {projects.map((project, index) => (
        <ProjectRow
          key={`${project.id}\u0000${index}`}
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
          onRename={onRenameProject}
          renderProjectSession={renderProjectSession}
          leadingIcon={leadingIcon?.(project)}
          createControl={undefined}
          allowPinning={allowPinning}
          compactTree={compactTree}
          attentionTone={attentionTone}
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
  onRename,
  renderProjectSession,
  leadingIcon,
  createControl,
  allowPinning,
  compactTree,
  attentionTone,
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
  onRename?: (projectId: string, name: string) => void
  renderProjectSession?: (project: AppLeftPaneProject, session: AppLeftPaneProjectSession) => ReactNode
  leadingIcon?: ReactNode
  createControl?: ReactNode
  allowPinning: boolean
  compactTree: boolean
  attentionTone: "accent" | "amber"
}) {
  // Keep the hover actions visible while the "•••" menu is open, even if the
  // pointer has moved into the (portaled) menu.
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameDraft, setRenameDraft] = useState("")
  const [renameError, setRenameError] = useState(false)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const disclosureRef = useRef<HTMLButtonElement>(null)
  const sessions = project.sessions ?? []
  // Badge shows sessions that NEED ATTENTION (blocked / awaiting input), not the
  // total session count — a quiet list with a loud "you have N waiting" signal.
  const blocked = project.blockedCount ?? 0
  const unavailable = project.available === false
  const name = project.name || fallbackName
  const moreItems = Boolean(allowPinning || onRename || onCreateSession || onOpenSettings || onOpenInNewTab)
  const hasActions = moreItems
  useEffect(() => {
    if (!renaming) return
    const frame = requestAnimationFrame(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [renaming])
  const finishRename = (restoreFocus: boolean) => {
    setRenaming(false)
    setRenameDraft("")
    setRenameError(false)
    if (restoreFocus) requestAnimationFrame(() => disclosureRef.current?.focus())
  }
  const commitRename = (restoreFocus: boolean) => {
    const nextName = renameDraft.trim()
    if (!nextName) {
      if (restoreFocus) setRenameError(true)
      else finishRename(false)
      return
    }
    if (nextName !== name) onRename?.(project.id, nextName)
    finishRename(restoreFocus)
  }

  return (
    <div className="space-y-0.5">
      {/* The row is a plain container — the chevron, name, and actions are each
          their own button, so nested-interactive clicks never fight a wrapping
          handler (an earlier role="button" wrapper swallowed the "•••" click and
          switched projects). */}
      <div
        className={cn(
          "app-left-project-row group relative flex min-h-8 w-full items-center gap-2 rounded-md py-1 pl-2 pr-2 transition-colors",
          active
            ? compactTree ? "text-foreground" : "bg-foreground/[0.07] text-foreground"
            : unavailable
              ? "text-muted-foreground/45"
              : "text-foreground/82 hover:bg-foreground/[0.05] hover:text-foreground",
        )}
      >
        {renaming ? (
          <>
            <button
              type="button"
              aria-label={expanded ? `Collapse ${name}` : `Expand ${name}`}
              aria-expanded={expanded}
              onClick={onToggleExpanded}
              className="app-left-project-disclosure-action grid h-5 w-5 shrink-0 place-items-center self-stretch rounded text-muted-foreground/55 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <ChevronRight className={cn("h-3.5 w-3.5 transition-transform duration-150", expanded && "rotate-90")} strokeWidth={2} aria-hidden="true" />
            </button>
            {leadingIcon ? <span className="grid size-4 shrink-0 place-items-center text-muted-foreground/70" aria-hidden="true">{leadingIcon}</span> : null}
            <input
              ref={renameInputRef}
              aria-label={`Rename ${name}`}
              aria-invalid={renameError || undefined}
              title={renameError ? "Project name cannot be empty" : undefined}
              value={renameDraft}
              onChange={(event) => {
                setRenameDraft(event.target.value)
                if (renameError) setRenameError(false)
              }}
              onBlur={() => commitRename(false)}
              onKeyDown={(event) => {
                if (event.key === "Enter") { event.preventDefault(); commitRename(true) }
                if (event.key === "Escape") { event.preventDefault(); finishRename(true) }
              }}
              className={cn(
                "h-6 min-w-0 flex-1 rounded border bg-background px-1.5 text-[13px] font-medium text-foreground outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring/50",
                renameError ? "border-destructive" : "border-border/70",
              )}
            />
            {renameError ? <span className="sr-only" role="alert">Project name cannot be empty.</span> : null}
          </>
        ) : (
          <button
            ref={disclosureRef}
            type="button"
            aria-label={expanded ? `Collapse ${name}` : `Expand ${name}`}
            aria-expanded={expanded}
            aria-current={active ? "page" : undefined}
            data-boring-mobile-dismiss="true"
            disabled={unavailable}
            onClick={() => { if (!unavailable) onActivate() }}
            className="flex min-w-0 flex-1 self-stretch items-center gap-2 rounded text-left text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-default"
          >
            <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground/55 transition-transform duration-150", expanded && "rotate-90")} strokeWidth={2} aria-hidden="true" />
            {leadingIcon ? <span className="grid size-4 shrink-0 place-items-center text-muted-foreground/70" aria-hidden="true">{leadingIcon}</span> : null}
            <span className="min-w-0 flex-1 truncate">{name}</span>
          </button>
        )}
        {/*
          The waiting rollup is the ONE thing this header exists to shout, so it
          is NOT in the layer the hover actions replace. It used to be: an
          absolutely-positioned overlay that faded to 0 on hover, so pointing at
          a collapsed Project destroyed the only signal telling you it had a
          chat waiting on you — at exactly the moment you were about to act on
          it. It is a static sibling now, and the actions render BESIDE it.
        */}
        {blocked > 0 ? (
          <span
            data-boring-workspace-part="app-left-project-attention"
            title={`${blocked} session${blocked === 1 ? "" : "s"} waiting`}
            className={cn(
              // Dot + number, the same mark the Agent card uses, so a rollup
              // means one thing in this pane whatever is grouping the list.
              "app-left-project-status pointer-events-none flex shrink-0 items-center gap-0.5 pl-1 text-[10px] font-medium tabular-nums leading-4",
              attentionTone === "amber" ? "text-[color:var(--attention)]" : "text-[color:var(--accent)]",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "size-1.5 rounded-full",
                attentionTone === "amber" ? "bg-[color:var(--attention)]" : "bg-[color:var(--accent)]",
              )}
            />
            {blocked > 99 ? "99+" : blocked}
          </span>
        ) : null}
        {/* Right slot: reserves width so the name truncates and never sits
            under the icons. */}
        <span className={cn("app-left-project-status-slot relative flex h-6 shrink-0 items-center justify-end", compactTree || createControl ? "w-6" : "w-[3.25rem]")}>
          {hasActions ? (
            <span className={cn(
              // The size and the touch behaviour of these two live in
              // globals.css beside the session-row rules, under the same
              // condition. Carrying a Tailwind `size-6` here instead is what
              // left them 24px and invisible-but-clickable on touch, with the
              // "N waiting" badge painted directly over their hit area.
              "app-left-project-actions flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100",
              menuOpen && "opacity-100",
            )}>
              {onCreateSession ? (
                <button
                  type="button"
                  aria-label={`New chat in ${name}`}
                  title="New chat"
                  data-boring-mobile-dismiss="true"
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
                  <DropdownMenuContent data-boring-workspace-part="app-left-menu" align="end" sideOffset={6} className="w-48 border-border/50 shadow-[0_12px_28px_-6px_rgba(0,0,0,0.55)]">
                    {onRename ? (
                      <DropdownMenuItem
                        onSelect={() => {
                          setRenameDraft(name)
                          setRenaming(true)
                        }}
                        className="gap-2 text-[13px]"
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        Rename project
                      </DropdownMenuItem>
                    ) : null}
                    {/* Independent capabilities, not alternatives. These were
                        an else-if chain, so ANY project that could be renamed
                        could never be pinned — the Pin item was unreachable on
                        every surface that passes onRenameProject. */}
                    {allowPinning ? (
                      <DropdownMenuItem onSelect={onTogglePinned} className="gap-2 text-[13px]">
                        {pinned ? <PinOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Pin className="h-3.5 w-3.5" aria-hidden="true" />}
                        {pinned ? "Unpin project" : "Pin project"}
                      </DropdownMenuItem>
                    ) : null}
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
        {createControl}
      </div>
      {expanded ? (
        <div className={cn("space-y-0.5", compactTree ? "pl-3" : "pl-6")}>
          {project.loadingSessions && sessions.length === 0 ? (
            <div className="space-y-1 px-1 py-1.5" role="status" aria-live="polite" aria-label={`Loading chats in ${name}`}>
              <div className="space-y-1" aria-hidden="true">
                <Skeleton className="h-6 w-full rounded-md" />
                <Skeleton className="h-6 w-3/4 rounded-md" />
              </div>
            </div>
          ) : sessions.length === 0 ? (
            <div className="px-1 py-1.5 text-xs text-muted-foreground">No chats yet.</div>
          ) : (
            sessions.map((session, index) => (
              <div key={`${session.id}\u0000${index}`}>
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
