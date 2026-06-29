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
    : "Workspace workbench failed"
  const description = status.status === "failed"
    ? status.message
    : "Chat is ready while files, tools, and workspace panels finish warming up."
  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-background px-6 text-center">
      <div className="max-w-sm rounded-2xl border border-border bg-card p-5 shadow-sm">
        {preparing ? (
          <div className="mx-auto mb-3 h-7 w-7 rounded-full border-2 border-muted-foreground/20 border-t-foreground animate-spin" aria-hidden="true" />
        ) : null}
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        {status.status === "failed" ? (
          <p className="mt-3 text-xs text-muted-foreground">Reload the workspace to retry.</p>
        ) : null}
      </div>
    </div>
  )
}

export function ChatSessionTransitionState() {
  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-background px-6 text-center">
      <div className="max-w-sm rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="mx-auto mb-3 h-7 w-7 rounded-full border-2 border-muted-foreground/20 border-t-foreground animate-spin" aria-hidden="true" />
        <div className="text-sm font-semibold text-foreground">Loading sessions…</div>
        <p className="mt-2 text-sm text-muted-foreground">Finding this workspace’s saved chats.</p>
      </div>
    </div>
  )
}
