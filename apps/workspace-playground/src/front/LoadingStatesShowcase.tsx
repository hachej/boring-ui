import { WorkspaceLoadingState } from "@hachej/boring-workspace"
import {
  ChatSessionTransitionState,
  WorkbenchWarmupOverlay,
} from "../../../../packages/workspace/src/app/front/WorkspaceAgentStatusStates"

export type LoadingStateMode = "workspace" | "sessions" | "workbench" | "error"

export function LoadingStatesShowcase({ mode }: { mode: LoadingStateMode }) {
  if (mode === "workspace") {
    return (
      <WorkspaceLoadingState
        title="Opening workspace"
        description="Preparing secure runtime, files, sessions, and layout."
        status="Waking workspace runtime"
      />
    )
  }

  if (mode === "sessions") {
    return (
      <div className="bg-background" style={{ height: "100vh", width: "100vw" }}>
        <ChatSessionTransitionState />
      </div>
    )
  }

  return (
    <div className="bg-background" style={{ height: "100vh", padding: 32, width: "100vw" }}>
      <div
        className="mx-auto overflow-hidden rounded-xl border border-border bg-background"
        style={{ height: "min(720px, calc(100vh - 64px))", maxWidth: 920 }}
      >
        <WorkbenchWarmupOverlay
          status={mode === "error"
            ? { status: "failed", message: "The secure runtime did not respond before the timeout." }
            : { status: "preparing", requirement: "sandbox-exec" }}
        />
      </div>
    </div>
  )
}
