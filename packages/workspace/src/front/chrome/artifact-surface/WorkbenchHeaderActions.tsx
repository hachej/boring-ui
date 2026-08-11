"use client"

import { ChevronDown, Maximize2, Minimize2, PanelRightClose } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
} from "@hachej/boring-ui-kit"

export interface WorkbenchHeaderPanel {
  id: string
  title: string
}

export function WorkbenchHeaderActions({
  panels,
  activePanelId,
  onActivatePanel,
  fullscreen,
  onToggleFullscreen,
  onClose,
}: {
  panels: WorkbenchHeaderPanel[]
  activePanelId: string | null
  onActivatePanel: (panelId: string) => void
  fullscreen: boolean
  onToggleFullscreen?: () => void
  onClose?: () => void
}) {
  return (
    <div
      data-boring-workspace-part="workbench-header-actions"
      className="pointer-events-auto flex items-center gap-1"
    >
      {panels.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              aria-label={`Open tabs (${panels.length})`}
              title="Open tabs"
            >
              <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span>{panels.length}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={6} className="min-w-52">
            {panels.map((panel) => (
              <DropdownMenuItem
                key={panel.id}
                onSelect={() => onActivatePanel(panel.id)}
                className="flex items-center justify-between gap-4"
              >
                <span className="min-w-0 truncate">{panel.title}</span>
                {panel.id === activePanelId ? (
                  <span className="text-[10px] text-muted-foreground">Current</span>
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {onToggleFullscreen ? (
        <IconButton
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onToggleFullscreen}
          aria-label={fullscreen ? "Restore split view" : "Fullscreen workbench"}
          title={fullscreen ? "Restore split view" : "Fullscreen workbench"}
        >
          {fullscreen ? (
            <Minimize2 className="h-3.5 w-3.5" strokeWidth={1.75} />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
        </IconButton>
      ) : null}
      {onClose ? (
        <IconButton
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onClose}
          aria-label="Close workbench"
          title="Close workbench (⌘2)"
        >
          <PanelRightClose className="h-4 w-4" strokeWidth={1.75} />
        </IconButton>
      ) : null}
    </div>
  )
}
