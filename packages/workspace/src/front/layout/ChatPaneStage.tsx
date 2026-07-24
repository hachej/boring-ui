import type { ReactNode } from "react"
import { cn } from "../lib/utils"
import { ChatPaneStageDock } from "./ChatPaneStageDock"

export interface ChatPaneDescriptor {
  id: string
  title?: string | null
  panel?: string
  params?: Record<string, unknown>
}

export type ChatPaneSplitDirection = "right" | "below"

export interface ChatPanePendingPlacement {
  paneId: string
  referencePaneId: string | null
  direction: ChatPaneSplitDirection
}

export interface ChatPaneStageProps {
  panes: ChatPaneDescriptor[]
  activePaneId?: string | null
  renderPane: (pane: ChatPaneDescriptor) => ReactNode
  /** Optional host actions rendered in each chat pane header. */
  topActions?: ReactNode
  /** Create a new chat pane split from the requested pane. */
  onSplitPane?: (id: string, direction: ChatPaneSplitDirection) => void
  /** One-shot placement for a newly-created pane. */
  pendingPanePlacement?: ChatPanePendingPlacement | null
  onActivePaneChange?: (id: string) => void
  onClosePane?: (id: string) => void
  /**
   * Pane to flash with a brief highlight ring — feedback when an action
   * targets a pane that is already visible (e.g. "open as pane" on an open
   * session). The parent clears it after a beat; the fade-out is CSS.
   */
  flashPaneId?: string | null
  /**
   * Persist the dockview layout (splits, sizes) under
   * `${storageKey}:chatPaneLayout`.
   */
  storageKey?: string
  /**
   * Called when a session is dropped onto the stage (drag a session-browser
   * row in). The parent opens the session as a pane placed where it was
   * dropped.
   */
  onDropSession?: (sessionId: string) => void
}

/**
 * Chat pane stage: a dockview-backed surface where each open session is a
 * pane. Drag flat pane headers to split in any direction, drag a session
 * row in to open it at a drop position, resize — geometry persists per
 * workspace.
 */
export function ChatPaneStage(props: ChatPaneStageProps) {
  return <ChatPaneStageDock {...props} />
}

export function paneTitle(pane: { title?: string | null }): string {
  return pane.title || "Untitled"
}

/**
 * DataTransfer type for dragging a chat session (e.g. a session-browser row)
 * into the chat stage. The payload is the session id.
 */
export const CHAT_SESSION_DRAG_TYPE = "application/x-boring-chat-session"

/**
 * The pane focus treatment shared by both engines: the selected chat stays
 * white while the others recede behind a faint grey wash — no border on the
 * active pane, the background contrast alone marks the selection. Flash is a
 * stronger transient ring for open-as-pane feedback.
 */
export function PaneFocusRing({ dimmed, flash }: { active?: boolean; dimmed: boolean; flash: boolean }) {
  return (
    <div
      aria-hidden="true"
      data-boring-workspace-part="chat-pane-focus-ring"
      className={cn(
        "pointer-events-none absolute inset-0 z-30",
        "transition-[background-color,box-shadow] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
        dimmed && !flash && "bg-[color:oklch(from_var(--foreground)_l_c_h/0.035)]",
        flash && "shadow-[inset_0_0_0_2px_oklch(from_var(--foreground)_l_c_h/0.55)]",
      )}
    />
  )
}
