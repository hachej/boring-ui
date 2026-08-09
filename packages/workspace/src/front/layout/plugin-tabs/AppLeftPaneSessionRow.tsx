"use client"

import { useState, type CSSProperties, type ReactNode } from "react"
import { Columns2, MessageSquare, Pin, Zap } from "lucide-react"
import { cn } from "../../lib/utils"
import { CHAT_SESSION_DRAG_TYPE } from "../ChatPaneStage"
import type { WorkspaceAttentionSessionBadge } from "../../attention/WorkspaceAttentionProvider"
import type { AppLeftPaneSession } from "./AppLeftPane"
import { AppSessionActionsMenu } from "./AppSessionActionsMenu"
import { InlineSessionRename, useInlineSessionRename } from "./InlineSessionRename"
import { encodeWorkspaceSessionDrag } from "../../sessionIdentity"
import { resolveSessionTrailingSlot, type SessionTrailingBadge, type SessionTrailingMarker } from "./appSessionRowTrailing"

export type AppSessionRowState = "normal" | "open" | "active"

/** The split / detach hover shortcuts differ only by icon, words and handler. */
function SessionHoverAction({ icon, label, title, onClick }: {
  icon: ReactNode
  label: string
  title: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      draggable={false}
      aria-label={label}
      title={title}
      onClick={onClick}
      className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {icon}
    </button>
  )
}

function sessionBadgeToneClassName(tone: WorkspaceAttentionSessionBadge["tone"]): string {
  switch (tone) {
    case "danger": return "bg-destructive/12 text-destructive"
    case "warning": return "bg-amber-500/12 text-amber-700 dark:text-amber-300"
    case "neutral": return "bg-foreground/[0.07] text-muted-foreground"
    default: return "bg-[color:var(--accent)]/12 text-[color:var(--accent)]"
  }
}

function renderTrailingBadge(badge: SessionTrailingBadge): ReactNode {
  switch (badge.kind) {
    case "attention":
      return (
        <span
          data-boring-workspace-part="app-session-badge"
          data-boring-badge={badge.badge.kind}
          className={cn("pointer-events-none inline-flex max-w-full shrink-0 truncate rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none", sessionBadgeToneClassName(badge.badge.tone))}
        >
          {badge.badge.label}
        </span>
      )
    case "working":
      return (
        <span
          data-boring-workspace-part="app-session-badge"
          data-boring-badge="working"
          className="pointer-events-none inline-flex shrink-0 rounded-full bg-foreground/[0.07] px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground"
        >
          working
        </span>
      )
    case "none":
      return null
  }
}

function renderTrailingMarker(marker: SessionTrailingMarker): ReactNode {
  switch (marker.kind) {
    case "owner":
      return <span className="truncate text-[11px] font-medium text-muted-foreground">{marker.label}</span>
    case "pin":
      return <Pin className="h-3.5 w-3.5 shrink-0 fill-current text-[color:var(--accent)]" strokeWidth={1.75} aria-hidden="true" />
    case "age":
      return (
        <span
          data-boring-workspace-part="app-session-age"
          title={marker.title}
          className="pointer-events-auto shrink-0 pl-1 text-[11px] tabular-nums leading-none text-muted-foreground"
        >
          {marker.label}
        </span>
      )
    case "none":
      return null
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
  // the rest. One slot per visible action; the pixel size of a slot lives in
  // CSS (one number per breakpoint) instead of a hardcoded width ladder that
  // desktop and mobile had already computed differently.
  const hoverActionCount = (showMenu ? 1 : 0) + (splitAvailable ? 1 : 0) + (detachAvailable ? 1 : 0)
  const actionSlotStyle = { "--app-session-action-slots": hoverActionCount } as CSSProperties
  // The dot is painted only under all three conditions; the resolver needs
  // that computed fact, not the `activeDot` prop that merely allows it.
  const workingDotShown = activeDot && activeDotActive && working
  const trailing = resolveSessionTrailingSlot({
    ...(attentionBadge ? { attentionBadge } : {}),
    working,
    workingDotShown,
    ...(ownerLabel ? { ownerLabel } : {}),
    pinned,
    ...(session.updatedAt !== undefined ? { updatedAt: session.updatedAt } : {}),
    now: Date.now(),
  })
  // The resolver already computed this for the age tooltip; the row title
  // reuses it rather than recomputing the same timestamp a third time.
  const exactUpdatedAt = trailing.marker.kind === "age" ? trailing.marker.title : undefined
  // Sizing for every trailing variant lives in ONE layer (globals.css, beside
  // the action-slot calc). The row states WHAT the slot holds; CSS decides how
  // wide that is.
  const trailingVariant = trailing.marker.kind === "owner"
    ? "owner"
    : trailing.badge.kind !== "none" ? "badge"
    : trailing.reserveActions ? "empty" : "marker"
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
              workingDotShown ? (
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
            style={actionSlotStyle}
            data-trailing={trailingVariant}
            className="app-left-session-trailing flex shrink-0 justify-end overflow-hidden group-hover:opacity-0 group-focus-within:opacity-0"
          >
            {renderTrailingBadge(trailing.badge)}
            {renderTrailingMarker(trailing.marker)}
          </span>
        </button>
      )}

      {!rename.editing && hoverActionCount > 0 ? (
        <span
          data-boring-workspace-part="app-session-actions"
          style={actionSlotStyle}
          className={cn(
            // Keep the action hit area above the row button at all times.
            // Toggling pointer-events only after hover creates a race where
            // the underlying session button can win the same click. The
            // buttons own that hit area, not this container — see
            // .app-left-session-actions in globals.css.
            "app-left-session-actions absolute inset-y-0 right-1 z-10 flex items-center justify-end gap-0.5 opacity-0",
            "group-hover:opacity-100 group-focus-within:opacity-100",
          )}
        >
          {splitAvailable ? (
            <SessionHoverAction
              icon={<Columns2 className="size-3.5" strokeWidth={1.75} aria-hidden="true" />}
              label={`Open ${title} in a split pane`}
              title="Open in split pane"
              onClick={() => onOpenAsPane?.(session.id)}
            />
          ) : null}
          {detachAvailable ? (
            <SessionHoverAction
              icon={<Zap className="size-3.5" strokeWidth={1.85} aria-hidden="true" />}
              label={`Open ${title} as a quick chat`}
              title="Open as quick chat"
              onClick={() => onOpenDetached?.(session.id)}
            />
          ) : null}
          {showMenu ? (
          <AppSessionActionsMenu
            sessionId={session.id}
            title={title}
            canCopy={canCopy}
            canRename={renameAvailable}
            canPin={pinAvailable}
            pinned={pinned}
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
