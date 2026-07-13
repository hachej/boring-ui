import * as React from 'react'
import { cn } from './lib'

export type MeterTone = 'default' | 'warning' | 'danger'

export interface MeterProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'role'> {
  /** Filled fraction as a percentage in the range 0..100. */
  value: number
  /** Accessible label for the progressbar (screen readers). */
  label?: string
  tone?: MeterTone
}

const toneFill: Record<MeterTone, string> = {
  default: 'bg-primary',
  warning: 'bg-[color:var(--boring-warning,var(--accent-foreground))]',
  danger: 'bg-destructive',
}

/**
 * Accessible horizontal usage/progress bar. Renders a subtle track with a
 * proportional fill and exposes `role="progressbar"` with aria value props so
 * consumers get an accessible meter out of the box.
 */
function Meter({ value, label, tone = 'default', className, ...props }: MeterProps) {
  const clamped = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      data-slot="meter"
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-muted', className)}
      {...props}
    >
      <div
        data-slot="meter-fill"
        className={cn('h-full rounded-full transition-[width] duration-300 ease-out', toneFill[tone])}
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}

export { Meter }
