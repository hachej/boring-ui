// Pinned shadcn fixture: `shadcn@4.21.4 add popover native-select label` (style base-nova, icons lucide), generated 2026-10-17
// from https://ui.shadcn.com/r/styles/base-nova/. Used only to type-check and run registry blocks; consumers install their own.
"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
