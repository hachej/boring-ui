import * as React from 'react'
import { cn } from './lib'

export function ChoiceGroup({ className, ...props }: React.ComponentProps<'fieldset'>) {
  return <fieldset data-slot="choice-group" className={cn('grid gap-2', className)} {...props} />
}

export function ChoiceGroupLegend({ className, ...props }: React.ComponentProps<'legend'>) {
  return <legend data-slot="choice-group-legend" className={cn('mb-2 text-sm font-medium leading-5 text-foreground', className)} {...props} />
}

export function ChoiceItem({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    <label
      data-slot="choice-item"
      className={cn(
        'flex items-start gap-3 rounded-md border border-border/70 bg-background px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted/30',
        'has-[:checked]:border-ring/60 has-[:checked]:bg-muted/40 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
        'has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export function ChoiceItemBody({ className, ...props }: React.ComponentProps<'span'>) {
  return <span data-slot="choice-item-body" className={cn('flex flex-col gap-1', className)} {...props} />
}

export function ChoiceItemTitle({ className, ...props }: React.ComponentProps<'span'>) {
  return <span data-slot="choice-item-title" className={cn('leading-5', className)} {...props} />
}

export function ChoiceItemDescription({ className, ...props }: React.ComponentProps<'small'>) {
  return <small data-slot="choice-item-description" className={cn('text-sm leading-5 text-muted-foreground', className)} {...props} />
}
