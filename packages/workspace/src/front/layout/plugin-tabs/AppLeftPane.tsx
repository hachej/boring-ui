"use client"

import { useMemo, useSyncExternalStore, type ReactNode } from "react"
import { Clock3, MessageSquarePlus, Pin, Plug, Plus, Search, Sparkles } from "lucide-react"
import { cn } from "../../lib/utils"
import { useRegistry } from "../../registry"
import type { OpenPanelConfig, SurfaceShellSnapshot } from "../../chrome/artifact-surface/SurfaceShell"
import type { PanelConfig } from "../../registry/types"
import { isWorkspacePagePlacement } from "../../../shared/types/panel"

export interface AppLeftPaneSession {
  id: string
  title?: string | null
  updatedAt?: string | number
  turnCount?: number
}

export interface AppLeftPaneProps {
  appTitle?: string
  sessionTitle?: string
  topSlot?: ReactNode
  bottomSlot?: ReactNode
  sessions: AppLeftPaneSession[]
  activeSessionId?: string | null
  openSessionIds: readonly string[]
  pinnedSessionIds: readonly string[]
  surfaceSnapshot: SurfaceShellSnapshot
  skillsPanelId: string
  onCreateSession: () => void
  onOpenCommandPalette: () => void
  onSwitchSession: (id: string) => void
  onOpenSessionAsPane: (id: string) => void
  onToggleSessionPinned: (id: string) => void
  onOpenPlugins: (panel?: OpenPanelConfig) => void
  onOpenSkills: () => void
}

type SessionRowState = "normal" | "open" | "active"

export function AppLeftPane({
  appTitle,
  sessionTitle,
  topSlot,
  bottomSlot,
  sessions,
  activeSessionId,
  openSessionIds,
  pinnedSessionIds,
  surfaceSnapshot,
  skillsPanelId,
  onCreateSession,
  onOpenCommandPalette,
  onSwitchSession,
  onOpenSessionAsPane,
  onToggleSessionPinned,
  onOpenPlugins,
  onOpenSkills,
}: AppLeftPaneProps) {
  const panelRegistry = useRegistry()
  const panels = useSyncExternalStore(
    panelRegistry.subscribe,
    panelRegistry.getSnapshot,
    panelRegistry.getSnapshot,
  )
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
  const pluginPanel = useMemo(
    () => resolveCurrentPluginWorkspacePage(panels, surfaceSnapshot, skillsPanelId),
    [panels, skillsPanelId, surfaceSnapshot],
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
      className="flex h-full min-h-0 w-[268px] shrink-0 flex-col border-r border-border bg-[color:oklch(from_var(--background)_calc(l-0.012)_c_h)] text-sm"
      aria-label="App navigation"
    >
      <header className="flex shrink-0 items-start border-b border-border/60 py-3 pl-14 pr-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold tracking-tight text-foreground">{appTitle || "Boring UI"}</div>
          <div className="truncate text-[12px] text-muted-foreground">{sessionTitle || "New session"}</div>
          {topSlot ? <div className="mt-2 min-w-0">{topSlot}</div> : null}
        </div>
      </header>

      <nav className="shrink-0 space-y-1 border-b border-border/60 px-2 py-2" aria-label="Primary workspace actions">
        <PrimaryAction icon={<Plus className="h-4 w-4" />} label="New chat" onClick={onCreateSession} />
        <PrimaryAction icon={<Search className="h-4 w-4" />} label="Search" onClick={onOpenCommandPalette} />
        <PrimaryAction icon={<Plug className="h-4 w-4" />} label="Plugins" onClick={() => onOpenPlugins(pluginPanel)} />
        <PrimaryAction icon={<Sparkles className="h-4 w-4" />} label="Skills" onClick={onOpenSkills} />
      </nav>

      <div className="boring-scrollbar-discreet min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <SessionSection title="Pinned" empty="No pinned sessions yet.">
          {pinnedSessions.map((session) => renderSession(session, true))}
        </SessionSection>
        <SessionSection title="Sessions" empty="No sessions yet.">
          {regularSessions.map((session) => renderSession(session, false))}
        </SessionSection>
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

function SessionSection({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children)
  return (
    <section data-boring-workspace-part="app-left-pane-section" className="py-2">
      <div className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/60">
        {title}
      </div>
      <div className="space-y-0.5">
        {hasChildren ? children : <div className="px-2 py-2 text-xs text-muted-foreground/70">{empty}</div>}
      </div>
    </section>
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
        "group flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        state === "active"
          ? "bg-foreground/[0.09] text-foreground"
          : state === "open"
            ? "bg-foreground/[0.045] text-foreground/90 hover:bg-foreground/[0.07]"
            : "text-foreground/78 hover:bg-foreground/[0.055] hover:text-foreground",
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

function resolveCurrentPluginWorkspacePage(
  panels: readonly PanelConfig[],
  snapshot: SurfaceShellSnapshot,
  skillsPanelId: string,
): OpenPanelConfig | undefined {
  const workspacePages = panels.filter((panel) => (
    isWorkspacePagePlacement(panel.placement)
    && panel.id !== skillsPanelId
    && panel.source !== "core"
  ))
  if (workspacePages.length === 0) return undefined

  type ResolvedWorkspacePage = { panel: PanelConfig; tab?: SurfaceShellSnapshot["openTabs"][number] }
  const byComponent = new Map(workspacePages.map((panel) => [panel.id, panel]))
  const panelForTab = (tab: SurfaceShellSnapshot["openTabs"][number]): ResolvedWorkspacePage | undefined => {
    const panel = byComponent.get(tab.component ?? tab.id)
    return panel ? { panel, tab } : undefined
  }
  const activeTab = snapshot.activeTab
    ? snapshot.openTabs.find((tab) => tab.id === snapshot.activeTab)
    : undefined
  const active = activeTab ? panelForTab(activeTab) : undefined
  const lastOpen = [...snapshot.openTabs]
    .reverse()
    .map(panelForTab)
    .find((entry): entry is ResolvedWorkspacePage => Boolean(entry))
  const fallback: ResolvedWorkspacePage | undefined = workspacePages[0] ? { panel: workspacePages[0] } : undefined
  const resolved: ResolvedWorkspacePage | undefined = active ?? lastOpen ?? fallback
  return resolved ? {
    id: resolved.tab?.id ?? resolved.panel.id,
    component: resolved.panel.id,
    title: resolved.tab?.title ?? resolved.panel.title,
  } : undefined
}
