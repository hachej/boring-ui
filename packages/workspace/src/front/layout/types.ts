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
  sidebar?: string | null
  sidebarParams?: Record<string, unknown>
  onOpenNav?: () => void
  onOpenSurface?: () => void
  className?: string
}
