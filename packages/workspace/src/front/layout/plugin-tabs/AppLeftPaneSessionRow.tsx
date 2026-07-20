"use client"

import { useState } from "react"
import { Clock3, MessageSquarePlus, Pin } from "lucide-react"
import { cn } from "../../lib/utils"
import { CHAT_SESSION_DRAG_TYPE } from "../ChatPaneStage"
import type { WorkspaceAttentionSessionBadge } from "../../attention/WorkspaceAttentionProvider"
import type { AppLeftPaneSession } from "./AppLeftPane"
import { AppSessionActionsMenu } from "./AppSessionActionsMenu"
import { InlineSessionRename, useInlineSessionRename } from "./InlineSessionRename"

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
  onRename,
  onDelete,
}: {
  session: AppLeftPaneSession
  state: AppSessionRowState
  pinned: boolean
  /** Whether this session can be split-paned/dragged (same-project only). */
  canSplit?: boolean
  /** Whether this session belongs to the active project's pinned-session scope. */
  canPin?: boolean
  working?: boolean
  attentionBadge?: WorkspaceAttentionSessionBadge
  onSwitch: (id: string) => void
  onOpenAsPane: (id: string) => void
  onTogglePinned: (id: string) => void
  onRename?: (id: string, title: string) => void | Promise<unknown>
  onDelete?: (id: string) => void | Promise<unknown>
}) {
  const title = session.title || "Untitled"
  const [menuOpen, setMenuOpen] = useState(false)
  const renameAvailable = Boolean(onRename) && session.nativeSessionId === session.id && session.hasAssistantReply === true
  const canCopy = session.ephemeral !== true
  const showMenu = canCopy || renameAvailable || Boolean(onDelete)
  const rename = useInlineSessionRename({
    sessionId: session.id,
    title,
    available: renameAvailable,
    onRename,
  })
  // Re-selecting the active chat is intentional: the shell uses this callback
  // to dismiss transient app-left overlays (Tasks, Skills, Plugins) even when
  // no session switch is needed.
  const activate = () => onSwitch(session.id)

  return (
    <div
      data-boring-workspace-part="app-session-row"
      data-boring-session-state={state}
      // Drag a session onto the chat stage to open it as a split pane (the
      // stage accepts CHAT_SESSION_DRAG_TYPE; see ChatPaneStageDock). Only
      // same-project sessions are draggable — a split pane lives in the loaded
      // workspace's stage, so cross-project sessions can't join it.
      draggable={canSplit && !rename.editing && !menuOpen}
      onDragStart={canSplit ? (event) => {
        if (rename.editing || menuOpen) { event.preventDefault(); return }
        event.dataTransfer.setData(CHAT_SESSION_DRAG_TYPE, session.id)
        event.dataTransfer.setData("text/plain", title)
        event.dataTransfer.effectAllowed = "copyMove"
      } : undefined}
      onClick={() => { if (!rename.editing) activate() }}
      className={cn(
        "group flex min-h-8 w-full items-center gap-2 rounded-md border px-2.5 py-1 text-left transition-colors",
        state === "active"
          // Subtle accent-tinted fill, no heavy colored border (Linear/Stripe style).
          ? "border-transparent bg-[color:oklch(from_var(--accent)_l_c_h/0.14)] text-foreground"
          : state === "open"
            ? "cursor-pointer border-transparent bg-foreground/[0.05] text-foreground/90 hover:bg-foreground/[0.07]"
            : "cursor-pointer border-transparent text-foreground/78 hover:bg-foreground/[0.055] hover:text-foreground",
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
      {rename.field ? (
        <InlineSessionRename field={rename.field} onCancel={rename.cancel} />
      ) : (
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); activate() }}
          aria-current={state === "active" ? "page" : undefined}
          className="min-w-0 flex-1 truncate rounded text-left text-[13px] font-medium leading-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          title={title}
        >
          {title}
        </button>
      )}
      {attentionBadge ? (
        <span
          data-boring-workspace-part="app-session-badge"
          data-boring-badge={attentionBadge.kind}
          className={cn("pointer-events-none inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none", sessionBadgeToneClassName(attentionBadge.tone))}
        >
          <span aria-hidden="true" className={cn("h-1.5 w-1.5 animate-pulse rounded-full", sessionBadgeDotClassName(attentionBadge.tone))} />
          {attentionBadge.label}
        </span>
      ) : working ? (
        <span
          data-boring-workspace-part="app-session-badge"
          data-boring-badge="working"
          className="pointer-events-none inline-flex shrink-0 items-center gap-1 rounded-full bg-foreground/[0.07] px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground"
        >
          <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-[color:var(--accent)]" />
          working
        </span>
      ) : null}
      {canPin ? (
        <span
          data-boring-workspace-part="app-session-pin-action"
          className={cn(
            "flex w-0 shrink-0 items-center overflow-hidden opacity-0 transition-[width,opacity,margin] group-hover:ml-1 group-hover:w-auto group-hover:opacity-100 group-focus-within:ml-1 group-focus-within:w-auto group-focus-within:opacity-100",
            pinned && "ml-1 w-auto opacity-100",
          )}
        >
          <button
            type="button"
            aria-label={pinned ? `Unpin ${title}` : `Pin ${title}`}
            title={pinned ? "Unpin" : "Pin"}
            aria-pressed={pinned}
            onClick={(event) => {
              event.stopPropagation()
              onTogglePinned(session.id)
            }}
            className={cn(
              "grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              pinned && "text-[color:var(--accent)]",
            )}
          >
            <Pin className={cn("h-3.5 w-3.5", pinned && "fill-current")} strokeWidth={1.75} />
          </button>
        </span>
      ) : null}
      {(state === "normal" && canSplit) || showMenu ? (
        <span
          data-boring-workspace-part="app-session-actions"
          className="flex w-0 shrink-0 items-center gap-0.5 overflow-hidden opacity-0 transition-[width,opacity,margin] group-hover:ml-1 group-hover:w-auto group-hover:opacity-100 group-focus-within:ml-1 group-focus-within:w-auto group-focus-within:opacity-100"
        >
          {state === "normal" && canSplit && !rename.editing ? (
            <button
              type="button"
              aria-label={`Open ${title} in new chat pane`}
              title="Open in new chat pane"
              onClick={(event) => { event.stopPropagation(); onOpenAsPane(session.id) }}
              className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <MessageSquarePlus className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          ) : null}
          {showMenu ? (
            <AppSessionActionsMenu
              sessionId={session.id}
              title={title}
              canCopy={canCopy}
              canRename={renameAvailable && !rename.editing}
              onRename={rename.begin}
              onDelete={onDelete}
              onOpenChange={setMenuOpen}
            />
          ) : null}
        </span>
      ) : null}
    </div>
  )
}
