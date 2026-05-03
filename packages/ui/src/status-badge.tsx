import * as React from 'react'
import { Badge, type BadgeProps } from './badge'
import { cn } from './lib'

export type StatusBadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'
export type StatusBadgeProps = BadgeProps & { tone?: StatusBadgeTone }

const toneClasses: Record<StatusBadgeTone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  success: 'bg-[color:var(--boring-success-soft,var(--secondary))] text-[color:var(--boring-success,var(--secondary-foreground))]',
  warning: 'bg-[color:var(--boring-warning-soft,var(--accent))] text-[color:var(--boring-warning,var(--accent-foreground))]',
  danger: 'bg-destructive/10 text-destructive',
  info: 'bg-accent text-accent-foreground',
}

function StatusBadge({ className, tone = 'neutral', variant = 'ghost', ...props }: StatusBadgeProps) {
  return <Badge data-slot="status-badge" variant={variant} className={cn(toneClasses[tone], className)} {...props} />
}

export { StatusBadge }
