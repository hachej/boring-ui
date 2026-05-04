import * as React from 'react'
import { cn } from './lib'

export type ResizeHandleOrientation = 'vertical' | 'horizontal'

export type ResizeHandleProps = Omit<React.ComponentProps<'div'>, 'onPointerDown'> & {
  orientation?: ResizeHandleOrientation
  onResizeStart?: (event: React.PointerEvent<HTMLDivElement>) => void
}

function ResizeHandle({
  className,
  orientation = 'vertical',
  onResizeStart,
  role = 'separator',
  tabIndex = 0,
  ...props
}: ResizeHandleProps) {
  return (
    <div
      data-slot="resize-handle"
      data-orientation={orientation}
      role={role}
      aria-orientation={orientation}
      tabIndex={tabIndex}
      onPointerDown={onResizeStart}
      className={cn(
        'shrink-0 touch-none select-none bg-transparent transition-colors hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
        orientation === 'vertical' ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize',
        className,
      )}
      {...props}
    />
  )
}

export { ResizeHandle }
