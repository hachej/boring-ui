import { useEffect, useState } from "react"
import type { IDockviewPanelHeaderProps } from "dockview-react"
import { X, Loader2 } from "lucide-react"
import { getFileIcon } from "../registry/getFileIcon"
import { cn } from "../../lib/utils"
import { useEvent } from "../events"

export function ShadcnTab(props: IDockviewPanelHeaderProps) {
  const { api } = props
  const [title, setTitle] = useState(api.title ?? api.id)

  useEffect(() => {
    const sync = () => setTitle(api.title ?? api.id)
    sync()
    const sub = api.onDidTitleChange?.(sync)
    return () => sub?.dispose?.()
  }, [api])

  const isDirty = title.endsWith(" ●")
  const displayTitle = isDirty ? title.slice(0, -2) : title
  const Icon = getFileIcon(displayTitle)

  // Subscribe to editor save lifecycle keyed by panelId. The badge
  // flips on at save:start and off at save:end (regardless of ok).
  // Keyed by panelId, not path, so a rename mid-save still resolves.
  const [isSaving, setIsSaving] = useState(false)
  useEvent("editor:save:start", (p) => {
    if (p.panelId === api.id) setIsSaving(true)
  })
  useEvent("editor:save:end", (p) => {
    if (p.panelId === api.id) setIsSaving(false)
  })

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation()
    api.close()
  }

  return (
    <div
      className={cn(
        "group relative flex h-full w-full min-w-0 items-center gap-1.5 pl-2.5 pr-7 select-none",
        "text-[12.5px] leading-none tracking-tight",
        "cursor-pointer transition-colors",
      )}
      title={isDirty ? `${displayTitle} (unsaved changes)` : displayTitle}
    >
      {isSaving ? (
        <Loader2
          data-testid="tab-saving-spinner"
          aria-label="Saving"
          className="h-3.5 w-3.5 shrink-0 animate-spin text-[color:var(--accent)]"
          strokeWidth={2}
        />
      ) : (
        <Icon
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground/70",
            "[.dv-active-tab_&]:text-[color:var(--accent)] [.active-tab_&]:text-[color:var(--accent)]",
          )}
          strokeWidth={1.5}
        />
      )}
      <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{displayTitle}</span>
      {isDirty ? (
        <span
          aria-hidden="true"
          className={cn(
            "mr-1 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/35",
            "[.dv-active-tab_&]:bg-foreground/45 [.active-tab_&]:bg-foreground/45",
          )}
        />
      ) : null}
      <button
        type="button"
        className={cn(
          "absolute right-1 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md",
          "text-muted-foreground opacity-0 transition-opacity duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
          "hover:bg-foreground/10 hover:text-foreground",
          "focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          "group-hover:opacity-100",
          "[.dv-active-tab_&]:opacity-50 [.active-tab_&]:opacity-50",
          "[.dv-active-tab_&]:hover:opacity-100 [.active-tab_&]:hover:opacity-100",
        )}
        onClick={handleClose}
        aria-label={`Close ${displayTitle}`}
      >
        <X className="h-3 w-3" strokeWidth={2.25} />
      </button>
    </div>
  )
}
