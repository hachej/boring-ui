import * as React from 'react'
import { cn } from './lib'

export type SpinnerProps = React.ComponentProps<'span'>

function Spinner({ className, ...props }: SpinnerProps) {
  return (
    <span
      data-slot="spinner"
      aria-hidden="true"
      className={cn('inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent', className)}
      {...props}
    />
  )
}

export { Spinner }
