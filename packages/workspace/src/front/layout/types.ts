import type { ReactNode } from "react"

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
