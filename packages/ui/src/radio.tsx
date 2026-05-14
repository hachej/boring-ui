import * as React from 'react'
import { cn } from './lib'

export type RadioProps = Omit<React.ComponentProps<'input'>, 'type'>

const Radio = React.forwardRef<HTMLInputElement, RadioProps>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    type="radio"
    data-slot="radio"
    className={cn(
      'size-4 shrink-0 rounded-full border border-input accent-primary shadow-xs transition-shadow outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
      className,
    )}
    {...props}
  />
))
Radio.displayName = 'Radio'

export { Radio }
