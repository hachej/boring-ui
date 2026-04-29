import { useMemo, type ComponentType, type ReactNode } from "react"
import type { DockviewPanelApi } from "dockview-react"
import type { PanelLifecycleApi } from "./types"
import { cn } from "../../lib/utils"

export interface PanelChromeProps {
  title: string
  icon?: ComponentType<{ className?: string }>
  essential?: boolean
  children: ReactNode
  className?: string
  panelApi?: DockviewPanelApi
}

function createLifecycleApi(
  panelApi: DockviewPanelApi,
): PanelLifecycleApi {
  return {
    get panelId() {
      return panelApi.id
    },
    get title() {
      return panelApi.title ?? panelApi.id
    },
    setTitle(t: string) {
      panelApi.setTitle(t)
    },
    close() {
      panelApi.close()
    },
    focus() {
      panelApi.setActive()
    },
    get isActive() {
      return panelApi.isActive
    },
  }
}

export function PanelChrome({
  title,
  icon: Icon,
  essential,
  children,
  className,
  panelApi,
}: PanelChromeProps) {
  const lifecycleApi = useMemo(
    () => (panelApi ? createLifecycleApi(panelApi) : null),
    [panelApi],
  )

  return (
    <div className={cn("flex h-full flex-col overflow-hidden", className)}>
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-muted/50 px-3">
        {Icon && (
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate text-sm font-medium">{title}</span>
        <div className="flex-1" />
        {!essential && panelApi && (
          <button
            type="button"
            className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            onClick={() => panelApi.close()}
            aria-label={`Close ${title}`}
          >
            <svg
              className="h-3 w-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  )
}

export { createLifecycleApi }
