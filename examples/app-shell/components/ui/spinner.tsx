// Pinned shadcn@4.21.4 Base UI fixture, 2026-10 release.
// https://ui.shadcn.com/r/styles/base-nova/spinner.json. MIT, Copyright (c) 2023 shadcn.
import { cn } from "cn"

import { Loader2Icon } from "lucide-react"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
