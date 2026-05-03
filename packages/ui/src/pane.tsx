import * as React from 'react'
import { cn } from './lib'

export function Pane({ className, ...props }: React.ComponentProps<'section'>) {
  return <section data-slot="pane" className={cn('flex min-h-0 flex-col rounded-lg border bg-card text-card-foreground', className)} {...props} />
}

export function PaneHeader({ className, ...props }: React.ComponentProps<'header'>) {
  return <header data-slot="pane-header" className={cn('flex min-h-11 items-center justify-between gap-3 border-b px-3', className)} {...props} />
}

export function PaneTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  return <h2 data-slot="pane-title" className={cn('truncate text-sm font-semibold', className)} {...props} />
}

export function PaneDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return <p data-slot="pane-description" className={cn('text-xs text-muted-foreground', className)} {...props} />
}

export function PaneBody({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="pane-body" className={cn('min-h-0 flex-1 overflow-auto p-3', className)} {...props} />
}

export function PaneFooter({ className, ...props }: React.ComponentProps<'footer'>) {
  return <footer data-slot="pane-footer" className={cn('flex items-center justify-end gap-2 border-t px-3 py-2', className)} {...props} />
}

export function PaneToolbar({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="pane-toolbar" className={cn('flex items-center gap-1', className)} {...props} />
}
