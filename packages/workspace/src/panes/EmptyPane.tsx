import { cn } from "../front/lib/utils"

export interface EmptyPaneProps {
  className?: string
  onOpenFile?: () => void
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-xs font-mono">
      {children}
    </kbd>
  )
}

export function EmptyPane({ className, onOpenFile }: EmptyPaneProps) {
  return (
    <div
      className={cn(
        "flex h-full flex-col items-center justify-center gap-6 text-muted-foreground",
        className,
      )}
    >
      <div className="text-center">
        <h2 className="text-lg font-medium text-foreground">No file open</h2>
        <p className="mt-1 text-sm">Open a file to get started</p>
      </div>
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
      {onOpenFile && (
        <button
          type="button"
          className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
          onClick={onOpenFile}
        >
          Open file
        </button>
      )}
    </div>
  )
}
