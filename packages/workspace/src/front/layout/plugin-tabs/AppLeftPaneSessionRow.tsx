"use client"

import { useEffect, useRef, useState } from "react"
import { Clock3, Copy, MessageSquarePlus, MoreHorizontal, Pencil, Pin, Trash2 } from "lucide-react"
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

async function copyText(text: string, fallbackFocusTarget?: HTMLElement | null): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through to legacy copy for HTTP dev URLs or unfocused pages.
    }
  }
  if (typeof document === "undefined") return false
  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.top = "-9999px"
  textarea.style.left = "-9999px"
  textarea.style.opacity = "0"
  textarea.style.pointerEvents = "none"
  document.body.appendChild(textarea)
  try {
    textarea.focus()
    textarea.select()
    return document.execCommand?.("copy") ?? false
  } catch {
    return false
  } finally {
    document.body.removeChild(textarea)
    if (fallbackFocusTarget?.isConnected) fallbackFocusTarget.focus()
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
  const renameAvailable = Boolean(onRename && session.nativeSessionId === session.id && session.hasAssistantReply === true)
  const [editingTitle, setEditingTitle] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [renameRequested, setRenameRequested] = useState(false)
  const [copyStatus, setCopyStatus] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const savingRef = useRef(false)
  const cancelRequestedRef = useRef(false)
  const copyStatusTimeoutRef = useRef<number | undefined>(undefined)
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null)
  const suppressMenuTriggerDragRef = useRef(false)
  const isEditing = editingTitle !== null
  const canRename = renameAvailable && !isEditing
  // AppLeftPane only renders durable sessions; never offer copying an empty ID.
  const hasSessionMenu = session.id.length > 0

  useEffect(() => {
    return () => {
      if (copyStatusTimeoutRef.current !== undefined) window.clearTimeout(copyStatusTimeoutRef.current)
    }
  }, [])

  useEffect(() => {
    if (isEditing) inputRef.current?.focus()
  }, [isEditing])

  useEffect(() => {
    if (!renameRequested || menuOpen) return
    cancelRequestedRef.current = false
    setEditingTitle(title)
    setError(null)
    setRenameRequested(false)
  }, [menuOpen, renameRequested, title])

  const cancelRename = () => {
    cancelRequestedRef.current = true
    setEditingTitle(null)
    setError(null)
  }
  useEffect(() => {
    if (!renameAvailable && isEditing) cancelRename()
  }, [isEditing, renameAvailable])
  const saveRename = () => {
    if (!renameAvailable || !onRename || editingTitle === null || savingRef.current || cancelRequestedRef.current) return
    const nextTitle = editingTitle.trim()
    if (!nextTitle) {
      setError("Session title is required")
      return
    }
    if (nextTitle === title) {
      setEditingTitle(null)
      setError(null)
      return
    }
    savingRef.current = true
    setSaving(true)
    setError(null)
    void Promise.resolve(onRename(session.id, nextTitle))
      .then(() => setEditingTitle(null))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Rename failed"))
      .finally(() => {
        savingRef.current = false
        setSaving(false)
      })
  }
  const startRename = () => {
    setMenuOpen(false)
    setRenameRequested(true)
  }
  const copySessionId = () => {
    setCopyStatus(null)
    void copyText(session.id, menuTriggerRef.current).then((copied) => {
      setCopyStatus(copied ? "Session ID copied" : "Could not copy session ID")
      if (copyStatusTimeoutRef.current !== undefined) window.clearTimeout(copyStatusTimeoutRef.current)
      copyStatusTimeoutRef.current = window.setTimeout(() => setCopyStatus(null), 1200)
    })
  }
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
        // Browsers can dispatch dragstart on this draggable row even when a
        // nested button is draggable={false}. Remembering its pointer/mouse
        // origin closes that native-drag escape hatch before a payload is set.
        const startedOnMenuTrigger = menuTriggerRef.current?.contains(event.target as Node)
        if (isEditing || menuOpen || suppressMenuTriggerDragRef.current || startedOnMenuTrigger) {
          suppressMenuTriggerDragRef.current = false
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
      {isEditing ? (
        <span className="min-w-0 flex-1">
          <input
            ref={inputRef}
            value={editingTitle ?? ""}
            disabled={saving}
            onChange={(event) => setEditingTitle(event.currentTarget.value)}
            onClick={(event) => event.stopPropagation()}
            onBlur={() => saveRename()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                event.stopPropagation()
                saveRename()
              } else if (event.key === "Escape") {
                event.preventDefault()
                event.stopPropagation()
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
      {/* "Open in new chat pane" only for closed, same-project sessions —
          it's pointless once open, and a cross-project session can't share
          this workspace's split stage. */}
      {(state === "normal" && canSplit) || hasSessionMenu ? (
        <span
          data-boring-workspace-part="app-session-actions"
          className={cn(
            "flex max-w-0 shrink-0 items-center gap-0.5 overflow-hidden opacity-0 pointer-events-none transition-[max-width,opacity,margin] group-hover:ml-1 group-hover:max-w-32 group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:ml-1 group-focus-within:max-w-32 group-focus-within:opacity-100 group-focus-within:pointer-events-auto",
            menuOpen && "ml-1 max-w-32 opacity-100 pointer-events-auto",
          )}
        >
          {state === "normal" && canSplit && !isEditing ? (
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
          {hasSessionMenu ? (
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  ref={menuTriggerRef}
                  type="button"
                  draggable={false}
                  aria-label={`More options for ${title}`}
                  title="More"
                  onPointerDown={() => {
                    suppressMenuTriggerDragRef.current = true
                  }}
                  onMouseDown={() => {
                    suppressMenuTriggerDragRef.current = true
                  }}
                  onPointerUp={() => {
                    suppressMenuTriggerDragRef.current = false
                  }}
                  onPointerCancel={() => {
                    suppressMenuTriggerDragRef.current = false
                  }}
                  onMouseUp={() => {
                    suppressMenuTriggerDragRef.current = false
                  }}
                  onClick={(event) => event.stopPropagation()}
                  onDragStart={(event) => {
                    suppressMenuTriggerDragRef.current = false
                    event.preventDefault()
                    event.stopPropagation()
                  }}
                  className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                sideOffset={6}
                onClick={(event) => event.stopPropagation()}
                className="w-48 border-border/50 shadow-[0_12px_28px_-6px_rgba(0,0,0,0.55)]"
              >
                <DropdownMenuItem onSelect={copySessionId} className="gap-2 text-[13px]">
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  Copy session ID
                </DropdownMenuItem>
                {canRename || onDelete ? <DropdownMenuSeparator /> : null}
                {canRename ? (
                  <DropdownMenuItem onSelect={startRename} className="gap-2 text-[13px]">
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    Rename
                  </DropdownMenuItem>
                ) : null}
                {canRename && onDelete ? <DropdownMenuSeparator /> : null}
                {onDelete ? (
                  <DropdownMenuItem onSelect={() => onDelete(session.id)} variant="destructive" className="gap-2 text-[13px]">
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Delete
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </span>
      ) : null}
      {copyStatus ? <span className="sr-only" role="status" aria-live="polite">{copyStatus}</span> : null}
    </div>
  )
}
