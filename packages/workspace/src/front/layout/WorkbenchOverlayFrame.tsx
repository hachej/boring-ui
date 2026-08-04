import type { ReactNode } from "react"
import { Maximize2, Minimize2, PanelRightClose, PanelRightOpen } from "lucide-react"
import { IconButton } from "@hachej/boring-ui-kit"
import { cn } from "../lib/utils"

/** Keeps Workbench-owned controls available while warmup blocks panel mounting. */
export function WorkbenchOverlayFrame({
  open,
  fullscreen,
  onOpen,
  onClose,
  onToggleFullscreen,
  children,
}: {
  open: boolean
  fullscreen: boolean
  onOpen: () => void
  onClose: () => void
  onToggleFullscreen: () => void
  children: ReactNode
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-border/60 bg-background px-2">
        {open ? <span className="truncate text-[13px] font-medium">Workbench</span> : <span />}
        <div className="flex items-center gap-1">
          {open ? (
            <>
              <IconButton
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={onToggleFullscreen}
                aria-label={fullscreen ? "Restore split view" : "Fullscreen workbench"}
              >
                {fullscreen ? <Minimize2 /> : <Maximize2 />}
              </IconButton>
              <IconButton type="button" variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close workbench">
                <PanelRightClose />
              </IconButton>
            </>
          ) : (
            <IconButton type="button" variant="ghost" size="icon-xs" onClick={onOpen} aria-label="Open workbench">
              <PanelRightOpen />
            </IconButton>
          )}
        </div>
      </header>
      <div
        className={cn("min-h-0 flex-1 overflow-hidden", !open && "pointer-events-none opacity-0")}
        aria-hidden={!open}
        inert={!open ? true : undefined}
      >
        {children}
      </div>
    </div>
  )
}
