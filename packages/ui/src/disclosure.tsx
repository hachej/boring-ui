import * as React from 'react'
import * as CollapsiblePrimitive from '@radix-ui/react-collapsible'
import { cn } from './lib'
import { Button, type ButtonProps } from './button'

const Disclosure = CollapsiblePrimitive.Root

const DisclosureContent = React.forwardRef<
  React.ElementRef<typeof CollapsiblePrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof CollapsiblePrimitive.Content>
>(({ className, ...props }, ref) => (
  <CollapsiblePrimitive.Content
    ref={ref}
    data-slot="disclosure-content"
    className={cn('overflow-hidden data-[state=closed]:animate-out data-[state=open]:animate-in', className)}
    {...props}
  />
))
DisclosureContent.displayName = 'DisclosureContent'

export type DisclosureTriggerProps = ButtonProps & {
  chevron?: React.ReactNode
}

const DisclosureTrigger = React.forwardRef<HTMLButtonElement, DisclosureTriggerProps>(
  ({ className, children, chevron, variant = 'ghost', size = 'sm', ...props }, ref) => (
    <CollapsiblePrimitive.Trigger asChild>
      <Button
        ref={ref}
        data-slot="disclosure-trigger"
        variant={variant}
        size={size}
        className={cn('group/disclosure justify-start gap-2', className)}
        {...props}
      >
        {chevron ?? <DisclosureChevron />}
        {children}
      </Button>
    </CollapsiblePrimitive.Trigger>
  ),
)
DisclosureTrigger.displayName = 'DisclosureTrigger'

function DisclosureChevron({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="disclosure-chevron"
      aria-hidden="true"
      className={cn('inline-block text-[11px] text-muted-foreground transition-transform group-data-[state=open]/disclosure:rotate-90', className)}
      {...props}
    >
      ▶
    </span>
  )
}

export { Disclosure, DisclosureTrigger, DisclosureContent, DisclosureChevron }
