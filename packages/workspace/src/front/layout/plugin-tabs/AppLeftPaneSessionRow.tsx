"use client"

import { useRef, useState, type CSSProperties, type ReactNode } from "react"
import { Columns2, MessageSquare, Pin, Zap } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@hachej/boring-ui-kit"
import { cn } from "../../lib/utils"
import { CHAT_SESSION_DRAG_TYPE } from "../ChatPaneStage"
import type { WorkspaceAttentionSessionBadge } from "../../attention/WorkspaceAttentionProvider"
import type { AppLeftPaneSession } from "./AppLeftPane"
import { AppSessionActionItems, AppSessionActionsMenu, AppSessionContextMenu, hasAppSessionActions } from "./AppSessionActionsMenu"
import { InlineSessionRename, useInlineSessionRename } from "./InlineSessionRename"
import { encodeWorkspaceSessionDrag } from "../../sessionIdentity"
import { resolveSessionTrailingSlot, type SessionTrailingBadge, type SessionTrailingMarker } from "./appSessionRowTrailing"

export type AppSessionRowState = "normal" | "open" | "active"

/**
 * A row verb can live in two places: directly on the row (revealed on hover /
 * focus-within) or inside the menu. Which of the two a surface picks is a
 * frequency judgement, not a capability one — so the row takes both lists and
 * never decides for its host.
 */
export type AppSessionRowShortcut = "split" | "quick"

const DEFAULT_HOVER_SHORTCUTS: readonly AppSessionRowShortcut[] = ["split", "quick"]

/**
 * The split / detach hover shortcuts differ only by icon, words and handler.
 * Their size carries NO Tailwind size utility on purpose: it IS the slot the
 * strip reserves for it, read straight off `--app-session-action-slot` by
 * `.app-left-session-secondary-action` in globals.css. One number, one place —
 * see the comment beside that rule.
 */
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
      className="app-left-session-secondary-action grid shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {icon}
    </button>
  )
}

