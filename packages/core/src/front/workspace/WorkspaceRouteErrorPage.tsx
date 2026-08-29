export type WorkspaceRouteErrorStatus = 'not-found' | 'forbidden' | 'switch-failed'

/**
 * Shared terminal state for a workspace-scoped route whose route status
 * resolved to something other than `matched` (not-found / forbidden /
 * switch-failed). Every workspace route (the main `/workspace/:id` shell,
 * members, settings, ...) renders this instead of its own content so a
 * non-member never sees a stale or half-loaded interactive shell.
 */
export function WorkspaceRouteErrorPage({ status, message }: { status: WorkspaceRouteErrorStatus; message: string }) {
  const title = status === 'not-found'
    ? 'Workspace not found'
    : status === 'forbidden'
      ? 'Workspace unavailable'
      : 'Workspace failed to open'
  return (
    <div className="flex h-screen min-h-0 items-center justify-center bg-background px-6 text-foreground">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  )
}
