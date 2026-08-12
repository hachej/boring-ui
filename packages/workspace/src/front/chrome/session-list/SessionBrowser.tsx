"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, ExternalLink, Pin, Plus } from "lucide-react"
import { IconButton } from "@hachej/boring-ui-kit"
import { cn } from "../../lib/utils"
import { ControlTooltip } from "../../components/ControlTooltip"
import { useWorkspaceAttention, workspaceAttentionSessionBadgeForBlocker, type WorkspaceAttentionSessionBadge } from "../../attention/WorkspaceAttentionProvider"
import { CHAT_SESSION_DRAG_TYPE } from "../../layout/ChatPaneStage"
import type { SessionItem } from "../../components/SessionList"

const CHAT_SESSION_STATUS_EVENT = "boring:chat-session-status"

export interface SessionActivityIndicator {
  working: boolean
}

export type SessionActivityById = Record<string, SessionActivityIndicator | undefined>

/**
 * Session ids whose chat panel is currently streaming. Fed by the
 * "boring:chat-session-status" window event each mounted chat panel emits —
 * the browser stays decoupled from any particular chat implementation.
 */
function useWorkingSessionIds(): ReadonlySet<string> {
  const [working, setWorking] = useState<ReadonlySet<string>>(() => new Set())
  useEffect(() => {
    const onStatus = (event: Event) => {
      const detail = (event as CustomEvent).detail as { sessionId?: unknown; working?: unknown } | undefined
      if (typeof detail?.sessionId !== "string") return
      const sessionId = detail.sessionId
      const isWorking = detail.working === true
      setWorking((current) => {
        if (current.has(sessionId) === isWorking) return current
        const next = new Set(current)
        if (isWorking) next.add(sessionId)
        else next.delete(sessionId)
        return next
      })
    }
    window.addEventListener(CHAT_SESSION_STATUS_EVENT, onStatus)
    return () => window.removeEventListener(CHAT_SESSION_STATUS_EVENT, onStatus)
  }, [])
  return working
}

export interface SessionBrowserProps {
  sessions: SessionItem[]
  activeId?: string | null
  /** Session ids currently open as chat panes, in pane order. */
  openIds?: string[]
  /** Session ids the user pinned; surfaced in a Pinned section on top. */
  pinnedIds?: string[]
  onTogglePin?: (id: string) => void
  onSwitch?: (id: string) => void
  onOpenAsTab?: (id: string) => void
  onCreate?: () => void
  onDelete?: (id: string) => void
  onLoadMore?: () => void
  hasMore?: boolean
  loadingMore?: boolean
  sessionActivityById?: SessionActivityById
  onClose?: () => void
  className?: string
}

type Group = { key: string; label: string; items: SessionItem[] }

const DAY_MS = 24 * 60 * 60 * 1000

