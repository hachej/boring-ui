import * as React from 'react'
import { cn } from './lib'

export type KbdProps = React.ComponentProps<'kbd'>

function Kbd({ className, ...props }: KbdProps) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded border bg-muted px-1 font-mono text-[10px] font-medium text-muted-foreground shadow-xs',
        className,
      )}
      {...props}
    />
  )
}

export { Kbd }
