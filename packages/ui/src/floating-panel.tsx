import * as React from 'react'
import { cn } from './lib'

export type FloatingPanelProps = React.ComponentProps<'div'>

function FloatingPanel({ className, ...props }: FloatingPanelProps) {
  return (
    <div
      data-slot="floating-panel"
      className={cn('rounded-lg border border-border/70 bg-[color:var(--surface-workbench-left,var(--background))] p-2 text-foreground shadow-2xl', className)}
      {...props}
    />
  )
}

export type FloatingPanelHeaderProps = React.ComponentProps<'div'>
function FloatingPanelHeader({ className, ...props }: FloatingPanelHeaderProps) {
  return <div data-slot="floating-panel-header" className={cn('flex items-center justify-between gap-2 border-b border-border px-1 pb-2', className)} {...props} />
}

export type FloatingPanelBodyProps = React.ComponentProps<'div'>
function FloatingPanelBody({ className, ...props }: FloatingPanelBodyProps) {
  return <div data-slot="floating-panel-body" className={cn('py-1', className)} {...props} />
}

export { FloatingPanel, FloatingPanelHeader, FloatingPanelBody }
