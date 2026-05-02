'use client'

import * as React from 'react'
import * as SeparatorPrimitive from '@radix-ui/react-separator'
import { cn } from './lib'

export type SeparatorProps = React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>

const Separator = React.forwardRef<
  React.ElementRef<typeof SeparatorPrimitive.Root>,
  SeparatorProps
>(({ className, orientation = 'horizontal', decorative = true, ...props }, ref) => (
  <SeparatorPrimitive.Root
    ref={ref}
    data-slot="separator"
    decorative={decorative}
    orientation={orientation}
    className={cn(
      'shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px',
      className,
    )}
    {...props}
  />
))
Separator.displayName = SeparatorPrimitive.Root.displayName

export { Separator }
