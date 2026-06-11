import type { ReactNode } from "react"
import type { ChatPaneDescriptor } from "./ChatPaneStage"

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
  onDropChatSession?: (sessionId: string) => void
  flashChatPaneId?: string | null
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
