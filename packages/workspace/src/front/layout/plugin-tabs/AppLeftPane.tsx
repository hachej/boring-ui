"use client"

import { useMemo, useState, type ReactNode } from "react"
import { ChevronRight, Clock3, MessageSquarePlus, Pin, Plug, Plus, Search, Sparkles } from "lucide-react"
import { cn } from "../../lib/utils"

export interface AppLeftPaneSession {
  id: string
  title?: string | null
  updatedAt?: string | number
  turnCount?: number
}

export interface AppLeftPaneProps {
  width?: number
  appTitle?: string
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
  onOpenPlugins: () => void
  onOpenSkills: () => void

}

type SessionRowState = "normal" | "open" | "active"

export function AppLeftPane({
  width = 268,
  appTitle,
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
  onOpenPlugins,
  onOpenSkills,
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
      {/* Top row: current project label (or host topSlot). The fixed-position
          app-nav collapse/expand button is rendered by PluginTabsWorkspaceShell
          at the same x/y in both states, so reserve the same quiet leading
          space here instead of moving the button into this row. */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 py-2 pl-11 pr-2">
        <div className="min-w-0 flex-1">
          {topSlot ? (
            topSlot
          ) : (
            <span className="truncate px-1 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
              {appTitle || "Boring UI"}
            </span>
          )}
        </div>
      </div>

      <nav className="shrink-0 space-y-1 border-b border-border/60 px-2 py-2" aria-label="Primary workspace actions">
        <PrimaryAction icon={<Plus className="h-4 w-4" strokeWidth={1.75} />} label="New chat" onClick={onCreateSession} />
        <PrimaryAction icon={<Search className="h-4 w-4" strokeWidth={1.75} />} label="Search" onClick={onOpenCommandPalette} />
        <PrimaryAction icon={<Plug className="h-4 w-4" strokeWidth={1.75} />} label="Plugins" onClick={onOpenPlugins} />
        <PrimaryAction icon={<Sparkles className="h-4 w-4" strokeWidth={1.75} />} label="Skills" onClick={onOpenSkills} />
      </nav>

      <div className="boring-scrollbar-discreet min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <CollapsibleSection title="Workspaces" defaultOpen={false}>
          <div className="flex min-h-9 w-full items-center gap-2 rounded-lg bg-foreground/[0.06] px-2.5 py-1.5 text-[13px] font-medium text-foreground">
            <span className="truncate">{appTitle || "Boring UI"}</span>
          </div>
        </CollapsibleSection>
        <CollapsibleSection title="Chats" defaultOpen>
          <SessionSubSection title="Pinned" empty="No pinned sessions yet.">
            {pinnedSessions.map((session) => renderSession(session, true))}
          </SessionSubSection>
          <SessionSubSection title="Sessions" empty="No sessions yet.">
            {regularSessions.map((session) => renderSession(session, false))}
          </SessionSubSection>
        </CollapsibleSection>
      </div>

      {bottomSlot ? <footer className="shrink-0 border-t border-border/60 p-2">{bottomSlot}</footer> : null}
    </aside>
  )
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
