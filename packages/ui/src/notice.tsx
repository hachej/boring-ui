import * as React from 'react'
import { cn } from './lib'

export type NoticeTone = 'info' | 'success' | 'warning' | 'error' | 'accent' | 'destructive'

export type NoticeProps = React.ComponentProps<'div'> & {
  tone?: NoticeTone
  title?: React.ReactNode
  description?: React.ReactNode
  icon?: React.ReactNode
  actions?: React.ReactNode
}

const noticeToneClasses: Record<NoticeTone, string> = {
  info: 'border-border bg-muted/20 text-foreground [&_[data-slot=notice-icon]]:text-muted-foreground',
  success: 'border-success/35 bg-[color:var(--success-soft)] text-success [&_[data-slot=notice-description]]:text-foreground',
  warning: 'border-warning/35 bg-[color:var(--warning-soft,var(--accent-soft))] text-foreground [&_[data-slot=notice-icon]]:text-[color:var(--warning,var(--accent))]',
  error: 'border-destructive/40 bg-destructive/10 text-destructive [&_[data-slot=notice-description]]:text-foreground',
  accent: 'border-accent/40 bg-[color:var(--accent-soft)] text-foreground [&_[data-slot=notice-icon]]:text-[color:var(--accent)]',
  destructive: 'border-destructive/50 bg-destructive/10 text-destructive [&_[data-slot=notice-description]]:text-foreground',
}

function Notice({
  className,
  tone = 'info',
  title,
  description,
  icon,
  actions,
  children,
  ...props
}: NoticeProps) {
  return (
    <div
      data-slot="notice"
      data-tone={tone}
      className={cn(
        'flex items-start gap-3 rounded-md border px-3 py-2 text-sm',
        noticeToneClasses[tone],
        className,
      )}
      {...props}
    >
      {icon && <div data-slot="notice-icon" className="mt-0.5 shrink-0">{icon}</div>}
      <div className="min-w-0 flex-1">
        {title && <div data-slot="notice-title" className="font-medium leading-snug">{title}</div>}
        {description && (
          <div data-slot="notice-description" className={cn('text-muted-foreground', title && 'mt-0.5')}>
            {description}
          </div>
        )}
        {children}
      </div>
      {actions && <div data-slot="notice-actions" className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

export { Notice }
