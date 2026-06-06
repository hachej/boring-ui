"use client"

import { useMemo } from 'react'
import { ChevronLeftIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { IconButton } from '@hachej/boring-ui-kit'
import type { SessionSummary } from '../../../shared/session'
import { cn } from '../../lib'

export interface SessionListProps {
  sessions: SessionSummary[]
  activeId?: string
  loading?: boolean
  onSwitch?: (id: string) => void
  onCreate?: () => void
  onDelete?: (id: string) => void
  onClose?: () => void
  className?: string
}

type Group = { key: string; label: string; items: SessionSummary[] }

const DAY_MS = 24 * 60 * 60 * 1000

export function SessionList({ sessions, activeId, loading = false, onSwitch, onCreate, onDelete, onClose, className }: SessionListProps) {
  const groups = useMemo(() => groupSessions(sessions), [sessions])

  return (
    <div
      data-boring-agent-part="session-list"
      className={cn('flex h-full min-h-0 flex-col bg-background', className)}
      role="navigation"
      aria-label="Session history"
      aria-busy={loading ? 'true' : undefined}
    >
      <div className="flex h-11 items-center justify-between border-b border-border/60 px-3.5">
        <span className="text-[12px] font-medium tracking-tight text-foreground/70">Sessions</span>
        <div className="flex items-center gap-0.5">
          {onCreate ? (
            <IconButton type="button" variant="ghost" size="icon-xs" onClick={onCreate} aria-label="New session" title="New chat">
              <PlusIcon className="h-3.5 w-3.5" strokeWidth={1.75} />
            </IconButton>
          ) : null}
          {onClose ? (
            <IconButton type="button" variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close sessions" title="Close sessions">
              <ChevronLeftIcon className="h-4 w-4" strokeWidth={1.75} />
            </IconButton>
          ) : null}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-2.5">
        {sessions.length === 0 ? (
          <div data-boring-agent-part="session-list-empty" className="px-3 py-8 text-center text-[13px] text-muted-foreground">
            {loading ? 'Loading sessions…' : 'No sessions yet.'}
            {!loading ? <><br />Start a new chat to begin.</> : null}
          </div>
        ) : null}

        {groups.map((group, index) => (
          <section key={group.key} className={cn(index > 0 && 'mt-4')}>
            <div className="flex items-baseline justify-between gap-2 px-3.5 pb-2 pt-2 text-[11px] font-medium tracking-tight text-muted-foreground/75">
              <span>{group.label}</span>
              <span aria-hidden="true" className="text-[10.5px] tabular-nums text-muted-foreground/40">{group.items.length}</span>
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

export const SessionBrowser = SessionList

function SessionRow({ session, active, onSwitch, onDelete }: { session: SessionSummary; active: boolean; onSwitch?: (id: string) => void; onDelete?: (id: string) => void }) {
  const time = relativeTime(session.updatedAt)
  return (
    <li
      role="listitem"
      data-boring-agent-part="session-row"
      data-boring-state={active ? 'selected' : undefined}
      className={cn(
        'group relative mx-2 mt-px flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]',
        'hover:bg-foreground/[0.04]',
        active && 'bg-foreground/[0.06] text-foreground',
      )}
      onClick={() => onSwitch?.(session.id)}
    >
      <span className="min-w-0 flex-1 truncate leading-5" title={session.title}>
        <span className={cn(active ? 'font-medium text-foreground' : 'text-foreground/90')}>{session.title || 'Untitled'}</span>
        {time ? <span className={cn('ml-1.5 tabular-nums text-[11px]', active ? 'text-[color:var(--accent)]' : 'text-muted-foreground/60')}>{time}</span> : null}
      </span>
      {onDelete ? (
        <IconButton
          type="button"
          variant="ghost"
          size="icon-xs"
          className="shrink-0 text-muted-foreground opacity-0 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
          onClick={(event) => {
            event.stopPropagation()
            onDelete(session.id)
          }}
          aria-label={`Delete ${session.title || 'session'}`}
        >
          <Trash2Icon className="h-3 w-3" />
        </IconButton>
      ) : null}
    </li>
  )
}

function groupSessions(sessions: SessionSummary[]): Group[] {
  const today = startOfDay(new Date())
  const yesterday = today - DAY_MS
  const lastWeek = today - 7 * DAY_MS
  const groups: Array<[string, string, SessionSummary[]]> = [
    ['today', 'Today', []],
    ['yesterday', 'Yesterday', []],
    ['week', 'This week', []],
    ['earlier', 'Earlier', []],
  ]

  for (const session of [...sessions].sort(sortByUpdatedDesc)) {
    const updated = toDate(session.updatedAt)
    const day = updated ? startOfDay(updated) : 0
    if (day >= today) groups[0]![2].push(session)
    else if (day >= yesterday) groups[1]![2].push(session)
    else if (day >= lastWeek) groups[2]![2].push(session)
    else groups[3]![2].push(session)
  }

  return groups.filter(([, , items]) => items.length > 0).map(([key, label, items]) => ({ key, label, items }))
}

function relativeTime(value: string): string {
  const date = toDate(value)
  if (!date) return ''
  const diff = Date.now() - date.getTime()
  if (diff < 60_000) return 'now'
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo`
  return `${Math.floor(days / 365)}y`
}

function toDate(value: string): Date | undefined {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function startOfDay(date: Date): number {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy.getTime()
}

function sortByUpdatedDesc(a: SessionSummary, b: SessionSummary): number {
  const updatedDelta = (toDate(b.updatedAt)?.getTime() ?? 0) - (toDate(a.updatedAt)?.getTime() ?? 0)
  if (updatedDelta !== 0) return updatedDelta
  const createdDelta = (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0)
  if (createdDelta !== 0) return createdDelta
  return a.id.localeCompare(b.id)
}
