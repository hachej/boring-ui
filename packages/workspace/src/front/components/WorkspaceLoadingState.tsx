import { Skeleton } from "@hachej/boring-ui-kit"
import { cn } from "../lib/utils"

export interface WorkspaceLoadingStateProps {
  title?: string
  description?: string
  status?: string
  fullscreen?: boolean
  className?: string
}

export function WorkspaceTranscriptLoadingSurface() {
  return (
    <div
      data-boring-workspace-part="transcript-loading-surface"
      className="flex min-h-0 flex-1 flex-col"
      aria-hidden="true"
    >
      <div className="mx-auto flex min-h-0 w-full max-w-[680px] flex-1 flex-col gap-7 overflow-hidden px-4 py-8">
        <div className="flex items-start gap-3">
          <Skeleton className="mt-0.5 size-7 shrink-0 rounded-lg" />
          <div className="flex min-w-0 flex-1 flex-col gap-2.5">
            <Skeleton className="h-3 w-24 rounded-sm" />
            <Skeleton className="h-3 w-full rounded-sm" />
            <Skeleton className="h-3 w-4/5 rounded-sm" />
          </div>
        </div>
        <div className="flex justify-end">
          <Skeleton className="h-11 w-[min(72%,30rem)] rounded-xl" />
        </div>
        <div className="flex items-start gap-3">
          <Skeleton className="mt-0.5 size-7 shrink-0 rounded-lg" />
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <Skeleton className="h-3 w-20 rounded-sm" />
            <Skeleton className="h-20 w-full rounded-lg" />
            <Skeleton className="h-3 w-3/5 rounded-sm" />
          </div>
        </div>
      </div>
      <div className="relative z-20 px-3 pb-3 pt-1">
        <div className="relative mx-auto w-full max-w-[680px] [--composer-input-group-height:3.5rem]">
          <Skeleton
            data-boring-workspace-part="composer-loading-placeholder"
            className="min-h-[var(--composer-input-group-height)] w-full rounded-xl"
          />
          <div className="mt-2 flex min-h-8 items-center justify-center">
            <Skeleton className="h-3 w-40 rounded-sm" />
          </div>
        </div>
      </div>
    </div>
  )
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
      data-boring-workspace-part="workspace-loading-shell"
      className={cn(
        "flex h-full w-full flex-col bg-background text-foreground",
        fullscreen ? "min-h-screen" : "min-h-[240px]",
        className,
      )}
    >
      <div className="sr-only">
        <span>{title}</span>
        {description ? <span>{description}</span> : null}
        {status ? <span>{status}</span> : null}
      </div>
      <div aria-hidden="true" className="flex min-h-0 w-full flex-1 overflow-hidden">
        <aside className="workspace-loading-sidebar flex w-[268px] shrink-0 flex-col border-r border-border bg-[color:oklch(from_var(--background)_calc(l-0.012)_c_h)] p-4">
          <div className="flex h-8 items-center gap-3 pl-8">
            <Skeleton className="size-7 rounded-lg" />
            <Skeleton className="h-3 w-24 rounded-sm" />
          </div>
          <div className="mt-4 flex flex-col gap-2">
            <Skeleton className="h-2.5 w-16 rounded-sm" />
            <Skeleton className="h-8 w-full rounded-md" />
            <Skeleton className="h-8 w-5/6 rounded-md" />
            <Skeleton className="h-8 w-11/12 rounded-md" />
          </div>
          <div className="mt-5 flex min-h-0 flex-1 flex-col gap-2 border-t border-border/40 pt-4">
            <Skeleton className="h-2.5 w-12 rounded-sm" />
            <Skeleton className="h-8 w-28 rounded-md" />
            <Skeleton className="h-9 w-full rounded-md" />
            <Skeleton className="h-9 w-11/12 rounded-md" />
            <Skeleton className="h-9 w-4/5 rounded-md" />
          </div>
          <Skeleton className="h-8 w-8 rounded-md" />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col bg-background">
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-border/30 px-4">
            <Skeleton className="h-3 w-32 rounded-sm" />
            <div className="flex items-center gap-2">
              <Skeleton className="size-7 rounded-md" />
              <Skeleton className="size-7 rounded-md" />
            </div>
          </div>
          <WorkspaceTranscriptLoadingSurface />
        </div>
      </div>
    </section>
  )
}
