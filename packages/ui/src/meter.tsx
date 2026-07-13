import * as React from 'react'
import { cn } from './lib'

export type MeterTone = 'default' | 'warning' | 'danger'

export interface MeterProps extends Omit<React.ComponentProps<'progress'>, 'role' | 'value' | 'max'> {
  /** Filled fraction as a percentage in the range 0..100. */
  value: number
  /** Accessible label for the progressbar (screen readers). */
  label?: string
  tone?: MeterTone
}

const toneFill: Record<MeterTone, string> = {
  default: '[&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary',
  warning: '[&::-webkit-progress-value]:bg-[color:var(--boring-warning,var(--accent-foreground))] [&::-moz-progress-bar]:bg-[color:var(--boring-warning,var(--accent-foreground))]',
  danger: '[&::-webkit-progress-value]:bg-destructive [&::-moz-progress-bar]:bg-destructive',
}

/**
 * Accessible horizontal usage/progress bar. A native `<progress>` element
 * gives the browser the dynamic fill without inline styles, which keeps it
 * compatible with applications that enforce nonce-only style CSPs.
 */
function Meter({ value, label, tone = 'default', className, ...props }: MeterProps) {
  const clamped = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0
  return (
    <progress
      role="progressbar"
      value={clamped}
      max={100}
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      data-slot="meter"
      className={cn(
        'h-2 w-full overflow-hidden rounded-full border-0 bg-muted [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:transition-all [&::-webkit-progress-value]:duration-300 [&::-moz-progress-bar]:rounded-full',
        toneFill[tone],
        className,
      )}
      {...props}
    />
  )
}

export { Meter }
