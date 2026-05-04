import * as React from 'react'
import { cn } from './lib'
import { Button, type ButtonProps } from './button'

export type SegmentedControlProps = React.ComponentProps<'div'>

function SegmentedControl({ className, ...props }: SegmentedControlProps) {
  return (
    <div
      data-slot="segmented-control"
      role="tablist"
      className={cn('inline-flex items-center gap-0.5 rounded-md border border-border bg-muted/50 p-0.5', className)}
      {...props}
    />
  )
}

export type SegmentedControlItemProps = ButtonProps & {
  selected?: boolean
}

function SegmentedControlItem({ className, selected, variant = 'ghost', size = 'xs', ...props }: SegmentedControlItemProps) {
  return (
    <Button
      data-slot="segmented-control-item"
      role="tab"
      aria-selected={selected}
      data-selected={selected ? 'true' : undefined}
      variant={variant}
      size={size}
      className={cn(
        'rounded-sm border border-transparent px-2 font-normal shadow-none',
        selected ? 'bg-background font-medium text-foreground shadow-sm hover:bg-background' : 'text-muted-foreground hover:text-foreground',
        className,
      )}
      {...props}
    />
  )
}

export { SegmentedControl, SegmentedControlItem }
