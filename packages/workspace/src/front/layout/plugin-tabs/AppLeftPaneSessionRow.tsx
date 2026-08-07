"use client"

import { useState } from "react"
import { MessageSquare, Pin } from "lucide-react"
import { cn } from "../../lib/utils"
import { CHAT_SESSION_DRAG_TYPE } from "../ChatPaneStage"
import type { WorkspaceAttentionSessionBadge } from "../../attention/WorkspaceAttentionProvider"
import type { AppLeftPaneSession } from "./AppLeftPane"
import { AppSessionActionsMenu } from "./AppSessionActionsMenu"
import { InlineSessionRename, useInlineSessionRename } from "./InlineSessionRename"
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
  activeDot = false,
  onSwitch,
  onOpenAsPane,
  onTogglePinned,
  onRename,
  onDelete,
}: {
  session: AppLeftPaneSession
  state: AppSessionRowState
  pinned: boolean
  canSplit?: boolean
  canPin?: boolean
  working?: boolean
  attentionBadge?: WorkspaceAttentionSessionBadge
  activeDot?: boolean
  onSwitch?: (id: string) => void
  onOpenAsPane?: (id: string) => void
  onTogglePinned?: (id: string) => void
  onRename?: (id: string, title: string) => void | Promise<unknown>
  onDelete?: (id: string) => unknown
}) {
  const title = session.title || "Untitled"
  const [menuOpen, setMenuOpen] = useState(false)
  const actionsAvailable = Boolean(onSwitch)
  const renameAvailable = Boolean(onRename) && session.nativeSessionId === session.id && session.hasAssistantReply === true
  const canCopy = session.ephemeral !== true
  const splitAvailable = state === "normal" && actionsAvailable && canSplit && Boolean(onOpenAsPane)
  const pinAvailable = canPin && Boolean(onTogglePinned)
  const showMenu = splitAvailable || pinAvailable || canCopy || renameAvailable || Boolean(onDelete)
  const actionWidthClassName = showMenu ? "w-7" : "w-0"
  const statusWidthClassName = attentionBadge || working ? "w-[88px]" : actionWidthClassName
  const rename = useInlineSessionRename({
    sessionId: session.id,
    title,
    available: renameAvailable,
    onRename,
  })
  const activate = () => onSwitch?.(session.id)
  const rowClassName = cn(
    "flex h-full w-full items-center gap-2 rounded-md px-2 text-left transition-colors motion-reduce:transition-none",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
    !actionsAvailable && "opacity-60",
    state === "active"
      ? "bg-[color:oklch(from_var(--accent)_l_c_h/0.14)] text-foreground"
      : state === "open"
        ? "bg-foreground/[0.05] text-foreground/90 hover:bg-foreground/[0.08]"
        : "text-foreground/78 hover:bg-foreground/[0.055] hover:text-foreground",
  )

  return (
    <div
      data-boring-workspace-part="app-session-row"
      data-boring-session-id={session.id}
      data-boring-agent-type-id={session.agentTypeId}
      data-boring-session-state={state}
      draggable={actionsAvailable && canSplit && !rename.editing && !menuOpen}
      onDragStart={actionsAvailable && canSplit ? (event) => {
        if (rename.editing || menuOpen) { event.preventDefault(); return }
        event.dataTransfer.setData(CHAT_SESSION_DRAG_TYPE, encodeWorkspaceSessionDrag({
          sessionId: session.id,
          ...(session.agentTypeId ? { agentTypeId: session.agentTypeId } : {}),
        }))
        event.dataTransfer.setData("text/plain", title)
        event.dataTransfer.effectAllowed = "copyMove"
      } : undefined}
      className="app-left-session-row group relative h-9 w-full"
    >
      {rename.field ? (
        <div className={rowClassName}>
          <span className="relative grid size-5 shrink-0 place-items-center" aria-hidden="true">
            <MessageSquare className="h-4 w-4 text-[color:var(--accent)]" strokeWidth={1.75} />
          </span>
          <InlineSessionRename field={rename.field} onCancel={rename.cancel} />
        </div>
      ) : (
        <button
          type="button"
          data-boring-mobile-dismiss="true"
          onClick={activate}
          disabled={!actionsAvailable}
          aria-current={state === "active" ? "page" : undefined}
          className={rowClassName}
          title={title}
        >
          <span className="relative grid size-5 shrink-0 place-items-center" aria-hidden={activeDot ? undefined : "true"}>
            {activeDot ? (
              state === "active" ? (
                <span title="Active session" className="size-2 rounded-full bg-[color:var(--accent)]">
                  <span className="sr-only">Active session</span>
                </span>
              ) : null
            ) : (
              <MessageSquare
                className={cn("h-4 w-4", state === "active" ? "text-[color:var(--accent)]" : "text-muted-foreground/65")}
                strokeWidth={1.75}
              />
            )}
          </span>
          <span className={cn("min-w-0 flex-1 truncate text-[13px] leading-5", state === "active" ? "font-semibold" : "font-medium")}>
            {title}
          </span>
          <span
            data-action-count={showMenu ? 1 : 0}
            data-has-status={attentionBadge || working ? "true" : "false"}
            className={cn("app-left-session-trailing flex shrink-0 justify-end overflow-hidden group-hover:opacity-0 group-focus-within:opacity-0", statusWidthClassName)}
          >
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
      )}

      {!rename.editing && showMenu ? (
        <span
          data-boring-workspace-part="app-session-actions"
          data-action-count="1"
          className={cn(
            "app-left-session-actions pointer-events-none absolute inset-y-0 right-1 z-10 flex items-center justify-end gap-0.5 opacity-0 transition-opacity motion-reduce:transition-none",
            actionWidthClassName,
            "group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100",
          )}
        >
          <AppSessionActionsMenu
            sessionId={session.id}
            title={title}
            canCopy={canCopy}
            canRename={renameAvailable}
            canSplit={splitAvailable}
            canPin={pinAvailable}
            pinned={pinned}
            onOpenAsPane={onOpenAsPane}
            onTogglePinned={onTogglePinned}
            onRename={rename.begin}
            onDelete={onDelete}
            onOpenChange={setMenuOpen}
          />
        </span>
      ) : null}
    </div>
  )
}
