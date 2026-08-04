"use client"

import { MessageSquare, MessageSquarePlus, Pin, X } from "lucide-react"
import { cn } from "../../lib/utils"
import { CHAT_SESSION_DRAG_TYPE } from "../ChatPaneStage"
import type { WorkspaceAttentionSessionBadge } from "../../attention/WorkspaceAttentionProvider"
import type { AppLeftPaneSession } from "./AppLeftPane"
import { encodeWorkspaceSessionDrag } from "../../sessionIdentity"

export type AppSessionRowState = "normal" | "open" | "active"

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
    case "neutral": return "bg-muted-foreground/70"
    default: return "bg-[color:var(--accent)]"
  }
}

export function AppSessionRow({
  session,
  state,
  pinned,
  canSplit = true,
  canPin = true,
  working = false,
  attentionBadge,
  onSwitch,
  onOpenAsPane,
  onTogglePinned,
  onDelete,
}: {
  session: AppLeftPaneSession
  state: AppSessionRowState
  pinned: boolean
  canSplit?: boolean
  canPin?: boolean
  working?: boolean
  attentionBadge?: WorkspaceAttentionSessionBadge
  onSwitch: (id: string) => void
  onOpenAsPane: (id: string) => void
  onTogglePinned: (id: string) => void
  onDelete?: (id: string) => void
}) {
  const title = session.title || "Untitled"
  const activate = () => onSwitch(session.id)

  return (
    <div
      data-boring-workspace-part="app-session-row"
      data-boring-session-state={state}
      draggable={canSplit}
      onDragStart={canSplit ? (event) => {
        event.dataTransfer.setData(CHAT_SESSION_DRAG_TYPE, encodeWorkspaceSessionDrag({
          sessionId: session.id,
          ...(session.agentTypeId ? { agentTypeId: session.agentTypeId } : {}),
        }))
        event.dataTransfer.setData("text/plain", title)
        event.dataTransfer.effectAllowed = "copyMove"
      } : undefined}
      className="group relative h-9 w-full"
    >
      <button
        type="button"
        data-boring-mobile-dismiss="true"
        onClick={activate}
        aria-current={state === "active" ? "page" : undefined}
        className={cn(
          "flex h-full w-full items-center gap-2 rounded-md px-2 text-left transition-colors motion-reduce:transition-none",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          state === "active"
            ? "bg-[color:oklch(from_var(--accent)_l_c_h/0.14)] text-foreground"
            : state === "open"
              ? "bg-foreground/[0.05] text-foreground/90 hover:bg-foreground/[0.08]"
              : "text-foreground/78 hover:bg-foreground/[0.055] hover:text-foreground",
        )}
        title={title}
      >
        <span className="relative grid size-5 shrink-0 place-items-center" aria-hidden="true">
          <MessageSquare
            className={cn("h-4 w-4", state === "active" ? "text-[color:var(--accent)]" : "text-muted-foreground/65")}
            strokeWidth={1.75}
          />
          {state === "active" ? <span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-[color:var(--accent)] ring-2 ring-background" /> : null}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-5">
          {title}
        </span>
        <span className="flex w-[88px] shrink-0 justify-end overflow-hidden group-hover:opacity-0 group-focus-within:opacity-0">
          {attentionBadge ? (
            <span
              data-boring-workspace-part="app-session-badge"
              data-boring-badge={attentionBadge.kind}
              className={cn("pointer-events-none inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none", sessionBadgeToneClassName(attentionBadge.tone))}
            >
              <span aria-hidden="true" className={cn("h-1.5 w-1.5 animate-pulse rounded-full motion-reduce:animate-none", sessionBadgeDotClassName(attentionBadge.tone))} />
              {attentionBadge.label}
            </span>
          ) : working ? (
            <span
              data-boring-workspace-part="app-session-badge"
              data-boring-badge="working"
              className="pointer-events-none inline-flex shrink-0 items-center gap-1 rounded-full bg-foreground/[0.07] px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground"
            >
              <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-[color:var(--accent)] motion-reduce:animate-none" />
              working
            </span>
          ) : pinned ? (
            <Pin className="h-3.5 w-3.5 shrink-0 fill-current text-[color:var(--accent)]" strokeWidth={1.75} aria-hidden="true" />
          ) : null}
        </span>
      </button>

      <span
        data-boring-workspace-part="app-session-actions"
        className={cn(
          "pointer-events-none absolute inset-y-0 right-1 z-10 flex w-[88px] items-center justify-end gap-0.5 opacity-0 transition-opacity motion-reduce:transition-none",
          "group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100",
        )}
      >
        {state === "normal" && canSplit ? (
          <button
            type="button"
            aria-label={`Open ${title} in new chat pane`}
            title="Open in new chat pane"
            data-boring-mobile-dismiss="true"
            onClick={() => onOpenAsPane(session.id)}
            className="grid size-7 place-items-center rounded-md bg-background/90 text-muted-foreground shadow-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <MessageSquarePlus className="h-4 w-4" strokeWidth={1.75} />
          </button>
        ) : null}
        {canPin ? (
          <button
            type="button"
            aria-label={pinned ? `Unpin ${title}` : `Pin ${title}`}
            title={pinned ? "Unpin" : "Pin"}
            aria-pressed={pinned}
            onClick={() => onTogglePinned(session.id)}
            className={cn(
              "grid size-7 place-items-center rounded-md bg-background/90 text-muted-foreground shadow-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              pinned && "text-[color:var(--accent)]",
            )}
          >
            <Pin className={cn("h-4 w-4", pinned && "fill-current")} strokeWidth={1.75} />
          </button>
        ) : null}
        {onDelete ? (
          <button
            type="button"
            aria-label={`Delete ${title}`}
            title="Delete"
            onClick={() => {
              if (typeof window !== "undefined" && window.confirm(`Delete “${title}”?`)) onDelete(session.id)
            }}
            className="grid size-7 place-items-center rounded-md bg-background/90 text-muted-foreground shadow-sm hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        ) : null}
      </span>
    </div>
  )
}
