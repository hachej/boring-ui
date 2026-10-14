// Pinned shadcn fixture: `shadcn@4.21.1 add drawer sidebar avatar dropdown-menu` (style base-nova, icons lucide), generated 2026-10-13
// from https://ui.shadcn.com/r/styles/base-nova/. Used only to type-check and run registry/app-shell; consumers install their own.
import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
