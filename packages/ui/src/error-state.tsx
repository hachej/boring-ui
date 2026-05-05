import * as React from 'react'
import { cn } from './lib'

export type ErrorStateProps = React.ComponentProps<'div'> & {
  title?: React.ReactNode
  description?: React.ReactNode
  details?: React.ReactNode
  actions?: React.ReactNode
}

function ErrorState({ className, title = 'Something went wrong', description, details, actions, children, ...props }: ErrorStateProps) {
  return (
    <div data-slot="error-state" className={cn('rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-destructive-foreground', className)} {...props}>
      <div className="space-y-2">
        {title && <h2 data-slot="error-state-title" className="text-base font-semibold text-destructive">{title}</h2>}
        {description && <p data-slot="error-state-description" className="text-sm text-foreground">{description}</p>}
        {children}
        {details && <pre data-slot="error-state-details" className="max-h-48 overflow-auto rounded-md bg-background p-3 text-xs text-muted-foreground">{details}</pre>}
        {actions && <div data-slot="error-state-actions" className="flex flex-wrap gap-2 pt-2">{actions}</div>}
      </div>
    </div>
  )
}

export { ErrorState }
