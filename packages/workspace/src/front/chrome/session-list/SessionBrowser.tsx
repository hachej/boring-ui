"use client"

import { useMemo } from "react"
import { ChevronLeft, Plus } from "lucide-react"
import { IconButton } from "@hachej/boring-ui"
import { cn } from "../../lib/utils"
import type { SessionItem } from "../../components/SessionList"

export interface SessionBrowserProps {
  sessions: SessionItem[]
  activeId?: string | null
  onSwitch?: (id: string) => void
  onCreate?: () => void
  onDelete?: (id: string) => void
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
  onSwitch,
  onCreate,
  onDelete,
  onClose,
  className,
}: SessionBrowserProps) {
  const groups = useMemo(() => groupSessions(sessions), [sessions])

  return (
    <div
      data-boring-workspace-part="session-list"
      className={cn("flex h-full min-h-0 flex-col bg-background", className)}
      role="navigation"
      aria-label="Session history"
    >
      <div
        className="flex items-center justify-between border-b border-[color:oklch(from_var(--border)_l_c_h/0.25)] px-3"
        style={{ height: 44 }}
      >
        <span className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
          Sessions
        </span>
        <div className="flex items-center gap-0.5">
          {onCreate && (
            <IconButton type="button" variant="ghost" size="icon-xs" onClick={onCreate} aria-label="New session" title="New chat">
              <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
            </IconButton>
          )}
          {onClose && (
            <IconButton type="button" variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close sessions" title="Close sessions (⌘1)">
              <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
            </IconButton>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {sessions.length === 0 && (
          <div className="px-3 py-8 text-center text-[13px] text-muted-foreground">
            No sessions yet.
            <br />
            Start a new chat to begin.
          </div>
        )}

        {groups.map((group, i) => (
          <section key={group.key} className={cn(i > 0 && "mt-2")}>
            <div className="px-4 pb-1 pt-2 text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
              {group.label}
            </div>
            <ul role="list" className="flex flex-col">
              {group.items.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  active={session.id === activeId}
                  onSwitch={onSwitch}
                  onDelete={onDelete}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}

function SessionRow({
  session,
  active,
  onSwitch,
  onDelete,
}: {
  session: SessionItem
  active: boolean
  onSwitch?: (id: string) => void
  onDelete?: (id: string) => void
}) {
  const time = relativeTime(session.updatedAt)
  return (
    <li
      role="listitem"
      data-boring-workspace-part="session-row"
      data-boring-state={active ? "selected" : undefined}
      className={cn(
        "group relative mx-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
        "cursor-pointer hover:bg-foreground/[0.04]",
        active && "bg-foreground/[0.06] text-foreground",
      )}
      onClick={() => onSwitch?.(session.id)}
    >
      <span className="min-w-0 flex-1 truncate leading-5" title={session.title}>
        <span className={cn(active ? "font-medium text-foreground" : "text-foreground/90")}>
          {session.title || "Untitled"}
        </span>
        {time && (
          <span className="ml-1.5 text-muted-foreground/70 tabular-nums">· {time}</span>
        )}
      </span>
      {onDelete && (
        <IconButton
          type="button"
          variant="ghost"
          size="icon-xs"
          className="shrink-0 text-muted-foreground opacity-0 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
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
      )}
    </li>
  )
}
