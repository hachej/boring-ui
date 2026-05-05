import * as React from 'react'
import { cn } from './lib'

export type DetailListProps = React.ComponentProps<'dl'>

function DetailList({ className, ...props }: DetailListProps) {
  return (
    <dl
      data-slot="detail-list"
      className={cn('divide-y divide-border/50 rounded-md border border-border/50 bg-muted/10', className)}
      {...props}
    />
  )
}

export { DetailList }
