"use client"

import { cn } from "../lib/utils"

export interface SessionItem {
  id: string
  title: string
  updatedAt?: string | number
}

export interface SessionListProps {
  sessions: SessionItem[]
  activeId?: string | null
  onSwitch?: (id: string) => void
  onCreate?: () => void
  onDelete?: (id: string) => void
  onRename?: (id: string, newTitle: string) => void
  className?: string
}

export function SessionList({
  sessions,
  activeId,
  onSwitch,
  onCreate,
  onDelete,
  className,
}: SessionListProps) {
  return (
    <div
      className={cn("flex h-full flex-col", className)}
      role="navigation"
      aria-label="Sessions"
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Sessions
        </span>
        {onCreate && (
          <button
            type="button"
            onClick={onCreate}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            aria-label="New session"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <path d="M8 3v10M3 8h10" />
            </svg>
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto" role="list">
        {sessions.length === 0 && (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            No sessions
          </div>
        )}
        {sessions.map((session) => (
          <SessionRow
            key={session.id}
            session={session}
            isActive={session.id === activeId}
            onSwitch={onSwitch}
            onDelete={onDelete}
          />
        ))}
      </div>
    </div>
  )
}

function SessionRow({
  session,
  isActive,
  onSwitch,
  onDelete,
}: {
  session: SessionItem
  isActive: boolean
  onSwitch?: (id: string) => void
  onDelete?: (id: string) => void
}) {
  return (
    <div
      role="listitem"
      className={cn(
        "group flex items-center gap-2 border-b border-border px-3 py-2 text-sm cursor-pointer transition-colors",
        isActive
          ? "bg-accent text-accent-foreground"
          : "text-foreground hover:bg-accent/50",
      )}
      onClick={() => onSwitch?.(session.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onSwitch?.(session.id)
        }
      }}
      tabIndex={0}
      aria-current={isActive ? "true" : undefined}
    >
      <span className="flex-1 truncate">{session.title}</span>
      {isActive && (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
          aria-label="Active"
        />
      )}
      {onDelete && (
        <button
          type="button"
          className="hidden shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive group-hover:block"
          onClick={(e) => {
            e.stopPropagation()
            onDelete(session.id)
          }}
          aria-label={`Delete ${session.title}`}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" />
          </svg>
        </button>
      )}
    </div>
  )
}
