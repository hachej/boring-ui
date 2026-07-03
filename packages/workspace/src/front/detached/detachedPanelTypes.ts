import type { ReactNode } from "react"

export interface DetachedPanelPosition {
  left: number
  top: number
}

export interface DetachedPanelSize {
  width: number
  height: number
}

export interface DetachedPanelPopoverProps {
  title: ReactNode
  subtitle?: ReactNode
  icon?: ReactNode
  initialPosition: DetachedPanelPosition
  size?: Partial<DetachedPanelSize>
  ariaLabel: string
  onClose: () => void
  onDock?: () => void
  children: ReactNode
  footer?: ReactNode
}
