import type { IDockviewPanelHeaderProps } from "dockview-react"
import { X } from "lucide-react"
import { cn } from "../lib/utils"

export function ShadcnTab(props: IDockviewPanelHeaderProps) {
  const { api } = props
  const title = api.title ?? api.id

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation()
    api.close()
  }

  return (
    <div
      className={cn(
        "group relative flex h-full w-full min-w-0 items-center pl-3 pr-7 text-sm select-none",
        "cursor-pointer transition-colors",
      )}
      title={title}
    >
      <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{title}</span>
      <button
        type="button"
        className={cn(
          "absolute right-1 top-1/2 -translate-y-1/2 inline-flex h-5 w-5 items-center justify-center rounded",
          "text-muted-foreground opacity-0 transition-opacity",
          "hover:bg-muted hover:text-foreground",
          "focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "group-hover:opacity-100",
          "[.dv-active-tab_&]:opacity-60 [.active-tab_&]:opacity-60",
          "[.dv-active-tab_&]:hover:opacity-100 [.active-tab_&]:hover:opacity-100",
        )}
        onClick={handleClose}
        aria-label={`Close ${title}`}
      >
        <X className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
    </div>
  )
}
