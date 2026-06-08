import type { ReactNode } from "react"
import { Plus, X } from "lucide-react"
import { IconButton } from "@hachej/boring-ui-kit"
import { cn } from "../lib/utils"

export interface ChatPaneDescriptor {
  id: string
  title?: string | null
  panel?: string
  params?: Record<string, unknown>
}

export interface ChatPaneStageProps {
  panes: ChatPaneDescriptor[]
  activePaneId?: string | null
  renderPane: (pane: ChatPaneDescriptor) => ReactNode
  onActivePaneChange?: (id: string) => void
  onClosePane?: (id: string) => void
  onCreatePaneAfter?: (id: string) => void
}

export function ChatPaneStage({
  panes,
  activePaneId,
  renderPane,
  onActivePaneChange,
  onClosePane,
  onCreatePaneAfter,
}: ChatPaneStageProps) {
  if (panes.length === 0) return null

  return (
    <div
      data-boring-workspace-part="chat-pane-stage"
      className="relative flex h-full min-h-0 w-full overflow-x-auto overflow-y-hidden bg-background"
    >
      {panes.map((pane, index) => {
        const title = pane.title || "Untitled"
        const active = pane.id === activePaneId || (!activePaneId && index === 0)
        const canClose = panes.length > 1
        return (
          <div
            key={pane.id}
            data-boring-workspace-part="chat-pane"
            data-boring-state={active ? "active" : "inactive"}
            aria-label={`Chat session ${title}`}
            className={cn(
              "group/chat-pane relative flex h-full min-w-[350px] flex-[1_0_350px] flex-col overflow-hidden bg-background",
              index > 0 && "border-l border-[color:oklch(from_var(--border)_l_c_h/0.7)]",
              active && "shadow-[inset_0_0_0_1px_oklch(from_var(--foreground)_l_c_h/0.28)]",
            )}
            onMouseDown={() => onActivePaneChange?.(pane.id)}
            onFocusCapture={(event) => {
              const target = event.target instanceof HTMLElement ? event.target : null
              if (target?.closest('[data-boring-workspace-part="chat-pane-control"]')) return
              onActivePaneChange?.(pane.id)
            }}
          >
            <div
              data-boring-workspace-part="chat-pane-header"
              className={cn(
                "flex h-8 shrink-0 items-center justify-between border-b border-border/55 px-2",
                active ? "bg-muted/45" : "bg-background",
              )}
            >
              <div className="flex min-w-0 items-center gap-1.5 px-1">
                <span className="truncate text-[12px] font-medium text-foreground/70">{title}</span>
              </div>
              <IconButton
                type="button"
                variant="ghost"
                size="icon-xs"
                data-boring-workspace-part="chat-pane-control"
                disabled={!canClose}
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  onClosePane?.(pane.id)
                }}
                aria-label={`Close ${title} pane`}
                title={canClose ? "Close pane" : "At least one chat pane must stay open"}
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.75} />
              </IconButton>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              {renderPane(pane)}
            </div>
            {onCreatePaneAfter ? (
              <IconButton
                type="button"
                variant="ghost"
                size="icon-sm"
                data-boring-workspace-part="chat-pane-control"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  onCreatePaneAfter(pane.id)
                }}
                aria-label="New chat to the right"
                title="New chat to the right"
                className={cn(
                  "absolute top-1/2 z-30 h-8 w-8 -translate-y-1/2 rounded-full bg-background text-muted-foreground shadow-[0_0_0_1px_oklch(from_var(--border)_l_c_h/0.8),0_6px_18px_-12px_oklch(0_0_0/0.45)] hover:bg-muted hover:text-foreground",
                  panes.length === 1 ? "right-2" : "-right-4",
                )}
              >
                <Plus className="h-4 w-4" strokeWidth={1.75} />
              </IconButton>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
