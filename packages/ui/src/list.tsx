import * as React from 'react'
import { cn } from './lib'

export type ListProps = React.ComponentProps<'div'>

function List({ className, ...props }: ListProps) {
  return <div data-slot="list" className={cn('divide-y divide-border/60', className)} {...props} />
}

export type ListRowProps = React.ComponentProps<'div'> & {
  interactive?: boolean
}

function ListRow({ className, interactive, ...props }: ListRowProps) {
  return (
    <div
      data-slot="list-row"
      data-interactive={interactive ? 'true' : undefined}
      className={cn(
        'flex items-center justify-between gap-3 py-3',
        interactive && 'cursor-pointer rounded-md px-2 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
        className,
      )}
      {...props}
    />
  )
}

export type ListRowMainProps = React.ComponentProps<'div'>
function ListRowMain({ className, ...props }: ListRowMainProps) {
  return <div data-slot="list-row-main" className={cn('min-w-0 flex-1', className)} {...props} />
}

export type ListRowTitleProps = React.ComponentProps<'p'>
function ListRowTitle({ className, ...props }: ListRowTitleProps) {
  return <p data-slot="list-row-title" className={cn('truncate text-sm font-medium text-foreground', className)} {...props} />
}

export type ListRowDescriptionProps = React.ComponentProps<'p'>
function ListRowDescription({ className, ...props }: ListRowDescriptionProps) {
  return <p data-slot="list-row-description" className={cn('truncate text-xs text-muted-foreground', className)} {...props} />
}

export type ListRowMetaProps = React.ComponentProps<'div'>
function ListRowMeta({ className, ...props }: ListRowMetaProps) {
  return <div data-slot="list-row-meta" className={cn('flex shrink-0 items-center gap-2 text-xs text-muted-foreground', className)} {...props} />
}

export type ListRowActionsProps = React.ComponentProps<'div'>
function ListRowActions({ className, ...props }: ListRowActionsProps) {
  return <div data-slot="list-row-actions" className={cn('flex shrink-0 items-center gap-2', className)} {...props} />
}

export { List, ListRow, ListRowMain, ListRowTitle, ListRowDescription, ListRowMeta, ListRowActions }
