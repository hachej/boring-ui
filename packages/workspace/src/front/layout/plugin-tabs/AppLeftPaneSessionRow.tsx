"use client"

import { useState } from "react"
import { LockKeyhole, MessageSquare, Pin } from "lucide-react"
import { cn } from "../../lib/utils"
import { CHAT_SESSION_DRAG_TYPE } from "../ChatPaneStage"
import type { WorkspaceAttentionSessionBadge } from "../../attention/WorkspaceAttentionProvider"
import type { AppLeftPaneSession } from "./AppLeftPane"
import { AppSessionActionsMenu } from "./AppSessionActionsMenu"
import { InlineSessionRename, useInlineSessionRename } from "./InlineSessionRename"
import { encodeWorkspaceSessionDrag } from "../../sessionIdentity"
import { AppLeftPaneSplitAction } from "./AppLeftPaneSplitAction"
import { PaneRow } from "./AppLeftPaneRow"

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
  agentBadge,
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
  agentBadge?: {
    agentTypeId: string
    label: string
  }
  attentionBadge?: WorkspaceAttentionSessionBadge
  onSwitch: (id: string) => void
  onOpenAsPane: (id: string) => void
  onTogglePinned: (id: string) => void
  onRename?: (id: string, title: string) => void | Promise<unknown>
  onDelete?: (id: string) => void | Promise<unknown>
}) {
  const title = session.title || "Untitled"
  const readOnlyReason = session.readOnlyReason ?? "This chat is read-only."
  const [menuOpen, setMenuOpen] = useState(false)
  const renameAvailable = Boolean(onRename) && session.ephemeral !== true
  const canCopy = session.ephemeral !== true
  const showMenu = canCopy || renameAvailable || Boolean(onDelete)
  const rename = useInlineSessionRename({
    sessionId: session.id,
    title,
    available: renameAvailable && session.readOnly !== true,
    onRename,
  })
  // Re-selecting the active chat is intentional: the shell uses this callback
  // to dismiss transient app-left overlays (Tasks, Skills, Plugins) even when
  // no session switch is needed.
  const activate = () => onSwitch(session.id)

  return (
    <PaneRow
      data-boring-workspace-part="app-session-row"
      data-boring-session-id={session.id}
      data-boring-agent-type-id={session.agentTypeId}
      data-boring-session-state={state}
      data-boring-session-read-only={session.readOnly ? "true" : undefined}
      // Drag a session onto the chat stage to open it as a split pane (the
      // stage accepts CHAT_SESSION_DRAG_TYPE; see ChatPaneStageDock). Only
      // same-project sessions are draggable — a split pane lives in the loaded
      // workspace's stage, so cross-project sessions can't join it.
      draggable={canSplit && !rename.editing && !menuOpen}
      onDragStart={canSplit ? (event) => {
        if (rename.editing || menuOpen) {
          event.preventDefault()
          return
        }
        event.dataTransfer.setData(CHAT_SESSION_DRAG_TYPE, encodeWorkspaceSessionDrag({
          sessionId: session.id,
          ...(session.agentTypeId ? { agentTypeId: session.agentTypeId } : {}),
        }))
        event.dataTransfer.setData("text/plain", title)
        event.dataTransfer.effectAllowed = "copyMove"
      } : undefined}
      onClick={() => {
        if (!rename.editing) activate()
      }}
      interactive
      leadingIcon={<MessageSquare className="h-4 w-4" strokeWidth={1.75} />}
      className={cn(
        state === "active"
          // Subtle accent-tinted fill, no heavy colored border (Linear/Stripe style).
          ? "bg-[color:oklch(from_var(--accent)_l_c_h/0.14)] text-foreground"
          : state === "open"
            ? "bg-foreground/[0.05] text-foreground/90 hover:bg-foreground/[0.07]"
            : "text-foreground/78 hover:bg-foreground/[0.055] hover:text-foreground",
      )}
      label={rename.field ? (
        <InlineSessionRename field={rename.field} onCancel={rename.cancel} />
      ) : (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            activate()
          }}
          aria-current={state === "active" ? "page" : undefined}
          className="w-full min-w-0 truncate rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          title={title}
        >
          {title}
        </button>
      )}
      trailing={(
        <>
          {agentBadge ? (
            <span
              data-boring-workspace-part="app-session-agent-badge"
              data-boring-agent-badge={agentBadge.agentTypeId}
              className="inline-flex max-w-20 shrink-0 truncate rounded-full bg-foreground/[0.07] px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground"
              title={agentBadge.label}
            >
              {agentBadge.label}
            </span>
          ) : null}
          {session.readOnly ? (
            <span
              data-boring-workspace-part="app-session-read-only-badge"
              aria-label={`Read-only chat. ${readOnlyReason}`}
              title={readOnlyReason}
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-foreground/[0.07] px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground"
            >
              <LockKeyhole aria-hidden="true" className="size-3" strokeWidth={1.75} />
              read-only
            </span>
          ) : null}
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
          {/* Keep the split action visible for closed, same-project sessions: it
              is the first-class path to watching another chat alongside the
              current one. A cross-project session cannot share this stage. */}
          {state === "normal" && canSplit && !rename.editing ? (
            <AppLeftPaneSplitAction
              ariaLabel={`Open ${title} in split`}
              title="Open in split"
              onClick={(event) => {
                event.stopPropagation()
                onOpenAsPane(session.id)
              }}
            />
          ) : null}
          {showMenu ? (
            <span
              data-boring-workspace-part="app-session-actions"
              className="flex w-0 shrink-0 items-center gap-0.5 overflow-hidden opacity-0 transition-[width,opacity,margin] group-hover:ml-1 group-hover:w-auto group-hover:opacity-100 group-focus-within:ml-1 group-focus-within:w-auto group-focus-within:opacity-100"
            >
              <AppSessionActionsMenu
                sessionId={session.id}
                title={title}
                canCopy={canCopy}
                canRename={renameAvailable && !rename.editing}
                mutationsDisabled={session.readOnly === true}
                disabledReason={readOnlyReason}
                onRename={rename.begin}
                onDelete={onDelete}
                onOpenChange={setMenuOpen}
              />
            </span>
          ) : null}
        </>
      )}
    />
  )
}
