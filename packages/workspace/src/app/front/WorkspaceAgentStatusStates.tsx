import { Button, ErrorState } from "@hachej/boring-ui-kit"
import {
  WorkspaceTranscriptLoadingSurface,
  WorkspaceWorkbenchLoadingSurface,
} from "../../front/components/WorkspaceLoadingState"
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
      <WorkspaceWorkbenchLoadingSurface />
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
