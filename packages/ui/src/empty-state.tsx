import * as React from 'react'
import { cn } from './lib'

export type EmptyStateProps = React.ComponentProps<'div'> & {
  title?: React.ReactNode
  description?: React.ReactNode
  icon?: React.ReactNode
  actions?: React.ReactNode
}

function EmptyState({ className, title, description, icon, actions, children, ...props }: EmptyStateProps) {
  return (
    <div data-slot="empty-state" className={cn('flex min-h-40 flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-8 text-center', className)} {...props}>
      {icon && <div data-slot="empty-state-icon" className="text-muted-foreground">{icon}</div>}
      {(title || description) && (
        <div className="space-y-1">
          {title && <h3 data-slot="empty-state-title" className="text-sm font-medium text-foreground">{title}</h3>}
          {description && <p data-slot="empty-state-description" className="text-sm text-muted-foreground">{description}</p>}
        </div>
      )}
      {children}
      {actions && <div data-slot="empty-state-actions" className="flex items-center justify-center gap-2">{actions}</div>}
    </div>
  )
}

export { EmptyState }
