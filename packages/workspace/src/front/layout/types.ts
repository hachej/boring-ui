import type { ReactNode } from "react"
import type { ChatPaneDescriptor, ChatPaneEngine } from "./ChatPaneStage"

export interface IdeLayoutProps {
  sidebar?: string
  center?: string
  right?: string
  className?: string
}

export interface ChatLayoutProps {
  nav?: string | null
  navParams?: Record<string, unknown>
  center?: string
  centerParams?: Record<string, unknown>
  chatPanes?: ChatPaneDescriptor[]
  activeChatPaneId?: string | null
  onActiveChatPaneChange?: (id: string) => void
  onCloseChatPane?: (id: string) => void
  onCreateChatPaneAfter?: (id: string) => void
  flashChatPaneId?: string | null
  /**
   * Chat stage layout engine. `dock` enables the dockview-backed stage
   * (drag headers to split in any direction); defaults to the flex row.
   * The `boring-workspace:chat-pane-engine` localStorage key overrides
   * when no explicit value is passed.
   */
  chatPaneEngine?: ChatPaneEngine | null
  surface?: string | null
  surfaceParams?: Record<string, unknown>
  surfaceOverlay?: ReactNode
  sidebar?: string | null
  sidebarParams?: Record<string, unknown>
  storageKey?: string
  onOpenNav?: () => void
  onOpenSurface?: () => void
  surfaceButtonBottomOffset?: number
  onOpenSidebar?: () => void
  className?: string
}
