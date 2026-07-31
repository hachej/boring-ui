"use client"

import type { ComponentPropsWithoutRef, ReactNode } from "react"
import { cn } from "../../lib/utils"

export function PaneRow({
  leadingIcon,
  label,
  trailing,
  interactive = false,
  className,
  ...props
}: Omit<ComponentPropsWithoutRef<"div">, "children"> & {
  leadingIcon: ReactNode
  label: ReactNode
  trailing?: ReactNode
  interactive?: boolean
}) {
  return (
    <div
      {...props}
      className={cn(
        "flex h-11 w-full items-center gap-2 rounded-md border border-transparent px-2.5 text-left [@media(hover:hover)_and_(min-width:640px)]:h-8 [@media(hover:hover)_and_(min-width:640px)]:py-1",
        interactive && "group cursor-pointer transition-colors",
        className,
      )}
    >
      <span
        data-boring-workspace-part="app-pane-row-type-icon"
        className="grid size-4 shrink-0 place-items-center text-muted-foreground/65"
        aria-hidden="true"
      >
        {leadingIcon}
      </span>
      <div
        data-boring-workspace-part="app-pane-row-label"
        className="min-w-0 flex-1 truncate text-[13px] font-medium leading-5"
      >
        {label}
      </div>
      {trailing ? (
        <div
          data-boring-workspace-part="app-pane-row-actions"
          className="flex shrink-0 items-center gap-0.5"
        >
          {trailing}
        </div>
      ) : null}
    </div>
  )
}
