"use client"

import { useState } from "react"
import { Columns2, MessageSquare, Pin, Zap } from "lucide-react"
import { cn } from "../../lib/utils"
import { CHAT_SESSION_DRAG_TYPE } from "../ChatPaneStage"
import type { WorkspaceAttentionSessionBadge } from "../../attention/WorkspaceAttentionProvider"
import type { AppLeftPaneSession } from "./AppLeftPane"
import { AppSessionActionsMenu } from "./AppSessionActionsMenu"
import { InlineSessionRename, useInlineSessionRename } from "./InlineSessionRename"
import { encodeWorkspaceSessionDrag } from "../../sessionIdentity"

export type AppSessionRowState = "normal" | "open" | "active"

/** Compact relative age for the row's trailing slot ("now", "8m", "3h", "2d", "5w"). */
export function formatSessionAge(updatedAt: string | number | undefined, now: number): string | null {
  if (updatedAt === undefined) return null
  const then = typeof updatedAt === "number" ? updatedAt : Date.parse(updatedAt)
  if (!Number.isFinite(then)) return null
  const seconds = Math.max(0, Math.floor((now - then) / 1000))
  if (seconds < 60) return "now"
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h`
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)}d`
  return `${Math.floor(seconds / 604_800)}w`
}

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
  activeDotActive = state === "active",
  compact = false,
  ownerLabel,
  onSwitch,
  onOpenAsPane,
  onOpenDetached,
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
  activeDotActive?: boolean
  compact?: boolean
  ownerLabel?: string
  onSwitch?: (id: string) => void
  onOpenAsPane?: (id: string) => void
  onOpenDetached?: (id: string) => void
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
  // A chat already on stage has nothing to gain from the quick overlay —
  // placement shortcuts only apply to chats that are not open yet.
  const detachAvailable = state === "normal" && actionsAvailable && Boolean(onOpenDetached)
  // Placement shortcuts surface directly on hover (owner spec); the menu keeps
  // the rest. Width reserves one 28px slot per visible action.
  const hoverActionCount = (showMenu ? 1 : 0) + (splitAvailable ? 1 : 0) + (detachAvailable ? 1 : 0)
  const actionWidthClassName = hoverActionCount === 3 ? "w-[84px]" : hoverActionCount === 2 ? "w-14" : hoverActionCount === 1 ? "w-7" : "w-0"
  const showWorkingBadge = working && !activeDot
  // The age is deliberately quiet: it only occupies the trailing slot when
  // nothing more urgent (badge, provenance, pin) claims it, and it yields to
  // the hover actions like the rest of the slot.
  const age = !attentionBadge && !showWorkingBadge && !ownerLabel && !pinned
    ? formatSessionAge(session.updatedAt, Date.now())
    : null
  const exactUpdatedAt = age !== null && session.updatedAt !== undefined
    ? new Date(typeof session.updatedAt === "number" ? session.updatedAt : Date.parse(session.updatedAt)).toLocaleString()
    : undefined
  const statusWidthClassName = ownerLabel ? "w-auto max-w-28 gap-1" : attentionBadge || showWorkingBadge ? "w-[88px]" : age ? "w-auto" : actionWidthClassName
  const rename = useInlineSessionRename({
    sessionId: session.id,
    title,
    available: renameAvailable,
    onRename,
  })
  const activate = () => onSwitch?.(session.id)
  const rowClassName = cn(
    "flex h-full w-full items-center rounded-md text-left transition-colors motion-reduce:transition-none",
    compact ? "gap-1.5 px-1.5" : "gap-2 px-2",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
    !actionsAvailable && "opacity-60",
    // Active stays quiet: one step past the hover tint plus the accent dot,
    // so the guide line and the rest of the pane keep their weight.
    state === "active"
      ? "bg-foreground/[0.07] text-foreground"
      : state === "open"
        ? "bg-foreground/[0.05] text-foreground/90 hover:bg-foreground/[0.08]"
        : "text-foreground/78 hover:bg-foreground/[0.055] hover:text-foreground",
  )
  const leadingSlotClassName = compact ? "relative grid h-5 w-3 shrink-0 place-items-center" : "relative grid size-5 shrink-0 place-items-center"

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
      className={cn("app-left-session-row group relative w-full", compact ? "h-[29px]" : "h-[30px]")}
    >
      {rename.field ? (
        <div className={rowClassName}>
          <span className={leadingSlotClassName} aria-hidden="true">
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
          title={exactUpdatedAt ? `${title}\nLast activity: ${exactUpdatedAt}` : title}
        >
          {activeDot && state === "active" ? (
            // The open chat announces itself with a discreet accent rail at
            // the row edge; the dot is reserved for a chat that is working.
            <span
              aria-hidden="true"
              data-boring-workspace-part="app-session-active-rail"
              className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-[color:var(--accent)]"
            />
          ) : null}
          <span className={leadingSlotClassName} aria-hidden={activeDot ? undefined : "true"}>
            {activeDot ? (
              activeDotActive && working ? (
                // Pulsing accent dot = working. Under reduced motion the
                // pulse stops and the dot dims instead.
                <span
                  title="Working"
                  className="size-2 animate-pulse rounded-full bg-[color:var(--accent)] motion-reduce:animate-none motion-reduce:opacity-60"
                >
                  <span className="sr-only">Working</span>
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
            data-action-count={hoverActionCount}
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
            ) : showWorkingBadge ? (
              <span
                data-boring-workspace-part="app-session-badge"
                data-boring-badge="working"
                className="pointer-events-none inline-flex shrink-0 rounded-full bg-foreground/[0.07] px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground"
              >
                working
              </span>
            ) : null}
            {ownerLabel ? (
              <span className="truncate text-[11px] font-medium text-muted-foreground">{ownerLabel}</span>
            ) : !attentionBadge && !working && pinned ? (
              <Pin className="h-3.5 w-3.5 shrink-0 fill-current text-[color:var(--accent)]" strokeWidth={1.75} aria-hidden="true" />
            ) : age ? (
              <span
                data-boring-workspace-part="app-session-age"
                title={exactUpdatedAt}
                className="pointer-events-auto shrink-0 pl-1 text-[10px] tabular-nums leading-none text-muted-foreground/70"
              >
                {age}
              </span>
            ) : null}
          </span>
        </button>
      )}

      {!rename.editing && hoverActionCount > 0 ? (
        <span
          data-boring-workspace-part="app-session-actions"
          data-action-count={hoverActionCount}
          className={cn(
            // Keep the reserved action hit area above the row button at all
            // times. Toggling pointer-events only after hover creates a race
            // where the underlying session button can win the same click.
            "app-left-session-actions pointer-events-auto absolute inset-y-0 right-1 z-10 flex items-center justify-end gap-0.5 opacity-0",
            actionWidthClassName,
            "group-hover:opacity-100 group-focus-within:opacity-100",
          )}
        >
          {splitAvailable ? (
            <button
              type="button"
              draggable={false}
              aria-label={`Open ${title} in a split pane`}
              title="Open in split pane"
              onClick={() => onOpenAsPane?.(session.id)}
              className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Columns2 className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            </button>
          ) : null}
          {detachAvailable ? (
            <button
              type="button"
              draggable={false}
              aria-label={`Open ${title} as a quick chat`}
              title="Open as quick chat"
              onClick={() => onOpenDetached?.(session.id)}
              className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Zap className="size-3.5" strokeWidth={1.85} aria-hidden="true" />
            </button>
          ) : null}
          {showMenu ? (
          <AppSessionActionsMenu
            sessionId={session.id}
            title={title}
            canCopy={canCopy}
            canRename={renameAvailable}
            // The split action now lives directly on hover; repeating it in
            // the menu is the redundancy the owner rejected.
            canSplit={false}
            canPin={pinAvailable}
            pinned={pinned}
            onOpenAsPane={onOpenAsPane}
            onTogglePinned={onTogglePinned}
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
