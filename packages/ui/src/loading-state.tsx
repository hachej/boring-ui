import * as React from 'react'
import { cn } from './lib'
import { Spinner } from './spinner'

export type LoadingStateProps = React.ComponentProps<'div'> & {
  label?: React.ReactNode
  centered?: boolean
}

function LoadingState({ className, label = 'Loading…', centered = false, children, ...props }: LoadingStateProps) {
  return (
    <div
      data-slot="loading-state"
      role="status"
      className={cn(
        'flex items-center gap-2 text-sm text-muted-foreground',
        centered && 'h-full w-full justify-center',
        className,
      )}
      {...props}
    >
      <Spinner className="size-3.5" />
      <span>{children ?? label}</span>
    </div>
  )
}

export { LoadingState }
