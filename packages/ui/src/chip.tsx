import * as React from 'react'
import { cn } from './lib'
import { Button, type ButtonProps } from './button'

export type ChipProps = React.ComponentProps<'span'> & {
  selected?: boolean
}

function Chip({ className, selected, ...props }: ChipProps) {
  return (
    <span
      data-slot="chip"
      data-selected={selected ? 'true' : undefined}
      className={cn(
        'inline-flex min-h-6 items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-xs text-foreground',
        selected && 'border-foreground/20 bg-foreground/10',
        className,
      )}
      {...props}
    />
  )
}

export type ChipButtonProps = ButtonProps & {
  selected?: boolean
}

function ChipButton({ className, selected, variant = 'outline', size = 'xs', ...props }: ChipButtonProps) {
  return (
    <Button
      data-slot="chip-button"
      data-selected={selected ? 'true' : undefined}
      variant={variant}
      size={size}
      className={cn(
        'h-auto rounded-full px-2 py-0.5 text-xs',
        selected && 'border-foreground/20 bg-foreground/10',
        className,
      )}
      {...props}
    />
  )
}

export type ChipRemoveProps = ButtonProps

function ChipRemove({ className, children, variant = 'ghost', size = 'icon-xs', ...props }: ChipRemoveProps) {
  return (
    <Button
      data-slot="chip-remove"
      variant={variant}
      size={size}
      className={cn('size-4 rounded-full text-muted-foreground hover:text-foreground', className)}
      {...props}
    >
      {children ?? <span aria-hidden="true" className="text-[13px] leading-none">×</span>}
    </Button>
  )
}

export { Chip, ChipButton, ChipRemove }
