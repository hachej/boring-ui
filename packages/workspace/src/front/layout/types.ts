export interface IdeLayoutProps {
  sidebar?: string
  center?: string
  right?: string
  className?: string
}

export interface ChatLayoutProps {
  nav?: string
  navParams?: Record<string, unknown>
  center?: string
  centerParams?: Record<string, unknown>
  surface?: string
  surfaceParams?: Record<string, unknown>
  sidebar?: string
  sidebarParams?: Record<string, unknown>
  className?: string
}
