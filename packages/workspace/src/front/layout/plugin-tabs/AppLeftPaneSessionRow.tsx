"use client"

import { useEffect, useRef, useState } from "react"
import { Clock3, MessageSquarePlus, Pencil, Pin, X } from "lucide-react"
import { cn } from "../../lib/utils"
import { CHAT_SESSION_DRAG_TYPE } from "../ChatPaneStage"
import type { WorkspaceAttentionSessionBadge } from "../../attention/WorkspaceAttentionProvider"
import type { AppLeftPaneSession } from "./AppLeftPane"

export type AppSessionRowState = "normal" | "open" | "active"

function sessionBadgeToneClassName(tone: WorkspaceAttentionSessionBadge["tone"]): string {
  switch (tone) {
    case "danger": return "bg-destructive/12 text-destructive"
    case "warning": return "bg-amber-500/12 text-amber-700 dark:text-amber-300"
    case "neutral": return "bg-foreground/[0.07] text-muted-foreground"
    default: return "bg-[color:var(--accent)]/12 text-[color:var(--accent)]"
  }
}

function isBrowserDraftSession(session: AppLeftPaneSession): boolean {
  return (session as { browserDraft?: { kind?: unknown } }).browserDraft?.kind === "new-native"
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
  onDelete?: (id: string) => void
}) {
  const title = session.title || "Untitled"
  const [editingTitle, setEditingTitle] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rowRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const savingRef = useRef(false)
  const cancelledRef = useRef(false)
  const isEditing = editingTitle !== null
  const canRenameSession = Boolean(onRename) && !isBrowserDraftSession(session)
  useEffect(() => {
    if (isEditing) inputRef.current?.focus()
  }, [isEditing])
  const cancelRename = () => {
    cancelledRef.current = true
    setEditingTitle(null)
    setError(null)
  }
  const commitRename = () => {
    if (cancelledRef.current || savingRef.current) return
    const next = (editingTitle ?? "").trim()
    if (!next) {
      setError("Session title is required")
      return
    }
    if (!onRename) return
    savingRef.current = true
    setSaving(true)
    setError(null)
    void Promise.resolve(onRename(session.id, next)).then(() => {
      setEditingTitle(null)
    }).catch((err) => {
      setError(err instanceof Error ? err.message : "Rename failed")
    }).finally(() => {
      savingRef.current = false
      setSaving(false)
    })
  }
  const activate = () => {
    if (state !== "active") onSwitch(session.id)
  }
  useEffect(() => {
    if (!isEditing) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node) || inputRef.current?.contains(target)) return
      // In-row actions own their clicks; only interactions outside the row
      // commit the active edit.
      if (rowRef.current?.contains(target)) return
      commitRename()
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [isEditing, commitRename])

  return (
    <div
      ref={rowRef}
      data-boring-workspace-part="app-session-row"
      data-boring-session-state={state}
      // Drag a session onto the chat stage to open it as a split pane (the
      // stage accepts CHAT_SESSION_DRAG_TYPE; see ChatPaneStageDock). Only
      // same-project sessions are draggable — a split pane lives in the loaded
      // workspace's stage, so cross-project sessions can't join it.
      draggable={canSplit && !isEditing}
      onDragStart={canSplit ? (event) => {
        if (isEditing) return
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
      {isEditing ? (
        <span className="min-w-0 flex-1">
          <input
            ref={inputRef}
            value={editingTitle ?? ""}
            disabled={saving}
            onChange={(event) => setEditingTitle(event.currentTarget.value)}
            onClick={(event) => event.stopPropagation()}
            onBlur={(event) => {
              // Moving to an in-row action (pin, split, delete) must not
              // accidentally commit before that action handles the click.
              if (event.currentTarget.closest('[data-boring-workspace-part="app-session-row"]')?.contains(event.relatedTarget)) return
              commitRename()
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                commitRename()
              } else if (event.key === "Escape") {
                event.preventDefault()
                cancelRename()
              }
            }}
            aria-label={`Rename ${title}`}
            aria-invalid={error ? true : undefined}
            className="h-6 w-full rounded border border-border bg-background px-1.5 text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60"
          />
          {error ? <span className="sr-only" role="alert">{error}</span> : null}
        </span>
      ) : (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            activate()
          }}
          disabled={state === "active"}
          className="min-w-0 flex-1 truncate rounded text-left text-[13px] font-medium leading-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-default"
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
      {/* "Open in new chat pane" only for closed, same-project sessions —
          it's pointless once open, and a cross-project session can't share
          this workspace's split stage. */}
      {canRenameSession || (state === "normal" && canSplit) || onDelete ? (
        <span
          data-boring-workspace-part="app-session-actions"
          className="flex w-0 shrink-0 items-center gap-0.5 overflow-hidden opacity-0 transition-[width,opacity,margin] group-hover:ml-1 group-hover:w-auto group-hover:opacity-100 group-focus-within:ml-1 group-focus-within:w-auto group-focus-within:opacity-100"
        >
          {canRenameSession && !isEditing ? (
            <button
              type="button"
              aria-label={`Rename ${title}`}
              title="Rename"
              onClick={(event) => {
                event.stopPropagation()
                cancelledRef.current = false
                setEditingTitle(title)
                setError(null)
              }}
              className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          ) : null}
          {state === "normal" && canSplit ? (
            <button
              type="button"
              aria-label={`Open ${title} in new chat pane`}
              title="Open in new chat pane"
              onClick={(event) => {
                event.stopPropagation()
                onOpenAsPane(session.id)
              }}
              className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <MessageSquarePlus className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          ) : null}
          {onDelete ? (
            <button
              type="button"
              aria-label={`Delete ${title}`}
              title="Delete"
              onClick={(event) => {
                event.stopPropagation()
                onDelete(session.id)
              }}
              className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          ) : null}
        </span>
      ) : null}
    </div>
  )
}
