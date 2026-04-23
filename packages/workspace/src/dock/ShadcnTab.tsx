import type { IDockviewPanelHeaderProps } from "dockview-react"
import { X } from "lucide-react"
import { cn } from "../lib/utils"

export function ShadcnTab(props: IDockviewPanelHeaderProps) {
  const { api, containerApi } = props
  const title = api.title ?? api.id

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation()
    api.close()
  }

  return (
    <div
      className={cn(
        "group flex h-full items-center gap-1.5 px-3 text-sm select-none",
        "cursor-pointer transition-colors",
      )}
    >
      <span className="truncate max-w-[160px]">{title}</span>
      <button
        type="button"
        className={cn(
          "ml-1 inline-flex h-4 w-4 items-center justify-center rounded-sm",
          "text-muted-foreground opacity-0 transition-opacity",
          "hover:text-foreground hover:bg-muted",
          "group-hover:opacity-100",
          "[.active-tab_&]:opacity-60",
          "[.active-tab_&]:hover:opacity-100",
        )}
        onClick={handleClose}
        aria-label={`Close ${title}`}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}
