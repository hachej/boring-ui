/**
 * Workspace context — resolves workspace from request.
 * Stub — implementation in Phase 3.
 */

export interface WorkspaceContext {
  workspaceId: string
  workspacePath: string
  userId: string
}

export function resolveWorkspaceContext(
  _workspaceId: string,
  _workspaceRoot: string,
): WorkspaceContext {
  throw new Error('Not implemented — see Phase 3')
}
