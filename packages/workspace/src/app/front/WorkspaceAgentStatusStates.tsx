import { Button, ErrorState, Skeleton } from "@hachej/boring-ui-kit"
import { WorkspaceTranscriptLoadingSurface } from "../../front/components/WorkspaceLoadingState"
import type { WorkspaceWarmupStatus } from "./workspacePreload"

export function WorkbenchWarmupOverlay({ status }: { status: WorkspaceWarmupStatus }) {
  const requirement = status.status === "ready" ? undefined : status.requirement
  const preparing = status.status !== "failed"
  const title = preparing
    ? requirement === "workspace-fs"
      ? "Preparing files…"
      : requirement === "sandbox-exec"
        ? "Preparing secure runtime…"
        : requirement === "ui-bridge"
          ? "Connecting workspace…"
          : "Preparing workspace…"
    : "Workspace unavailable"
  const description = status.status === "failed"
    ? "The workspace runtime could not finish preparing. Reload the workspace to try again."
    : "Chat is ready while files, tools, and workspace panels finish warming up."

  if (!preparing) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center bg-background p-6">
        <ErrorState
          className="w-full max-w-md"
          title={title}
          description={description}
          details={status.message}
          actions={(
            <Button type="button" onClick={() => window.location.reload()}>
              Reload workspace
            </Button>
          )}
        />
      </div>
    )
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background"
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-boring-workspace-part="workbench-loading-surface"
    >
      <div className="sr-only">
        <span>{title}</span>
        <span>{description}</span>
      </div>
      <div aria-hidden="true" className="flex h-11 shrink-0 items-center gap-3 border-b border-border/40 px-4">
        <Skeleton className="size-5 rounded-md" />
        <Skeleton className="h-3 w-28 rounded-sm" />
      </div>
      <div aria-hidden="true" className="grid min-h-64 flex-1 grid-cols-[minmax(0,1fr)_minmax(12rem,0.42fr)]">
        <div className="flex min-h-64 flex-col gap-4 border-r border-border/40 p-4">
          <Skeleton className="h-3 w-24 rounded-sm" />
          <Skeleton className="h-8 w-full rounded-md" />
          <Skeleton className="h-8 w-4/5 rounded-md" />
          <Skeleton className="h-8 w-11/12 rounded-md" />
          <Skeleton className="mt-auto h-8 w-2/3 rounded-md" />
        </div>
        <div className="flex min-h-64 flex-col gap-4 p-4">
          <Skeleton className="h-3 w-20 rounded-sm" />
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
      </div>
    </div>
  )
}

export function ChatSessionTransitionState() {
  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Loading saved chats"
      data-boring-workspace-part="session-loading-surface"
    >
      <WorkspaceTranscriptLoadingSurface />
    </div>
  )
}