function sessionBadgeToneClassName(tone: WorkspaceAttentionSessionBadge["tone"]): string {
  switch (tone) {
    case "danger": return "bg-destructive/12 text-destructive"
    case "warning": return "bg-[color:oklch(from_var(--attention)_l_c_h/0.14)] text-[color:var(--attention)]"
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
  showPlacementShortcuts = true,
  hoverShortcuts = DEFAULT_HOVER_SHORTCUTS,
  leadingGlyph = "chat",
  menuShortcuts,
  placementScope = "unopened",
  confirmDelete = false,
  ownerLabel,
  leadingBadge,
  metaTag,
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
  /** Keep quick/split hover actions out of deeply nested or touch-constrained rows. */
  showPlacementShortcuts?: boolean
  /** Verbs that get their own hover-revealed icon. Default: the two placements. */
  hoverShortcuts?: readonly AppSessionRowShortcut[]
  /** Placement verbs the menu repeats. Default: none — the row icons carry them. */
  menuShortcuts?: readonly AppSessionRowShortcut[]
  /**
   * The fallback mark in the leading slot when nothing else claims it. "none"
   * keeps the slot (alignment is shared with rows that DO carry a chip) and
   * draws nothing: a chat glyph on every row of a list of chats states the
   * obvious, and it appeared on exactly the rows the Agent chip skips, so it
   * read as a distinction rather than as a default.
   */
  leadingGlyph?: "chat" | "none"
  /** Whether a chat already on stage still offers the placement verbs. */
  placementScope?: "unopened" | "always"
  /** Route Delete through a confirmation instead of firing it straight off the menu. */
  confirmDelete?: boolean
  ownerLabel?: string
  /**
   * Takes over the leading slot (normally the chat glyph / working dot) when a
   * surface identifies its rows by something stronger than "this is a chat" —
   * the console spike puts the owning Agent's colour chip here. Opt-in: rows
   * that pass nothing keep the glyph.
   */
  leadingBadge?: ReactNode
  /**
   * A quiet inline tag between the title and the trailing slot (the spike's
   * project tag). It lives OUTSIDE the trailing slot on purpose: that slot's
   * width ladder in globals.css is keyed to one badge + one marker, and the
   * tag answers a third question ("where does this chat live") that must not
   * cost the age or the attention badge their place.
   */
  metaTag?: ReactNode
  onSwitch?: (id: string) => void
  onOpenAsPane?: (id: string) => void
  onOpenDetached?: (id: string) => void
  onTogglePinned?: (id: string) => void
  onRename?: (id: string, title: string) => void | Promise<unknown>
  onDelete?: (id: string) => unknown
}) {
  const title = session.title || "Untitled"
  const [menuOpen, setMenuOpen] = useState(false)
  const [contextPoint, setContextPoint] = useState<{ x: number; y: number } | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const rowRef = useRef<HTMLDivElement | null>(null)
  const actionsAvailable = Boolean(onSwitch)
  const renameAvailable = Boolean(onRename) && session.nativeSessionId === session.id && session.hasAssistantReply === true
  const canCopy = session.ephemeral !== true
  // One rule, read by the row icon and the menu entry alike so the two can
  // never disagree about what is possible.
  //
  // `placementScope` decides whether the ACTIVE chat still offers them.
  // "unopened" is what the shipped hosts do: a chat already on stage gains
  // nothing from a second door onto itself. It has one bad consequence the
  // Console cannot live with — the menu silently loses two entries on exactly
  // one row, so the operator learns that right-click and "..." are unreliable
  // rather than that this chat is open. "always" keeps the verb list constant
  // per row-set and lets the active chat be pulled into a split view beside
  // another one, which is a real thing to want.
  const placementInScope = placementScope === "always" || state === "normal"
  const splitPossible = placementInScope && actionsAvailable && canSplit && Boolean(onOpenAsPane)
  const detachPossible = placementInScope && actionsAvailable && Boolean(onOpenDetached)
  const pinAvailable = canPin && Boolean(onTogglePinned)
  const wants = (list: readonly AppSessionRowShortcut[] | undefined, shortcut: AppSessionRowShortcut) =>
    Boolean(list?.includes(shortcut))
  const splitAvailable = showPlacementShortcuts && splitPossible && wants(hoverShortcuts, "split")
  const detachAvailable = showPlacementShortcuts && detachPossible && wants(hoverShortcuts, "quick")
  // Whatever a hover icon does not carry stays reachable in the menu.
  const menuSplitAvailable = splitPossible && wants(menuShortcuts, "split")
  const menuDetachAvailable = detachPossible && wants(menuShortcuts, "quick")
  const menuProps = {
    canCopy,
    canRename: renameAvailable,
    canPin: pinAvailable,
    canOpenAsPane: menuSplitAvailable,
    canOpenDetached: menuDetachAvailable,
    onDelete,
    onTogglePinned,
  }
  const showMenu = hasAppSessionActions(menuProps)
  // One slot per visible action; the pixel size of a slot lives in CSS (one
  // number per breakpoint) instead of a hardcoded width ladder that desktop and
  // mobile had already computed differently.
  const hoverActionCount = (showMenu ? 1 : 0)
    + (splitAvailable ? 1 : 0)
    + (detachAvailable ? 1 : 0)
  const actionSlotStyle = { "--app-session-action-slots": hoverActionCount } as CSSProperties
  // The dot is painted only under all three conditions; the resolver needs
  // that computed fact, not the `activeDot` prop that merely allows it.
  // A leading badge has taken the slot the dot would paint into, so the dot is
  // not shown and the trailing "working" badge must carry that state instead.
  const workingDotShown = !leadingBadge && activeDot && activeDotActive && working
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
  // Closing a menu that was opened at the pointer has nowhere to hand focus
  // back to, so the row takes it: the keyboard stays where the operator was.
  const focusRow = () => rowRef.current?.querySelector<HTMLElement>("button")?.focus()
  // Closing the menu normally hands focus back to the row. When the menu is
  // closing BECAUSE a dialog is opening, that same courtesy is a focus steal:
  // the row wins the race and the alert dialog opens with focus outside itself,
  // so its trap is never entered and Escape/Tab land on the list behind it.
  const openingDialogRef = useRef(false)
  const requestDelete = onDelete
    ? confirmDelete
      ? () => { openingDialogRef.current = true; setDeleteConfirmOpen(true) }
      : (id: string) => onDelete(id)
    : undefined
  const actionItems = (closeMenu: () => void) => (
    <AppSessionActionItems
      sessionId={session.id}
      title={title}
      {...menuProps}
      pinned={pinned}
      onRename={rename.begin}
      {...(onOpenAsPane ? { onOpenAsPane: () => onOpenAsPane(session.id) } : {})}
      {...(onOpenDetached ? { onOpenDetached: () => onOpenDetached(session.id) } : {})}
      {...(requestDelete ? { onDelete: requestDelete } : {})}
      onCloseMenu={closeMenu}
    />
  )
  const rowClassName = cn(
    "app-left-session-line flex h-full w-full items-center rounded-md text-left transition-colors motion-reduce:transition-none",
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
  // A compact row narrows the leading slot to a 12px spacer because it usually
  // holds nothing but the working dot. A leading badge needs the full slot.
  const leadingSlotClassName = compact && !leadingBadge
    ? "relative grid h-5 w-3 shrink-0 place-items-center"
    : "relative grid size-5 shrink-0 place-items-center"

  return (
    <div
      ref={rowRef}
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
      // Right-click is the second door onto the SAME panel the "..." opens.
      // Suppressed while renaming, where the native menu (cut/paste/undo) is
      // the useful one.
      onContextMenu={showMenu && !rename.editing ? (event) => {
        event.preventDefault()
        setContextPoint({ x: event.clientX, y: event.clientY })
      } : undefined}
      // F2 is the platform's rename key, and every list that supports rename
      // is expected to answer it. It stays gated by the same eligibility rule
      // as the menu entry, so the two never disagree.
      onKeyDown={renameAvailable && !rename.editing ? (event) => {
        if (event.key !== "F2") return
        event.preventDefault()
        rename.begin()
      } : undefined}
      className={cn("app-left-session-row group relative w-full", compact ? "h-[29px]" : "h-[30px]")}
    >
      {rename.field ? (
        <div className={rowClassName}>
          <span className={leadingSlotClassName} aria-hidden="true">
            {leadingBadge ?? (leadingGlyph === "chat"
              ? <MessageSquare className="h-4 w-4 text-[color:var(--accent)]" strokeWidth={1.75} />
              : null)}
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
          <span className={leadingSlotClassName} aria-hidden={activeDot || leadingBadge ? undefined : "true"}>
            {leadingBadge ? leadingBadge : activeDot ? (
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
            ) : leadingGlyph === "chat" ? (
              <MessageSquare
                className={cn("h-4 w-4", state === "active" ? "text-[color:var(--accent)]" : "text-muted-foreground/65")}
                strokeWidth={1.75}
              />
            ) : null}
          </span>
          {/* The title is the LAST thing allowed to lose room. Its floor lives
              in globals.css beside the tag's ceiling, because the two are one
              decision: what the row spends its width on. Measured before that
              rule existed, in a 259px row: title 44px, project tag 81px,
              trailing slot 84px — the chat's NAME clipped to "Com…" while its
              metadata got three times the space. */}
          <span
            data-boring-workspace-part="app-session-title"
            className={cn("app-left-session-title min-w-0 flex-1 truncate text-[13px] leading-5", state === "active" ? "font-semibold" : "font-medium")}
          >
            {title}
          </span>
          {metaTag ? (
            // Fades with the trailing slot so the hover actions get the whole
            // right edge rather than sharing it with a tag.
            <span
              data-boring-workspace-part="app-session-meta-tag"
              className="app-left-session-meta-tag flex min-w-0 items-center overflow-hidden pl-1 group-hover:opacity-0 group-focus-within:opacity-0"
            >
              {metaTag}
            </span>
          ) : null}
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
            "app-left-session-actions absolute inset-y-0 right-1 z-10 flex items-center justify-end opacity-0",
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
            <AppSessionActionsMenu title={title} onOpenChange={setMenuOpen}>
              {actionItems(() => setMenuOpen(false))}
            </AppSessionActionsMenu>
          ) : null}
        </span>
      ) : null}

      {showMenu ? (
        <AppSessionContextMenu
          title={title}
          point={contextPoint}
          onPointChange={setContextPoint}
          onOpenChange={(open) => {
            setMenuOpen(open)
            if (open || openingDialogRef.current) return
            focusRow()
          }}
        >
          {actionItems(() => setContextPoint(null))}
        </AppSessionContextMenu>
      ) : null}

      {confirmDelete && onDelete ? (
        <AlertDialog
          open={deleteConfirmOpen}
          onOpenChange={(open) => {
            setDeleteConfirmOpen(open)
            if (!open) { openingDialogRef.current = false; focusRow() }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
              <AlertDialogDescription>
                “{title}” and its transcript are removed for good.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              {/* First focusable in the content, so the trap opens on the
                  non-destructive choice. */}
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                data-boring-workspace-part="app-session-delete-confirm"
                variant="destructive"
                onClick={() => { void onDelete(session.id) }}
              >
                Delete chat
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  )
}
