import * as React from 'react'
import { cn } from './lib'

export type InlineCodeProps = React.ComponentProps<'code'>

function InlineCode({ className, ...props }: InlineCodeProps) {
  return (
    <code
      data-slot="inline-code"
      className={cn('rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground', className)}
      {...props}
    />
  )
}

export { InlineCode }
