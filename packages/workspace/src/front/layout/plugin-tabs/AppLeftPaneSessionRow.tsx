"use client"

import { useRef, useState } from "react"
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

export interface AppSessionRowProps {
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
  onDelete?: (id: string) => void
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
}: AppSessionRowProps) {
  const title = session.title || "Untitled"
  const renameAvailable = Boolean(onRename && session.nativeSessionId === session.id && session.hasAssistantReply === true)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuTriggerDragSuppressedRef = useRef(false)
  const rename = useInlineSessionRename({
    sessionId: session.id,
    title,
    available: renameAvailable,
    menuOpen,
    onRename,
  })
  const isEditing = rename.isEditing
  const canRename = renameAvailable && !isEditing
  // AppLeftPane only renders durable sessions; never offer copying an empty ID.
  const hasSessionMenu = session.id.length > 0

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
      draggable={canSplit && !isEditing && !menuOpen}
      onDragStart={canSplit ? (event) => {
        if (isEditing || menuOpen || menuTriggerDragSuppressedRef.current) {
          menuTriggerDragSuppressedRef.current = false
          event.preventDefault()
          event.stopPropagation()
          return
        }
        event.dataTransfer.setData(CHAT_SESSION_DRAG_TYPE, session.id)
        event.dataTransfer.setData("text/plain", title)
        event.dataTransfer.effectAllowed = "copyMove"
      } : undefined}
      onClick={() => {
        if (!isEditing) activate()
      }}
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
        <InlineSessionRename
          title={title}
          {...rename.field}
          onCancel={rename.cancelRename}
        />
      ) : (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            activate()
          }}
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
      {/* Keep every visible action in one flex group: the row's outer gap is
          for content, while this control group owns the compact button gap. */}
      {canPin || (state === "normal" && canSplit) || hasSessionMenu ? (
        <span
          data-boring-workspace-part="app-session-controls"
          className={cn(
            "flex max-w-0 shrink-0 items-center gap-0.5 overflow-hidden opacity-0 pointer-events-none transition-[max-width,opacity,margin] group-hover:ml-1 group-hover:max-w-32 group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:ml-1 group-focus-within:max-w-32 group-focus-within:opacity-100 group-focus-within:pointer-events-auto",
            // A pinned row exposes only its pin until the row is hovered or
            // focused; its other controls must retain their reveal behavior.
            pinned && canPin && "ml-1 max-w-6 opacity-100 pointer-events-auto",
            menuOpen && "ml-1 max-w-32 opacity-100 pointer-events-auto",
          )}
        >
          {canPin ? (
            <button
              data-boring-workspace-part="app-session-pin-action"
              type="button"
              aria-label={pinned ? `Unpin ${title}` : `Pin ${title}`}
              title={pinned ? "Unpin" : "Pin"}
              aria-pressed={pinned}
              onClick={(event) => {
                event.stopPropagation()
                onTogglePinned(session.id)
              }}
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                pinned && "text-[color:var(--accent)]",
              )}
            >
              <Pin className={cn("h-3.5 w-3.5", pinned && "fill-current")} strokeWidth={1.75} />
            </button>
          ) : null}
          {/* "Open in new chat pane" only for closed, same-project sessions —
              it's pointless once open, and a cross-project session can't share
              this workspace's split stage. */}
          {state === "normal" && canSplit && !isEditing ? (
            <button
              type="button"
              aria-label={`Open ${title} in new chat pane`}
              title="Open in new chat pane"
              onClick={(event) => {
                event.stopPropagation()
                onOpenAsPane(session.id)
              }}
              className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <MessageSquarePlus className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          ) : null}
          {hasSessionMenu ? (
            <AppSessionActionsMenu
              sessionId={session.id}
              title={title}
              canRename={canRename}
              onRequestRename={rename.requestRename}
              onDelete={onDelete}
              onOpenChange={setMenuOpen}
              dragSuppressedRef={menuTriggerDragSuppressedRef}
            />
          ) : null}
        </span>
      ) : null}
    </div>
  )
}