function toDate(value: SessionItem["updatedAt"]): Date | null {
  if (value === undefined || value === null) return null
  const d = typeof value === "number" ? new Date(value) : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function startOfDay(d: Date): number {
  const c = new Date(d)
  c.setHours(0, 0, 0, 0)
  return c.getTime()
}

function groupSessions(sessions: SessionItem[]): Group[] {
  const now = new Date()
  const today = startOfDay(now)
  const yesterday = today - DAY_MS
  const lastWeek = today - 7 * DAY_MS

  const todayItems: SessionItem[] = []
  const yesterdayItems: SessionItem[] = []
  const thisWeekItems: SessionItem[] = []
  const earlierItems: SessionItem[] = []
  const undatedItems: SessionItem[] = []

  for (const s of sessions) {
    const d = toDate(s.updatedAt)
    if (!d) {
      undatedItems.push(s)
      continue
    }
    const day = startOfDay(d)
    if (day >= today) todayItems.push(s)
    else if (day >= yesterday) yesterdayItems.push(s)
    else if (day >= lastWeek) thisWeekItems.push(s)
    else earlierItems.push(s)
  }

  const sortDesc = (a: SessionItem, b: SessionItem) => {
    const da = toDate(a.updatedAt)?.getTime() ?? 0
    const db = toDate(b.updatedAt)?.getTime() ?? 0
    return db - da
  }

  const groups: Group[] = []
  if (todayItems.length) groups.push({ key: "today", label: "Today", items: todayItems.sort(sortDesc) })
  if (yesterdayItems.length) groups.push({ key: "yesterday", label: "Yesterday", items: yesterdayItems.sort(sortDesc) })
  if (thisWeekItems.length) groups.push({ key: "week", label: "This week", items: thisWeekItems.sort(sortDesc) })
  if (earlierItems.length) groups.push({ key: "earlier", label: "Earlier", items: earlierItems.sort(sortDesc) })
  if (undatedItems.length) groups.push({ key: "undated", label: "Other", items: undatedItems })
  return groups
}

function sessionBadgeToneClassName(tone: WorkspaceAttentionSessionBadge["tone"]): string {
  switch (tone) {
    case "danger": return "bg-destructive/12 text-destructive"
    case "warning": return "bg-amber-500/12 text-amber-700 dark:text-amber-300"
    case "neutral": return "bg-foreground/[0.07] text-muted-foreground"
    default: return "bg-[color:var(--accent)]/12 text-[color:var(--accent)]"
  }
}

function sessionBadgeDotClassName(tone: WorkspaceAttentionSessionBadge["tone"]): string {
  switch (tone) {
    case "danger": return "bg-destructive"
    case "warning": return "bg-amber-500"
    case "neutral": return "bg-muted-foreground"
    default: return "bg-[color:var(--accent)]"
  }
}

function relativeTime(value: SessionItem["updatedAt"]): string {
  const d = toDate(value)
  if (!d) return ""
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return "now"
  const m = Math.floor(diff / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const days = Math.floor(h / 24)
  if (days < 7) return `${days}d`
  const w = Math.floor(days / 7)
  if (w < 5) return `${w}w`
  const mo = Math.floor(days / 30)
  if (mo < 12) return `${mo}mo`
  const y = Math.floor(days / 365)
  return `${y}y`
}

export function SessionBrowser({
  sessions,
  activeId,
  openIds,
  pinnedIds,
  onTogglePin,
  onSwitch,
  onOpenAsTab,
  onCreate,
  onDelete,
  onLoadMore,
  hasMore = false,
  loadingMore = false,
  sessionActivityById,
  onClose,
  className,
}: SessionBrowserProps) {
  // Pinned sessions sit in their own section on top, in pin order. Open
  // panes surface in "Active" (in pane order); everything else is history
  // grouped by recency. A session appears in only the highest-priority
  // section it qualifies for: Pinned > Active > History.
  const openSet = useMemo(() => new Set(openIds ?? []), [openIds])
  const pinnedSet = useMemo(() => new Set(pinnedIds ?? []), [pinnedIds])
  const pinnedSessions = useMemo(
    () => (pinnedIds ?? [])
      .map((id) => sessions.find((session) => session.id === id))
      .filter((session): session is SessionItem => Boolean(session)),
    [pinnedIds, sessions],
  )
  const activeSessions = useMemo(
    () => (openIds ?? [])
      .filter((id) => !pinnedSet.has(id))
      .map((id) => sessions.find((session) => session.id === id))
      .filter((session): session is SessionItem => Boolean(session)),
    [openIds, pinnedSet, sessions],
  )
  const historySessions = useMemo(
    () => (openSet.size > 0 || pinnedSet.size > 0
      ? sessions.filter((session) => !openSet.has(session.id) && !pinnedSet.has(session.id))
      : sessions),
    [openSet, pinnedSet, sessions],
  )
  const groups = useMemo(() => groupSessions(historySessions), [historySessions])
  const [pinnedCollapsed, setPinnedCollapsed] = useState(false)
  const [activeCollapsed, setActiveCollapsed] = useState(false)
  // History starts collapsed so the drawer leads with what's open; expands
  // on click. With no panes open there is no Active section, so history
  // shows by default to avoid an empty-looking drawer.
  const [historyCollapsed, setHistoryCollapsed] = useState(
    () => (openIds?.length ?? 0) > 0 || (pinnedIds?.length ?? 0) > 0,
  )
  const optimisticWorkingSessionIds = useWorkingSessionIds()
  const isSessionWorking = useCallback((sessionId: string) => {
    const activity = sessionActivityById?.[sessionId]
    return activity ? activity.working : optimisticWorkingSessionIds.has(sessionId)
  }, [optimisticWorkingSessionIds, sessionActivityById])
  const { blockers } = useWorkspaceAttention()
  const sessionBadges = useMemo(() => {
    const badges = new Map<string, WorkspaceAttentionSessionBadge>()
    for (const blocker of blockers) {
      if (!blocker.sessionId) continue
      const badge = workspaceAttentionSessionBadgeForBlocker(blocker)
      if (!badge) continue
      const existing = badges.get(blocker.sessionId)
      if (!existing || (badge.priority ?? 0) > (existing.priority ?? 0)) {
        badges.set(blocker.sessionId, badge)
      }
    }
    return badges
  }, [blockers])

  return (
    <div
      data-boring-workspace-part="session-list"
      className={cn(
        "flex h-full min-h-0 flex-col bg-[color:oklch(from_var(--background)_calc(l-0.01)_c_h)]",
        className,
      )}
      role="navigation"
      aria-label="Session history"
    >
      <div className="flex h-11 items-center justify-between border-b border-border/60 px-3.5">
        <span className="text-[12px] font-medium tracking-tight text-foreground/70">
          Sessions
        </span>
        <div className="flex items-center gap-0.5">
          {onCreate && (
            <ControlTooltip label="New chat" side="bottom">
              <IconButton type="button" variant="ghost" size="icon-xs" onClick={onCreate} aria-label="New session">
                <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
              </IconButton>
            </ControlTooltip>
          )}
          {onClose && (
            <ControlTooltip label="Close sessions" hint="⌘1" side="bottom">
              <IconButton type="button" variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close sessions">
                <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
              </IconButton>
            </ControlTooltip>
          )}
        </div>
      </div>

      <div className="boring-scrollbar-discreet flex-1 overflow-y-auto py-2.5">
        {sessions.length === 0 && (
          <div className="px-3 py-8 text-center text-[13px] text-muted-foreground">
            No sessions yet.
            <br />
            Start a new chat to begin.
          </div>
        )}

        {pinnedSessions.length > 0 && (
          <section data-boring-workspace-part="session-pinned-section">
            <SectionHeader
              label="Pinned"
              count={pinnedSessions.length}
              attentionCount={attentionCount(pinnedSessions, sessionBadges)}
              collapsed={pinnedCollapsed}
              onToggle={() => setPinnedCollapsed((value) => !value)}
            />
            {!pinnedCollapsed && (
              <ul role="list" className="flex flex-col">
                {pinnedSessions.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    active={session.id === activeId}
                    open={openSet.has(session.id)}
                    pinned
                    working={isSessionWorking(session.id)}
                    attentionBadge={sessionBadges.get(session.id)}
                    onSwitch={onSwitch}
                    onOpenAsTab={onOpenAsTab}
                    onTogglePin={onTogglePin}
                    onDelete={onDelete}
                  />
                ))}
              </ul>
            )}
          </section>
        )}

        {activeSessions.length > 0 && (
          <section data-boring-workspace-part="session-active-section" className={cn(pinnedSessions.length > 0 && "mt-3")}>
            <SectionHeader
              label="Active"
              count={activeSessions.length}
              attentionCount={attentionCount(activeSessions, sessionBadges)}
              collapsed={activeCollapsed}
              onToggle={() => setActiveCollapsed((value) => !value)}
            />
            {!activeCollapsed && (
              <ul role="list" className="flex flex-col">
                {activeSessions.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    active={session.id === activeId}
                    open
                    pinned={pinnedSet.has(session.id)}
                    working={isSessionWorking(session.id)}
                    attentionBadge={sessionBadges.get(session.id)}
                    onSwitch={onSwitch}
                    onOpenAsTab={onOpenAsTab}
                    onTogglePin={onTogglePin}
                    onDelete={onDelete}
                  />
                ))}
              </ul>
            )}
          </section>
        )}

        {groups.length > 0 && (
          <section
            data-boring-workspace-part="session-history-section"
            className={cn(activeSessions.length > 0 && "mt-3")}
          >
            <SectionHeader
              label="History"
              count={historySessions.length}
              attentionCount={attentionCount(historySessions, sessionBadges)}
              collapsed={historyCollapsed}
              onToggle={() => setHistoryCollapsed((value) => !value)}
            />
            {!historyCollapsed && (
              <>
                {groups.map((group, i) => (
                  <section key={group.key} className={cn(i > 0 && "mt-2")}>
                    <div className="flex items-baseline justify-between gap-2 px-5 pb-2 pt-2 text-[11px] font-medium tracking-tight text-muted-foreground/60">
                      <span>{group.label}</span>
                      <span aria-hidden="true" className="text-[10.5px] tabular-nums text-muted-foreground/40">{group.items.length}</span>
                    </div>
                    <ul role="list" className="flex flex-col">
                      {group.items.map((session) => (
                        <SessionRow
                          key={session.id}
                          session={session}
                          active={session.id === activeId}
                          open={false}
                          pinned={pinnedSet.has(session.id)}
                          working={isSessionWorking(session.id)}
                          attentionBadge={sessionBadges.get(session.id)}
                          onSwitch={onSwitch}
                          onOpenAsTab={onOpenAsTab}
                          onTogglePin={onTogglePin}
                          onDelete={onDelete}
                        />
                      ))}
                    </ul>
                  </section>
                ))}

                {hasMore && onLoadMore ? (
                  <div className="px-3 py-3">
                    <button
                      type="button"
                      onClick={onLoadMore}
                      disabled={loadingMore}
                      className="w-full rounded-md border border-border/60 px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-60"
                    >
                      {loadingMore ? "Loading…" : "Load more"}
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </section>
        )}
      </div>
    </div>
  )
}

function attentionCount(items: SessionItem[], badges: ReadonlyMap<string, WorkspaceAttentionSessionBadge>): number {
  return items.reduce((count, session) => count + (badges.has(session.id) ? 1 : 0), 0)
}

function SectionHeader({
  label,
  count,
  attentionCount = 0,
  collapsed,
  onToggle,
}: {
  label: string
  count: number
  attentionCount?: number
  collapsed: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      data-boring-workspace-part="session-section-toggle"
      className="flex w-full items-baseline justify-between gap-2 px-3.5 pb-2 pt-2 text-[11px] font-medium tracking-tight text-muted-foreground/75 transition-colors hover:text-foreground/80"
    >
      <span className="flex items-center gap-1">
        <ChevronRight
          aria-hidden="true"
          className={cn("h-3 w-3 transition-transform duration-150", !collapsed && "rotate-90")}
          strokeWidth={2}
        />
        {label}
        {attentionCount > 0 ? (
          <span
            data-boring-workspace-part="session-section-attention"
            data-boring-badge="attention-rollup"
            className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[color:var(--accent)]/12 px-1 text-[9.5px] font-semibold tabular-nums text-[color:var(--accent)]"
            aria-label={`${attentionCount} session${attentionCount === 1 ? "" : "s"} need attention`}
          >
            {attentionCount}
          </span>
        ) : null}
      </span>
      <span aria-hidden="true" className="text-[10.5px] tabular-nums text-muted-foreground/40">{count}</span>
    </button>
  )
}

function SessionRow({
  session,
  active,
  open,
  pinned,
  working,
  attentionBadge,
  onSwitch,
  onOpenAsTab,
  onTogglePin,
  onDelete,
}: {
  session: SessionItem
  active: boolean
  open: boolean
  pinned: boolean
  working: boolean
  attentionBadge?: WorkspaceAttentionSessionBadge
  onSwitch?: (id: string) => void
  onOpenAsTab?: (id: string) => void
  onTogglePin?: (id: string) => void
  onDelete?: (id: string) => void
}) {
  const time = relativeTime(session.updatedAt)
  const hasSessionStatus = Boolean(attentionBadge || working || time)
  return (
    <li
      role="listitem"
      data-boring-workspace-part="session-row"
      data-boring-state={active ? "selected" : undefined}
      className={cn(
        "group relative mx-2 mt-px flex items-center rounded-md px-2.5 py-1.5 text-[13px] transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
        "cursor-pointer hover:bg-foreground/[0.04]",
        active && "bg-foreground/[0.06] text-foreground",
      )}
      onClick={() => onSwitch?.(session.id)}
      // Rows can be dragged onto the chat stage to open the session as a
      // pane at the drop position (dock engine).
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(CHAT_SESSION_DRAG_TYPE, session.id)
        e.dataTransfer.setData("text/plain", session.title || session.id)
        e.dataTransfer.effectAllowed = "copyMove"
      }}
    >
      {open && (
        <span
          aria-hidden="true"
          data-boring-workspace-part="session-open-dot"
          className={cn(
            "mr-2 h-1.5 w-1.5 shrink-0 rounded-full",
            active ? "bg-foreground/70" : "bg-foreground/30",
          )}
        />
      )}
      <span className="min-w-0 flex-1 truncate leading-5" title={session.title}>
        <span className={cn(active ? "font-medium text-foreground" : "text-foreground/90")}>
          {session.title || "Untitled"}
        </span>
      </span>
      <span
        className={cn(
          "flex shrink-0 items-center transition-[margin] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
          hasSessionStatus || pinned ? "ml-2" : "ml-0 group-hover:ml-2 focus-within:ml-2",
        )}
      >
        {attentionBadge ? (
          <span
            data-boring-workspace-part="session-badge"
            data-boring-badge={attentionBadge.kind}
            className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none", sessionBadgeToneClassName(attentionBadge.tone))}
          >
            <span aria-hidden="true" className={cn("h-1.5 w-1.5 animate-pulse rounded-full", sessionBadgeDotClassName(attentionBadge.tone))} />
            {attentionBadge.label}
          </span>
        ) : working ? (
          <span
            data-boring-workspace-part="session-badge"
            data-boring-badge="working"
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-foreground/[0.07] px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground"
          >
            <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-[color:var(--accent)]" />
            working
          </span>
        ) : time ? (
          <span
            data-boring-workspace-part="session-age"
            className={cn(
              "shrink-0 tabular-nums text-[11px]",
              active ? "text-[color:var(--accent)]" : "text-muted-foreground/60",
            )}
          >
            {time}
          </span>
        ) : null}
        {onTogglePin ? (
          <span
            data-boring-workspace-part="session-pin-action"
            className={cn(
              "flex w-0 shrink-0 items-center overflow-hidden opacity-0 transition-[width,opacity,margin] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:w-auto group-hover:opacity-100 focus-within:w-auto focus-within:opacity-100",
              hasSessionStatus && "group-hover:ml-1.5 focus-within:ml-1.5",
              pinned && cn("w-auto opacity-100", hasSessionStatus && "ml-1.5"),
            )}
          >
            <ControlTooltip label={pinned ? "Unpin session" : "Pin session"}>
              <IconButton
                type="button"
                variant="ghost"
                size="icon-xs"
                data-boring-workspace-part="session-pin-toggle"
                data-boring-state={pinned ? "pinned" : undefined}
                className={cn(
                  "shrink-0 focus-visible:opacity-100",
                  pinned
                    ? "text-[color:var(--accent)] hover:text-[color:var(--accent)]"
                    : "text-muted-foreground/70 hover:text-foreground",
                )}
                onClick={(e) => {
                  e.stopPropagation()
                  onTogglePin(session.id)
                }}
                aria-label={pinned ? `Unpin ${session.title || "session"}` : `Pin ${session.title || "session"}`}
                aria-pressed={pinned}
              >
                <Pin className={cn("h-3.5 w-3.5", pinned && "fill-current")} strokeWidth={1.75} />
              </IconButton>
            </ControlTooltip>
          </span>
        ) : null}
        <span
          data-boring-workspace-part="session-actions"
          className={cn(
            "flex w-0 shrink-0 items-center gap-1 overflow-hidden opacity-0 transition-[width,opacity,margin] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:w-auto group-hover:opacity-100 focus-within:w-auto focus-within:opacity-100",
            (hasSessionStatus || onTogglePin) && "group-hover:ml-1 focus-within:ml-1",
          )}
        >
          {onOpenAsTab && (
            <ControlTooltip label="Open in chat pane">
              <IconButton
                type="button"
                variant="ghost"
                size="icon-xs"
                className="shrink-0 text-muted-foreground/70 hover:text-foreground focus-visible:opacity-100"
                onClick={(e) => {
                  e.stopPropagation()
                  onOpenAsTab(session.id)
                }}
                aria-label={`Open ${session.title || "session"} in chat pane`}
              >
                <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
              </IconButton>
            </ControlTooltip>
          )}
          {onDelete && (
            <ControlTooltip label="Delete session">
              <IconButton
                type="button"
                variant="ghost"
                size="icon-xs"
                className="shrink-0 text-muted-foreground hover:text-destructive focus-visible:opacity-100"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(session.id)
                }}
                aria-label={`Delete ${session.title || "session"}`}
              >
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" />
                </svg>
              </IconButton>
            </ControlTooltip>
          )}
        </span>
      </span>
    </li>
  )
}
