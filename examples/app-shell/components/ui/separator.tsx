// Pinned shadcn fixture: `shadcn@4.21.1 add drawer sidebar avatar dropdown-menu` (style base-nova, icons lucide), generated 2026-10-13
// from https://ui.shadcn.com/r/styles/base-nova/. Used only to type-check and run registry/app-shell; consumers install their own.
"use client"

import { Separator as SeparatorPrimitive } from "@base-ui/react/separator"
import { cn } from "@/lib/utils"

function Separator({
  className,
  orientation = "horizontal",
  ...props
}: SeparatorPrimitive.Props) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
