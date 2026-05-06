import { Button, EmptyState, Kbd } from "@hachej/boring-ui-kit"
import { cn } from "../../lib/utils"

export interface EmptyPaneProps {
  className?: string
  onOpenFile?: () => void
}

export function EmptyPane({ className, onOpenFile }: EmptyPaneProps) {
  return (
    <EmptyState
      className={cn("h-full border-0 text-muted-foreground", className)}
      title="No file open"
      description="Open a file to get started"
      actions={
        onOpenFile ? (
          <Button type="button" variant="outline" onClick={onOpenFile}>
            Open file
          </Button>
        ) : null
      }
    >
      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-3">
          <Kbd>⌘P</Kbd>
          <span>Open file</span>
        </div>
        <div className="flex items-center gap-3">
          <Kbd>⌘⇧P</Kbd>
          <span>Command palette</span>
        </div>
        <div className="flex items-center gap-3">
          <Kbd>⌘B</Kbd>
          <span>Toggle sidebar</span>
        </div>
      </div>
    </EmptyState>
  )
}
