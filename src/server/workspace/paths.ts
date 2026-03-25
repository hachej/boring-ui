/**
 * Workspace path utilities — safe path resolution and validation.
 * Stub — implementation in Phase 2/3.
 * Mirrors Python's APIConfig.validate_path().
 */
import path from 'node:path'

export function ensureWorkspaceDir(
  workspaceRoot: string,
  workspaceId: string,
): string {
  return path.join(workspaceRoot, workspaceId)
}

export function validatePath(
  _workspaceRoot: string,
  _requestedPath: string,
): string {
  throw new Error('Not implemented — see Phase 2: Path validation')
}
