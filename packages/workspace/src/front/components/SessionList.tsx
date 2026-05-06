"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react"
import { IconButton } from "@hachej/boring-ui"
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
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const sessionIds = useMemo(() => sessions.map((session) => session.id), [sessions])

  useEffect(() => {
    if (sessionIds.length === 0) {
      setFocusedId(null)
      return
    }

    setFocusedId((prev) => {
      if (prev && sessionIds.includes(prev)) return prev
      if (activeId && sessionIds.includes(activeId)) return activeId
      return sessionIds[0] ?? null
    })
  }, [sessionIds, activeId])

  const focusSession = useCallback((id: string) => {
    setFocusedId(id)
    rowRefs.current[id]?.focus()
  }, [])

  const handleSessionKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, id: string) => {
      if (event.target !== event.currentTarget) return

      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault()
        onSwitch?.(id)
        return
      }

      const currentIndex = sessionIds.indexOf(id)
      if (currentIndex < 0) return

      let nextIndex = currentIndex
      if (event.key === "ArrowDown") {
        nextIndex = Math.min(currentIndex + 1, sessionIds.length - 1)
      } else if (event.key === "ArrowUp") {
        nextIndex = Math.max(currentIndex - 1, 0)
      } else if (event.key === "Home") {
        nextIndex = 0
      } else if (event.key === "End") {
        nextIndex = sessionIds.length - 1
      } else {
        return
      }

      event.preventDefault()
      const nextId = sessionIds[nextIndex]
      if (nextId) {
        focusSession(nextId)
      }
    },
    [focusSession, onSwitch, sessionIds],
  )

  return (
    <div
      data-boring-workspace-part="session-list"
      className={cn("flex h-full flex-col", className)}
      role="navigation"
      aria-label="Sessions"
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Sessions
        </span>
        {onCreate && (
          <IconButton type="button" variant="ghost" size="icon-xs" onClick={onCreate} aria-label="New session">
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
          </IconButton>
        )}
      </div>

      <div className="flex-1 overflow-y-auto" role="list" aria-label="Session list">
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
            isFocused={session.id === focusedId}
            onSwitch={onSwitch}
            onDelete={onDelete}
            onFocus={() => setFocusedId(session.id)}
            onKeyDown={handleSessionKeyDown}
            rowRef={(node) => {
              rowRefs.current[session.id] = node
            }}
          />
        ))}
      </div>
    </div>
  )
}

function SessionRow({
  session,
  isActive,
  isFocused,
  onSwitch,
  onDelete,
  onFocus,
  onKeyDown,
  rowRef,
}: {
  session: SessionItem
  isActive: boolean
  isFocused: boolean
  onSwitch?: (id: string) => void
  onDelete?: (id: string) => void
  onFocus: () => void
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>, id: string) => void
  rowRef: (node: HTMLDivElement | null) => void
}) {
  return (
    <div
      ref={rowRef}
      role="listitem"
      data-boring-workspace-part="session-row"
      data-boring-state={isActive ? "selected" : undefined}
      data-focused={isFocused ? "true" : "false"}
      className={cn(
        "group flex items-center gap-2 border-b border-border px-3 py-2 text-sm cursor-pointer transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        isActive
          ? "bg-accent text-accent-foreground"
          : "text-foreground hover:bg-accent/50",
      )}
      onClick={() => onSwitch?.(session.id)}
      onFocus={onFocus}
      onKeyDown={(event) => onKeyDown(event, session.id)}
      tabIndex={isFocused ? 0 : -1}
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
        <IconButton
          type="button"
          variant="ghost"
          size="icon-xs"
          className="shrink-0 text-muted-foreground opacity-0 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 group-data-[focused=true]:opacity-100"
          onClick={(e) => {
            e.stopPropagation()
            onDelete(session.id)
          }}
          tabIndex={isFocused ? 0 : -1}
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
        </IconButton>
      )}
    </div>
  )
}
