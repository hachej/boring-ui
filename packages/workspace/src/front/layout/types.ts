import type { ReactNode } from "react"
import type { ChatPaneDescriptor, ChatPanePendingPlacement, ChatPaneSplitDirection } from "./ChatPaneStage"

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
  /** Optional host actions rendered in each chat pane header. */
  chatTopActions?: ReactNode
  activeChatPaneId?: string | null
  onActiveChatPaneChange?: (id: string) => void
  onCloseChatPane?: (id: string) => void
  onCreateChatPaneAfter?: (id: string) => void
  onSplitChatPane?: (id: string, direction: ChatPaneSplitDirection) => void
  pendingChatPanePlacement?: ChatPanePendingPlacement | null
  onDropChatSession?: (sessionId: string) => void
  flashChatPaneId?: string | null
  surface?: string | null
  surfaceParams?: Record<string, unknown>
  /** Opaque overlay rendered over the full chat stage only (not over the workbench). */
  chatOverlay?: ReactNode
  /** Called when shell chrome needs to dismiss the chat overlay before collapsing chat. */
  onCloseChatOverlay?: () => void
  surfaceOverlay?: ReactNode
  sidebar?: string | null
  sidebarParams?: Record<string, unknown>
  storageKey?: string
  /** Enable the phone-width one-surface mobile shell for direct ChatLayout hosts. */
  mobileShellEnabled?: boolean
  onOpenNav?: () => void
  onOpenSurface?: () => void
  surfaceButtonBottomOffset?: number
  onOpenSidebar?: () => void
  className?: string
}
