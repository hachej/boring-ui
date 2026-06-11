import type { ReactNode } from "react"
import { cn } from "../lib/utils"
import { ChatPaneStageDock } from "./ChatPaneStageDock"
import { ChatPaneStageFlex } from "./ChatPaneStageFlex"

export interface ChatPaneDescriptor {
  id: string
  title?: string | null
  panel?: string
  params?: Record<string, unknown>
}

/**
 * Layout engine for the chat pane stage.
 *
 * - `flex` (default): panes lay out as a single row of vertical splits.
 * - `dock`: dockview-backed stage — drag pane headers to split in any
 *   direction and resize; geometry persists per workspace.
 *
 * Resolution order: explicit prop, then the
 * `boring-workspace:chat-pane-engine` localStorage override, then `flex`.
 */
export type ChatPaneEngine = "flex" | "dock"

const ENGINE_STORAGE_KEY = "boring-workspace:chat-pane-engine"

export function resolveChatPaneEngine(preferred?: ChatPaneEngine | null): ChatPaneEngine {
  if (preferred === "dock" || preferred === "flex") return preferred
  try {
    const stored = globalThis.localStorage?.getItem(ENGINE_STORAGE_KEY)
    if (stored === "dock" || stored === "flex") return stored
  } catch {
    // Storage may be unavailable; fall through to the default.
  }
  return "flex"
}

export interface ChatPaneStageProps {
  panes: ChatPaneDescriptor[]
  activePaneId?: string | null
  renderPane: (pane: ChatPaneDescriptor) => ReactNode
  onActivePaneChange?: (id: string) => void
  onClosePane?: (id: string) => void
  /**
   * Pane to flash with a brief highlight ring — feedback when an action
   * targets a pane that is already visible (e.g. "open as pane" on an open
   * session). The parent clears it after a beat; the fade-out is CSS.
   */
  flashPaneId?: string | null
  /**
   * Dock engine only: persist the dockview layout (splits, sizes) under
   * `${storageKey}:chatPaneLayout`.
   */
  storageKey?: string
  /**
   * Called when a session is dropped onto the stage (drag a session-browser
   * row in). The parent opens the session as a pane; the dock engine places
   * it where it was dropped.
   */
  onDropSession?: (sessionId: string) => void
  engine?: ChatPaneEngine | null
}

export function ChatPaneStage({ engine, ...props }: ChatPaneStageProps) {
  return resolveChatPaneEngine(engine) === "dock"
    ? <ChatPaneStageDock {...props} />
    : <ChatPaneStageFlex {...props} />
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
 * The active-pane focus treatment shared by both engines: a soft rounded
 * inset ring that fades in and out instead of popping, with a slightly
 * stronger variant while a pane is flashed. Neutral by design — it should
 * read like keyboard focus in a pro editor, not a colored selection.
 */
export function PaneFocusRing({ active, flash }: { active: boolean; flash: boolean }) {
  return (
    <div
      aria-hidden="true"
      data-boring-workspace-part="chat-pane-focus-ring"
      className={cn(
        "pointer-events-none absolute inset-0 z-30",
        "transition-[opacity,box-shadow] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
        active || flash ? "opacity-100" : "opacity-0",
        flash
          ? "shadow-[inset_0_0_0_2px_oklch(from_var(--foreground)_l_c_h/0.55)]"
          : "bg-[color:oklch(from_var(--foreground)_l_c_h/0.025)] shadow-[inset_0_0_0_1px_oklch(from_var(--foreground)_l_c_h/0.22)]",
      )}
    />
  )
}
