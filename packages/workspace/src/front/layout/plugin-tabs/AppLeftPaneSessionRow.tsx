"use client"

import { Clock3, MessageSquarePlus, Pin } from "lucide-react"
import { cn } from "../../lib/utils"
import { CHAT_SESSION_DRAG_TYPE } from "../ChatPaneStage"
import type { AppLeftPaneSession } from "./AppLeftPane"

export type AppSessionRowState = "normal" | "open" | "active"

export function AppSessionRow({
  session,
  state,
  pinned,
  canSplit = true,
  canPin = true,
  onSwitch,
  onOpenAsPane,
  onTogglePinned,
}: {
  session: AppLeftPaneSession
  state: AppSessionRowState
  pinned: boolean
  /** Whether this session can be split-paned/dragged (same-project only). */
  canSplit?: boolean
  /** Whether this session belongs to the active project's pinned-session scope. */
  canPin?: boolean
  onSwitch: (id: string) => void
  onOpenAsPane: (id: string) => void
  onTogglePinned: (id: string) => void
}) {
  const title = session.title || "Untitled"
  const activate = () => {
    if (state !== "active") onSwitch(session.id)
  }

  return (
    <div
      data-boring-workspace-part="app-session-row"
      data-boring-session-state={state}
      // Drag a session onto the chat stage to open it as a split pane (the
      // stage accepts CHAT_SESSION_DRAG_TYPE; see ChatPaneStageDock). Only
      // same-project sessions are draggable — a split pane lives in the loaded
      // workspace's stage, so cross-project sessions can't join it.
      draggable={canSplit}
      onDragStart={canSplit ? (event) => {
        event.dataTransfer.setData(CHAT_SESSION_DRAG_TYPE, session.id)
        event.dataTransfer.setData("text/plain", title)
        event.dataTransfer.effectAllowed = "copyMove"
      } : undefined}
      className={cn(
        "group flex min-h-8 w-full items-center gap-2 rounded-md border px-2.5 py-1 text-left transition-colors",
        state === "active"
          // Subtle accent-tinted fill, no heavy colored border (Linear/Stripe style).
          ? "border-transparent bg-[color:oklch(from_var(--accent)_l_c_h/0.14)] text-foreground"
          : state === "open"
            ? "border-transparent bg-foreground/[0.05] text-foreground/90 hover:bg-foreground/[0.07]"
            : "border-transparent text-foreground/78 hover:bg-foreground/[0.055] hover:text-foreground",
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
      <button
        type="button"
        onClick={activate}
        disabled={state === "active"}
        className="min-w-0 flex-1 truncate rounded text-left text-[13px] font-medium leading-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-default"
        title={title}
      >
        {title}
      </button>
      <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {canPin ? (
          <button
            type="button"
            aria-label={pinned ? `Unpin ${title}` : `Pin ${title}`}
            title={pinned ? "Unpin" : "Pin"}
            aria-pressed={pinned}
            onClick={() => onTogglePinned(session.id)}
            className={cn(
              "grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              pinned && "text-[color:var(--accent)]",
            )}
          >
            <Pin className={cn("h-3.5 w-3.5", pinned && "fill-current")} strokeWidth={1.75} />
          </button>
        ) : null}
        {/* "Open in new chat pane" only for closed, same-project sessions —
            it's pointless once open, and a cross-project session can't share
            this workspace's split stage. */}
        {state === "normal" && canSplit ? (
          <button
            type="button"
            aria-label={`Open ${title} in new chat pane`}
            title="Open in new chat pane"
            onClick={() => onOpenAsPane(session.id)}
            className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <MessageSquarePlus className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        ) : null}
      </span>
    </div>
  )
}
