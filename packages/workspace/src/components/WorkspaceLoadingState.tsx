import { LoaderCircle } from "lucide-react"

import { cn } from "../lib/utils"

export interface WorkspaceLoadingStateProps {
  title?: string
  description?: string
  status?: string
  fullscreen?: boolean
  className?: string
}

export function WorkspaceLoadingState({
  title = "Loading workspace",
  description = "Preparing the workspace context.",
  status = "Loading",
  fullscreen = true,
  className,
}: WorkspaceLoadingStateProps) {
  return (
    <section
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn(
        "flex h-full w-full items-center justify-center bg-background px-6 text-foreground",
        fullscreen ? "min-h-screen" : "min-h-[240px]",
        className,
      )}
    >
      <div className="flex w-full max-w-sm flex-col items-center gap-5 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-card text-foreground">
          <LoaderCircle
            aria-hidden="true"
            className="h-5 w-5 animate-spin text-muted-foreground motion-reduce:animate-none"
          />
        </div>
        <div className="space-y-2">
          <h2 className="text-base font-medium text-foreground">{title}</h2>
          {description ? (
            <p className="text-sm leading-6 text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {status ? (
          <p className="text-xs font-medium text-muted-foreground/80">{status}</p>
        ) : null}
      </div>
    </section>
  )
}
