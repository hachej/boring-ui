"use client"

import { MessageSquare, MessageSquarePlus, MoreHorizontal, Pin, PinOff, Trash2 } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@hachej/boring-ui-kit"
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
  const hasActions = (state === "normal" && canSplit) || canPin || Boolean(onDelete)
  const actionCount = hasActions ? 1 : 0
  const actionWidthClassName = hasActions ? "w-7" : "w-0"
  const statusWidthClassName = attentionBadge || working ? "w-[88px]" : actionWidthClassName

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
      className="app-left-session-row group relative h-9 w-full"
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
        </span>
        <span className={cn("min-w-0 flex-1 truncate text-[13px] leading-5", state === "active" ? "font-semibold" : "font-medium")}>
          {title}
        </span>
        <span data-action-count={actionCount} data-has-status={attentionBadge || working ? "true" : "false"} className={cn("app-left-session-trailing flex shrink-0 justify-end overflow-hidden group-hover:opacity-0 group-focus-within:opacity-0", statusWidthClassName)}>
          {attentionBadge ? (
            <span
              data-boring-workspace-part="app-session-badge"
              data-boring-badge={attentionBadge.kind}
              className={cn("pointer-events-none inline-flex max-w-full shrink-0 truncate rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none", sessionBadgeToneClassName(attentionBadge.tone))}
            >
              {attentionBadge.label}
            </span>
          ) : working ? (
            <span
              data-boring-workspace-part="app-session-badge"
              data-boring-badge="working"
              className="pointer-events-none inline-flex shrink-0 rounded-full bg-foreground/[0.07] px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground"
            >
              working
            </span>
          ) : pinned ? (
            <Pin className="h-3.5 w-3.5 shrink-0 fill-current text-[color:var(--accent)]" strokeWidth={1.75} aria-hidden="true" />
          ) : null}
        </span>
      </button>

      <span
        data-boring-workspace-part="app-session-actions"
        data-action-count={actionCount}
        className={cn(
          "app-left-session-actions pointer-events-none absolute inset-y-0 right-1 z-10 flex items-center justify-end gap-0.5 opacity-0 transition-opacity motion-reduce:transition-none",
          actionWidthClassName,
          "group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100",
        )}
      >
        {hasActions ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Chat actions for ${title}`}
                title="Chat actions"
                onClick={(event) => event.stopPropagation()}
                className="app-left-session-secondary-action grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <MoreHorizontal className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={6} className="min-w-48">
              {state === "normal" && canSplit ? (
                <DropdownMenuItem data-boring-mobile-dismiss="true" onSelect={() => onOpenAsPane(session.id)}>
                  <MessageSquarePlus className="mr-2 h-4 w-4" />
                  Open in new chat pane
                </DropdownMenuItem>
              ) : null}
              {canPin ? (
                <DropdownMenuItem onSelect={() => onTogglePinned(session.id)}>
                  {pinned ? <PinOff className="mr-2 h-4 w-4" /> : <Pin className="mr-2 h-4 w-4" />}
                  {pinned ? "Unpin chat" : "Pin chat"}
                </DropdownMenuItem>
              ) : null}
              {onDelete ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    data-boring-mobile-dismiss="true"
                    onSelect={() => {
                      if (typeof window !== "undefined" && window.confirm(`Delete “${title}”?`)) onDelete(session.id)
                    }}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete chat
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </span>
    </div>
  )
}
